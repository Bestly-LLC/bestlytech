"""Penny: weekly Mercury merchant totals -> spend_merchants. Aggregates only; no raw transactions leave memory."""
import json, os, re, socket, sys, time, statistics, urllib.request, urllib.error, urllib.parse
from datetime import date, datetime, timedelta, timezone

ENV = "/home/pi/scripts/.env"
STATE = "/opt/bestly/cron/state/penny_bank.json"
MERC = "https://api.mercury.com/api/v1"
UA = "bestly-penny/1.0"
WD_TOKEN_FILE = os.environ.get("SETTLEMENT_TOKEN_FILE", "/home/pi/.bestly/db_watchdog_token")


def load_env():
    e = {}
    try:
        for ln in open(ENV):
            ln = ln.strip()
            if not ln or ln.startswith("#") or "=" not in ln:
                continue
            if ln.startswith("export "):
                ln = ln[7:]
            k, v = ln.split("=", 1)
            e[k.strip()] = v.strip().strip('"').strip("'")
    except OSError:
        pass
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "MERCURY_API_TOKEN"):
        if os.environ.get(k) and not e.get(k):
            e[k] = os.environ[k]
    return e


def http(method, url, headers, body=None, timeout=40):
    data = json.dumps(body).encode() if body is not None else None
    h = {"User-Agent": UA, "Accept": "application/json"}
    h.update(headers)
    if data is not None:
        h["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode() or "null"
            return json.loads(raw)
    except urllib.error.HTTPError as ex:
        raise RuntimeError("HTTP %s %s" % (ex.code, url.split("?")[0]))


class SB:
    def __init__(self, env):
        self.u = env["SUPABASE_URL"].rstrip("/")
        k = env["SUPABASE_SERVICE_ROLE_KEY"]
        self.h = {"apikey": k, "Authorization": "Bearer " + k}

    def get(self, path):
        return http("GET", self.u + "/rest/v1/" + path, self.h)

    def post(self, path, body, prefer):
        h = dict(self.h)
        h["Prefer"] = prefer
        return http("POST", self.u + "/rest/v1/" + path, h, body)

    def patch(self, path, body):
        h = dict(self.h)
        h["Prefer"] = "return=minimal"
        return http("PATCH", self.u + "/rest/v1/" + path, h, body)

    def rpc(self, fn, body):
        return http("POST", self.u + "/rest/v1/rpc/" + fn, self.h, body)


def norm_merchant(name):
    s = re.sub(r"\s+", " ", (name or "").strip())
    for _ in range(3):
        s2 = re.sub(r"\s*[#*]\s*[A-Za-z0-9-]{3,}$", "", s)
        s2 = re.sub(r"\s+(store\s*)?\d{3,}$", "", s2, flags=re.I).strip(" -*#")
        if s2 == s:
            break
        s = s2
    return s


class force_ipv4(object):
    """Mercury allowlists a token by source address and the Pi is dual-stack: left alone it reaches api.mercury.com over
    IPv6, which nobody allowlisted. Inside this block every lookup is IPv4 only. Same fix as mercury-sync (2026-10-14)
    and settlement-mercury (1b08e626)."""

    def __enter__(self):
        self._real = socket.getaddrinfo

        def ipv4_only(host, port, family=0, *args, **kwargs):
            return self._real(host, port, socket.AF_INET, *args, **kwargs)

        socket.getaddrinfo = ipv4_only
        return self

    def __exit__(self, *exc):
        socket.getaddrinfo = self._real
        return False


def mercury_token(env, sb):
    """Same order as settlement-mercury: MERCURY_API_TOKEN in the Pi .env, then Vault pi:mercury_api_token through the
    service-role RPC pi_secret_get, then mercury_token_t with the db-watchdog token. Never printed. Returns (token, why)."""
    t = (env.get("MERCURY_API_TOKEN") or "").strip()
    if t:
        return t, ""
    try:
        v = sb.rpc("pi_secret_get", {"p_name": "pi:mercury_api_token"})
        if isinstance(v, str) and v.strip():
            return v.strip(), ""
    except Exception:  # noqa: BLE001  (not allowlisted, not saved, or DB briefly down: fall through)
        pass
    try:
        with open(WD_TOKEN_FILE) as f:
            wd = f.read().strip()
        v = sb.rpc("mercury_token_t", {"p_token": wd})
        if isinstance(v, str) and v.strip():
            return v.strip(), ""
        return "", ""
    except Exception as e:  # noqa: BLE001
        return "", " (mercury_token_t: %s)" % type(e).__name__


def mercury_txns(token):
    h = {"Authorization": "Bearer " + token}
    accts = http("GET", MERC + "/accounts", h).get("accounts", [])
    names = set()
    for a in accts:
        for f in ("name", "nickname", "legalBusinessName"):
            if a.get(f):
                names.add(re.sub(r"\s+", " ", str(a[f]).strip()).lower())
    start = (date.today() - timedelta(days=120)).isoformat()
    out = []
    for a in accts:
        off = 0
        while True:
            q = urllib.parse.urlencode({"start": start, "limit": 500, "offset": off})
            r = http("GET", "%s/account/%s/transactions?%s" % (MERC, a["id"], q), h)
            tx = r.get("transactions", [])
            for t in tx:
                try:
                    amt = float(t.get("amount") or 0)
                except (TypeError, ValueError):
                    continue
                if amt >= 0 or t.get("status") in ("failed", "cancelled"):
                    continue
                cp = re.sub(r"\s+", " ", (t.get("counterpartyName") or "").strip())
                if t.get("kind") == "internalTransfer" or cp.lower() in names or not cp:
                    continue
                d = (t.get("postedAt") or t.get("createdAt") or "")[:10]
                try:
                    d = date.fromisoformat(d)
                except ValueError:
                    continue
                out.append((norm_merchant(cp), d, -amt))
            off += len(tx)
            if len(tx) < 500 or off >= int(r.get("total") or 0):
                break
    return out


def cadence_of(days):
    if not days:
        return None
    m = statistics.median(days)
    if 5 <= m <= 9:
        return "weekly"
    if 26 <= m <= 36:
        return "monthly"
    if 350 <= m <= 380:
        return "yearly"
    return "irregular"


def aggregate(txns):
    by = {}
    for m, d, a in txns:
        if m:
            by.setdefault(m.lower(), []).append((m, d, a))
    rows = []
    for _, lst in by.items():
        lst.sort(key=lambda x: x[1])
        amts = [x[2] for x in lst]
        med = statistics.median(amts)
        band = [x for x in lst if abs(x[2] - med) <= 0.2 * med] or lst[-1:]
        ds = [x[1] for x in band]
        gaps = [(ds[i + 1] - ds[i]).days for i in range(len(ds) - 1)]
        gaps = [g for g in gaps if g > 0]
        cad = cadence_of(gaps)
        rec = len(band) >= 2 and cad in ("weekly", "monthly", "yearly")
        avg = sum(x[2] for x in band) / len(band)
        est = {"weekly": avg * 52 / 12, "monthly": avg, "yearly": avg / 12}.get(cad)
        rows.append({"merchant": lst[-1][0], "charges": len(lst), "avg_amount_usd": round(avg, 2),
                     "last_amount_usd": round(lst[-1][2], 2), "first_seen": lst[0][1].isoformat(),
                     "last_seen": lst[-1][1].isoformat(), "cadence": cad,
                     "est_monthly_usd": round(est, 2) if (rec and est) else None, "_rec": rec})
    return rows


def rd_state():
    try:
        return json.load(open(STATE))
    except Exception:
        return {}


def wr_state(s):
    try:
        os.makedirs(os.path.dirname(STATE), exist_ok=True)
        json.dump(s, open(STATE, "w"))
    except OSError:
        pass


def ask_guess(merchant):
    sys.path.insert(0, "/opt/bestly/cron")
    import freellm
    prompt = ("In 3 to 6 words, plainly say what kind of business or product this bank-statement "
              "merchant name is (example answers: domain registrar, design software subscription). "
              "Reply with only the words, no punctuation or quotes. If unsure, reply: unclear. Merchant: " + merchant)
    msgs = [{"role": "user", "content": prompt}]
    res = None
    for call in (lambda: freellm.chat(msgs), lambda: freellm.chat(prompt), lambda: freellm.ask(prompt)):
        try:
            res = call()
            if res:
                break
        except Exception:
            continue
    if isinstance(res, dict):
        res = res.get("text") or res.get("content") or ((res.get("choices") or [{}])[0].get("message") or {}).get("content")
    if not isinstance(res, str):
        return None
    g = re.sub(r"<think>.*?</think>", "", res, flags=re.S).strip().splitlines()
    g = (g[-1] if g else "").strip().strip("\"'.` ").lower()
    if not g or g == "unclear" or len(g.split()) > 8 or len(g) > 60:
        return None
    return g


def main(argv):
    dry = "--dry" in (argv or [])
    env = load_env()
    if not env.get("SUPABASE_URL") or not env.get("SUPABASE_SERVICE_ROLE_KEY"):
        raise RuntimeError("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing in " + ENV)
    sb = SB(env)
    tok, why = mercury_token(env, sb)
    if not tok:
        if dry:
            return "dry: no Mercury token%s (.env, Vault pi:mercury_api_token, mercury_token_t); would raise cost.feed once per 7 days" % why
        st = rd_state()
        if time.time() - st.get("raised_at", 0) > 7 * 86400:
            sb.rpc("bestly_raise", {
                "p_key": "cost.feed", "p_kind": "problem", "p_severity": "info",
                "p_title": "Penny: I need a read-only Mercury token on the Pi",
                "p_body": "Create one in Mercury > Settings > API tokens (Read only), then save it as MERCURY_API_TOKEN in the Pi env. Until then I only watch internal usage.",
                "p_area": "cost", "p_needs_jared": "Add read-only Mercury token"})
            st["raised_at"] = time.time()
            wr_state(st)
            return "ok no Mercury token yet; raised cost.feed ask"
        return "ok no Mercury token yet; ask already raised this week"
    with force_ipv4():
        txns = mercury_txns(tok)
    rows = aggregate(txns)
    rec = [r for r in rows if r["_rec"]]
    est = sum(r["est_monthly_usd"] or 0 for r in rec)
    if dry:
        top = sorted(rec, key=lambda r: -(r["est_monthly_usd"] or 0))[:10]
        for r in top:
            print("  %-34s %-8s avg $%-8.2f est $%.2f/mo x%d" % (r["merchant"][:34], r["cadence"], r["avg_amount_usd"], r["est_monthly_usd"], r["charges"]))
        return "dry: merchants %d, recurring %d, est $%.0f/mo (no writes)" % (len(rows), len(rec), est)
    now = datetime.now(timezone.utc).isoformat()
    have = {m["merchant"].lower() for m in sb.get("spend_merchants?select=merchant&limit=5000")}
    new = sum(1 for r in rec if r["merchant"].lower() not in have)
    payload = [{k: v for k, v in r.items() if k != "_rec"} | {"source": "pi", "updated_at": now} for r in rec]
    for i in range(0, len(payload), 100):
        sb.post("spend_merchants?on_conflict=merchant", payload[i:i + 100], "resolution=merge-duplicates,return=minimal")
    guesses = 0
    try:
        todo = sb.get("spend_merchants?select=merchant&status=eq.unknown&guess=is.null&limit=20")
        for m in todo:
            g = ask_guess(m["merchant"])
            if g:
                sb.patch("spend_merchants?merchant=eq." + urllib.parse.quote(m["merchant"], safe=""), {"guess": g})
                guesses += 1
            time.sleep(1)
    except Exception:
        pass
    try:
        sb.rpc("cost_cutter_discover", {})
    except Exception:
        pass
    return "ok merchants %d, recurring %d, est $%.0f/mo, new unknown %d, guesses %d" % (len(rows), len(rec), est, new, guesses)


if __name__ == "__main__":
    print(main(sys.argv[1:]))
