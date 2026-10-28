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
  6. Local alerts v2 watchdog (Oct 28, 2026), every run:
     - collector silent for 10 min -> restarts bestly-citizen.timer on Hestia over ssh and alerts (wall.citizen_collector);
     - FRESHNESS per source: every active source in citizen_sources must have answered within its own stale_s. A failing source goes quiet
       ('paused' on its switch, both on Wall > Sky details and the /admin Sky panel), Scout is told once, signed Sky Sync (wall.src_<source>),
       the collector retries with backoff and the alert clears itself. Sources that need a one-time setup stay quiet ('setup');
     - wall server /api/citizen older than 3 min -> wall.citizen_wallfeed;
     - PARITY (Jared 3:08 PM: the sky and wall must match, admin and projector): compares the category registry (id, label, color, icon,
       order, default) and the incident keys + categories of the wall server's snapshot, the admin path (citizen_parity_view) and the live
       projector page (window.__citView). Drift that lasts 2 runs alerts Scout (wall.citizen_parity) and a stale page is reloaded;
       it clears when they agree again. Every alert is signed Sky Sync.

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


def rpc(fn, args):
    cfg, key = load(CFG, {}), _secret()
    if not cfg or not key:
        return None
    r = _post(cfg["supabase_url"].rstrip("/") + "/rest/v1/rpc/" + fn, dict(args, p_token=key),
              {"apikey": cfg["publishable"], "Authorization": "Bearer " + cfg["publishable"]})
    return json.loads(r or b"null")


WALL_API = "http://192.168.1.211:8099/api/citizen"
PARITY_YOUNG_S = 150        # an incident first seen within this long may not have reached the other side yet
PARITY_RUNS = 2             # drift must show on this many runs in a row (5 min apart) before anyone is told


def _view(sn):
    """What a screen would draw from one snapshot: the category registry and the incident keys with their categories."""
    cats = sorted((c.get("id"), c.get("label"), c.get("color"), hashlib.md5((c.get("icon") or "").encode()).hexdigest()[:8], c.get("ord"), bool(c.get("default_on")))
                  for c in (sn.get("cats") or []))
    inc = {"%s|%s" % (i.get("key"), i.get("cat")): i for i in (sn.get("incidents") or [])}
    return cats, inc


def _diff(a, b, now_ms):
    """a, b = snapshots (wall server, admin path). Returns (registry_differs, only_in_a, only_in_b), ignoring incidents too young to have synced."""
    ca, ia = _view(a)
    cb, ib = _view(b)
    young = PARITY_YOUNG_S * 1000
    oa = sorted(k for k, v in ia.items() if k not in ib and now_ms - (v.get("first_seen") or 0) > young)
    ob = sorted(k for k, v in ib.items() if k not in ia and now_ms - (v.get("first_seen") or 0) > young)
    return ca != cb or a.get("hash") != b.get("hash"), oa, ob


def parity_check(st):
    """Sky and wall in parity (Jared 2026-10-28 3:08 PM). Three views of the same registry + incidents must agree: the wall server's /api/citizen
    (what the projector gets), the admin path (citizen_parity_view = wall_admin_citizen's payload, what /admin/sky gets) and the live projector
    page itself (window.__citView). Drift must persist PARITY_RUNS runs; a stale page is reloaded, anything else is told to Scout. Clears itself."""
    p = st.setdefault("parity", {"srv": 0, "pg": 0})
    now_ms = int(time.time() * 1000)
    try:
        with urllib.request.urlopen(WALL_API, timeout=10) as r:
            w = json.loads(r.read())
        wsn, adm = w.get("snap"), rpc("citizen_parity_view", {})
    except Exception as e:
        log("parity: could not read a side: %s" % e)
        return "parity: unreadable"
    if not isinstance(wsn, dict) or not isinstance(adm, dict):
        return "parity: no snapshot yet"
    notes = []
    # 1. wall server vs admin path
    reg_bad, only_w, only_a = _diff(wsn, adm, now_ms)
    if reg_bad or only_w or only_a:
        p["srv"] = p.get("srv", 0) + 1
        log("parity (server vs admin) run %d: registry %s, only on wall %s, only on admin %s" % (p["srv"], reg_bad, only_w[:5], only_a[:5]))
        if p["srv"] >= PARITY_RUNS:
            event(st, "wall.citizen_parity", "problem", "urgent", "wall and admin Sky map are out of parity",
                  "The projector's local alerts and /admin/sky are not showing the same thing. Registry (icons, colors, labels, switches) differs: %s. "
                  "Only on the wall: %s. Only on admin: %s. The wall server may be serving an old copy (its feed age is %s s)." %
                  (reg_bad, ", ".join(only_w[:6]) or "none", ", ".join(only_a[:6]) or "none", w.get("age_s")), push=True)
        notes.append("DRIFT server/admin")
    else:
        p["srv"] = 0
    # 2. the live projector page vs the wall server (the page pulls every 20 s)
    v = page("JSON.stringify(window.__citView?__citView():null)", 30)
    if isinstance(v, dict):
        pcats = sorted(v.get("cats") or [])
        scats = sorted("%s|%s|%s" % (c.get("id"), c.get("label"), c.get("color")) for c in (wsn.get("cats") or []))
        pinc = set(v.get("inc") or [])
        sinc = {"%s|%s" % (i.get("key"), i.get("cat")): i for i in (wsn.get("incidents") or [])}
        young = PARITY_YOUNG_S * 1000
        miss = sorted(k for k, i in sinc.items() if k not in pinc and now_ms - (i.get("first_seen") or 0) > young)
        extra = sorted(k for k in pinc if k not in sinc)
        if pcats != scats or v.get("hash") != wsn.get("hash") or miss or extra:
            p["pg"] = p.get("pg", 0) + 1
            log("parity (page vs server) run %d: registry %s, missing on page %s, extra on page %s" % (p["pg"], pcats != scats, miss[:5], extra[:5]))
            if p["pg"] >= PARITY_RUNS:
                run([NODE, RELOAD], 30)
                notes.append("reloaded the wall page for parity")
                if p["pg"] >= PARITY_RUNS + 1:
                    event(st, "wall.citizen_parity_page", "problem", "warning", "the projector page keeps showing old local alerts",
                          "After a reload the wall page still differs from the wall server's snapshot (registry %s, missing %s, extra %s)." %
                          (pcats != scats, ", ".join(miss[:5]) or "none", ", ".join(extra[:5]) or "none"))
            notes.append("DRIFT page/server")
        else:
            p["pg"] = 0
            event(st, "wall.citizen_parity_page", "resolved", "info", "the projector page matches again", "Registry and incidents agree with the wall server.")
    if not (reg_bad or only_w or only_a) and p.get("srv", 0) == 0:
        event(st, "wall.citizen_parity", "resolved", "info", "wall and admin Sky map are in parity again", "Same categories, icons, colors and incidents on both.")
    _, inc = _view(wsn)
    return "parity %s (%d categories, %d incidents)" % ("OK" if not notes else "; ".join(notes), len(wsn.get("cats") or []), len(inc))


def citizen_check(st):
    """Local alerts watchdog (v2). Collector alive, every active source fresh, wall fed, wall and admin in parity. Returns a short status for the beat."""
    try:
        s = rpc("citizen_status", {})
    except Exception as e:
        log("citizen_status failed: %s" % e)
        return "local alerts: status unreadable"
    if not s:
        return "local alerts: no credentials"
    src = s.get("sources") or {}
    col = src.get("collector") or {}

    # 1. the collector on Hestia must check in at least every 10 min; it is a systemd timer, so restarting the timer is the fix
    age = col.get("ok_age_s")
    if age is None or age > 600:
        rc, out = run(["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "hestia",
                       "sudo systemctl restart bestly-citizen.timer && sudo systemctl start --no-block bestly-citizen.service"], 40)
        log("collector silent (%s s); restart timer rc=%s %s" % (age, rc, out[:120]))
        event(st, "wall.citizen_collector", "problem", "urgent", "local alerts collector went quiet",
              "The local alerts collector on Hestia hasn't checked in for %s. I restarted bestly-citizen.timer over ssh (rc %s). "
              "If this stays up, check systemctl status bestly-citizen on Hestia." % ("%d min" % (age // 60) if age is not None else "ever", rc), push=True)
    else:
        event(st, "wall.citizen_collector", "resolved", "info", "local alerts collector is back", "The collector is checking in again.")

    # 2. every active source has its own freshness check. A source that stops answering goes quiet ("paused" on its switch in both the
    #    Wall > Sky details list and the Sky map panel), Scout hears once, the collector keeps retrying with backoff and it clears itself.
    ok_n, paused, setup = 0, [], []
    for c in s.get("configured") or []:
        name = c.get("source")
        if not c.get("active"):
            continue
        f = src.get(name)
        if not f:
            continue                       # never reported: not running yet (e.g. a feed another owner hasn't started); nothing to judge
        key = "wall.src_" + name
        if f.get("status") == "setup":
            setup.append(name)
            continue
        age = f.get("ok_age_s")
        if f.get("status") == "ok" and age is not None and age <= (c.get("stale_s") or 900):
            ok_n += 1
            event(st, key, "resolved", "info", "%s is answering again" % c.get("label"), "Its local alerts are back on the wall and the Sky map.")
        else:
            paused.append(name)
            event(st, key, "problem", "warning", "%s paused" % c.get("label"),
                  "%s has not answered for %s (status %s, %s failures in a row%s). Its category goes quiet ('paused') on the wall and the Sky map; "
                  "the collector keeps retrying with backoff and this clears on its own." %
                  (c.get("label"), ("%d min" % (age // 60)) if age is not None else "a while", f.get("status"), f.get("fail_count", 0),
                   ("; " + str(f.get("last_error"))[:120]) if f.get("last_error") else ""))
    mode = "%d source(s) fresh" % ok_n + ((", PAUSED: " + ", ".join(paused)) if paused else "") + ((", need setup: " + ", ".join(setup)) if setup else "")

    # 3. the wall server must be handing the snapshot to the page
    try:
        with urllib.request.urlopen(WALL_API, timeout=10) as r:
            w = json.loads(r.read())
        wa = w.get("age_s")
    except Exception as e:
        wa = None
        log("wall /api/citizen unreadable: %s" % e)
    if wa is None or wa > 180:
        event(st, "wall.citizen_wallfeed", "problem", "warning", "the wall isn't getting local alerts",
              "The wall server's /api/citizen is %s old (should be under 20 s). The sky layer hides itself when the data is over 3 min old." %
              ("%d s" % wa if wa is not None else "unreachable"))
    else:
        event(st, "wall.citizen_wallfeed", "resolved", "info", "the wall gets local alerts again", "/api/citizen is fresh.")

    # 4. parity between the projector and /admin/sky
    try:
        par = parity_check(st)
    except Exception as e:
        par = "parity check crashed: %s" % e
        log(par)
    return "local alerts: %s, %s open; %s" % (mode, s.get("open_incidents", 0), par)


def main():
    os.makedirs(DIR, exist_ok=True)
    st = load(STATE, {})
    try:
        cit_note = citizen_check(st)
    except Exception as e:
        cit_note = "local alerts check crashed: %s" % e
        log(cit_note)
    a = audit()
    if a is None:
        # the renderer being down belongs to Wall Renderer / Wall Watchdog; Sky Sync only notes it
        log("page unreachable (renderer down?)")
        beat(True, "wall page not reachable right now; renderer watchdogs own that; " + cit_note)
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
        beat(True, "sky is off (mapping, skit or no planes); nothing to check; " + cit_note)
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
    beat(not bad, "; ".join([summary] + note + [cit_note]))
    save(STATE, st)


if __name__ == "__main__":
    main()
