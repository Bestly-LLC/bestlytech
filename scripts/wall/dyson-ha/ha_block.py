
# ---------- Dyson via Home Assistant (Claude 2026-10-29): the purifier reads + drives through HA when Homebridge doesn't have it ----------
# Homebridge's Dyson plugin was never signed in, so the wall's Devices card sat on "Sign in once in Homebridge" for a month.
# Home Assistant already holds the Studio Dyson locally (Dyson Connector, Pi job dyson_connect), so the wall reads it from HA.
# Homebridge still wins if it ever lists the Dyson. HA token is read at runtime from /home/pi/scripts/.env, never written anywhere.
W5_HA_BASE = "http://127.0.0.1:8123"
W5_HA_ENV = "/home/pi/scripts/.env"
W5_HA_FAN = "fan.pure_cool_series_tp04_tp07_tp09_tp11_pc1"
W5_HA_SENS = {"pm25": "_pm_2_5", "pm10": "_pm_10", "voc": "_volatile_organic_compounds_index", "no2": "_nitrogen_dioxide_index",
              "filter": "_filter_life", "temp": "_temperature", "humidity": "_humidity"}


def _w5_ha_token():
    try:
        for ln in open(W5_HA_ENV):
            k, _, v = ln.strip().partition("=")
            if k in ("HA_TOKEN", "HASS_TOKEN", "HA_LONG_TOKEN") and v:
                return v.strip().strip('"').strip("'")
    except Exception:
        pass
    return None


def _w5_ha(method, path, data=None):
    t = _w5_ha_token()
    if not t:
        raise RuntimeError("no Home Assistant token on the Pi")
    req = urllib.request.Request(W5_HA_BASE + path, data=None if data is None else json.dumps(data).encode(), method=method,
                                 headers={"Authorization": "Bearer " + t, "Content-Type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=10).read() or b"null")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Home Assistant {path.split('?')[0]} -> HTTP {e.code}")


def _w5_num(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() else round(f, 1)
    except Exception:
        return None


def w5_dyson_read_ha():
    states = _w5_ha("GET", "/api/states")
    by = {e.get("entity_id"): e for e in (states or []) if isinstance(e, dict)}
    fan = by.get(W5_HA_FAN)
    if not fan or fan.get("state") in (None, "unavailable"):
        W5["air"]["found"] = False
        return [], None
    base = W5_HA_FAN.split(".", 1)[1]
    at = fan.get("attributes") or {}
    on = fan.get("state") == "on"
    pm = str(at.get("preset_mode") or "").lower()
    rd = {"active": 1 if on else 0, "state": 2 if on else 0, "target": (1 if pm == "auto" else 0) if on else None,
          "speed": _w5_num(at.get("percentage")) if on else 0, "aq": None, "pm25": None, "pm10": None, "voc": None, "no2": None,
          "filter": None, "filter_change": None, "temp_f": None, "humidity": None, "ids": {"ha": W5_HA_FAN}, "src": "ha"}
    for k, suf in W5_HA_SENS.items():
        e = by.get("sensor." + base + suf)
        v = _w5_num(e.get("state")) if e else None
        if v is None:
            continue
        if k == "temp":
            u = str((e.get("attributes") or {}).get("unit_of_measurement") or "")
            rd["temp_f"] = v if "F" in u else round(v * 9 / 5 + 32, 1)
        else:
            rd[k] = v
    if all(rd[k] is None for k in ("pm25", "pm10", "voc", "no2", "temp_f", "humidity")):
        # HA keeps the last fan state, but a Dyson that is really connected sends air data every ~30 s. All blank = not connected.
        W5["air"]["found"] = True
        raise RuntimeError("the Dyson is on Wi-Fi but isn't answering Home Assistant (its local connection is closed)")
    if isinstance(rd["filter"], (int, float)):
        rd["filter_change"] = 1 if rd["filter"] <= 5 else 0
    W5["air"]["found"] = True
    W5["air"]["readable"] = {"home_assistant": sorted(k for k in rd if rd[k] is not None and k not in ("ids", "src"))}
    return [fan], rd


_w5_dyson_read_hb = w5_dyson_read
_w5_purifier_on_hb = w5_purifier_on


def w5_dyson_read():
    hb_err = None
    try:
        mine, rd = _w5_dyson_read_hb()
        if mine:
            return mine, rd
    except Exception as e:
        hb_err = e
    try:
        return w5_dyson_read_ha()
    except Exception as e:
        raise RuntimeError(f"Dyson: Home Assistant ({e}); Homebridge ({hb_err or 'no Dyson listed'})")


def w5_purifier_on(rd):
    if (rd or {}).get("src") != "ha":
        return _w5_purifier_on_hb(rd)
    if rd.get("active") == 1:
        return "already"
    try:
        _w5_ha("POST", "/api/services/fan/turn_on", {"entity_id": W5_HA_FAN})
        try:
            modes = ((_w5_ha("GET", "/api/states/" + W5_HA_FAN) or {}).get("attributes") or {}).get("preset_modes") or []
            auto = next((m for m in modes if str(m).lower() == "auto"), None)
            if auto:
                _w5_ha("POST", "/api/services/fan/set_preset_mode", {"entity_id": W5_HA_FAN, "preset_mode": auto})
        except Exception as e:
            w5_log(f"purifier auto mode skipped: {e}")
        time.sleep(6)
        _, rd2 = w5_dyson_read()
        return "on" if rd2 and rd2.get("active") == 1 else "failed"
    except Exception as e:
        w5_log(f"purifier on (HA) failed: {e}")
        return "failed"
# ---------- end Dyson via Home Assistant ----------

