#!/usr/bin/env python3
"""Bestly Studio watchdog — runs every minute from launchd (tech.bestly.watchdog).
Repo copy of ~/bin/bestly-watchdog.py on the Mac mini (source of truth is the Mac; keep in sync).

Watches from OUTSIDE the database, because when the database is starved nothing
inside it (pg_cron, edge functions) can notice or fix it. 2026-09-23 outage:
Micro instance pinned, every query timed out for 75 min, no alert fired.

  healthy   -> if an incident was open, report 'up' (closes it, credits the fix)
  slow/down -> report to ops_watchdog_report: it logs the incident and runs the
               best-scoring in-database heal (hygiene / cancel / terminate)
  2 misses  -> pause the Mac pollers (they only add load during a freeze); restored on recovery
  3 misses  -> push to Jared's phone via ntfy (topic in Keychain)
  8 misses  -> restart the database via the Management API, if a token is in
               Keychain (service bestly-supabase-pat), at most every 30 min
Everything it does is appended to ~/Library/Application Support/bestly-watchdog/log.
"""
import json, os, subprocess, time, urllib.request, urllib.error

REF = "rcqfqhguwpmaarseifqg"
SB = f"https://{REF}.supabase.co"
ANON = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"  # publishable key (key switch 2026-09-24)
DIR = os.path.expanduser("~/Library/Application Support/bestly-watchdog")
STATE = os.path.join(DIR, "state.json")
LOG = os.path.join(DIR, "log")
SLOW_MS = 6000
ALERT_AT, RESTART_AT, RESTART_GAP = 3, 8, 30 * 60
SHED_AT = 2  # consecutive DOWN checks before pausing the Mac pollers


def log(msg):
    with open(LOG, "a") as f:
        f.write(time.strftime("%Y-%m-%d %I:%M:%S %p ") + msg + "\n")


def keychain(service, account=None):
    args = ["security", "find-generic-password", "-s", service, "-w"] + (["-a", account] if account else [])
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=10).stdout.strip() or None
    except Exception:
        return None


def http(url, body=None, headers=None, timeout=10, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method or ("POST" if data is not None else "GET"),
                                 headers={"Content-Type": "application/json", **(headers or {})})
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), int((time.time() - t0) * 1000)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300], int((time.time() - t0) * 1000)
    except Exception as e:
        return 0, str(e)[:300], int((time.time() - t0) * 1000)


def rpc_t(fn, args, timeout=10):
    """Token-gated call: the watchdog's private token lives only in Keychain (bestly-db-watchdog)."""
    return rpc(fn + "_t", {"p_token": keychain("bestly-db-watchdog", "token") or "", **args}, timeout)


def rpc(fn, args, timeout=10):
    return http(f"{SB}/rest/v1/rpc/{fn}", args, {"apikey": ANON, "Authorization": f"Bearer {ANON}"}, timeout)


def ntfy(title, body, prio=5, tags="rotating_light"):
    topic = keychain("bestly-ntfy-topic")
    if not topic:
        return log("ntfy: no topic in Keychain")
    code, _, _ = http("https://ntfy.sh", {"topic": topic, "title": title, "message": body, "priority": prio,
                                          "tags": [tags], "click": "https://studio.bestly.tech/"}, timeout=10)
    log(f"ntfy {code}: {title}")


def load():
    try:
        return json.load(open(STATE))
    except Exception:
        return {"misses": 0, "since": None, "alerted": False, "last_restart": 0, "pending": []}


def main():
    os.makedirs(DIR, exist_ok=True)
    s = load()
    # 1. the database, through the same door every page load uses
    code, body, ms = rpc("studio_boot", {"p_file": "index.html", "p_preview": None}, timeout=12)
    db_ok = code == 200 and '"ok": true' in body.replace('"ok":true', '"ok": true')
    # 2. the site itself (Vercel)
    scode, _, sms = http("https://studio.bestly.tech/", timeout=12)
    state = "up" if db_ok and ms < SLOW_MS else ("slow" if db_ok else "down")

    if state == "up":
        if s["misses"]:
            mins = max(1, int((time.time() - (s["since"] or time.time())) / 60))
            for p in s.get("pending", []):          # restarts we could not record while it was down
                rpc_t("ops_watchdog_note", p, timeout=15)
            c, b, _ = rpc_t("ops_watchdog_report", {"p_source": "mac-watchdog", "p_state": "up", "p_detail": {"shed": s.get("shed", [])}}, timeout=20)
            unshed(s)
            log(f"RECOVERED after {mins} min: {b[:200]}")
            if s["alerted"]:
                ntfy("Bestly database is back", f"Down about {mins} min. Admin, Studio and trip pages work again; paused Mac helpers restarted.", 3, "white_check_mark")
        s = {"misses": 0, "since": None, "alerted": False, "last_restart": s.get("last_restart", 0), "pending": [], "shed": []}
    else:
        s["misses"] += 1
        s["since"] = s["since"] or time.time()
        log(f"{state.upper()} #{s['misses']} db={code} {ms}ms site={scode} {sms}ms :: {body[:120]}")
        # in-database heal (works whenever the database answers at all)
        c, b, _ = rpc_t("ops_watchdog_report", {"p_source": "mac-watchdog", "p_state": state,
                                              "p_detail": {"db_code": code, "db_ms": ms, "site": scode}}, timeout=35)
        log(f"  heal -> {c} {b[:200]}")
        if state == "down" and s["misses"] >= SHED_AT and not s.get("shed"):
            shed(s)
        if s["misses"] >= ALERT_AT and not s["alerted"]:
            ntfy(f"Bestly database is {state}", f"Admin, Studio and trip pages can't reach it: {s['misses']} failed checks in a row. "
                 "Mac helpers are paused so it can recover; a restart follows at 8 minutes if it is still down.")
            s["alerted"] = True
        if s["misses"] >= RESTART_AT and time.time() - s.get("last_restart", 0) > RESTART_GAP:
            pat = keychain("bestly-supabase-pat")
            if pat:
                rc, rb, _ = http(f"https://api.supabase.com/v1/projects/{REF}/restart", {},
                                 {"Authorization": f"Bearer {pat}"}, timeout=30)
                s["last_restart"] = time.time()
                s.setdefault("pending", []).append({"p_action": "restart", "p_ok": rc == 200,
                                                    "p_detail": {"http": rc}})
                log(f"  RESTART requested -> {rc} {rb[:120]}")
                ntfy("Restarting the Studio database", f"Still down after {s['misses']} min. Restart sent ({rc}).", 4, "arrows_counterclockwise")
            elif s["misses"] == RESTART_AT:
                log("  restart skipped: no bestly-supabase-pat in Keychain")
                ntfy("Bestly database still down — needs a restart", "I can't restart it myself without a Supabase access token on the Mac. "
                     "Supabase dashboard → Project settings → General → Restart project.", 5)
    json.dump(s, open(STATE, "w"))
    # keep the log small
    try:
        if os.path.getsize(LOG) > 2_000_000:
            os.replace(LOG, LOG + ".1")
    except Exception:
        pass

# Mac pollers paused while the database is down (2026-09-24). Every few seconds they call the database; during a
# freeze they only add load and reconnect storms. Recording (meetingrec-agent) and turo-sender keep running.
SHED = ["tech.bestly.partner-ai", "tech.bestly.tesla-worker", "tech.bestly.clips", "tech.bestly.meetingrec-sync",
        "tech.bestly.sentsync", "tech.bestly.mailbridge", "tech.bestly.partner-mail"]


def shed(s):
    uid, done = os.getuid(), []
    for label in SHED:
        r = subprocess.run(["launchctl", "bootout", f"gui/{uid}/{label}"], capture_output=True, text=True, timeout=15)
        if r.returncode == 0:
            done.append(label)
    s["shed"] = done
    log(f"  SHED {len(done)} Mac pollers while the database is down: {', '.join(l.split('.')[-1] for l in done)}")


def unshed(s):
    uid = os.getuid()
    for label in s.get("shed", []):
        plist = os.path.expanduser(f"~/Library/LaunchAgents/{label}.plist")
        r = subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", plist], capture_output=True, text=True, timeout=15)
        log(f"  restored {label.split('.')[-1]} rc={r.returncode}")
    s["shed"] = []


# Car + Turo helpers must always be loaded in launchd. 2026-09-24: tesla-worker exited during a DB outage and
# was no longer loaded at all, so guest car buttons fell back to nothing. Re-load any that went missing.
KEEP_AGENTS = ["tech.bestly.tesla-worker", "tech.bestly.turo-sender"]


def keep_agents():
    uid = os.getuid()
    for label in KEEP_AGENTS:
        try:
            r = subprocess.run(["launchctl", "print", f"gui/{uid}/{label}"], capture_output=True, text=True, timeout=10)
            if r.returncode == 0:
                continue
            plist = os.path.expanduser(f"~/Library/LaunchAgents/{label}.plist")
            if not os.path.exists(plist):
                continue
            b = subprocess.run(["launchctl", "bootstrap", f"gui/{uid}", plist], capture_output=True, text=True, timeout=15)
            log(f"agent {label} was not loaded -> bootstrap rc={b.returncode} {b.stderr.strip()[:120]}")
        except Exception as e:
            log(f"agent check {label} failed: {e}")


if __name__ == "__main__":
    try:
        if not load().get("shed"):          # while shedding, don't re-load what we paused on purpose
            keep_agents()
    except Exception:
        pass
    main()
