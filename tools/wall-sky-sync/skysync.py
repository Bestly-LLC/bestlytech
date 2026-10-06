#!/usr/bin/env python3
"""Sky Sync - keeps every layer of the wall's sky lined up with home (Bestly AI employee, hired 2026-10-05).

Why: moving home (admin "move home") used to move only the planes and the Home tag. Roads, traffic and city names
stayed behind until something else redrew them, and Jared kept having to report it after each new layer.

How (every 5 min, LaunchAgent tech.bestly.skysync, Mac mini, no AI):
  1. Ask the live wall page (headless Chrome on CDP 47333) for window.__skyAudit(): for each registered layer
     (roads + signs, traffic, landmarks, Home tag) how far it sits from where home is now, in sky pixels.
  2. The page heals itself first (redraw after 2 bad checks). If a layer is still off, Sky Sync waits, reloads the page,
     checks again, and only then pushes an urgent alert (wall.skysync).
  3. Flags new sky layers nobody registered in SKYLAYERS (wall.skysync_unknown), because those are exactly the ones
     that won't follow home.
  4. When wall.html changes, it runs a real move-home test (home glides away and back in the page only) at the next quiet
     hour (2-5 AM), or right away with --test.
  5. Checks in with Scout (agent_beat wall-sky-sync).

Deployed copy: ~/Bestly/skysync/skysync.py (this file is the repo copy). Uses Sweep's config.json and the Keychain key.
"""
import hashlib, json, os, subprocess, sys, time, urllib.request

HOME = os.path.expanduser("~")
DIR = os.path.join(HOME, "Bestly", "skysync")
STATE = os.path.join(DIR, "state.json")
LOG = os.path.join(DIR, "skysync.log")
CFG = os.path.join(HOME, "Bestly", "sweep", "config.json")
EV = os.path.join(HOME, "Bestly", "wall-mac", "ev.mjs")
RELOAD = os.path.join(HOME, "Bestly", "wall-mac", "reload.mjs")
NODE = "/opt/homebrew/bin/node" if os.path.exists("/opt/homebrew/bin/node") else "node"
PAGE = "http://127.0.0.1:18099/?src=pi"
SLUG, NAME = "wall-sky-sync", "Sky Sync"
OFF_PX = 3          # a layer more than this many sky px from home is out of sync
TEST = "--test" in sys.argv


def log(msg):
    line = time.strftime("%Y-%m-%d %I:%M:%S %p ") + msg
    print(line)
    with open(LOG, "a") as f:
        f.write(line + "\n")


def load(p, d):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return d


def save(p, obj):
    with open(p + ".tmp", "w") as f:
        json.dump(obj, f)
    os.replace(p + ".tmp", p)


def run(cmd, timeout=60):
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout or "").strip()
    except Exception as e:
        return 1, str(e)


def page(expr, timeout=40):
    rc, out = run([NODE, EV, expr], timeout)
    if rc != 0:
        return None
    try:
        v = json.loads(out)
        return json.loads(v) if isinstance(v, str) else v
    except Exception:
        return None


def audit():
    return page("JSON.stringify(window.__skyAudit?__skyAudit():{missing:true})")


def _secret():
    rc, out = run(["security", "find-generic-password", "-s", "bestly-home-hub-agent", "-w"], 20)
    return out if rc == 0 else ""


def _post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), method="POST",
                                 headers=dict({"Content-Type": "application/json"}, **headers))
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read()


def beat(ok, summary):
    cfg, key = load(CFG, {}), _secret()
    if not cfg or not key:
        return
    try:
        _post(cfg["supabase_url"].rstrip("/") + "/rest/v1/rpc/agent_beat",
              {"p_slug": SLUG, "p_ok": ok, "p_summary": summary[:480], "p_token": key},
              {"apikey": cfg["publishable"], "Authorization": "Bearer " + cfg["publishable"]})
    except Exception as e:
        log("beat failed: %s" % e)


def event(st, key, kind, severity, title, body, push=False):
    sent = st.setdefault("sent", {})
    if kind == "resolved" and sent.get(key) != "problem":
        return
    if kind == "problem" and sent.get(key) == "problem" and time.time() - st.setdefault("sent_at", {}).get(key, 0) < 6 * 3600:
        return
    cfg, secret = load(CFG, {}), _secret()
    if not cfg or not secret:
        log("[event] %s %s: %s" % (key, kind, title))
        return
    try:
        _post(cfg["supabase_url"].rstrip("/") + "/functions/v1/home-hub-agent",
              {"op": "event", "key": key, "kind": kind, "severity": severity, "title": "Sky Sync: " + title,
               "body": body + "\n\n- Sky Sync, wall sky keeper", "push": push},
              {"x-api-key": secret})
        sent[key] = kind
        st.setdefault("sent_at", {})[key] = time.time()
        log("event %s %s: %s" % (key, kind, title))
    except Exception as e:
        log("event failed %s: %s" % (key, e))


def off_layers(a):
    return {k: v for k, v in (a.get("layers") or {}).items() if v is not None and v >= OFF_PX}


def page_hash():
    try:
        with urllib.request.urlopen(PAGE, timeout=15) as r:
            return hashlib.sha256(r.read()).hexdigest()[:16]
    except Exception:
        return None


def move_test():
    """Glide home away and back in the live page only (the saved spot is untouched), audit at the end of each glide."""
    r = page("(async()=>{ if(!window.__skyTestHome) return JSON.stringify({missing:true});"
             " const w=ms=>new Promise(r=>setTimeout(r,ms)), out=[];"
             " const o=__skyTestHome({x:0.35,y:0.55}); await w(1500); out.push(__skyAudit().layers);"
             " __skyTestHome(o); await w(1500); out.push(__skyAudit().layers); return JSON.stringify(out); })()", 60)
    if not isinstance(r, list):
        return None, "test could not run (%s)" % r
    bad = [{k: v for k, v in L.items() if v is not None and v >= OFF_PX} for L in r]
    return (not any(bad)), "after moving: %s, after moving back: %s" % tuple(json.dumps(L) for L in r)


def main():
    os.makedirs(DIR, exist_ok=True)
    st = load(STATE, {})
    a = audit()
    if a is None:
        # the renderer being down belongs to Wall Renderer / Wall Watchdog; Sky Sync only notes it
        log("page unreachable (renderer down?)")
        beat(True, "wall page not reachable right now; renderer watchdogs own that")
        save(STATE, st)
        return
    if a.get("missing"):
        event(st, "wall.skysync_missing", "problem", "warning", "the wall page lost its sync check",
              "window.__skyAudit is gone from wall.html (rolled back or overwritten?). Layers can drift from home again "
              "without anyone noticing. Restore the Sky Sync block in wall.html (docs/wall-freeze-2026-09-28.md).")
        beat(False, "wall.html has no __skyAudit")
        save(STATE, st)
        return
    event(st, "wall.skysync_missing", "resolved", "info", "sync check is back", "wall.html has __skyAudit again.")
    if not a.get("on"):
        beat(True, "sky is off (mapping, skit or no planes); nothing to check")
        save(STATE, st)
        return

    note = []
    bad = off_layers(a) if not a.get("anim") else {}
    if bad:
        log("off: %s, waiting for the page to heal itself" % bad)
        time.sleep(12)
        a = audit() or a
        bad = off_layers(a)
        if bad:
            log("still off: %s, reloading the page" % bad)
            run([NODE, RELOAD], 30)
            time.sleep(35)
            a = audit() or a
            bad = off_layers(a)
            st["reloads"] = st.get("reloads", 0) + 1
            note.append("reloaded the page")
    if bad:
        event(st, "wall.skysync", "problem", "urgent", "sky layers don't line up with home",
              "Out of line after a self-heal and a page reload (sky px from home): %s. Home is %s." %
              (json.dumps(bad), json.dumps(a.get("home"))), push=True)
    else:
        event(st, "wall.skysync", "resolved", "info", "sky layers line up again", "Every layer follows home.")

    unknown = sorted(a.get("unknown") or [])
    if unknown:
        event(st, "wall.skysync_unknown", "problem", "warning", "new sky layer isn't registered",
              "These sky layers aren't in SKYLAYERS in wall.html, so nothing checks that they follow home: %s. "
              "Stamp them when they draw and register them (see the Sky Sync comment in wall.html)." % ", ".join(unknown))
    else:
        event(st, "wall.skysync_unknown", "resolved", "info", "every sky layer is registered", "No unknown layers.")

    if a.get("heals", 0) > st.get("heals_seen", 0):
        note.append("page healed itself %d time(s) since load" % a["heals"])
        log("page self-heals: %s, last %s" % (a.get("heals"), json.dumps(a.get("last"))))
    st["heals_seen"] = a.get("heals", 0)

    # a new wall.html gets a real move-home test, at a quiet hour (or now with --test)
    h = page_hash()
    if h and h != st.get("page_hash"):
        st["test_due"] = True
        st["page_hash"] = h
    hour = time.localtime().tm_hour
    if TEST or (st.get("test_due") and 2 <= hour < 5):
        ok, detail = move_test()
        st["test_due"] = False
        st["last_test"] = {"at": int(time.time()), "ok": ok, "detail": detail}
        log("move-home test: %s %s" % (ok, detail))
        if ok is False:
            event(st, "wall.skysync_test", "problem", "warning", "move-home test failed on the new wall.html",
                  "Glided home away and back in the page; some layers didn't follow: %s" % detail)
        elif ok:
            event(st, "wall.skysync_test", "resolved", "info", "move-home test passes", detail)
        note.append("move-home test " + ("passed" if ok else "FAILED" if ok is False else "could not run"))

    summary = "layers in line (worst %.1f px)" % a.get("worst", 0) if not bad else "OUT of line: %s" % json.dumps(bad)
    beat(not bad, "; ".join([summary] + note))
    save(STATE, st)


if __name__ == "__main__":
    main()
