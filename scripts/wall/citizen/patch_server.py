import re, sys
p = "/opt/bestly/wall/server.py"
s = open(p).read()
orig = s

# 1) state switch default + allowlist
a = 'DEFAULT_STATE.update({"skyCars": True, "skyCarLabels": True})'
assert a in s
s = s.replace(a, 'DEFAULT_STATE.update({"skyAlerts": True})   # Local alerts layer on the sky (Citizen/NWS/CHP; admin Wall > Sky details; 2026-10-28)\n' + a, 1)
b = 'if k in ("issTag", "skyHome", "atc", "skyCars", "skyCarLabels", "skyOverscan", "skyTiles") and not isinstance(v, bool):'
assert b in s
s = s.replace(b, b.replace('"skyCarLabels",', '"skyCarLabels", "skyAlerts",'), 1)

# 2) loop + cache, placed before the ISS helper
marker = '_iss = {"at": 0.0, "ok_at": 0.0, "v": {}, "err": None}'
assert marker in s
block = '''# LOCAL ALERTS (Sky Sync, 2026-10-28): the Hestia collector (bestly-citizen.timer) writes Citizen/NWS/CHP incidents to Supabase;
# this pulls wall_citizen_snapshot every 20 s for the sky layer ("citizen" in SKYLAYERS) and keeps the last good copy on disk.
# PRIVATE / INTERNAL: served only to the wall page, never to guests.
CIT_FILE = os.path.join(ROOT, "citizen_snap.json")
CIT = {"snap": None, "ok_at": 0.0, "error": None, "fails": 0}


def citizen_loop():
    time.sleep(10)
    try:
        d = json.load(open(CIT_FILE))
        CIT.update(snap=d.get("snap"), ok_at=d.get("ok_at") or 0.0)
    except Exception:
        pass
    while True:
        wait = 20
        try:
            snap = rpc("wall_citizen_snapshot", {}, timeout=10)
            if isinstance(snap, dict):
                CIT.update(snap=snap, ok_at=time.time(), error=None, fails=0)
                with open(CIT_FILE + ".tmp", "w") as f:
                    json.dump({"snap": snap, "ok_at": CIT["ok_at"]}, f)
                os.replace(CIT_FILE + ".tmp", CIT_FILE)
        except Exception as e:
            CIT["error"], CIT["fails"], wait = str(e)[:160], CIT["fails"] + 1, min(120, 20 * (CIT["fails"] + 1))
        time.sleep(wait)


'''
s = s.replace(marker, block + marker, 1)

# 3) route
r = '        if p == "/api/air":'
assert r in s
route = '''        if p == "/api/citizen":   # local alerts for the sky layer (Sky Sync); age_s lets the page and Sky Sync judge freshness
            with lock:
                return self.send(200, json.dumps({"snap": CIT["snap"], "age_s": round(time.time() - CIT["ok_at"], 1) if CIT["ok_at"] else None,
                                                  "error": CIT["error"]}))
'''
s = s.replace(r, route + r, 1)

# 4) thread
t = '    threading.Thread(target=news_loop, daemon=True).start()   # W1 round 4'
assert t in s
s = s.replace(t, t + '\n    threading.Thread(target=citizen_loop, daemon=True).start()   # local alerts (Sky Sync, 2026-10-28)', 1)

# 5) heartbeat
h = '            hb["routes"] = {"known": _rt["known"]'
assert h in s
s = s.replace(h, '            hb["citizen"] = {"age_s": round(time.time() - CIT["ok_at"], 1) if CIT["ok_at"] else None, "error": CIT["error"],\n                             "n": len((CIT["snap"] or {}).get("incidents") or [])}\n' + h, 1)
open(p, "w").write(s)
print("patched", len(orig), "->", len(s))
