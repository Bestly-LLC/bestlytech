#!/usr/bin/env python3
# ALERTS_20261103
"""Wall alerts batch (Claude, Nov 3 2026). Three alert paths, one small daemon, no paid AI.

  1. Wall turned off outside its schedule  -> passive push "Wall turned off by <source> at 7:56 PM" + "Turn it back on" (owner Wall Watchdog)
  2. Helicopter over a nearby incident      -> sky tag / card line "Over reported robbery · 0.4 mi" + push (owner Sky Sync)
  3. Rare / special aircraft on the 15 mi feed -> iPhone push + gold wall card + HomePod chime and line (owner Sky Sync)

Rules: 12-hour times, miles and feet, no ellipsis, every push signed by its owner (title = employee name), quiet hours 11 PM to 7 AM
hold to the 7 AM digest unless it is a violent or fire incident, HomePod never plays while the private-time mode is on (fail closed).
Config: alerts_config.json, alerts_rare.json. State: alerts_state.json. Heartbeat: alerts_status.json (watchdog.py alerts_watch heals).
Run:  alerts_batch.py            daemon
      alerts_batch.py --selftest dry run with injected data, prints the exact push text and the would-be HomePod call
"""
import json
import math
import os
import re
import sys
import threading
import time
import urllib.parse
import urllib.request

sys.path.insert(0, "/opt/bestly/wall")
import alerts_rare  # noqa: E402

VERSION = "ALERTS_20261103"
ROOT = "/opt/bestly/wall"
CFG_FILE = ROOT + "/alerts_config.json"
STATE_FILE = ROOT + "/alerts_state.json"
STATUS_FILE = ROOT + "/alerts_status.json"
OVER_FILE = ROOT + "/alerts_over.json"
REPORT_FILE = ROOT + "/.report.json"
OVERRIDE_FILE = ROOT + "/power_override.json"
ENV_FILE = "/home/pi/scripts/.env"
HA = "http://127.0.0.1:8123"
WALL = "http://127.0.0.1:8099"
IPHONE = "mobile_app_jareds_iphone"
NB = " "
DRY = {"on": False, "log": []}
G = {"started": time.time(), "loops": {}, "errs": {}, "feed_fail": 0, "ws": False, "ws_at": 0.0, "last": {}}
LOCK = threading.Lock()
_tok = {"v": None}


def log(m):
    print(time.strftime("%Y-%m-%d %I:%M:%S %p") + " " + m, flush=True)


def jload(p, d):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return d


def jsave(p, obj):
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f)
    os.replace(tmp, p)


def cfg():
    return jload(CFG_FILE, {})


def token():
    if _tok["v"] is None:
        with open(ENV_FILE) as f:
            for line in f:
                if line.startswith("HA_TOKEN="):
                    _tok["v"] = line.split("=", 1)[1].strip().strip('"').strip("'")
    return _tok["v"]


def ha(method, path, data=None, timeout=10):
    req = urllib.request.Request(HA + path, data=json.dumps(data).encode() if data is not None else None, method=method,
                                 headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
        return json.loads(body) if body else None


def wall_get(path, timeout=8):
    with urllib.request.urlopen(WALL + path, timeout=timeout) as r:
        return json.loads(r.read())


def ha_state(eid):
    try:
        return (ha("GET", "/api/states/" + eid, timeout=6) or {}).get("state")
    except Exception:
        return None


# ---------- small helpers ----------
def t12(ts=None):
    return time.strftime("%I:%M %p", time.localtime(ts)).lstrip("0")


def is_quiet(now=None, c=None):
    c = c or cfg()
    h = time.localtime(now or time.time()).tm_hour
    a, b = c.get("quiet_from", 23), c.get("quiet_to", 7)
    return (h >= a or h < b) if a > b else (a <= h < b)


def hav_mi(la1, lo1, la2, lo2):
    p1, p2 = math.radians(la1), math.radians(la2)
    dl = math.radians(lo2 - lo1)
    dp = p2 - p1
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(a))


def compass(b):
    return ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][int(((b % 360) + 22.5) // 45) % 8]


def miles_txt(d):
    if d < 1:
        return ("%.1f" % d) + NB + "mi"
    return ("%d" % round(d)) + NB + "mi"


WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen",
         "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"]


def say_num(n):
    n = int(n)
    return WORDS[n] if 0 <= n <= 20 else str(n)


# ---------- Scout (digest) and phone push ----------
def scout(key, kind, severity, title, body, push=False):
    if DRY["on"]:
        DRY["log"].append(("SCOUT", key, kind, severity, title, body, push))
        print("  [dry] scout %s %s %s push=%s | %s | %s" % (key, kind, severity, push, title, body.replace("\n", " / ")))
        return
    try:
        c = jload(REPORT_FILE, {})
        req = urllib.request.Request(c["supabase_url"].rstrip("/") + "/functions/v1/home-hub-agent",
                                     data=json.dumps({"op": "event", "key": key, "kind": kind, "severity": severity, "title": title,
                                                      "body": body, "push": push}).encode(),
                                     headers={"Content-Type": "application/json", "x-api-key": c["agent_key"]})
        urllib.request.urlopen(req, timeout=10).read()
        log("scout " + key + " " + kind)
    except Exception as e:
        log("scout %s failed: %s" % (key, e))


def push(owner, message, level="active", actions=None, tag=None, silent=False, subtitle=None, url=None):
    """iPhone push through Home Assistant. Title is always the owning employee."""
    data = {"push": {"interruption-level": level}}
    if silent:
        data["push"]["sound"] = "none"
    if actions:
        data["actions"] = actions
    if tag:
        data["tag"] = tag
    if subtitle:
        data["subtitle"] = subtitle
    if url:
        data["url"] = url
    body = {"title": owner, "message": message, "data": data}
    if DRY["on"]:
        DRY["log"].append(("PUSH", body))
        print("  [dry] PUSH to iPhone | title=%r | message=%r | level=%s%s%s" % (owner, message, level, " silent" if silent else "",
              (" | actions=" + ",".join(a["action"] for a in actions)) if actions else ""))
        return True
    try:
        ha("POST", "/api/services/notify/" + IPHONE, body, timeout=12)
        log("push [%s] %s" % (owner, message))
        return True
    except Exception as e:
        log("push failed: %s" % e)
        return False


# ================= 1. wall turned off =================
def wall_off_source(at, c):
    """Who turned the wall off. Reads the Home Assistant logbook around the moment the override was written."""
    off_btn = c.get("wall_off", {}).get("source_button", "button.wall_power_off")
    try:
        s = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(at - 90))
        e = time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(at + 15))
        rows = ha("GET", "/api/logbook/%s?entity=%s&end_time=%s" % (urllib.parse.quote(s), off_btn, urllib.parse.quote(e)), timeout=20) or []
        for x in reversed(rows):
            nm = x.get("context_name") or ""
            if nm:
                return ("your private-time scene" if re.search(r"sexy|private", nm, re.I) else "Home Assistant (%s)" % nm), "ha:" + nm
            return "Home Assistant", "ha"
    except Exception as ex:
        log("logbook lookup failed: %s" % ex)
    return None, None


def wall_off_text(ov, c):
    at = ov.get("at") or time.time()
    reason = str(ov.get("reason") or "")
    if reason == "siri":
        who, how = "Siri", "siri"
    else:
        who, how = wall_off_source(at, c)
        if not who:
            who, how = "the admin remote", "admin"
    return "Wall turned off by %s at %s" % (who, t12(at)), how


def wall_off_step(st, c, ov=None):
    """Call every few seconds. Returns the push text when a new out-of-schedule power-off appeared, else None."""
    ov = ov if ov is not None else jload(OVERRIDE_FILE, {})
    at = ov.get("at")
    if not at or ov.get("on") is not False or (ov.get("until") or 0) < time.time():
        return None
    if st.get("wall_off_seen") == at:
        return None
    if time.time() - at > 600:                 # old; remember it and stay quiet (daemon restart, etc.)
        st["wall_off_seen"] = at
        return None
    st["wall_off_seen"] = at
    text, how = wall_off_text(ov, c)
    acts = [{"action": "WALL_WAKE", "title": "Turn it back on", "activationMode": "background", "authenticationRequired": False}]
    if is_quiet(None, c) and c.get("wall_off", {}).get("digest_in_quiet", True):
        scout("wall.off_digest", "problem", "info", "Wall turned off", text + ".\n\n- Wall Watchdog, wall alarm keeper", push=False)
    else:
        push("Wall Watchdog", text, level="passive", actions=acts, tag="bestly_wall_off", silent=True, subtitle="Tap Turn it back on to wake it")
    G["last"]["wall_off"] = {"at": time.time(), "text": text, "how": how}
    return text


def wake_wall():
    c = cfg().get("wall_off", {})
    btn = c.get("wake_button", "button.wall_power_on")
    if DRY["on"]:
        print("  [dry] HA button.press " + btn)
        return
    ha("POST", "/api/services/button/press", {"entity_id": btn})
    log("wall wake pressed from the push (%s)" % btn)
    G["last"]["wake"] = time.time()


def ws_loop():
    from websockets.sync.client import connect
    while True:
        try:
            with connect(HA.replace("http://", "ws://") + "/api/websocket", open_timeout=10, ping_interval=30, ping_timeout=20) as ws:
                json.loads(ws.recv())
                ws.send(json.dumps({"type": "auth", "access_token": token()}))
                if json.loads(ws.recv()).get("type") != "auth_ok":
                    raise RuntimeError("Home Assistant refused the token")
                ws.send(json.dumps({"id": 1, "type": "subscribe_events", "event_type": "mobile_app_notification_action"}))
                while True:
                    G["ws"], G["ws_at"] = True, time.time()
                    try:
                        raw = ws.recv(timeout=30)
                    except TimeoutError:
                        continue
                    m = json.loads(raw)
                    if m.get("type") != "event":
                        continue
                    d = (m.get("event") or {}).get("data") or {}
                    if str(d.get("action") or "") == "WALL_WAKE":
                        threading.Thread(target=wake_wall, daemon=True).start()
        except Exception as e:
            G["errs"]["ws"] = str(e)[:120]
        G["ws"] = False
        time.sleep(5)


# ================= 2. helicopters: why they are there =================
HELI_NOTABLE = {"police", "news", "fire", "medical"}
PHRASES = [
    (r"robber", "robbery", "violent"), (r"shots? fired|shooting|gunshot|gunfire", "shooting", "violent"),
    (r"stabb", "stabbing", "violent"), (r"carjack", "carjacking", "violent"), (r"kidnap", "kidnapping", "violent"),
    (r"homicide|murder", "homicide", "violent"), (r"assault|battery|\badw\b", "assault", "violent"),
    (r"armed|weapon|\bgun\b|firearm", "armed suspect", "violent"),
    (r"explosion", "explosion", "fire"), (r"\bfire\b|smoke|brush|flames|arson", "fire", "fire"),
    (r"pursuit|chase", "pursuit", ""), (r"burglar", "burglary", ""), (r"theft|larceny|stolen", "theft", ""),
    (r"vandal", "vandalism", ""), (r"collision|crash|\btc\b", "traffic collision", ""), (r"disturbance|fight", "disturbance", ""),
    (r"suspicious|prowler", "suspicious activity", ""), (r"missing", "missing person", ""),
]


def incident_phrase(inc):
    txt = " ".join(str(inc.get(k) or "") for k in ("title", "short", "sub", "last_update")).lower()
    for rx, name, kind in PHRASES:
        if re.search(rx, txt):
            return "reported " + name, kind
    base = re.sub(r"[^a-z0-9 ,&/'\-]", " ", str(inc.get("short") or inc.get("title") or "").lower()).strip()
    base = re.sub(r"\s+", " ", base)
    if not base:
        return None, ""
    if len(base) > 30:
        base = base[:30].rsplit(" ", 1)[0]
    return "reported " + base, ""


def agency_of(row):
    p = str(row.get("police") or "")
    if "LAPD" in p:
        return "LAPD"
    if "Sheriff" in p:
        return "Sheriff"
    if "CHP" in p:
        return "CHP"
    if p:
        return p.split(" ")[0]
    n = row.get("news") or {}
    if n:
        return str(n.get("call") or n.get("station") or "News")
    if "fire" in str(row.get("notable") or []):
        return "Fire department"
    return "Helicopter"


def heli_rows(rows):
    out = []
    for r in rows:
        lv = r.get("live") or {}
        if not r.get("helicopter") or lv.get("lat") is None or lv.get("on_ground"):
            continue
        if not (set(r.get("notable") or []) & HELI_NOTABLE):
            continue
        out.append(r)
    return out


def match_incident(center, incidents, now, c):
    hc = c.get("heli", {})
    best = None
    for i in incidents or []:
        if i.get("cat") not in hc.get("incident_cats", []) or i.get("source") in hc.get("skip_sources", []):
            continue
        la, lo = i.get("lat"), i.get("lng")
        if la is None or lo is None:
            continue
        t0 = (i.get("first_seen") or i.get("updated_at") or 0) / 1000.0
        if not t0 or now - t0 > hc.get("incident_max_age_min", 60) * 60 or now - t0 < -300:
            continue
        d = hav_mi(center[0], center[1], la, lo)
        if d <= hc.get("match_radius_mi", 0.75) and (best is None or d < best[0]):
            best = (d, i)
    return best[1] if best else None


def heli_step(st, c, rows, incidents, now=None):
    """Tracks every police / news / fire helicopter, matches the nearest fresh incident to its orbit centre, writes the 'over' lines
    the wall reads, and returns the list of pushes it made: [(text, level, violent_or_fire, incident_key)]."""
    now = now or time.time()
    hc = c.get("heli", {})
    trk = st.setdefault("heli_trk", {})
    over, made = {}, []
    live_hex = set()
    for r in heli_rows(rows):
        hx = str(r.get("hex") or "").lower()
        lv = r["live"]
        live_hex.add(hx)
        t = trk.setdefault(hx, {"pts": [], "within": None, "out": None})
        t["pts"].append([now, lv["lat"], lv["lon"]])
        t["pts"] = [p for p in t["pts"] if now - p[0] <= 600]
        recent = [p for p in t["pts"] if now - p[0] <= 300]
        pts = recent if len(recent) >= 3 else t["pts"][-1:]
        center = (sum(p[1] for p in pts) / len(pts), sum(p[2] for p in pts) / len(pts))
        dist = lv.get("dist_mi")
        if dist is None:
            dist = hav_mi(c["home"][0], c["home"][1], lv["lat"], lv["lon"])
        if dist <= hc.get("push_within_mi", 1.0):
            t["within"], t["out"] = (t["within"] or now), None
        else:
            t["out"] = t["out"] or now
            if now - t["out"] > hc.get("gap_reset_s", 60):
                t["within"] = None
        inc = match_incident(center, incidents, now, c)
        if not inc:
            continue
        phrase, kind = incident_phrase(inc)
        if not phrase:
            continue
        over[hx] = {"line": phrase + " \u00b7 " + miles_txt(dist), "d": round(dist, 1), "at": now}
        key = str(inc.get("key") or inc.get("title"))
        if t["within"] and now - t["within"] >= hc.get("push_dwell_s", 300) and key not in st.setdefault("heli_pushed", {}):
            who = agency_of(r)
            text = "%s circling %s away: %s" % (who, miles_txt(dist), phrase)
            urgent = kind in ("violent", "fire")
            st["heli_pushed"][key] = now
            made.append((text, "time-sensitive" if urgent else "active", urgent, key))
    for hx in list(trk):
        if hx not in live_hex and now - (trk[hx]["pts"][-1][0] if trk[hx]["pts"] else 0) > 900:
            trk.pop(hx, None)
    st["heli_pushed"] = {k: v for k, v in st.get("heli_pushed", {}).items() if now - v < 86400}
    return over, made


def heli_deliver(made, c):
    for text, level, urgent, key in made:
        if is_quiet(None, c) and not urgent:
            scout("wall.skysync.heli_digest", "problem", "info", "Helicopter over an incident", text + ".\n\n- Sky Sync, wall sky alerts keeper", push=False)
        else:
            push("Sky Sync", text, level=level, tag="bestly_heli_" + re.sub(r"\W+", "", key)[:24])
        G["last"]["heli"] = {"at": time.time(), "text": text}


# ================= 3. rare aircraft =================
def cpa(row, home):
    """Closest approach to home: (miles, minutes from now or None, compass word of the closest point)."""
    lv = row["live"]
    d, b = lv.get("dist_mi"), lv.get("bearing")
    if d is None or b is None:
        return None
    rx, ry = d * math.sin(math.radians(b)), d * math.cos(math.radians(b))
    sp, hd = lv.get("speed_mph") or 0, lv.get("heading")
    if sp < 40 or hd is None:
        return d, None, compass(b)
    vx, vy = sp * math.sin(math.radians(hd)), sp * math.cos(math.radians(hd))
    tt = -(rx * vx + ry * vy) / (vx * vx + vy * vy)          # hours
    if tt <= 0:
        return d, None, compass(b)
    cx, cy = rx + vx * tt, ry + vy * tt
    return math.hypot(cx, cy), tt * 60.0, compass(math.degrees(math.atan2(cx, cy)))


def rare_text(name, row, c):
    r = cpa(row, c["home"])
    lv = row["live"]
    if r is None:
        return "%s on the 15%smi feed" % (name, NB), None
    dist, mins, word = r
    if mins is not None and 0 <= mins <= 30:
        m = max(1, int(round(mins)))
        if dist < 0.3:
            return "%s passing right over home in %d%smin" % (name, m, NB), m
        return "%s passing %s %s in %d%smin" % (name, miles_txt(dist), word, m, NB), m
    return "%s now %s %s" % (name, miles_txt(lv.get("dist_mi") or dist), word), None


def private_time_on(c):
    s = ha_state(c.get("rare", {}).get("private_entity", "input_boolean.sexy_time"))
    return s != "off"                      # fail closed: unknown, unavailable or on all block the HomePod


def voice_line(name, text, mins):
    t = text.replace(NB, " ")
    t = re.sub(r"\b(\d+)\.(\d)\b", lambda m: say_num(m.group(1)) + " point " + say_num(m.group(2)), t)
    t = re.sub(r"\b(\d+)\b", lambda m: say_num(m.group(1)), t)
    t = t.replace(" mi ", " miles ").replace(" min", " minutes" if mins and mins != 1 else " minute")
    return "Sky Sync here. " + t + "."


def speak(line, c):
    """HomePod chime plus line through the existing Music Assistant announce script. HARD RULES: never while private-time mode is on,
    never in quiet hours. Returns a short reason string."""
    rc = c.get("rare", {})
    if not rc.get("voice", True):
        return "voice switched off in config"
    if is_quiet(None, c):
        return "blocked: quiet hours"
    if private_time_on(c):
        return "blocked: private-time mode is on (or could not be checked)"
    script = rc.get("speak_script", "script.news_chopper_announce")
    if DRY["on"]:
        print("  [dry] HomePod call: script.turn_on %s variables.message=%r (chime + announce, private-time gate passed)" % (script, line))
        return "dry-run: would speak"
    ha("POST", "/api/services/script/turn_on", {"entity_id": script, "variables": {"message": line}}, timeout=15)
    return "spoken"


def rare_step(st, c, rows, now=None):
    now = now or time.time()
    rc = c.get("rare", {})
    done = st.setdefault("rare", {})
    made = []
    for r in rows:
        lv = r.get("live") or {}
        if lv.get("lat") is None or lv.get("on_ground"):
            continue
        if (lv.get("dist_mi") or 99) > rc.get("max_range_mi", 15):
            continue
        hx = str(r.get("hex") or "").lower()
        name = alerts_rare.rare_match(r.get("callsign"), r.get("type_code"), 1 if r.get("military") else 0, hx)
        if not name:
            continue
        if now - done.get(hx, 0) < rc.get("cooldown_min", 60) * 60:
            continue
        done[hx] = now
        text, mins = rare_text(name, r, c)
        made.append((name, text, mins, r))
    st["rare"] = {k: v for k, v in done.items() if now - v < 86400}
    return made


def rare_deliver(made, c):
    for name, text, mins, r in made:
        if is_quiet(None, c):
            scout("wall.skysync.rare_digest", "problem", "info", "Rare aircraft nearby", text + ".\n\n- Sky Sync, wall sky alerts keeper", push=False)
            why = "blocked: quiet hours (digest)"
        else:
            push("Sky Sync", text, level="time-sensitive", tag="bestly_rare_" + (str(r.get("hex")) or "x"))
            why = speak(voice_line(name, text, mins), c)
        log("rare %s -> %s" % (text, why))
        G["last"]["rare"] = {"at": time.time(), "text": text, "voice": why}


# ================= main loops =================
def beat(name):
    G["loops"][name] = time.time()


def write_status():
    jsave(STATUS_FILE, {"at": time.time(), "version": VERSION, "pid": os.getpid(), "loops": G["loops"], "errs": G["errs"],
                        "feed_fail": G["feed_fail"], "ws": G["ws"], "ws_age_s": round(time.time() - G["ws_at"], 1) if G["ws_at"] else None,
                        "last": G["last"], "up_s": round(time.time() - G["started"])})


def wall_loop():
    st_lock = LOCK
    while True:
        try:
            c = cfg()
            with st_lock:
                st = jload(STATE_FILE, {})
                before = json.dumps(st, sort_keys=True)
                wall_off_step(st, c)
                if json.dumps(st, sort_keys=True) != before:
                    jsave(STATE_FILE, st)
            beat("wall")
        except Exception as e:
            G["errs"]["wall"] = str(e)[:120]
        time.sleep(5)


def sky_loop():
    inc_at, incidents = 0.0, []
    while True:
        try:
            c = cfg()
            now = time.time()
            try:
                rows = (wall_get("/api/aircraft/live") or {}).get("aircraft") or []
                G["feed_fail"] = 0
            except Exception as e:
                G["feed_fail"] += 1
                G["errs"]["feed"] = str(e)[:120]
                time.sleep(15)
                continue
            if now - inc_at > 45:
                try:
                    incidents = ((wall_get("/api/citizen") or {}).get("snap") or {}).get("incidents") or []
                    inc_at = now
                except Exception as e:
                    G["errs"]["citizen"] = str(e)[:120]
            with LOCK:
                st = jload(STATE_FILE, {})
                over, hm = heli_step(st, c, rows, incidents, now)
                rm = rare_step(st, c, rows, now)
                jsave(STATE_FILE, st)
            jsave(OVER_FILE, over)
            if hm:
                heli_deliver(hm, c)
            if rm:
                rare_deliver(rm, c)
            beat("sky")
        except Exception as e:
            G["errs"]["sky"] = str(e)[:160]
            log("sky loop error: %s" % e)
        time.sleep(15)


def sd_notify(msg):
    p = os.environ.get("NOTIFY_SOCKET")
    if not p:
        return
    try:
        import socket
        s = socket.socket(socket.AF_UNIX, socket.SOCK_DGRAM)
        s.connect("\0" + p[1:] if p.startswith("@") else p)
        s.send(msg.encode())
        s.close()
    except OSError:
        pass


def main():
    log("alerts_batch %s starting" % VERSION)
    for fn in (wall_loop, sky_loop, ws_loop):
        threading.Thread(target=fn, daemon=True, name=fn.__name__).start()
    sd_notify("READY=1")
    while True:
        try:
            write_status()
            ok = all(time.time() - G["loops"].get(k, G["started"]) < 120 for k in ("wall", "sky"))
            if ok:
                sd_notify("WATCHDOG=1")
        except Exception as e:
            log("status error: %s" % e)
        time.sleep(10)


# ================= self test (dry run, injected data) =================
def selftest():
    DRY["on"] = True
    c = cfg()
    now = time.time()
    home = c["home"]
    print("== 1. wall turned off (injected override at 7:56 PM, real HA logbook lookup for Nov 2 7:56:16 PM) ==")
    at = time.mktime((2026, 11, 2, 19, 56, 16, 0, 0, -1))
    st = {}
    ov = {"on": False, "until": now + 3600, "at": at}
    saved = time.time
    # the step ignores events older than 10 minutes in real life; for the replay we pretend it is 7:56:40 PM
    time.time = lambda: at + 24
    try:
        print("  text ->", wall_off_step(st, c, ov))
    finally:
        time.time = saved
    print("  siri variant ->", wall_off_text({"on": False, "at": at, "reason": "siri"}, c)[0])
    print("  admin variant (no HA activity) -> would read 'Wall turned off by the admin remote at 7:56 PM' when the logbook has no button press")
    print("  wake action ->", end=" ")
    wake_wall()

    print("== 2. helicopters ==")
    inc = {"cat": "police", "key": "scanner:test-1", "source": "scanner", "title": "Armed robbery in progress", "short": "ARMED ROBBERY",
           "lat": home[0] + 0.004, "lng": home[1] + 0.003, "first_seen": (now - 12 * 60) * 1000, "updated_at": (now - 5 * 60) * 1000}
    stale = dict(inc, key="scanner:old", first_seen=(now - 3 * 3600) * 1000)
    far = dict(inc, key="scanner:far", lat=home[0] + 0.05)
    row = {"hex": "a1f0d8", "helicopter": True, "notable": ["police"], "police": "LAPD Air Support", "label": "LAPD Air Support",
           "live": {"lat": home[0] + 0.005, "lon": home[1] + 0.004, "dist_mi": 0.4, "bearing": 40, "speed_mph": 40, "heading": 90, "on_ground": False}}
    st = {}
    for i in range(0, 22):                                   # 21 samples, 20 s apart = 7 minutes within 1 mi
        over, made = heli_step(st, c, [row], [stale, far, inc], now - (21 - i) * 20)
        if i == 0:
            print("  first look, over line ->", over.get("a1f0d8", {}).get("line"), "| pushes:", made)
        if made:
            print("  push after %d s within 1 mi ->" % (i * 20), made)
            heli_deliver(made, c)
            break
    over, made = heli_step(st, c, [row], [inc], now)
    print("  repeat sample, second push for the same incident? ->", bool(made))
    quiet_c = dict(c, quiet_from=0, quiet_to=24)
    print("  quiet hours, non-violent (burglary) -> digest:")
    inc2 = dict(inc, key="scanner:b", title="Burglary report", short="BURGLARY")
    st2 = {"heli_trk": {"a1f0d8": {"pts": [[now - 400, row["live"]["lat"], row["live"]["lon"]]] * 3, "within": now - 400, "out": None}}}
    _, m2 = heli_step(st2, quiet_c, [row], [inc2], now)
    heli_deliver(m2, quiet_c)
    print("  quiet hours, violent (shooting) -> still pushes:")
    inc3 = dict(inc, key="scanner:s", title="Shots fired", short="SHOTS FIRED")
    st3 = {"heli_trk": {"a1f0d8": {"pts": [[now - 400, row["live"]["lat"], row["live"]["lon"]]] * 3, "within": now - 400, "out": None}}}
    _, m3 = heli_step(st3, quiet_c, [row], [inc3], now)
    heli_deliver(m3, quiet_c)

    print("== 3. rare aircraft ==")
    b2 = {"hex": "ae1234", "callsign": "DEATH11", "type_code": "B2", "military": True, "helicopter": False,
          "live": {"lat": home[0] + 0.04, "lon": home[1], "dist_mi": 3.0, "bearing": 0, "speed_mph": 380, "heading": 270, "on_ground": False}}
    af1 = {"hex": "adfdf8", "callsign": "AF1", "type_code": "B742", "military": True,
           "live": {"lat": home[0] - 0.1, "lon": home[1] + 0.1, "dist_mi": 8, "bearing": 140, "speed_mph": 420, "heading": 320, "on_ground": False}}
    boring = {"hex": "a00001", "callsign": "DAL123", "type_code": "B738", "military": False, "live": {"lat": home[0], "lon": home[1], "dist_mi": 5, "bearing": 90, "on_ground": False}}
    st = {}
    made = rare_step(st, c, [b2, af1, boring], now)
    print("  matched:", [m[0] for m in made])
    print("  cooldown repeat ->", [m[0] for m in rare_step(st, c, [b2], now + 600)], "(empty = cooldown holds for 60 min)")
    print("  private-time check right now (fail closed) -> blocked =", private_time_on(c))
    rare_deliver(made, c)
    print("  private-time mode ON (simulated):")
    _orig = globals()["ha_state"]
    globals()["ha_state"] = lambda eid: "on"
    print("   ->", speak("Sky Sync here. B-2 passing three miles north in two minutes.", c))
    globals()["ha_state"] = lambda eid: "off"
    print("  private-time mode off, daytime (simulated):")
    print("   ->", speak("Sky Sync here. B-2 passing three miles north in two minutes.", dict(c, quiet_from=0, quiet_to=0)))
    print("  quiet hours (simulated):")
    print("   ->", speak("x", dict(c, quiet_from=0, quiet_to=24)))
    globals()["ha_state"] = _orig


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        main()
