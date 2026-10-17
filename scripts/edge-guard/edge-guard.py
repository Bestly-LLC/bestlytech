#!/usr/bin/env python3
"""Edge Guard - the AI employee that owns the Cloudflare edge for bestly.tech, www.bestly.tech, cloud.bestly.tech.

Runs on the Mac mini from launchd (tech.bestly.edge-guard) once a minute. Free: plain Python, no AI, no Claude.
Full explanation: docs/edge-guard.md. Live copy: ~/bestly-agents/edge-guard/ (this file is the source).

Why it exists (2026-10-05): the Cloudflare account is on the Workers FREE plan, 100,000 requests a day shared by all
Workers. Two splash Workers sat on every request, the cap was hit, every visitor got error 1027. So now NO Worker
route exists normally (zero quota). Edge Guard attaches a splash route only while a site is failing:

  every minute  probe the 3 sites (origin health, judged through Cloudflare like a visitor)
  2 failures in a row   attach that site's splash route (fail open), alert Jared once
  3 healthy in a row    detach it, alert Jared once ("back up after N minutes")
  every run, always:
    - any Worker route on the zone that is fail-CLOSED is switched to fail open (whoever made it)
    - any splash route attached while the site is healthy is detached (undoes an accidental redeploy)
    - Cloudflare error 1027/429 seen: fix what it can (fail open, remove the Workers) and alert
    - a heartbeat is written to the database every run so Team Watch notices if Edge Guard itself stops

Credentials, nothing new and nothing moved:
  - Cloudflare: the wrangler OAuth login already on this Mac (~/Library/Preferences/.wrangler/config/default.toml),
    refreshed with `npx wrangler whoami` when it is about to expire. The token is read into memory, used for the
    API call, and never printed, logged, copied or sent anywhere.
  - Database: the publishable key + the Mac watchdog token in Keychain (bestly-db-watchdog), exactly like
    ~/bin/bestly-watchdog.py. Alerts go through scout_notify() inside edge_guard_note_t().
  - If wrangler is logged out, it alerts: "On the Mac mini, run `npx wrangler login`."

Controls (files next to this script):
  PAUSED               exists -> do nothing except heartbeat (the card shows it as paused)
  probe-override.json  {"until": <epoch>, "bestly.tech": ["http://127.0.0.1:8599/"]}  test hook, expires on its own;
                       alerts for an overridden site are marked (test) and never push the phone.
"""
import calendar
import concurrent.futures
import fcntl
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

HOME = os.path.expanduser("~")
DIR = os.path.dirname(os.path.realpath(__file__))
STATE_FILE = os.path.join(DIR, "state.json")
LOG_FILE = os.path.join(DIR, "edge-guard.log")
PENDING_FILE = os.path.join(DIR, "pending.jsonl")
OVERRIDE_FILE = os.path.join(DIR, "probe-override.json")
PAUSE_FILE = os.path.join(DIR, "PAUSED")
WRANGLER_TOML = os.path.join(HOME, "Library/Preferences/.wrangler/config/default.toml")

SB = "https://rcqfqhguwpmaarseifqg.supabase.co"
ANON = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"  # publishable key, same one ~/bin/bestly-watchdog.py uses
CF = "https://api.cloudflare.com/client/v4"
ZONE_NAME = "bestly.tech"

# One group per origin. A group's splash route(s) are attached together and detached together.
GROUPS = [
    {"name": "bestly.tech", "script": "bestly-site-outage-splash",
     "patterns": ["bestly.tech/*", "www.bestly.tech/*"],
     "probes": ["https://bestly.tech/", "https://www.bestly.tech/"]},
    {"name": "cloud.bestly.tech", "script": "bestly-cloud-maintenance-splash",
     "patterns": ["cloud.bestly.tech/*"],
     "probes": ["https://cloud.bestly.tech/status.php"]},
]
SPLASH_SCRIPTS = {g["script"] for g in GROUPS}
DOWN_AFTER = 2      # failed checks in a row before the splash goes on
UP_AFTER = 3        # healthy checks in a row before it comes off
REMIND_EVERY = 60 * 60
FIX_COMMAND = "On the Mac mini, run `npx wrangler login`."


# ------------------------------------------------------------------ small helpers
def now():
    return int(time.time())


def clock(ts=None):
    """12-hour time, e.g. 3:05 PM (Jared's rule: never 24-hour)."""
    return time.strftime("%-I:%M %p", time.localtime(ts or now()))


def log(msg):
    try:
        with open(LOG_FILE, "a") as f:
            f.write(time.strftime("%Y-%m-%d %I:%M:%S %p ") + msg + "\n")
        if os.path.getsize(LOG_FILE) > 1_000_000:  # keep it small: roll once
            os.replace(LOG_FILE, LOG_FILE + ".1")
    except Exception:
        pass


def plural(n, word):
    return f"{n} {word}" + ("" if n == 1 else "s")


def load_state():
    try:
        return json.load(open(STATE_FILE))
    except Exception:
        return {}


def save_state(st):
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump(st, f, indent=1)
    os.replace(tmp, STATE_FILE)


def keychain(service, account=None):
    args = ["security", "find-generic-password", "-s", service, "-w"] + (["-a", account] if account else [])
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=10).stdout.strip() or None
    except Exception:
        return None


def http_json(url, body=None, headers=None, method=None, timeout=15):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data is not None else "GET"),
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"raw": raw[:200].decode("utf-8", "replace")}
    except Exception as e:
        return 0, {"error": str(e)[:200]}


# ------------------------------------------------------------------ database (Supabase) + phone fallback
def sb_rpc(fn, args):
    tok = keychain("bestly-db-watchdog", "token") or ""
    code, body = http_json(f"{SB}/rest/v1/rpc/{fn}", {"p_token": tok, **args},
                           {"apikey": ANON, "Authorization": f"Bearer {ANON}"}, timeout=15)
    return code, body


def hapush(title, body):
    """Phone fallback when the database can't be reached: the Mac's one way to Jared's iPhone."""
    try:
        subprocess.run([os.path.join(HOME, "bin/hapush"), title, body, "4", "Edge Guard"],
                       capture_output=True, text=True, timeout=90)
    except Exception as e:
        log(f"hapush failed: {e}")


def report(site, state, action, detail=None, alert=None):
    """Log to edge_guard_log (+ alert through scout_notify). If the database is down, queue the log line and
    still push the alert by phone so an outage never goes unannounced."""
    args = {"p_site": site, "p_state": state, "p_action": action, "p_detail": detail, "p_alert": alert}
    log(f"{site} {state} / {action}" + (f" / {detail}" if detail else "") + (f"  ALERT: {alert['title']}" if alert else ""))
    code, body = sb_rpc("edge_guard_note_t", args)
    if code in (200, 204):
        return True
    log(f"database report failed ({code}): {str(body)[:160]}")
    try:
        with open(PENDING_FILE, "a") as f:
            f.write(json.dumps({**args, "p_alert": None, "at": now()}) + "\n")
    except Exception:
        pass
    if alert and alert.get("push"):
        hapush(alert["title"], alert.get("body") or "")
    return False


def flush_pending():
    try:
        lines = open(PENDING_FILE).read().splitlines()
    except Exception:
        return
    if not lines:
        return
    keep = []
    for ln in lines[-200:]:
        try:
            args = json.loads(ln)
            args.pop("at", None)
            code, _ = sb_rpc("edge_guard_note_t", args)
            if code not in (200, 204):
                keep.append(ln)
        except Exception:
            pass
    try:
        if keep:
            open(PENDING_FILE, "w").write("\n".join(keep) + "\n")
        else:
            os.remove(PENDING_FILE)
    except Exception:
        pass


def beat(ok, summary):
    code, body = sb_rpc("edge_guard_beat_t", {"p_ok": ok, "p_summary": summary})
    if code not in (200, 204):
        log(f"heartbeat failed ({code}): {str(body)[:160]}")


# ------------------------------------------------------------------ probing
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


_opener = urllib.request.build_opener(NoRedirect)


def probe(url, timeout=10):
    """Returns {ok, kind, status, ms}. kind: ok | unreachable | http5xx | quota."""
    sep = "&" if "?" in url else "?"
    full = f"{url}{sep}__eg={now()}"  # cache-bust so we judge the origin, not a cached page
    req = urllib.request.Request(full, headers={"User-Agent": "BestlyEdgeGuard/1.0", "Accept": "text/html",
                                                "Cache-Control": "no-cache"})
    t0 = time.time()
    status, body = 0, ""
    try:
        with _opener.open(req, timeout=timeout) as r:
            status = r.status
            body = r.read(2000).decode("utf-8", "replace") if r.status >= 400 else ""
    except urllib.error.HTTPError as e:
        status = e.code
        try:
            body = e.read(2000).decode("utf-8", "replace")
        except Exception:
            body = ""
    except Exception as e:
        return {"ok": False, "kind": "unreachable", "status": 0, "ms": int((time.time() - t0) * 1000), "why": str(e)[:80]}
    ms = int((time.time() - t0) * 1000)
    if status == 429 or (status >= 400 and re.search(r"\b1027\b|rate limited", body, re.I)):
        return {"ok": False, "kind": "quota", "status": status, "ms": ms}
    if status >= 500:
        return {"ok": False, "kind": "http5xx", "status": status, "ms": ms}
    return {"ok": True, "kind": "ok", "status": status, "ms": ms}


def read_override():
    try:
        o = json.load(open(OVERRIDE_FILE))
        if int(o.get("until", 0)) > now():
            return o
    except Exception:
        pass
    return {}


def why(res):
    if res["kind"] == "unreachable":
        return "not answering"
    if res["kind"] == "quota":
        return "Cloudflare rate limit, error 1027"
    return f"error {res['status']}"


# ------------------------------------------------------------------ cached lies at the edge
# Vercel tags EVERY /assets/* response with `Cache-Control: public, max-age=31536000,
# immutable` — including its own 404. Cloudflare caches what the origin says is
# cacheable, so one 404 in the seconds while a deploy swaps builds becomes a
# year-long answer for a file that exists. On 2026-10-17 that is exactly what
# happened to a JS chunk /neckpilot imports: the page was dead on arrival in
# Chrome while every probe we owned said 200, curl included.
#
# The tell is the difference between two requests for the same file: without a
# cache-buster the edge answers from its own copy, with one it goes to the origin.
# A plain 404 that a busted request says is 200 means the edge is holding a lie.
# Detection needs no Cloudflare permission at all — that is why it lives here and
# not in the account. Clearing it does: the wrangler login Edge Guard already has
# carries zone:read and nothing cache-related (purge answers 401, rulesets 403),
# so a purge only happens when someone has added the Keychain token below.
HOME_CACHE_URL = "https://www.bestly.tech"
ASSET_RE = re.compile(r'["\'](/(?:assets|models)/[A-Za-z0-9_.-]+\.(?:js|css|glb|woff2|png))["\']')
ASSET_CAP = 12
CACHE_EVERY = 300          # seconds between asset checks (the probes every minute are enough otherwise)
CF_CACHE_KEYCHAIN = ("bestly-cf-cache", "bestly.tech")  # Cloudflare API token, Zone: Cache Purge
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36")


def fetch_status(url, timeout=10):
    """One GET the way a browser makes it. Returns (status, cf-cache-status)."""
    req = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA, "Accept": "*/*"})
    try:
        with _opener.open(req, timeout=timeout) as r:
            return r.status, (r.headers.get("cf-cache-status") or "").lower()
    except urllib.error.HTTPError as e:
        return e.code, (e.headers.get("cf-cache-status") or "").lower()
    except Exception:
        return 0, ""


def asset_paths(timeout=10):
    """Every /assets/ and /models/ file the live homepage asks a browser to load."""
    req = urllib.request.Request(f"{HOME_CACHE_URL}/?__eg={now()}",
                                 headers={"User-Agent": BROWSER_UA, "Accept": "text/html"})
    try:
        with _opener.open(req, timeout=timeout) as r:
            html = r.read(400000).decode("utf-8", "replace")
    except Exception as e:
        log(f"cache check: could not read the homepage ({e})")
        return []
    seen, out = set(), []
    for m in ASSET_RE.finditer(html):
        if m.group(1) not in seen:
            seen.add(m.group(1))
            out.append(m.group(1))
    return out[:ASSET_CAP]


def check_assets(paths, timeout=10):
    """Files the edge answers differently from the origin. Only a lie counts:
    a plain 404 whose origin, asked directly, is fine."""
    bad = []
    for p in paths:
        url = HOME_CACHE_URL + p
        plain, cf = fetch_status(url, timeout)
        if plain == 200:
            continue
        busted, _ = fetch_status(f"{url}?__eg={now()}", timeout)
        bad.append({"path": p, "plain": plain, "busted": busted, "cf": cf})
    return bad


def purge_urls(zid, urls):
    """Cloudflare purge. Returns True, False (token present but refused), or None (no token)."""
    tok = keychain(*CF_CACHE_KEYCHAIN)
    if not tok:
        return None
    code, resp = http_json(f"{CF}/zones/{zid}/purge_cache", {"files": urls},
                           {"Authorization": "Bearer " + tok}, method="POST", timeout=20)
    log(f"cache purge {code}: {json.dumps(resp.get('errors', []))[:160] if code != 200 else 'ok'}")
    return code == 200 and bool(resp.get("success"))


# The prevention, not just the cure. A cache rule cannot test a response code in
# its expression (that phase runs before the origin answers), but its TTL setting
# can be per-status: `status_code_ttl` with 404 -> no-store keeps every other
# response cached exactly as before and refuses to store a 404 at all. Cloudflare
# caches 404/410 for three minutes on its own even with no cache-control, so
# without this the window is always open.
CACHE_RULE_DESC = "Edge Guard: never store a 404 for a built asset"
CACHE_RULE_EXPR = ('(http.host eq "www.bestly.tech" or http.host eq "bestly.tech") '
                   'and starts_with(http.request.uri.path, "/assets/")')
CACHE_RULE = {
    "description": CACHE_RULE_DESC,
    "expression": CACHE_RULE_EXPR,
    "action": "set_cache_settings",
    "action_parameters": {
        "cache": True,
        "edge_ttl": {"mode": "respect_origin", "status_code_ttl": [{"status_code": 404, "value": "no-store"}]},
    },
}
CACHE_PHASE = "http_request_cache_settings"
RULE_EVERY = 24 * 60 * 60


def ensure_cache_rule(zid):
    """True when the rule is in place (adding it if needed), False when it could not be, None with no token."""
    tok = keychain(*CF_CACHE_KEYCHAIN)
    if not tok:
        return None
    hdr = {"Authorization": "Bearer " + tok}
    code, resp = http_json(f"{CF}/zones/{zid}/rulesets/phases/{CACHE_PHASE}/entrypoint", headers=hdr, timeout=20)
    if code == 404:  # no rules in this phase yet
        rules = []
    elif code != 200:
        log(f"cache rule: could not read the ruleset ({code}) {json.dumps(resp.get('errors', []))[:160]}")
        return False
    else:
        rules = resp.get("result", {}).get("rules", [])
    if any(r.get("description") == CACHE_RULE_DESC for r in rules):
        return True
    # Send the whole array back: this endpoint replaces the phase's rules, so a
    # rule posted alone would silently delete somebody else's.
    code, resp = http_json(f"{CF}/zones/{zid}/rulesets/phases/{CACHE_PHASE}/entrypoint",
                           {"rules": rules + [CACHE_RULE]}, hdr, method="PUT", timeout=20)
    ok = code == 200 and bool(resp.get("success"))
    log(f"cache rule: added ({code}){' ok' if ok else ' ' + json.dumps(resp.get('errors', []))[:160]}"
        f" keeping {len(rules)} existing rule(s)")
    return ok


# ------------------------------------------------------------------ Cloudflare (wrangler OAuth login, token stays in memory)
class CfAuthError(Exception):
    pass


def _toml():
    return open(WRANGLER_TOML).read()


def _token():
    m = re.search(r'oauth_token\s*=\s*"([^"]+)"', _toml())
    if not m:
        raise CfAuthError("no wrangler login found")
    return m.group(1)


def _expires_soon(minutes=10):
    try:
        m = re.search(r'expiration_time\s*=\s*"([^"]+)"', _toml())
        t = calendar.timegm(time.strptime(m.group(1)[:19], "%Y-%m-%dT%H:%M:%S"))
        return t - now() < minutes * 60
    except Exception:
        return True


def refresh_login():
    """`npx wrangler whoami` refreshes the OAuth token in place. Output is discarded (never printed)."""
    env = {**os.environ, "PATH": f"{HOME}/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin",
           "WRANGLER_SEND_METRICS": "false", "NO_COLOR": "1", "HOME": HOME}
    try:
        r = subprocess.run([f"{HOME}/.local/node/bin/npx", "wrangler", "whoami"], capture_output=True, text=True,
                           timeout=90, env=env, cwd=DIR)
        text = (r.stdout + r.stderr).lower()
        # 2026-10-11: wrangler 4.149 prints "missing some expected OAuth scopes ... run `wrangler login`" while the login still
        # works ("You are logged in"). That warning is not a logout; matching "wrangler login" raised a false alert every minute.
        if "you are logged in" in text:
            return True
        if "not authenticated" in text or "not logged in" in text or "wrangler login" in text:
            raise CfAuthError("wrangler is logged out")
        return True
    except CfAuthError:
        raise
    except Exception as e:
        log(f"wrangler whoami failed: {e}")
        return False


def cf(method, path, body=None, _retry=True):
    """Cloudflare API call. Never logs or returns the token. Raises CfAuthError if the login is dead."""
    if _expires_soon():
        refresh_login()
    code, resp = http_json(CF + path, body, {"Authorization": "Bearer " + _token()}, method=method)
    if code in (401, 403) or any(e.get("code") in (10000, 9109) for e in resp.get("errors", []) if isinstance(e, dict)):
        if _retry:
            refresh_login()
            return cf(method, path, body, _retry=False)
        raise CfAuthError(f"Cloudflare refused the login ({code})")
    return code, resp


def cf_errors(resp):
    return "; ".join(f"{e.get('code')}: {e.get('message')}" for e in resp.get("errors", []) if isinstance(e, dict))[:300]


# ------------------------------------------------------------------ the run
def run():
    st = load_state()
    ov = read_override()
    test_groups = {g["name"] for g in GROUPS if g["name"] in ov}
    notes, ok_all = [], True

    flush_pending()

    if os.path.exists(PAUSE_FILE):
        beat(False, "Paused by hand (PAUSED file). Not enforcing anything.")
        log("paused")
        return

    # 1. probe every site in parallel
    jobs = {}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as ex:
        for g in GROUPS:
            urls = ov.get(g["name"]) if g["name"] in ov else g["probes"]
            jobs[g["name"]] = [(u, ex.submit(probe, u)) for u in urls]
    results = {name: [(u, f.result()) for u, f in lst] for name, lst in jobs.items()}

    # 2. list routes (one call), fix what is wrong
    routes, cf_ok = [], True
    try:
        if not st.get("zone_id"):
            code, resp = cf("GET", f"/zones?name={ZONE_NAME}")
            st["zone_id"] = resp["result"][0]["id"]
        zid = st["zone_id"]
        code, resp = cf("GET", f"/zones/{zid}/workers/routes")
        if code != 200 or not resp.get("success"):
            raise RuntimeError(f"could not list routes ({code}) {cf_errors(resp)}")
        routes = resp["result"]
        st.pop("token_alerted", None)
    except CfAuthError as e:
        cf_ok = False
        ok_all = False
        notes.append("Cloudflare login needs a fix")
        report("cloudflare", "token", "alert", str(e), {
            "title": "Edge Guard: I lost my Cloudflare login",
            "body": f"I can't change Cloudflare routes, so I can't protect the sites right now. Fix: {FIX_COMMAND} "
                    "Probes and alerts still work.",
            "severity": "warning", "push": True, "dedupe": f"edge.token.{time.strftime('%Y%m%d')}",
        })
    except Exception as e:
        cf_ok = False
        ok_all = False
        notes.append("could not read Cloudflare routes")
        report("cloudflare", "error", "none", f"list routes failed: {e}")

    t = now()
    # -- invariant A: no fail-closed route, whoever made it
    if cf_ok:
        for r in routes:
            if r.get("script") and not r.get("request_limit_fail_open"):
                code, resp = cf("PUT", f"/zones/{zid}/workers/routes/{r['id']}",
                                {"pattern": r["pattern"], "script": r["script"], "request_limit_fail_open": True})
                if code == 200 and resp.get("success"):
                    r["request_limit_fail_open"] = True
                    report("cloudflare", "repaired", "set fail open", f"{r['pattern']} ({r['script']})", {
                        "title": "Edge Guard: switched a blocking route to fail open",
                        "body": f"The route {r['pattern']} (Worker {r['script']}) would have blocked visitors with error 1027 "
                                "if the free plan's daily Worker limit ran out. It now lets visitors through instead.",
                        "severity": "warning", "push": True,
                        "dedupe": f"edge.failopen.{r['id']}.{time.strftime('%Y%m%d')}"})
                else:
                    ok_all = False
                    report("cloudflare", "error", "set fail open failed", f"{r['pattern']}: {code} {cf_errors(resp)}")

    # -- per-site logic
    quota_seen = False
    summary_bits = []
    for g in GROUPS:
        name = g["name"]
        gs = st.setdefault("groups", {}).setdefault(name, {"fails": 0, "oks": 0})
        res = results[name]
        healthy = all(r["ok"] for _, r in res)
        bad = [r for _, r in res if not r["ok"]]
        is_test = name in test_groups
        tag = " (test)" if is_test else ""
        sev_push = (lambda v: False if is_test else v)
        dk = "test." if is_test else ""

        if any(r["kind"] == "quota" for r in bad):
            quota_seen = True
        if healthy:
            gs["oks"] = gs.get("oks", 0) + 1
            if gs.get("fails"):
                gs["first_ok_at"] = t
            gs["fails"] = 0
        else:
            if not gs.get("fails"):
                gs["first_fail_at"] = t
            gs["fails"] = gs.get("fails", 0) + 1
            gs["oks"] = 0
            gs["reason"] = why(bad[0])
        if not cf_ok:
            summary_bits.append(f"{name} {'ok' if healthy else 'DOWN'}")
            if not healthy and gs["fails"] >= DOWN_AFTER:
                report(name, "down", "cannot attach splash", f"{why(bad[0])}; no Cloudflare access",
                       {"title": f"Edge Guard: {name} is down and I can't reach Cloudflare to show the splash{tag}",
                        "body": f"{name} failed {gs['fails']} checks in a row ({why(bad[0])}). I have no Cloudflare access right now. "
                                f"If it is the login: {FIX_COMMAND}",
                        "severity": "warning", "push": sev_push(True), "dedupe": f"edge.{dk}down-nocf.{name}.{t // 3600}"})
            continue

        mine = [r for r in routes if r.get("script") == g["script"]]
        attached_patterns = {r["pattern"] for r in mine}
        missing = [p for p in g["patterns"] if p not in attached_patterns]
        inc = gs.get("incident")

        if healthy:
            if mine and gs["oks"] >= UP_AFTER:
                failed = []
                for r in mine:
                    code, resp = cf("DELETE", f"/zones/{zid}/workers/routes/{r['id']}")
                    if code == 200 and resp.get("success"):
                        routes.remove(r)
                    else:
                        failed.append(r["pattern"])
                if failed:
                    ok_all = False
                    report(name, "error", "detach failed", f"{failed}")
                elif inc:
                    mins = max(1, round((gs.get("first_ok_at", t) - inc["first_fail_at"]) / 60))
                    gs["incident"] = None
                    report(name, "recovered", "detached splash", f"down about {mins} min",
                           {"title": f"Edge Guard: {name} back up after {plural(mins, 'minute')}{tag}",
                            "body": f"{name} has been healthy for {UP_AFTER} checks in a row, as of {clock()}. "
                                    "The splash page is off and normal traffic uses no Worker quota.",
                            "severity": "info", "push": sev_push(True), "dedupe": f"edge.{dk}up.{name}.{inc['id']}"})
                else:
                    report(name, "ok", "detached splash", f"{len(mine)} splash route(s) were on while the site was healthy",
                           {"title": f"Edge Guard: removed a splash page that was on while {name} was healthy{tag}",
                            "body": "Something (probably a redeploy) left the 'we'll be right back' route on. "
                                    "I took it off so it stops using the free plan's Worker quota.",
                            "severity": "info", "push": False, "dedupe": f"edge.{dk}stray.{name}.{mine[0]['id']}"})
            still_on = [r for r in routes if r.get("script") == g["script"]]
            summary_bits.append(f"{name} ok" + (" (splash still on)" if still_on else ""))
        else:
            gs["oks"] = 0
            down_by_quota = bad and all(r["kind"] == "quota" for r in bad)
            if down_by_quota and not is_test:
                summary_bits.append(f"{name} rate limited")
                continue  # handled once below, for all sites
            if gs["fails"] >= DOWN_AFTER and missing:
                if not inc:
                    inc = gs["incident"] = {"id": gs.get("first_fail_at", t), "first_fail_at": gs.get("first_fail_at", t)}
                done, errs = [], []
                for p in missing:
                    code, resp = cf("POST", f"/zones/{zid}/workers/routes",
                                    {"pattern": p, "script": g["script"], "request_limit_fail_open": True})
                    if code == 200 and resp.get("success"):
                        done.append(p)
                        routes.append(resp["result"])
                    else:
                        errs.append(f"{p}: {code} {cf_errors(resp)}")
                if done:
                    report(name, "down", "attached splash", f"{why(bad[0])}; routes {done}",
                           {"title": f"Edge Guard: {name} is down, showing the splash{tag}",
                            "body": f"{name} failed {gs['fails']} checks in a row ({why(bad[0])}), since {clock(inc['first_fail_at'])}. "
                                    f"I switched on the 'we'll be right back' page. It comes off by itself after {UP_AFTER} healthy checks.",
                            "severity": "warning", "push": sev_push(True), "dedupe": f"edge.{dk}down.{name}.{inc['id']}"})
                if errs:
                    ok_all = False
                    report(name, "error", "attach failed", "; ".join(errs),
                           {"title": f"Edge Guard: {name} is down and I could not turn on the splash page{tag}",
                            "body": f"{name} is failing ({why(bad[0])}) and attaching the splash route failed: {errs[0][:160]}",
                            "severity": "warning", "push": sev_push(True), "dedupe": f"edge.{dk}attachfail.{name}.{t // 3600}"})
            elif inc and gs["fails"] >= DOWN_AFTER:
                # still down, splash already on: one reminder an hour, never one a minute
                if t - gs.get("last_remind", inc["first_fail_at"]) >= REMIND_EVERY:
                    gs["last_remind"] = t
                    mins = round((t - inc["first_fail_at"]) / 60)
                    report(name, "down", "reminder", f"still down after {mins} min",
                           {"title": f"Edge Guard: {name} is still down after {plural(mins, 'minute')}{tag}",
                            "body": f"Still failing ({why(bad[0])}). The splash page is on. Down since {clock(inc['first_fail_at'])}.",
                            "severity": "warning", "push": sev_push(True), "dedupe": f"edge.{dk}still.{name}.{inc['id']}.{t // REMIND_EVERY}"})
            summary_bits.append(f"{name} DOWN ({why(bad[0])}), splash {'on' if mine or missing != g['patterns'] else 'pending'}")
            ok_all = False

    # -- invariant D: no cached lie about a file that exists (the /neckpilot killer)
    sites_healthy = all(st.get("groups", {}).get(g["name"], {}).get("fails", 0) == 0 for g in GROUPS)
    if sites_healthy and not test_groups:
        cst = st.setdefault("cache", {})
        if now() - int(cst.get("checked_at", 0)) >= CACHE_EVERY:
            cst["checked_at"] = now()
            paths = asset_paths()
            lies = check_assets(paths) if paths else []
            cst["checked"] = len(paths)
            cst.pop("lies", None) if not lies else cst.update({"lies": {l["path"]: l for l in lies}})
            day = time.strftime("%Y%m%d")
            for lie in lies:
                url = HOME_CACHE_URL + lie["path"]
                # A busted request that answers 200 proves the file is there and the
                # edge is the problem. A busted 404 means the deploy itself is wrong,
                # which is a different alert and not something a purge can fix.
                origin_ok = lie["busted"] == 200
                purged = purge_urls(zid, [url]) if origin_ok else None
                if purged:
                    cst.setdefault("purged", {})[lie["path"]] = now()
                cst.setdefault("alerted", {})[lie["path"]] = day
                if origin_ok and purged is None:
                    body = (f"The edge answered {lie['plain']} for {url} (cf-cache-status {lie['cf'] or 'unknown'}) while the "
                            "origin, asked directly, served it fine — so the cached answer is wrong and every browser gets it. "
                            "A visitor's page breaks on a file that exists.\n\n"
                            "I can see this but I cannot clear it: the wrangler login I have carries zone:read and no cache "
                            "permission, so no purge and no cache rule. Either purge it by hand (Cloudflare → Caching → "
                            "Configuration → Purge by URL → paste the link above) or add a Cloudflare API token with "
                            "Zone → Cache Purge to Keychain as bestly-cf-cache and I will clear the next one myself.")
                elif origin_ok:
                    body = (f"The edge answered {lie['plain']} for {url} while the origin served it fine. I purged it, so the "
                            "next request goes back to the origin. A visitor's page was breaking on a file that exists.")
                else:
                    body = (f"{url} answers {lie['plain']} from the edge AND {lie['busted']} straight from the origin, so the "
                            "file is not in the deployment at all — a purge will not help. A page is loading a file the "
                            "build did not ship. Depth Check reports the deploy side of this.")
                report("edge", "cache", "purged" if purged else ("detected" if origin_ok else "missing at origin"),
                       f"{lie['path']} plain={lie['plain']} busted={lie['busted']} cf={lie['cf'] or 'n/a'}",
                       {"title": "Edge Guard: the edge is serving a cached lie" if origin_ok else
                                 "Edge Guard: a page is loading a file the build never shipped",
                        "body": body,
                        "severity": "warning", "push": True,
                        "dedupe": f"edge.cache.{re.sub(r'[^a-z0-9]+', '-', lie['path'].lower())}.{day}"})
                ok_all = ok_all and bool(purged)
            for k in ("alerted", "purged"):
                watch = cst.get(k) or {}
                if len(watch) > 50:
                    for old in sorted(watch, key=lambda p: watch[p])[:-50]:
                        watch.pop(old, None)
            if lies:
                summary_bits.append(f"{len(lies)} cached lie(s): " + ", ".join(l["path"].split("/")[-1] for l in lies[:3]))

    # -- invariant E: the rule that stops a 404 from ever being stored in the first place.
    # Once a day, because it only changes when somebody edits it by hand. Needs the same
    # Keychain token; with no token there is nothing to enforce, and the summary says so
    # rather than pretending the edge is covered.
    if cf_ok and not test_groups:
        cst = st.setdefault("cache", {})
        if now() - int(cst.get("rule_checked_at", 0)) >= RULE_EVERY:
            cst["rule_checked_at"] = now()
            rule_state = ensure_cache_rule(zid)
            cst["rule_ok"] = rule_state
            if rule_state is None:
                summary_bits.append("no cache token (rule unverified)")
            elif rule_state is False:
                ok_all = False
                report("edge", "cache", "rule missing", "could not read or write the cache ruleset",
                       {"title": "Edge Guard: I could not confirm the rule that keeps 404s out of the cache",
                        "body": "A 404 cached at the edge is what killed /neckpilot on 2026-10-17. The rule that refuses "
                                "to store one is either missing or I could not reach it — my token was refused. Check that "
                                "the bestly-cf-cache token in Keychain still exists and still has Zone → Cache Rules: Edit.",
                        "severity": "warning", "push": True,
                        "dedupe": f"edge.cache.rule.{time.strftime('%Y%m%d')}"})

    # -- invariant C: Cloudflare 1027 / 429 (the Worker request cap). Remove the Workers, keep fail open, tell Jared once an hour.
    if quota_seen and cf_ok and not test_groups:
        removed = []
        for r in list(routes):
            if r.get("script") in SPLASH_SCRIPTS:
                code, resp = cf("DELETE", f"/zones/{zid}/workers/routes/{r['id']}")
                if code == 200 and resp.get("success"):
                    routes.remove(r)
                    removed.append(r["pattern"])
        report("cloudflare", "quota", "removed splash routes" if removed else "none",
               f"error 1027 seen; removed {removed}",
               {"title": "Edge Guard: Cloudflare is rate limiting the sites (error 1027)",
                "body": "Visitors are getting Cloudflare's 'temporarily rate limited' page. That is the free plan's Worker "
                        "request cap. I made sure every route is fail open" + (f" and took the splash Workers off {', '.join(removed)}" if removed else "") +
                        ". The sites should recover on the next check.",
                "severity": "warning", "push": True, "dedupe": f"edge.quota.{t // 3600}"})
        ok_all = False

    if not summary_bits:
        summary_bits = ["probes only"]
    attached_now = [r["pattern"] for r in routes if r.get("script") in SPLASH_SCRIPTS]
    summary = f"{'; '.join(summary_bits)}. Splash routes on: {len(attached_now)}." + ("" if cf_ok else " Cloudflare access broken.")
    beat(ok_all, summary)
    save_state(st)


def main():
    os.makedirs(DIR, exist_ok=True)
    lock = open(os.path.join(DIR, ".lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return  # the previous run is still going
    if "--status" in sys.argv:
        print(json.dumps(load_state(), indent=1))
        return
    try:
        run()
    except Exception as e:
        log(f"run crashed: {type(e).__name__}: {str(e)[:200]}")
        try:
            beat(False, f"Edge Guard crashed: {type(e).__name__}")
        except Exception:
            pass


if __name__ == "__main__":
    main()
