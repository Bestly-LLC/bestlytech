"""Bank Watch (Nickel, Settlements Clerk) - matches Mercury deposits to settlement claims. bestly-pi, every 2 hours at :07.

Installed as /opt/bestly/cron/jobs/settlement_mercury.py (+ jobs/settlement-mercury.py wrapper) and run by
/opt/bestly/cron/run.sh settlement-mercury, which reports the heartbeat to pi_jobs via runjob.py -> pi_job_report.

  1. Mercury READ-ONLY API: GET /accounts, GET /account/<id>/transactions  (Bearer MERCURY_API_TOKEN)
  2. keep CREDITS only (amount > 0, status sent, not an internal transfer between his own Mercury accounts)
  3. settlement_mercury_ingest_t(p_token, p_txns)  -> matches each deposit to one claim, marks it paid with the exact amount,
     parks look-alikes in settlement_unmatched_bank. Idempotent on the Mercury transaction id.

HARD LIMITS: no write endpoint of Mercury is ever called (no transfers, no payments, no recipients, no webhooks). No bank
data is written anywhere but the settlement ledger tables. Free: plain code, no AI.

Auth
  Mercury : MERCURY_API_TOKEN in /home/pi/scripts/.env, or else the token saved on the admin page /admin/cost-cutter (write-only
            field -> Vault secret pi:mercury_api_token -> rpc mercury_token_t). Same read-only key Penny's penny_bank job reads.
            Never printed, logged or committed. Missing -> the run reports "ok no Mercury token yet" and does nothing.
  Supabase: the house db-watchdog token (db_watchdog_ok) from /home/pi/.bestly/db_watchdog_token (mode 600), sent with the
            project's publishable key, same as the settlement finder.

  python3 settlement_mercury.py [--dry] [--days N]      default 14 days
  python3 settlement_mercury.py --backfill [--dry]      365 days, once
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, "/opt/bestly/cron")
import lib  # noqa: E402  (SUPABASE_URL from the Pi .env)

ENV = "/home/pi/scripts/.env"
MERC = "https://api.mercury.com/api/v1"
UA = "bestly-bank-watch/1.0"
PUBLISHABLE = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw")  # public by design
TOKEN_FILE = os.environ.get("SETTLEMENT_TOKEN_FILE", "/home/pi/.bestly/db_watchdog_token")
BATCH = 150


def _env_token():
    t = os.environ.get("MERCURY_API_TOKEN", "").strip()
    if t:
        return t
    try:
        for ln in open(ENV):
            ln = ln.strip()
            if ln.startswith("export "):
                ln = ln[7:]
            if ln.startswith("MERCURY_API_TOKEN="):
                return ln.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def _wd_token():
    with open(TOKEN_FILE) as f:
        t = f.read().strip()
    if not t:
        raise RuntimeError("db-watchdog token file is empty")
    return t


def _mercury_get(path, token, tries=3):
    """READ-ONLY: GET only. Retries network errors / 429 / 5xx."""
    last = None
    for i in range(tries):
        if i:
            time.sleep(3 * i)
        req = urllib.request.Request(MERC + path, method="GET", headers={
            "Authorization": "Bearer " + token, "Accept": "application/json", "User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode() or "null")
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise RuntimeError(f"Mercury refused the token (HTTP {e.code}); needs a new read-only token")
            if e.code < 500 and e.code != 429:
                raise RuntimeError(f"Mercury HTTP {e.code} on {path.split('?')[0]}")
            last = f"HTTP {e.code}"
        except Exception as e:  # noqa: BLE001
            last = str(e)
    raise RuntimeError(f"Mercury unreachable ({last})")


def sb(name, **args):
    body = json.dumps({"p_token": _wd_token(), **args}).encode()
    last = None
    for wait in (0, 3, 10, 30):
        if wait:
            time.sleep(wait)
        req = urllib.request.Request(lib.URL + "/rest/v1/rpc/" + name, data=body, method="POST", headers={
            "Content-Type": "application/json", "apikey": PUBLISHABLE, "Authorization": "Bearer " + PUBLISHABLE})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                raw = r.read().decode()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as e:
            txt = e.read().decode()[:300]
            if e.code < 500 and e.code != 429:
                raise RuntimeError(f"{name} -> HTTP {e.code}: {txt}")
            last = f"{name} -> HTTP {e.code}: {txt}"
        except Exception as e:  # noqa: BLE001
            last = f"{name} -> {e}"
    raise RuntimeError(last)


def fetch_credits(token, days):
    """Credits posted in the last `days` days across every Mercury account."""
    accts = _mercury_get("/accounts", token).get("accounts", [])
    # createdAt window a few days wider than the posted window (card/ACH rows post after they are created)
    start = (date.today() - timedelta(days=days + 4)).isoformat()
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    out = []
    for a in accts:
        off = 0
        while True:
            q = urllib.parse.urlencode({"start": start, "limit": 500, "offset": off, "status": "sent"})
            r = _mercury_get("/account/%s/transactions?%s" % (a["id"], q), token)
            tx = r.get("transactions", [])
            for t in tx:
                try:
                    amt = float(t.get("amount") or 0)
                except (TypeError, ValueError):
                    continue
                if amt <= 0 or t.get("status") not in (None, "sent"):
                    continue
                if str(t.get("kind", "")).lower() in ("internaltransfer", "treasurytransfer"):
                    continue
                posted = t.get("postedAt") or t.get("createdAt") or ""
                try:
                    if datetime.fromisoformat(posted.replace("Z", "+00:00")) < cutoff:
                        continue
                except ValueError:
                    pass
                out.append({"id": t["id"], "amount": amt, "postedAt": posted, "kind": t.get("kind"), "status": t.get("status") or "sent",
                            "counterpartyName": t.get("counterpartyName"), "bankDescription": t.get("bankDescription"),
                            "note": t.get("note") or t.get("externalMemo")})
            off += len(tx)
            if len(tx) < 500 or off >= int(r.get("total") or 0):
                break
    return out


def main(argv):
    argv = argv or []
    dry = "--dry" in argv
    days = 365 if "--backfill" in argv else 14
    if "--days" in argv:
        days = int(argv[argv.index("--days") + 1])
    token = _env_token()
    if not token:
        # Saved from the Cost Cutter page (write-only field, Vault secret pi:mercury_api_token); needs the db-watchdog token.
        try:
            token = (sb("mercury_token_t") or "").strip()
        except Exception:  # noqa: BLE001  (no token saved yet, or the DB is briefly unreachable: same quiet result)
            token = ""
    if not token:
        return "ok no Mercury token yet (MERCURY_API_TOKEN in /home/pi/scripts/.env, shared with Penny); nothing to check"
    credits = fetch_credits(token, days)
    if dry:
        return f"ok dry: {len(credits)} credits in the last {days} days, nothing sent"
    tot = {"matched": 0, "unmatched": 0, "skipped": 0, "newly_paid": 0}
    for i in range(0, len(credits), BATCH):
        res = sb("settlement_mercury_ingest_t", p_txns=credits[i:i + BATCH]) or {}
        for k in tot:
            tot[k] += int(res.get(k) or 0)
    lead = "ok " if not (tot["matched"] or tot["unmatched"]) else ""
    return (f"{lead}{len(credits)} credits in {days}d: {tot['matched']} matched ({tot['newly_paid']} newly paid), "
            f"{tot['unmatched']} to sort, {tot['skipped']} already seen/skipped")


if __name__ == "__main__":
    print(main(sys.argv[1:]))
