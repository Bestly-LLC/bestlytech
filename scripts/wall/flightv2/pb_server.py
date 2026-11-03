# FLIGHTV2 patch part B: server.py. usage: pb_server.py <path>   (run once; asserts every anchor)
import sys
p=sys.argv[1]; s=open(p).read()
assert 'FLIGHTV2_P2' not in s
def rep(old,new,cnt=1):
    global s
    assert s.count(old)==cnt,(old[:60],s.count(old))
    s=s.replace(old,new)
# --- air_loop: squawk, v2 labels, 24 planes instead of 12
rep('''"dst": a.get("dst"), "dir": a.get("dir")}''','''"dst": a.get("dst"), "dir": a.get("dir"), "sq": a.get("squawk")}''')
rep('''            out.sort(key=lambda x: x.get("dst") or 99)
''','''            out.sort(key=lambda x: x.get("dst") or 99)
            try:                                                   # FLIGHTV2_P2: label ladder from the enrichment cache
                _m = _ae_cards()["m"]
                for _x in out:
                    _r = _m.get(str(_x.get("hex") or "").lower())
                    if _r:
                        _x["v2"] = _v2_compact(_r)
            except Exception:
                pass
''')
rep('''air["list"], air["at"], air["error"] = out[:12], time.time(), None''','''air["list"], air["at"], air["error"] = out[:24], time.time(), None   # FLIGHTV2_P2: was 12 (no altitude cap exists)''')
rep('''"model", "maker", "area", "close", "from", "to", "news", "police")''','''"model", "maker", "area", "close", "from", "to", "news", "police", "sq", "v2")''')
rep('''"focus": state.get("airFocus"), "bearing": state.get("airBearing") or 0}''','''"focus": state.get("airFocus"), "bearing": state.get("airBearing") or 0, "far": _far_list(lst)}''')
helpers = r'''
# ---------- FLIGHTV2_P2 (2026-11-02): enrichment labels on the air list, off-map list, predictive sky heads-up, /api/bus ----------
_AEC = {"at": 0.0, "m": {}}


def _ae_cards():
    """hex -> enriched card (cache only, 4 s memo). Never raises."""
    now = time.time()
    if now - _AEC["at"] < 4:
        return _AEC
    _AEC["at"] = now
    try:
        import aircraft_enrich as _AE
        _c, _b = _AE.handle("/api/aircraft/live")
        d = json.loads(_b)
        _AEC["m"] = {str(r.get("hex") or "").lower(): r for r in (d.get("aircraft") or [])}
    except Exception as e:
        _AEC["at"] = now - 2
        _AEC["err"] = str(e)[:80]
    return _AEC


def _v2_compact(r):
    lv, rt, ph = (r.get("live") or {}), (r.get("route") or {}), (r.get("photo") or {})
    o = {"l": r.get("label"), "s": r.get("sublabel"), "t": r.get("tier"), "n": r.get("notable") or None, "e": r.get("emergency"),
         "ty": r.get("type_code"), "tn": r.get("type_name"), "rg": r.get("registration"), "ag": r.get("age_years"),
         "fr": rt.get("from"), "to": rt.get("to"), "fc": rt.get("from_city"), "tc": rt.get("to_city"),
         "ph": ph.get("thumb"), "pc": ph.get("credit"), "hel": True if r.get("helicopter") else None}
    return {k: v for k, v in o.items() if v not in (None, "", [])}


def _far_list(lst):
    """Planes the 15 mi enrichment poller sees that are not in the wall's air list (for the off-map edge pills)."""
    try:
        have = {str(x.get("hex") or "").lower() for x in (lst or [])}
        out = []
        for hx, r in _ae_cards()["m"].items():
            lv = r.get("live") or {}
            if hx in have or lv.get("lat") is None or lv.get("on_ground"):
                continue
            out.append({"h": hx, "l": r.get("label"), "lat": lv.get("lat"), "lon": lv.get("lon"), "alt": lv.get("alt_ft"),
                        "d": lv.get("dist_mi"), "hd": lv.get("heading"), "e": r.get("emergency"), "t": r.get("tier")})
        out.sort(key=lambda x: x.get("d") or 99)
        return out[:16]
    except Exception:
        return []


_BUS = {"at": 0.0, "body": None, "ok_at": 0.0}
BUS_URL = "http://192.168.1.182:8097/bus.json"


def _bus_proxy():
    """/api/bus: the Clio bus collector, fetched here (the Mac's local-network privacy blocks the page from reaching Clio itself)."""
    import urllib.request
    now = time.time()
    if _BUS["body"] is not None and now - _BUS["at"] < 8:
        return 200, _BUS["body"]
    _BUS["at"] = now
    try:
        with urllib.request.urlopen(urllib.request.Request(BUS_URL, headers={"User-Agent": "bestly-wall/1.0"}), timeout=4) as r:
            body = r.read().decode()
        json.loads(body)
        _BUS["body"], _BUS["ok_at"] = body, now
    except Exception as e:
        if _BUS["body"] is None or now - _BUS["ok_at"] > 180:
            return 200, json.dumps({"ok": False, "error": str(e)[:80], "lines": [], "vehicles": []})
    return 200, _BUS["body"]


SKY_PRED = {"fast": False, "cool": {}, "cool_e": {}, "st": {}, "starts": [], "last_end": 0.0, "err": None}


def _pred_flags(a):
    em = str(a.get("sq") or "") in SKYA.EMERGENCY_SQUAWKS or bool((a.get("v2") or {}).get("e"))
    alt = a.get("alt")
    rapid = (a.get("vr") or 0) <= -4000 and isinstance(alt, (int, float)) and alt < 10000 and (a.get("dst") or 99) * 1.1508 <= 15
    return em, rapid


def _pred_target(a, stage, c, stt, now):
    t = SKYA.plane_target(a, _plane_type(a), _iata)
    t["pred"] = {"stage": stage, "secs": (c or {}).get("secs"), "alt": ((c or {}).get("alt") if stage == "approaching" else a.get("alt")),
                 "progress": SKYA.pred_progress(c, stt["d0"]) if c else 0.5, "sq": a.get("sq"), "vr": a.get("vr")}
    return t


def _sky_plane(now):
    """FLIGHTV2_P2: predictive. A card starts when an aircraft is predicted to pass within 0.25 mi of home in <= 45 s (any altitude),
    or squawks 7700/7600/7500, or drops >= 4,000 ft/min below 10,000 ft inside 15 mi. airFocus (admin-pinned plane) keeps the old behavior."""
    hx0, why0 = _sky_target()
    if why0 == "airFocus":
        return _sky_plane_old(now)
    if now - air.get("at", 0) > 30:
        return None, "no feed"
    P = SKY_PRED
    by = {str(x.get("hex") or "").lower(): x for x in (air.get("list") or []) if x.get("lat") is not None}
    for k in [k for k, v in P["st"].items() if now - v["t0"] > 400]:
        P["st"].pop(k, None)
    cur = str(SKY_LA.get("hex") or "") if SKY_LA["active"] else ""
    act = cur[6:] if cur.startswith("plane:") else None
    if act:
        a, stt = by.get(act), P["st"].get(act)
        ended = a is None or stt is None
        if not ended:
            c = SKYA.cpa(a)
            if stt["mode"] in ("emergency", "rapid"):
                em, rapid = _pred_flags(a)
                still = em if stt["mode"] == "emergency" else rapid
                stt["bad"] = 0 if still else stt.get("bad", 0) + 1
                if stt["bad"] > 10 or now - stt["t0"] > 3600:
                    ended = True
                else:
                    return _pred_target(a, stt["mode"], c, stt, now), "predict"
            elif c is None or now - stt["t0"] > 240:
                ended = True
            elif c["secs"] < -6 and c["range_mi"] > 0.3:
                stt.setdefault("passed_at", now)
                if now - stt["passed_at"] > 12:
                    ended = True
                else:
                    return _pred_target(a, "passed", c, stt, now), "predict"
            elif c["range_mi"] <= 0.25 or abs(c["secs"]) <= 6:
                return _pred_target(a, "overhead", c, stt, now), "predict"
            elif c["miles"] > SKYA.PRED_ABORT_MI:
                stt.setdefault("turned_at", now)
                if now - stt["turned_at"] > 10:
                    ended = True
                else:
                    return _pred_target(a, "turned", c, stt, now), "predict"
            else:
                return _pred_target(a, "approaching", c, stt, now), "predict"
        P["fast"], P["last_end"] = True, now
        P["cool"][act] = now
        P["st"].pop(act, None)
        return None, "predict done"
    if now - P["last_end"] < 60:
        return None, "cooldown"
    best = None
    for hx, a in by.items():
        em, rapid = _pred_flags(a)
        c = SKYA.cpa(a)
        if em:
            if now - P["cool_e"].get(hx + str(a.get("sq")), 0) < 1800:
                continue
            key, mode = (0, 0.0), "emergency"
        elif now - P["cool"].get(hx, 0) < 1200:
            continue
        elif rapid:
            key, mode = (1, 0.0), "rapid"
        elif c and c["miles"] <= SKYA.PRED_START_MI and -3 <= c["secs"] <= SKYA.PRED_START_S:
            key, mode = (2, max(0.0, c["secs"])), "approaching"
        else:
            continue
        if best is None or key < best[0]:
            best = (key, hx, a, c, mode)
    if best is None:
        return None, "none predicted"
    P["starts"] = [x for x in P["starts"] if now - x < 3600]
    if len(P["starts"]) >= 6 and best[4] == "approaching":
        return None, "hourly cap"
    _k, hx, a, c, mode = best
    stt = {"mode": mode, "t0": now, "d0": max(0.3, (c or {}).get("along") or 0.5)}
    P["st"][hx], P["fast"] = stt, False
    P["starts"].append(now)
    if mode == "emergency":
        P["cool_e"][hx + str(a.get("sq"))] = now
    return _pred_target(a, mode, c, stt, now), "predict"

'''
rep('''def air_loop():
''', helpers+'''
def air_loop():
''')
# --- rename the old plane picker
rep('''def _sky_plane(now):
    hx, why = _sky_target()''','''def _sky_plane_old(now):
    hx, why = _sky_target()''')
# --- faster end + faster updates for the predictive card
rep('''if off or now - SKY_LA["gone_at"] >= 90:''','''if off or now - SKY_LA["gone_at"] >= (12 if (SKY_PRED.get("fast") and SKY_LA.get("kind") == "plane") else 90):''')
rep('''elif (now - SKY_LA["sent_at"] >= 20 and SKYA.visible_change''','''elif (now - SKY_LA["sent_at"] >= (6 if (kind == "plane" and t.get("pred")) else 20) and SKYA.visible_change''')
# --- /api/bus
rep('''        if p == "/api/sky-board" or p.startswith("/api/aircraft/"):''','''        if p == "/api/bus":                                           # FLIGHTV2_P2: Clio bus collector, proxied
            _bc, _bb = _bus_proxy()
            return self.send(_bc, _bb)
        if p == "/api/sky-board" or p.startswith("/api/aircraft/"):''')
open(p,'w').write(s)
print('server.py patched')
