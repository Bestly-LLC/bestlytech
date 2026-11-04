# ---------- BRIEF_20261103: morning brief on the wall (Jared 2026-11-03) ----------
# Starts (once a day, 5 AM to noon, only while he is home) on the first of: the wake-up alarm stopped/snoozed, or first motion on the
# Hue motion sensor. Dismissed from the Bestly Admin app with state.briefDismiss (ms timestamp); auto-hides at noon. Also keeps the
# overnight sky log (10 PM to 6 AM: low planes, helicopters, LAX flow flips) and the Scout/Turo digest numbers. The page falls back to
# the normal board whenever this endpoint or its data fails; stale data is reported to Scout as digest-only (info).
BRIEF_FILE = os.path.join(ROOT, "brief_state.json")
BRIEF_SKY_FILE = os.path.join(ROOT, "brief_sky.json")
BRIEF_ST = {"day": None, "start": None, "src": None, "data": None, "data_at": 0.0, "err": None, "beat": 0.0, "bad": 0, "sent": False, "tries": 0}
BRIEF_SKY = {"nights": {}, "dirty": False, "flow": None, "cand": None, "cand_n": 0, "chk": 0.0, "saved": 0.0}


def _brief_now():
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/Los_Angeles"))


def _brief_night(d):
    """The night key (date of the 10 PM it started) while 10 PM to 6 AM, else None."""
    if d.hour >= 22:
        return d.strftime("%Y-%m-%d")
    if d.hour < 6:
        return (d - timedelta(days=1)).strftime("%Y-%m-%d")
    return None


def _brief_rec(n):
    return BRIEF_SKY["nights"].setdefault(n, {"planes": [], "helis": [], "flips": []})


def _brief_sky_note(out):
    """Called from air_loop with every aircraft in range (before the 24-item cap)."""
    n = _brief_night(_brief_now())
    if n is None:
        return
    rad = state.get("airRadiusMi")
    rad = rad if isinstance(rad, (int, float)) and not isinstance(rad, bool) and 2 <= rad <= 25 else 15
    rec = _brief_rec(n)
    ps, hs = set(rec["planes"]), set(rec["helis"])
    b0 = (len(ps), len(hs))
    for x in out:
        alt, dst = x.get("alt"), x.get("dst")
        if not isinstance(alt, (int, float)) or alt >= 2000 or dst is None or dst * 1.1508 > rad:
            continue
        hx = str(x.get("hex") or "").lower()
        if not hx:
            continue
        heli = str(x.get("cat") or "").upper() == "A7" or bool(HELI_T.match(x.get("t") or ""))
        (hs if heli else ps).add(hx)
    if (len(ps), len(hs)) != b0:
        rec["planes"], rec["helis"] = sorted(ps), sorted(hs)
        BRIEF_SKY["dirty"] = True


def _brief_flow_tick(d):
    n = _brief_night(d)
    if n is None or time.time() - BRIEF_SKY["chk"] < 60:
        return
    BRIEF_SKY["chk"] = time.time()
    import aircraft_enrich as _AE
    f = (((_AE.sky_board() or {}).get("airports") or {}).get("LAX") or {}).get("flow")
    if not f:
        return
    S = BRIEF_SKY
    if S["flow"] is None:
        S["flow"] = f
        return
    if f == S["flow"]:
        S["cand"], S["cand_n"] = None, 0
        return
    if f == S["cand"]:
        S["cand_n"] += 1
    else:
        S["cand"], S["cand_n"] = f, 1
    if S["cand_n"] >= 3:                                  # three one-minute reads in a row = a real change
        _brief_rec(n)["flips"].append({"to": f, "ts": int(time.time()), "at": d.strftime("%-I:%M %p")})
        S["flow"], S["cand"], S["cand_n"], S["dirty"] = f, None, 0, True
        print(f"brief: LAX flow -> {f}", flush=True)


def _brief_save_sky(force=False):
    S = BRIEF_SKY
    if not (S["dirty"] or force) or time.time() - S["saved"] < 60:
        return
    keep = sorted(S["nights"])[-14:]
    S["nights"] = {k: S["nights"][k] for k in keep}
    tmp = BRIEF_SKY_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"nights": S["nights"], "flow": S["flow"]}, f)
    os.replace(tmp, BRIEF_SKY_FILE)
    S["dirty"], S["saved"] = False, time.time()


def _brief_save_state():
    with open(BRIEF_FILE, "w") as f:
        json.dump({"day": BRIEF_ST["day"], "start": BRIEF_ST["start"], "src": BRIEF_ST["src"]}, f)


def _brief_detect(d, five):
    """-> (source, ts) or None: the alarm stopped/snoozed since 5 AM, else motion on the Hue sensor since 5 AM."""
    a = state.get("alarm") if isinstance(state.get("alarm"), dict) else {}
    now = time.time()
    best = 0.0
    for k, ahead in (("stop", 60), ("snooze", 600)):       # a snooze value is the time it is snoozed UNTIL
        v = a.get(k) or 0
        v = v / 1000 if v > 1e11 else v
        if five <= v <= now + ahead:
            best = max(best, v)
    la = ALARM_ACT.get("last") or {}
    if la.get("action") in ("WALL_ALARM_STOP", "WALL_ALARM_SNOOZE") and (la.get("at") or 0) >= five:
        best = max(best, la["at"])
    if best:
        return "alarm", best
    e = _ha_entity("binary_sensor.hue_motion_sensor_motion")
    lc = e.get("last_changed") or ""
    if lc and e.get("state") in ("on", "off"):
        ts = datetime.fromisoformat(lc.replace("Z", "+00:00")).timestamp()
        if ts >= five:
            return "motion", ts
    return None


def _brief_fetch():
    d = rpc("wall_pi_brief", {}, timeout=15)
    if isinstance(d, dict) and "fixed" in d:
        BRIEF_ST["data"], BRIEF_ST["data_at"], BRIEF_ST["err"], BRIEF_ST["bad"] = d, time.time(), None, 0
        if BRIEF_ST["sent"] and _w2_report("wall.morning_brief", "resolved", "info", "Morning brief data is back",
                                           "The morning brief on the wall is reading overnight fixes and Turo trips again."):
            BRIEF_ST["sent"] = False
        return True
    raise RuntimeError("brief rpc returned no data")


def _brief_tick():
    d = _brief_now()
    today = d.strftime("%Y-%m-%d")
    _brief_flow_tick(d)
    _brief_save_sky()
    if BRIEF_ST["day"] != today:
        BRIEF_ST.update(day=today, start=None, src=None, tries=0)
        _brief_save_state()
    if not (5 <= d.hour < 12):
        return
    five = d.replace(hour=5, minute=0, second=0, microsecond=0).timestamp()
    if BRIEF_ST["start"] is None and PRES.get("where") == "home":
        det = _brief_detect(d, five)
        if det:
            BRIEF_ST["start"], BRIEF_ST["src"] = time.time(), det[0]
            _brief_save_state()
            print(f"brief: started by {det[0]}", flush=True)
            BRIEF_ST["data_at"] = 0.0
    if BRIEF_ST["start"] is not None or d.hour >= 6:
        if time.time() - BRIEF_ST["data_at"] > (60 if BRIEF_ST["start"] and not BRIEF_ST["data"] else 300):
            try:
                _brief_fetch()
            except Exception as e:
                BRIEF_ST["err"] = str(e)[:140]
                BRIEF_ST["bad"] += 1
                BRIEF_ST["data_at"] = time.time() - 240          # retry in about a minute
    # watchdog: started, but data missing/stale for ~15 min -> Scout (digest only)
    if BRIEF_ST["start"] is not None and BRIEF_ST["bad"] >= 12 and not BRIEF_ST["sent"]:
        BRIEF_ST["sent"] = _w2_report("wall.morning_brief", "problem", "info", "Morning brief data is not loading",
                                      "The morning brief could not read overnight fixes / Turo trips (" + str(BRIEF_ST["err"]) + "). The wall shows the normal board with no brief numbers; it retries every minute.")


def _brief_dismissed(five):
    v = state.get("briefDismiss")
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return False
    return (v / 1000 if v > 1e11 else v) >= five


def brief_payload():
    d = _brief_now()
    today = d.strftime("%Y-%m-%d")
    five = d.replace(hour=5, minute=0, second=0, microsecond=0).timestamp()
    start = BRIEF_ST["start"] if BRIEF_ST["day"] == today else None
    dis = _brief_dismissed(five)
    home = PRES.get("where") == "home"
    fresh = bool(BRIEF_ST["data"]) and time.time() - BRIEF_ST["data_at"] < 1200
    prev = (d - timedelta(days=1)).strftime("%Y-%m-%d")
    rec = BRIEF_SKY["nights"].get(prev) or {}
    fl = (rec.get("flips") or [])
    show = bool(start) and not dis and home and 5 <= d.hour < 12
    dg = BRIEF_ST["data"] if fresh else None
    return {"show": show, "day": today, "start": start, "src": BRIEF_ST["src"], "dismissed": dis, "home": home,
            "sky": {"planes": len(rec.get("planes") or []), "helis": len(rec.get("helis") or []), "flip": fl[-1] if fl else None},
            "digest": ({"fixed": dg.get("fixed"), "needs": dg.get("needs"), "top": dg.get("top")} if dg else None),
            "turo": (dg.get("turo") if dg else None), "data_age_s": round(time.time() - BRIEF_ST["data_at"]) if BRIEF_ST["data_at"] else None,
            "beat_age_s": round(time.time() - BRIEF_ST["beat"]) if BRIEF_ST["beat"] else None, "err": BRIEF_ST["err"], "tz": "America/Los_Angeles"}


def brief_loop():
    try:
        s = json.load(open(BRIEF_FILE))
        BRIEF_ST.update(day=s.get("day"), start=s.get("start"), src=s.get("src"))
    except Exception:
        pass
    try:
        j = json.load(open(BRIEF_SKY_FILE))
        BRIEF_SKY["nights"], BRIEF_SKY["flow"] = j.get("nights") or {}, j.get("flow")
    except Exception:
        pass
    while True:
        try:
            _brief_tick()
            BRIEF_ST["beat"] = time.time()
        except Exception as e:
            BRIEF_ST["err"] = str(e)[:140]
            print(f"brief_loop: {e}", flush=True)
        time.sleep(10)


