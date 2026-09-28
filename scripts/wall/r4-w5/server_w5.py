
# ---------- W5 round 4 (Claude 2026-09-28): indoor air -> Dyson purifier + fresh-air takeover; page health for signatures/shows ----------
# Indoor air comes from the Dyson purifier's own sensors (nothing else in the house measures it). The Dyson reaches us through
# Homebridge (homebridge-dyson-pure-cool); we read + drive it with the homebridge-config-ui-x REST API. Login lives only in
# /opt/bestly/wall/.homebridge.json (600, copied from the Home Hub agent config; backed up in Supabase Vault), never in git.
import urllib.request, urllib.error
# BAD  = PM2.5 >= 35 ug/m3 (EPA "unhealthy for sensitive groups" starts at 35.5) or HomeKit air quality 4-5 (Inferior/Poor),
#        on 2 readings in a row (about 2 min).
# GOOD = PM2.5 <= 20 and air quality 1-2 for 10 min in a row (hysteresis, so it can't flap around the line).
# Entering BAD: purifier on in auto mode (always), and the wall's fresh-air takeover (~15 s) at most once per 2 h, never in DND.
W5 = {"beat": None, "beat_at": 0.0, "take": None, "seq": int(time.time()), "air": {"at": 0.0, "ok_at": 0.0, "error": None, "found": None, "reading": None,
      "bad": False, "bad_n": 0, "good_since": None, "last_take": 0.0, "last_on": 0.0, "last_action": None, "readable": None}}
W5_AIR_FILE = os.path.join(ROOT, "w5_air.json")
W5_LOG = os.path.join(ROOT, "w5_air.log")
W5_HB_FILE = os.path.join(ROOT, ".homebridge.json")
_w5_tok = {"t": None, "at": 0.0}


def w5_log(msg):
    try:
        with open(W5_LOG, "a") as f:
            f.write(time.strftime("%Y-%m-%d %I:%M:%S %p ") + msg + "\n")
        if os.path.getsize(W5_LOG) > 400000:
            os.replace(W5_LOG, W5_LOG + ".1")
    except Exception:
        pass
    print("w5: " + msg, flush=True)


def w5_dnd(now=None):
    """Do Not Disturb from state.dnd (W4). Missing -> the old 11 PM - 7 AM quiet hours."""
    d = state.get("dnd")
    now = now or time.time()
    lt = time.localtime(now)
    if isinstance(d, dict):
        o = d.get("override")
        if isinstance(o, dict) and isinstance(o.get("until"), (int, float)) and o["until"] / 1000.0 > now:
            return o.get("mode") == "on"
        if d.get("on") is False:
            return False

        def m(x, dflt):
            try:
                h, mi = str(x or dflt).split(":")
                return int(h) * 60 + int(mi)
            except Exception:
                return m(dflt, dflt) if x != dflt else 0
        f, t, c = m(d.get("from"), "22:30"), m(d.get("to"), "07:00"), lt.tm_hour * 60 + lt.tm_min
        return (f <= c < t) if f <= t else (c >= f or c < t)
    return lt.tm_hour >= 23 or lt.tm_hour < 7


def _w5_hb_cfg():
    try:
        c = json.load(open(W5_HB_FILE))
        return c.get("base") or "http://127.0.0.1:8581", c.get("user"), c.get("password")
    except Exception:
        return None, None, None


def _w5_hb(method, path, data=None, retry=True):
    base, user, pw = _w5_hb_cfg()
    if not user:
        raise RuntimeError("no Homebridge login on the Pi (.homebridge.json)")
    if not _w5_tok["t"] or time.time() - _w5_tok["at"] > 3 * 3600:
        req = urllib.request.Request(base + "/api/auth/login", data=json.dumps({"username": user, "password": pw}).encode(),
                                     headers={"Content-Type": "application/json"}, method="POST")
        _w5_tok["t"] = json.load(urllib.request.urlopen(req, timeout=10)).get("access_token")
        _w5_tok["at"] = time.time()
    req = urllib.request.Request(base + path, data=None if data is None else json.dumps(data).encode(), method=method,
                                 headers={"Authorization": "Bearer " + str(_w5_tok["t"]), "Content-Type": "application/json"})
    try:
        raw = urllib.request.urlopen(req, timeout=15).read()
        return json.loads(raw or b"null")
    except urllib.error.HTTPError as e:
        if e.code == 401 and retry:
            _w5_tok["t"] = None
            return _w5_hb(method, path, data, False)
        raise RuntimeError(f"Homebridge {path} -> HTTP {e.code}")


def _w5_is_dyson(a):
    info = a.get("accessoryInformation") or {}
    txt = " ".join(str(x) for x in (info.get("Manufacturer"), info.get("Model"), info.get("Name"), info.get("Serial Number"), a.get("serviceName"), a.get("plugin"))).lower()
    return "dyson" in txt or "e2b-us-mja0869a" in txt


def w5_dyson_read():
    """-> (services, reading). services = the Dyson's Homebridge services; reading = the numbers the rule uses."""
    acc = _w5_hb("GET", "/api/accessories")
    if not isinstance(acc, list):
        raise RuntimeError("Homebridge did not list accessories (insecure mode off?)")
    mine = [a for a in acc if _w5_is_dyson(a)]
    W5["air"]["found"] = bool(mine)
    if not mine:
        return [], None
    rd = {"active": None, "state": None, "target": None, "speed": None, "aq": None, "pm25": None, "pm10": None, "voc": None, "no2": None,
          "filter": None, "filter_change": None, "temp_f": None, "humidity": None, "ids": {}}
    readable = {}
    for a in mine:
        stype = a.get("type") or a.get("humanType")
        for ch in a.get("serviceCharacteristics") or []:
            t, v = ch.get("type"), ch.get("value")
            readable.setdefault(stype, [])
            if t not in readable[stype]:
                readable[stype].append(t)
            key = {"Active": "active", "CurrentAirPurifierState": "state", "TargetAirPurifierState": "target", "RotationSpeed": "speed",
                   "AirQuality": "aq", "PM2_5Density": "pm25", "PM10Density": "pm10", "VOCDensity": "voc", "NitrogenDioxideDensity": "no2",
                   "FilterLifeLevel": "filter", "FilterChangeIndication": "filter_change", "CurrentTemperature": "temp_c", "CurrentRelativeHumidity": "humidity"}.get(t)
            if not key:
                continue
            if key == "temp_c":
                rd["temp_f"] = round(v * 9 / 5 + 32, 1) if isinstance(v, (int, float)) else None
            elif rd.get(key) is None:
                rd[key] = v
            if t in ("Active", "TargetAirPurifierState", "RotationSpeed") and ch.get("canWrite"):
                rd["ids"][t] = a.get("uniqueId")
    W5["air"]["readable"] = readable
    return mine, rd


def w5_air_bad(rd):
    pm, aq = rd.get("pm25"), rd.get("aq")
    return (isinstance(pm, (int, float)) and pm >= 35) or (isinstance(aq, (int, float)) and aq >= 4)


def w5_air_good(rd):
    pm, aq = rd.get("pm25"), rd.get("aq")
    ok_pm = pm is None or (isinstance(pm, (int, float)) and pm <= 20)
    ok_aq = aq is None or (isinstance(aq, (int, float)) and aq <= 2)
    return ok_pm and ok_aq and (pm is not None or aq is not None)


def w5_purifier_on(rd):
    """Active=1, auto mode. Returns 'on' | 'already' | 'failed'."""
    if rd.get("active") == 1:
        return "already"
    uid = (rd.get("ids") or {}).get("Active")
    if not uid:
        return "failed"
    try:
        _w5_hb("PUT", "/api/accessories/" + uid, {"characteristicType": "Active", "value": 1})
        tid = (rd.get("ids") or {}).get("TargetAirPurifierState")
        if tid:
            _w5_hb("PUT", "/api/accessories/" + tid, {"characteristicType": "TargetAirPurifierState", "value": 1})
        time.sleep(6)
        _, rd2 = w5_dyson_read()
        return "on" if rd2 and rd2.get("active") == 1 else "failed"
    except Exception as e:
        w5_log(f"purifier on failed: {e}")
        return "failed"


def w5_take(kind, **kw):
    global version
    with lock:
        W5["seq"] += 1
        W5["take"] = {"seq": W5["seq"], "kind": kind, "at": time.time(), **kw}
        version += 1
        lock.notify_all()


def w5_air_save():
    a = W5["air"]
    try:
        json.dump({k: a.get(k) for k in ("bad", "good_since", "last_take", "last_on", "last_action")}, open(W5_AIR_FILE, "w"))
    except Exception:
        pass


def w5_loop():
    a = W5["air"]
    try:
        a.update({k: v for k, v in json.load(open(W5_AIR_FILE)).items() if k in a})
    except Exception:
        pass
    while True:
        try:
            a["at"] = time.time()
            _, rd = w5_dyson_read()
            if rd is None:
                a["error"] = "Dyson not in Homebridge yet (the plugin is installed but not signed in)"
            else:
                a["reading"] = {k: v for k, v in rd.items() if k != "ids"}
                a["ok_at"], a["error"] = time.time(), None
                if w5_air_bad(rd):
                    a["bad_n"] += 1
                    a["good_since"] = None
                    if not a["bad"] and a["bad_n"] >= 2:
                        a["bad"] = True
                        res = w5_purifier_on(rd)
                        a["last_on"], a["last_action"] = time.time(), f"air bad (PM2.5 {rd.get('pm25')}, AQ {rd.get('aq')}): purifier {res}"
                        w5_log(a["last_action"])
                        if w5_dnd():
                            w5_log("takeover skipped: Do Not Disturb")
                        elif time.time() - a["last_take"] < 7200:
                            w5_log("takeover skipped: shown in the last 2 h")
                        else:
                            a["last_take"] = time.time()
                            w5_take("air", pm25=rd.get("pm25"), label={1: "Excellent", 2: "Good", 3: "Fair", 4: "Inferior", 5: "Poor"}.get(rd.get("aq")),
                                    purifier="on" if res in ("on", "already") else "failed")
                            w5_log("fresh-air takeover shown")
                        w5_air_save()
                else:
                    a["bad_n"] = 0
                    if w5_air_good(rd):
                        a["good_since"] = a["good_since"] or time.time()
                        if a["bad"] and time.time() - a["good_since"] >= 600:
                            a["bad"] = False
                            w5_log(f"air good again (PM2.5 {rd.get('pm25')}, AQ {rd.get('aq')})")
                            w5_air_save()
                    else:
                        a["good_since"] = None
        except Exception as e:
            a["error"] = str(e)[:200]
        time.sleep(60)


def w5_beat(b):
    if isinstance(b, dict):
        W5["beat"] = {k: b.get(k) for k in ("sig", "mot", "air", "ufo", "fps", "dnd")}
        W5["beat_at"] = time.time()


def w5_api():
    return {"take": W5["take"], "dnd": w5_dnd()}


def w5_health():
    a = W5["air"]
    return {"beat_age_s": round(time.time() - W5["beat_at"], 1) if W5["beat_at"] else None, "beat": W5["beat"],
            "signs_error": signs.get("error"), "signs_at": signs.get("at"),
            "air": {"configured": bool(_w5_hb_cfg()[1]), "found": a["found"], "error": a["error"], "age_s": round(time.time() - a["ok_at"]) if a["ok_at"] else None,
                    "bad": a["bad"], "reading": a["reading"], "last_action": a["last_action"], "readable": a["readable"]},
            "take": W5["take"]}


def w5_test(b):
    """localhost-only test hook: {"take":"air"} shows the takeover now (ignores DND and the 2 h limit)."""
    if (b or {}).get("take") == "air":
        rd = W5["air"].get("reading") or {}
        w5_take("air", pm25=rd.get("pm25") if rd.get("pm25") is not None else 42, label="Inferior", purifier="on" if rd.get("active") == 1 else "unknown", test=True)
        return {"ok": True, "take": W5["take"]}
    return {"ok": False}
