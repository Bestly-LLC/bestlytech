"""mercury_pulse (Pi cron job): Mercury balances, 30-day money in/out, trailing burn, recurring bills and the next
expected deposit -> cc_mercury_pulse, for the Money card on the admin Command Center.

READ-ONLY toward Mercury: GET only, the same read-only token and IPv4 rule as settlement-mercury (Bank Watch).
Only aggregates and merchant names leave this script; no account numbers, no card numbers, no raw transactions.

Owner: Penny (cost-cutter) for the money numbers; the freshness watchdog is cloud_admin_watch.py (check `mercury_balance`).
Schedule: every 30 minutes (crontab: 7,37 * * * *). A balance older than 3 hours trips the watchdog.
"""
import json
import statistics
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, "/opt/bestly/cron")
import lib  # noqa: E402
from jobs import settlement_mercury as sm  # noqa: E402  (token lookup, IPv4-only block, GET helper)

SKIP_COUNTERPARTY = ("mercury credit", "mercury io cashback")   # card payments (counted at the purchase) and the cashback crumbs
SKIP_KIND = ("internaltransfer", "treasurytransfer", "externaltransfer")


def _when(t):
    s = t.get("postedAt") or t.get("createdAt") or ""
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def _all_transactions(token, start):
    out, after = [], None
    for _ in range(40):
        q = "/transactions?limit=500&start=%s" % start + ("&start_after=%s" % after if after else "")
        r = sm._mercury_get(q, token)
        out += r.get("transactions", [])
        after = (r.get("page") or {}).get("nextPage")
        if not after or not r.get("transactions"):
            break
    return out


def _bills(tx, today):
    """Recurring outflows: same merchant, steady amount, steady gap (weekly / every two weeks / monthly)."""
    by = {}
    for t in tx:
        if t["amount"] >= 0:
            continue
        name = (t.get("counterpartyNickname") or t.get("counterpartyName") or "").strip()
        if not name or name.lower() in SKIP_COUNTERPARTY or t["_kind"] in SKIP_KIND:
            continue
        by.setdefault(name, []).append(t)
    bills = []
    for name, rows in by.items():
        rows.sort(key=lambda r: r["_at"])
        if len(rows) < 2:
            continue
        amts = [-r["amount"] for r in rows]
        if max(amts) > min(amts) * 1.25 + 0.5:
            continue
        gaps = [(b["_at"] - a["_at"]).total_seconds() / 86400 for a, b in zip(rows, rows[1:])]
        g = statistics.median(gaps)
        if 26 <= g <= 35:
            every = 30
        elif 12 <= g <= 17 and len(rows) >= 3:
            every = 14
        elif 6 <= g <= 8 and len(rows) >= 3:
            every = 7
        else:
            continue
        nxt = rows[-1]["_at"].date() + timedelta(days=every)
        while nxt < today - timedelta(days=2):
            nxt += timedelta(days=every)
        if nxt > today + timedelta(days=40):
            continue
        bills.append({"name": name[:32], "amount": round(statistics.median(amts), 2), "next": nxt.isoformat(), "every_days": every})
    bills.sort(key=lambda b: b["next"])
    return bills[:8]


def _next_deposit(tx, now):
    """Turo pays out on a steady rhythm: next = last payout + the usual gap, amount = the usual payout (14 days)."""
    pays = sorted((t for t in tx if t["amount"] > 0 and t["_kind"] not in SKIP_KIND
                   and (t.get("counterpartyName") or "").lower() == "turo"), key=lambda t: t["_at"])
    if len(pays) < 3:
        return None
    days = sorted({p["_at"].date() for p in pays})
    gaps = [(b - a).days for a, b in zip(days, days[1:]) if (b - a).days > 0]
    gap = max(1, int(statistics.median(gaps))) if gaps else 1
    recent = [p["amount"] for p in pays if p["_at"] > now - timedelta(days=14)] or [p["amount"] for p in pays[-5:]]
    nxt = pays[-1]["_at"] + timedelta(days=gap)
    while nxt < now:
        nxt += timedelta(days=gap)
    return {"amount": round(statistics.median(recent), 2), "expected_at": nxt.isoformat(),
            "basis": "Turo pays about every %d day%s" % (gap, "" if gap == 1 else "s")}


def main(argv):
    dry = "--dry" in argv
    token = sm._env_token() or sm._vault_token()
    if not token:
        raise RuntimeError("no Mercury token (Vault pi:mercury_api_token)")
    now = datetime.now(timezone.utc)
    today = now.date()
    with sm.force_ipv4():
        accts = sm._mercury_get("/accounts", token).get("accounts", [])
        tx = _all_transactions(token, (today - timedelta(days=125)).isoformat())
    live = [a for a in accts if a.get("status") == "active"]
    accounts = [{"name": (a.get("nickname") or a.get("name") or "Account")[:40], "last4": str(a.get("accountNumber") or "")[-4:],
                 "balance": round(float(a.get("availableBalance") or 0), 2)} for a in live]
    total = round(sum(a["balance"] for a in accounts), 2)
    rows = []
    for t in tx:
        at = _when(t)
        try:
            amt = float(t.get("amount"))
        except (TypeError, ValueError):
            continue
        if at is None or t.get("status") in ("failed", "cancelled"):
            continue
        rows.append({**t, "amount": amt, "_at": at, "_kind": str(t.get("kind") or "").lower()})
    cut = now - timedelta(days=30)
    win = [t for t in rows if t["_at"] >= cut and t["_kind"] not in SKIP_KIND
           and (t.get("counterpartyName") or "").lower() not in SKIP_COUNTERPARTY]
    in_30 = round(sum(t["amount"] for t in win if t["amount"] > 0), 2)
    out_30 = round(-sum(t["amount"] for t in win if t["amount"] < 0), 2)
    payload = {"accounts": accounts, "total": total, "in_30d": in_30, "out_30d": out_30, "burn_daily": round(out_30 / 30, 2),
               "bills": _bills(rows, today), "next_deposit": _next_deposit(rows, now)}
    if dry:
        print(json.dumps(payload, indent=1)[:3000])
        return "ok dry"
    lib.rpc("cc_mercury_ingest", p=payload)
    return "ok $%.2f across %d accounts, 30d in $%.2f out $%.2f, %d recurring bills" % (total, len(accounts), in_30, out_30, len(payload["bills"]))
