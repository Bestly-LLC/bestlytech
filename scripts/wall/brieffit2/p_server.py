#!/usr/bin/env python3
"""BRIEFFIT2_20261104 server.py patch (anchored, exact-once): mirrors the wall's morning brief into the Home Assistant helper
input_boolean.wall_morning_brief (ON while the brief is showing, OFF when it hides) + watchdog.
usage: p_server.py <in.py> <out.py>"""
import sys, ast

src = open(sys.argv[1], encoding="utf-8").read()
if "BRIEFFIT2_20261104" in src:
    sys.exit("already patched")


def once(s, old, new):
    n = s.count(old)
    assert n == 1, (n, old[:80])
    return s.replace(old, new)


BLOCK = r'''# ---------- BRIEFFIT2_20261104: Morning Brief switch in Home Assistant / Apple Home / Siri (Jared 2026-11-04) ----------
# input_boolean.wall_morning_brief is ON while the brief is on the wall. Anyone turning it OFF (Siri, Home app, HA) dismisses the brief:
# the HA automation bestly_morning_brief_dismiss writes briefDismiss=$now through wall_ha_patch. Loop guard: this loop publishes
# sensor.wall_brief_show (on/off = what the wall wants) BEFORE it flips the helper, and that automation only acts while the sensor is on,
# so the Pi's own OFF (brief hid at noon / was dismissed) never writes a dismiss. Watchdog: helper and brief disagree > 2 min -> re-sync
# every minute; 2 failed re-syncs (or HA unreachable 2 min) -> Scout wall.morning_brief_ha (info = digest only, signed Wall Watchdog).
BRIEF_HA_ENT = "input_boolean.wall_morning_brief"
BRIEF_HA_SENSOR = "sensor.wall_brief_show"
BRIEF_HA_TEST = os.path.join(ROOT, "brief_ha_test.json")      # {"show": true, "until": epoch}: test only, never changes what the wall shows
BRIEF_HA_STATUS = os.path.join(ROOT, "brief_ha.json")
BRIEF_HA = {"want": None, "since": 0.0, "set_at": 0.0, "pub_at": 0.0, "pub": None, "resyncs": 0, "down_since": 0.0, "sent": False, "err": None, "have": None, "ok_at": 0.0}


def _brief_ha_req(method, path, body=None, timeout=6):
    req = urllib.request.Request(HA_URL + path, data=(json.dumps(body).encode() if body is not None else None), method=method,
                                 headers={"Authorization": "Bearer " + ha_token(), "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    return json.loads(raw) if raw else None


def _brief_ha_want():
    want = bool(brief_payload().get("show"))
    try:
        t = json.load(open(BRIEF_HA_TEST))
        if float(t.get("until", 0)) > time.time() and "show" in t:
            want = bool(t["show"])
    except Exception:
        pass
    return want


def _brief_ha_report(open_, msg):
    if open_:
        return _w2_report("wall.morning_brief_ha", "problem", "info", "Morning Brief switch is out of sync",
                          msg + "\n\n- Wall Watchdog, wall morning brief")
    return _w2_report("wall.morning_brief_ha", "resolved", "info", "Morning Brief switch is back in sync",
                      msg + "\n\n- Wall Watchdog, wall morning brief")


def _brief_ha_sync():
    S = BRIEF_HA
    now = time.time()
    want = _brief_ha_want()
    try:
        have = _brief_ha_req("GET", "/api/states/" + BRIEF_HA_ENT).get("state") == "on"
        S["err"], S["down_since"], S["have"] = None, 0.0, have
    except Exception as e:
        S["err"] = str(e)[:100]
        S["down_since"] = S["down_since"] or now
        if now - S["down_since"] > 120 and not S["sent"]:
            S["sent"] = _brief_ha_report(True, "The Pi could not reach the Morning Brief switch in Home Assistant for over 2 minutes (" + S["err"] + "). "
                                               "Saying 'turn off Morning Brief' may not dismiss the brief until it is back; the Bestly Admin button still works.")
        return
    if S["pub"] != want or now - S["pub_at"] > 30:               # ignore flag first, helper second
        try:
            _brief_ha_req("POST", "/api/states/" + BRIEF_HA_SENSOR, {"state": "on" if want else "off", "attributes": {"friendly_name": "Wall brief showing"}})
            S["pub"], S["pub_at"] = want, now
        except Exception as e:
            S["err"] = "publish: " + str(e)[:80]
            return
    changed = S["want"] != want
    S["want"] = want
    if have == want:
        S["since"], S["resyncs"] = 0.0, 0
        S["ok_at"] = now
        if S["sent"]:
            S["sent"] = not _brief_ha_report(False, "The Morning Brief switch in Home Assistant matches the wall again.")
    else:
        S["since"] = S["since"] or now
        late = now - S["since"] > 120 and now - S["set_at"] > 60
        if (changed or late) and now - S["set_at"] > 8:
            try:
                _brief_ha_req("POST", "/api/services/input_boolean/" + ("turn_on" if want else "turn_off"), {"entity_id": BRIEF_HA_ENT})
                S["set_at"] = now
                if late:
                    S["resyncs"] += 1
                    print(f"brief_ha: re-sync -> {'on' if want else 'off'} (try {S['resyncs']})", flush=True)
                else:
                    print(f"brief_ha: helper -> {'on' if want else 'off'}", flush=True)
            except Exception as e:
                S["err"] = "set: " + str(e)[:80]
                S["resyncs"] += 1 if late else 0
        if S["resyncs"] >= 2 and not S["sent"]:
            S["sent"] = _brief_ha_report(True, "The wall brief is " + ("showing" if want else "hidden") + " but the Morning Brief switch in Home Assistant says "
                                               + ("off" if want else "on") + " for over 2 minutes, and re-syncing did not fix it. 'Turn off Morning Brief' may not "
                                               "dismiss the brief until it does; the Bestly Admin button still works.")
    try:
        json.dump({"want": want, "have": have, "since": S["since"], "resyncs": S["resyncs"], "err": S["err"], "sent": S["sent"], "at": int(now)}, open(BRIEF_HA_STATUS, "w"))
    except Exception:
        pass


def brief_loop():'''
src = once(src, "def brief_loop():", BLOCK)
src = once(src, "            _brief_tick()\n            BRIEF_ST[\"beat\"] = time.time()\n",
           "            _brief_tick()\n            BRIEF_ST[\"beat\"] = time.time()\n"
           "            try:\n                _brief_ha_sync()                                   # BRIEFFIT2_20261104\n"
           "            except Exception as e:\n                print(f\"brief_ha: {e}\", flush=True)\n")
ast.parse(src)
open(sys.argv[2], "w", encoding="utf-8").write(src)
print("ok")
