# ---------- AUDIO_20261103: projector audio path (Q38 / Q42). The wall page (Mac headless Chrome, captured with tab audio into go2rtc "wallmac" and
# played by the projector app; or the Fully Kiosk fallback page) runs an invisible listener that long-polls GET /api/sound/next and plays the
# claimed sound with Web Audio through the page's own sound engine. POST /api/sound (LAN only) is the one door; every gate is enforced here. ----------
PJA_DIR = os.path.join(WWW, "sounds")
PJA_LOG = os.path.join(ROOT, "pja_log.jsonl")
PJA_FILES = {"chime": "chime.wav", "rare": "rare.wav", "alert": "alert.wav"}
PJA_EMERG_VOL = 60            # percent of the projector's 0-100 scale; emergency may raise to this, never above, then restore
PJA_RATE_S = 60               # at most one non-emergency sound per minute
PJA = {"seq": 0, "ev": None, "claimed": None, "claimed_by": None, "last_normal": 0.0, "polls": {}, "ctx": None, "ctx_bad_since": None,
       "ack": None, "played": 0, "sent": 0, "suppressed": 0, "bad": 0, "sent_state": None, "tap_at": 0.0, "boot": time.time(), "last_bad": None}
PJA_LOCK = threading.Lock()


def pja_log(entry):
    entry = dict(entry, t=round(time.time(), 1), at=time.strftime("%Y-%m-%d %I:%M:%S %p"))
    print("pja: " + json.dumps(entry), flush=True)
    try:
        with open(PJA_LOG, "a") as f:
            f.write(json.dumps(entry) + "\n")
        if os.path.getsize(PJA_LOG) > 400000:
            with open(PJA_LOG) as f:
                keep = f.readlines()[-400:]
            with open(PJA_LOG, "w") as f:
                f.writelines(keep)
    except Exception:
        pass


def pja_la_hour():
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/Los_Angeles")).hour


def pja_asleep():
    """Why the wall is asleep, or None. Projector screen off / unreachable, wall power override off, or no page heartbeat."""
    try:
        if projector_asleep():
            return "projector screen is off"
        ov = _ov_read()
        if ov.get("on") is False and (ov.get("until") or 0) > time.time():
            return "wall power is off"
        hb = json.load(open(HEART_FILE))
        if time.time() - hb.get("at", 0) > 120:
            return "no wall page heartbeat for 2 minutes"
        if hb.get("dark"):
            return "wall is dark"
    except Exception:
        return None
    return None


def pja_private():
    """Private-time scene gate. input_boolean.sexy_time must be exactly 'off'; unknown / unavailable / unreadable all block."""
    try:
        st = _ha_entity("input_boolean.sexy_time").get("state")
    except Exception:
        st = None
    return st != "off", st


def pja_listener_age():
    with PJA_LOCK:
        if not PJA["polls"]:
            return None
        return time.time() - max(PJA["polls"].values())


def pja_enqueue(sound, reason, priority):
    with PJA_LOCK:
        PJA["seq"] += 1
        PJA["ev"] = {"seq": PJA["seq"], "sound": sound, "reason": reason, "priority": priority, "at": time.time(), "ttl": 12}
        PJA["claimed"] = None
        PJA["sent"] += 1
        return PJA["seq"]


def pja_emergency(sound, reason, priority):
    """Emergency: if the projector is quieter than the fixed moderate level, raise to it, play, restore. Never goes above it."""
    cur = None
    try:
        if not _muted():
            cur = _vol_get()
            if cur is not None and cur < PJA_EMERG_VOL:
                _vol_set(PJA_EMERG_VOL)
            else:
                cur = None
    except Exception as e:
        pja_log({"vol_err": str(e)[:80]})
        cur = None
    seq = pja_enqueue(sound, reason, priority)
    pja_log({"queued": sound, "seq": seq, "priority": priority, "reason": reason, "vol_restore_to": cur})
    if cur is not None:
        time.sleep(4.5)
        try:
            _vol_set(cur)
            pja_log({"vol_restored": cur})
        except Exception as e:
            pja_log({"vol_restore_err": str(e)[:80]})


def pja_request(sound, reason="", priority="normal", test=None):
    """The one decision point. Returns (http_code, dict). `test` (dict of sexy_time / hour / asleep / sound_on overrides) makes this a dry run:
    gates are evaluated with the overrides, nothing is queued, the outcome is logged."""
    test = test if isinstance(test, dict) and test else None
    sound, priority = str(sound or "")[:24], str(priority or "normal")[:12]
    reason = str(reason or "")[:120]
    if sound not in PJA_FILES or priority not in ("normal", "emergency", "safety"):
        return 400, {"ok": False, "error": "bad sound or priority", "sounds": sorted(PJA_FILES)}
    base = {"sound": sound, "reason": reason, "priority": priority, "test": bool(test)}

    def no(why):
        PJA["suppressed"] += 1
        pja_log(dict(base, suppressed=why))
        return 200, {"ok": True, "played": False, "suppressed": why, "detail": "suppressed: " + why}
    loud = priority in ("emergency", "safety")
    if test and test.get("sexy_time") is not None:
        priv, st = str(test["sexy_time"]) != "off", str(test["sexy_time"])
    else:
        priv, st = pja_private()
    if priv and priority != "safety":
        return no("private-time scene (input_boolean.sexy_time=%s); only a true safety alarm may play" % st)
    hour = test["hour"] if test and isinstance(test.get("hour"), int) else pja_la_hour()
    if (hour >= 23 or hour < 7) and not loud:
        return no("quiet hours 11 PM to 7 AM; only emergency may play")
    sl = ("test: wall asleep" if test.get("asleep") else None) if test and "asleep" in test else pja_asleep()
    if sl and not loud:
        return no("wall asleep (%s); only emergency may play" % sl)
    snd_on = (test.get("sound_on") if test and "sound_on" in test else state.get("sound", True) is not False)
    if not snd_on and not loud:
        return no("wall sounds are switched off in the admin")
    now = time.time()
    if not loud and now - PJA["last_normal"] < PJA_RATE_S:
        return no("rate limit: one non-emergency sound per %d s (last %d s ago)" % (PJA_RATE_S, now - PJA["last_normal"]))
    age = pja_listener_age()
    if age is None or age > 20:
        if not test:
            return no("no sound listener has checked in (last %s)" % ("never" if age is None else "%d s ago" % age))
    if test:
        pja_log(dict(base, dry_run="would play"))
        return 200, {"ok": True, "played": False, "dry_run": True, "detail": "dry run: all gates passed, would play"}
    if not loud:
        PJA["last_normal"] = now
        seq = pja_enqueue(sound, reason, priority)
        pja_log(dict(base, queued=sound, seq=seq))
        return 200, {"ok": True, "played": True, "seq": seq, "detail": "queued %s" % sound}
    threading.Thread(target=pja_emergency, args=(sound, reason, priority), daemon=True).start()
    return 200, {"ok": True, "played": True, "detail": "emergency queued (volume check first)"}


def pja_next(cid, after, ctx):
    now = time.time()
    with PJA_LOCK:
        PJA["polls"][cid] = now
        PJA["polls"] = {k: v for k, v in PJA["polls"].items() if now - v < 300}
        PJA["ctx"] = ctx
        ev = PJA["ev"]
        if ev and now - ev["at"] <= ev["ttl"] and PJA["claimed"] != ev["seq"] and ev["seq"] > after:
            PJA["claimed"], PJA["claimed_by"] = ev["seq"], cid
            return {"seq": ev["seq"], "sound": ev["sound"], "url": "/sounds/" + PJA_FILES[ev["sound"]], "gain": 1.6,
                    "priority": ev["priority"]}
    return {}


def pja_ack(b):
    PJA["ack"] = {"seq": b.get("seq"), "state": str(b.get("state"))[:12], "detail": str(b.get("detail") or "")[:80], "at": time.time(),
                  "cid": str(b.get("cid") or "")[:12]}
    if b.get("state") == "played":
        PJA["played"] += 1
    pja_log({"ack": PJA["ack"]})


def pja_status():
    age = pja_listener_age()
    return {"listeners": len(PJA["polls"]), "listener_age_s": None if age is None else round(age, 1), "ctx": PJA["ctx"], "sent": PJA["sent"],
            "played": PJA["played"], "suppressed": PJA["suppressed"], "ack": PJA["ack"], "bad": PJA["bad"], "last_bad": PJA["last_bad"],
            "report_state": PJA["sent_state"], "files": {k: os.path.isfile(os.path.join(PJA_DIR, v)) for k, v in PJA_FILES.items()}}


def pja_stream_audio():
    """go2rtc wallmac: True/False = the Mac publisher is live and does / does not offer an audio track; None = not live (fallback page) or unknown."""
    try:
        import urllib.request as _u
        with _u.urlopen("http://127.0.0.1:1984/api/streams?src=wallmac", timeout=4) as r:
            d = json.loads(r.read())
        prods = d.get("producers") or []
        if not prods:
            return None
        return any("audio" in str(m) for p in prods for m in (p.get("medias") or []))
    except Exception:
        return None


def pja_check():
    now = time.time()
    bad = None
    try:
        hb = json.load(open(HEART_FILE))
    except Exception:
        hb = {}
    alive = now - hb.get("at", 0) < 90 and not hb.get("dark") and not pja_asleep()
    if alive:
        age = pja_listener_age()
        ctx = PJA["ctx"]
        if ctx in (None, "running", "suspended"):
            PJA["ctx_bad_since"] = None
        else:
            PJA["ctx_bad_since"] = PJA["ctx_bad_since"] or now
        if age is None and now - PJA["boot"] < 120:
            pass                                                   # just restarted; the page checks in within a minute
        elif age is None or age > 25:
            bad = "the sound listener on the wall page stopped checking in (%s)" % ("never" if age is None else "%d s ago" % age)
        elif PJA["ctx_bad_since"] and now - PJA["ctx_bad_since"] > 150:
            bad = "the wall page's sound engine is locked (%s), so a sound could not play" % ctx
            if now - PJA["tap_at"] > 120:                           # same unlock tap the existing sound watchdog uses
                PJA["tap_at"] = now
                threading.Thread(target=lambda: adb("shell", "input", "tap", "1880", "1050"), daemon=True).start()
        elif pja_stream_audio() is False:
            bad = "the wall video stream to the projector has no audio track"
    PJA["bad"] = PJA["bad"] + 1 if bad else 0
    if bad:
        PJA["last_bad"] = bad
    if PJA["bad"] >= 3 and PJA["sent_state"] != "problem":
        if _w2_report("wall.audio_path", "problem", "info", "Wall sound path needs a look",
                      "On the wall, %s. The page reloads its own listener when it stalls, and the Pi taps the wall to unlock sound. "
                      "If it keeps happening, restart the wall from the admin.\n\n- Wall Watchdog, wall alarm keeper" % bad):
            PJA["sent_state"] = "problem"
    elif not bad and PJA["bad"] == 0 and PJA["sent_state"] == "problem":
        if _w2_report("wall.audio_path", "resolved", "info", "Wall sound path is healthy",
                      "The sound listener is checking in and the stream carries audio.\n\n- Wall Watchdog, wall alarm keeper"):
            PJA["sent_state"] = "resolved"


def pja_loop():
    time.sleep(45)
    while True:
        try:
            pja_check()
        except Exception as e:
            print("pja: check failed " + str(e)[:100], flush=True)
        time.sleep(30)


