"""Vera's compliance check engine (shared by jobs/compliance_daily.py and jobs/compliance_weekly.py). Free: no AI, no Claude.

run_checks(checks) -> [{"id", "ok": True|False|None, "detail"}]   ok None = the check could not run (page/API down), not a failure.
Kinds: http_contains, http_absent, http_status, policy_fresh, page_hosts (rendered through the Pi Chrome, see compliance_browser.py),
sql_zero, sql_true (read-only, through the compliance_run_sql RPC), elevenlabs, listing (iTunes lookup), domain_expiry (RDAP),
deadline (runs the reminder tick).
Pages that are single-page apps are rendered; a plain 200 from bestly.tech proves nothing (CLAUDE.md).
"""
import datetime
import json
import os
import re
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

import lib

# The Pi's IPv6 route to Cloudflare black-holes (SYN-SENT for 30 s per request), so try IPv4 addresses first. IPv6 stays as the fallback.
_gai = socket.getaddrinfo


def _gai_v4_first(*a, **kw):
    res = _gai(*a, **kw)
    return sorted(res, key=lambda r: 0 if r[0] == socket.AF_INET else 1)


socket.getaddrinfo = _gai_v4_first

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 BestlyComplianceBot/1"
BROWSER = ["/opt/bestly/turo-watch/.venv/bin/python", "/opt/bestly/cron/compliance_browser.py"]
STATE_DIR = "/opt/bestly/cron/state/compliance"
BATCH = 12  # pages per browser process, so one hung page cannot sink the whole run


# ------------------------------------------------------------------ text helpers
def norm(t):
    t = (t or "").replace(" ", " ").replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", t).strip().lower()


def fetch_plain(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.8"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore")[:200000]


def status_only(url, timeout=30):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def plain_text(html_):
    html_ = re.sub(r"(?is)<(script|style|noscript|svg)[^>]*>.*?</\1>", " ", html_)
    html_ = re.sub(r"(?s)<[^>]+>", " ", html_)
    import html as _h
    return _h.unescape(html_)


# ------------------------------------------------------------------ rendering (browser) with a per-run cache
_page_cache = {}


def render_pages(reqs):
    """reqs: list of {"url", "click"?}. Fills _page_cache[(url, click)]."""
    todo = [r for r in reqs if (r["url"], r.get("click")) not in _page_cache]
    seen, uniq = set(), []
    for r in todo:
        k = (r["url"], r.get("click"))
        if k not in seen:
            seen.add(k)
            uniq.append({"url": r["url"], "click": r.get("click")})
    for i in range(0, len(uniq), BATCH):
        chunk = uniq[i:i + BATCH]
        try:
            out = subprocess.run(BROWSER + [json.dumps(chunk)], capture_output=True, text=True, timeout=60 * len(chunk) + 60)
            if out.returncode != 0:
                raise RuntimeError((out.stderr or out.stdout)[-300:])
            data = json.loads(out.stdout)
            for r, page in zip(chunk, data["pages"]):
                page["how"] = data.get("how")
                _page_cache[(r["url"], r.get("click"))] = page
        except Exception as e:  # noqa: BLE001
            for r in chunk:
                _page_cache[(r["url"], r.get("click"))] = {"url": r["url"], "status": None, "text": "", "hosts": [], "cookies": 0,
                                                           "local_storage": 0, "error": "browser: " + str(e)[:200]}


def get_page(url, click=None):
    if (url, click) not in _page_cache:
        render_pages([{"url": url, "click": click}])
    return _page_cache[(url, click)]


def page_text(chk):
    """(norm_text, status, error) for an http_* check; rendered by default for anything that is not a feed/file."""
    p = chk["params"] or {}
    url = chk["target"]
    if p.get("rendered"):
        pg = get_page(url, p.get("click"))
        if pg.get("error") and not pg.get("text"):
            return None, pg.get("status"), pg["error"]
        # a click that failed is a failure of the check, not a pass
        return norm(pg["text"]), pg.get("status"), pg.get("error")
    st, body = fetch_plain(url)
    return norm(plain_text(body) if "<" in body[:2000] and "<?xml" not in body[:100] else body), st, None


# ------------------------------------------------------------------ evaluators
def ev_contains(chk):
    p = chk["params"] or {}
    txt, st, err = page_text(chk)
    if txt is None:
        return None, err
    if err and p.get("click"):
        return None, err
    if st is not None and st >= 400:
        return False, f"page answered HTTP {st}"
    missing = [n for n in p.get("all", []) if norm(n) not in txt]
    missing += [f"/{r}/" for r in p.get("regex", []) if not re.search(r, txt, re.I)]
    if p.get("any") and not any(norm(n) in txt for n in p["any"]):
        missing.append("any of: " + ", ".join(p["any"]))
    if p.get("min_len") and len(txt) < p["min_len"]:
        missing.append(f"page text only {len(txt)} chars (needs {p['min_len']})")
    if missing:
        return False, "missing: " + "; ".join(missing)[:400]
    return True, f"found all ({len(txt)} chars)"


def ev_absent(chk):
    p = chk["params"] or {}
    if p.get("assets"):
        return ev_assets(chk)
    txt, st, err = page_text(chk)
    if txt is None:
        return None, err
    if st is not None and st >= 400 and p.get("pass_if_status_gte") and st >= p["pass_if_status_gte"]:
        return True, f"page is offline (HTTP {st})"
    if st is not None and st >= 400:
        return False, f"page answered HTTP {st}"
    hit = [n for n in p.get("banned", []) if norm(n) in txt]
    hit += [f"/{r}/" for r in p.get("regex", []) if re.search(r, txt, re.I)]
    if hit:
        return False, "found: " + "; ".join(hit)[:400]
    return True, f"none of {len(p.get('banned', [])) + len(p.get('regex', []))} phrases found"


def ev_assets(chk):
    """Search the site's JS files (the entry bundle and every chunk it names) for banned strings."""
    p = chk["params"]
    st, html_ = fetch_plain(chk["target"])
    if st >= 400:
        return None, f"home answered HTTP {st}"
    base = chk["target"]
    todo = [urllib.parse.urljoin(base, m) for m in re.findall(r'(?:src|href)="([^"]+\.js)"', html_)]
    seen, hits = set(), []
    banned = p.get("banned", [])
    while todo and len(seen) < 90:
        u = todo.pop(0)
        if u in seen:
            continue
        seen.add(u)
        try:
            s, body = fetch_plain(u, 40)
        except Exception:  # noqa: BLE001
            continue
        if s != 200:
            continue
        for b in banned:
            if b in body:
                hits.append(u.rsplit("/", 1)[-1])
        for m in re.findall(r'assets/[A-Za-z0-9_.-]+\.js', body):
            todo.append(urllib.parse.urljoin(base, "/" + m))
    if hits:
        return False, f"'{banned[0]}' found in " + ", ".join(sorted(set(hits)))[:300]
    return True, f"{len(seen)} script files scanned, none contain the banned text"


def ev_status(chk):
    exp = (chk["params"] or {}).get("expect", [200])
    st = status_only(chk["target"])
    return (st in exp), f"HTTP {st} (want {'/'.join(map(str, exp))})"


def ev_fresh(chk):
    p = chk["params"] or {}
    txt, st, err = page_text(chk)
    if txt is None:
        return None, err
    m = re.search(r"(?:last updated|updated|effective(?: date)?)\W{0,4}\s*(?:on\s*)?([a-z]{3,9})\.? (\d{1,2}),? (20\d\d)", txt)
    if not m:
        return False, "no 'Last updated' date on the page"
    try:
        d = datetime.datetime.strptime(f"{m.group(1)[:3].title()} {m.group(2)} {m.group(3)}", "%b %d %Y").date()
    except ValueError:
        return False, f"could not read the date '{m.group(0)}'"
    age = (datetime.date.today() - d).days
    lim = p.get("max_age_days", 365)
    return age <= lim, f"last updated {d.isoformat()} ({age} days ago, limit {lim})"


def ev_hosts(chk):
    p = chk["params"] or {}
    pg = get_page(chk["target"], None)
    if pg.get("error") and not pg.get("hosts"):
        return None, pg["error"]
    allow = p.get("allow", [])
    bad = [h for h in pg["hosts"] if not any(h == a or h.endswith("." + a) for a in allow)]
    trackers = [h for h in pg["hosts"] if any(d in h for d in p.get("deny", []))]
    probs = []
    if trackers:
        probs.append("tracker hosts: " + ", ".join(trackers))
    if bad:
        probs.append("new third parties: " + ", ".join(bad))
    if pg["cookies"] > p.get("max_cookies", 0):
        probs.append(f"{pg['cookies']} cookies set before any click")
    if pg["local_storage"] > p.get("max_local_storage", 0):
        probs.append(f"{pg['local_storage']} localStorage keys set before any click")
    if probs:
        return False, "; ".join(probs)[:400]
    return True, f"{len(pg['hosts'])} hosts, all approved; 0 cookies, 0 storage keys"


def ev_sql(chk, want_true):
    r = lib.rpc("compliance_run_sql", p_sql=chk["target"])
    if not isinstance(r, dict) or not r:
        return None, "query returned no row"
    v = next(iter(r.values()))
    if want_true:
        return v is True, f"value={v}"
    try:
        return float(v) == 0, f"count={v}"
    except (TypeError, ValueError):
        return v is False, f"value={v}"


_el_key = None


def el_get(path):
    global _el_key
    if _el_key is None:
        _el_key = lib.rpc("pi_secret", p_name="elevenlabs_api_key") or ""
    if not _el_key:
        raise RuntimeError("no ElevenLabs key in Vault")
    req = urllib.request.Request("https://api.elevenlabs.io" + path, headers={"xi-api-key": _el_key, "User-Agent": "bestly-compliance/1"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"ElevenLabs HTTP {e.code} for {path.split('?')[0]}")


def ev_eleven(chk):
    p = chk["params"] or {}
    aid = p.get("agent_id")
    if not aid and p.get("agent_name"):
        lst = el_get("/v1/convai/agents?page_size=100&search=" + urllib.parse.quote(p["agent_name"]))
        for a in lst.get("agents", []):
            if p["agent_name"].lower() in (a.get("name") or "").lower():
                aid = a["agent_id"]
                break
    if not aid:
        return None, "could not find the agent in ElevenLabs"
    a = el_get(f"/v1/convai/agents/{aid}")
    fm = (((a.get("conversation_config") or {}).get("agent") or {}).get("first_message")) or ""
    ret = ((a.get("platform_settings") or {}).get("privacy") or {}).get("retention_days")
    probs, notes = [], []
    for rule in p.get("rules", []):
        if rule == "first_message_ai":
            if not re.search(r"\bAI\b", fm):
                probs.append("first message does not say AI")
        elif rule == "first_message_record":
            if "record" not in fm.lower():
                probs.append("first message does not say calls are recorded")
        elif rule == "retention_1_90":
            if not isinstance(ret, int):
                return None, "retention_days not readable from the agent"
            if not (1 <= ret <= 90):
                probs.append(f"retention_days is {ret} (want 1 to 90)")
            notes.append(f"retention {ret} days")
    if probs:
        return False, "; ".join(probs)
    return True, "ok" + (": " + ", ".join(notes) if notes else "")


def _state(name):
    try:
        with open(os.path.join(STATE_DIR, name + ".json")) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _save_state(name, obj, dry):
    if dry:
        return
    os.makedirs(STATE_DIR, exist_ok=True)
    with open(os.path.join(STATE_DIR, name + ".json"), "w") as f:
        json.dump(obj, f)


def ev_listing(chk, dry):
    p = chk["params"]
    j = json.loads(fetch_plain(f"https://itunes.apple.com/lookup?id={p['track_id']}&country={p.get('country', 'us')}")[1])
    if not j.get("results"):
        return False, "iTunes lookup found no app (removed from the store?)"
    r = j["results"][0]
    cur = {"version": r.get("version"), "released": r.get("currentVersionReleaseDate"), "name": r.get("trackName")}
    old = _state("listing_" + p["track_id"])
    extra = ""
    if old and old.get("version") != cur["version"]:
        extra = f" CHANGED from {old.get('version')}"
        if not dry:
            try:
                lib.rpc("compliance_alert", p_key=f"compliance.listing.{p['track_id']}.{cur['version']}",
                        p_title=f"{cur['name']} is now {cur['version']} on the App Store",
                        p_body=f"It was {old.get('version')}. Re-check the privacy label, the policy and the age rating against what this version does.",
                        p_money=False)
            except Exception:  # noqa: BLE001
                pass
    _save_state("listing_" + p["track_id"], cur, dry)
    return True, f"{cur['name']} {cur['version']} released {str(cur['released'])[:10]}{extra}"


RDAP = {"io": "https://rdap.identitydigital.services/rdap/domain/"}  # rdap.org has no .io; everything else goes through rdap.org


def ev_domain(chk):
    p = chk["params"]
    d = chk["target"]
    base = RDAP.get(d.rsplit(".", 1)[-1], "https://rdap.org/domain/")
    j = json.loads(fetch_plain(base + d, 40)[1])
    exp = next((e.get("eventDate") for e in j.get("events", []) if e.get("eventAction") == "expiration"), None)
    if not exp:
        return None, "RDAP gave no expiration date"
    days = (datetime.datetime.fromisoformat(exp.replace("Z", "+00:00")).date() - datetime.date.today()).days
    ok = days >= p.get("min_days", 60)
    return ok, f"{d} expires {exp[:10]} ({days} days)" + ("" if ok else ", renew it")


def ev_deadline(chk, dry):
    if dry:
        return True, "dry run: reminders not sent"
    r = lib.rpc("compliance_deadline_tick")
    return True, f"reminders sent: {r.get('reminded') if isinstance(r, dict) else r}"


# ------------------------------------------------------------------ driver
def run_checks(checks, dry=False, only=None):
    checks = [c for c in checks if not only or c["id"].startswith(only)]
    # warm the browser cache once, in batches, for every page-based check
    reqs = []
    for c in checks:
        p = c["params"] or {}
        if c["kind"] in ("http_contains", "http_absent", "policy_fresh") and p.get("rendered"):
            reqs.append({"url": c["target"], "click": p.get("click")})
        elif c["kind"] == "page_hosts":
            reqs.append({"url": c["target"], "click": None})
    if reqs:
        render_pages(reqs)
    out = []
    for c in checks:
        t0 = time.time()
        try:
            k = c["kind"]
            if k == "http_contains":
                ok, d = ev_contains(c)
            elif k == "http_absent":
                ok, d = ev_absent(c)
            elif k == "http_status":
                ok, d = ev_status(c)
            elif k == "policy_fresh":
                ok, d = ev_fresh(c)
            elif k == "page_hosts":
                ok, d = ev_hosts(c)
            elif k == "sql_zero":
                ok, d = ev_sql(c, False)
            elif k == "sql_true":
                ok, d = ev_sql(c, True)
            elif k == "elevenlabs":
                ok, d = ev_eleven(c)
            elif k == "listing":
                ok, d = ev_listing(c, dry)
            elif k == "domain_expiry":
                ok, d = ev_domain(c)
            elif k == "deadline":
                ok, d = ev_deadline(c, dry)
            else:
                ok, d = None, f"unknown kind {k}"
        except Exception as e:  # noqa: BLE001
            ok, d = None, f"{type(e).__name__}: {str(e)[:200]}"
        out.append({"id": c["id"], "ok": ok, "detail": d, "ms": int((time.time() - t0) * 1000)})
    return out


def off_switch(job):
    for f in ("/opt/bestly/cron/state/compliance.OFF", f"/opt/bestly/cron/state/{job}.OFF"):
        if os.path.exists(f):
            return f
    return None


def summarize(results):
    ok = sum(1 for r in results if r["ok"] is True)
    bad = [r for r in results if r["ok"] is False]
    err = [r for r in results if r["ok"] is None]
    return ok, bad, err
