#!/usr/bin/env python3
"""Local alerts collector (Sky Sync). Runs on the Hestia role (Clio right now) every ~2 min via systemd timer bestly-citizen.timer.

No AI, no paid services, standard library only. PRIVATE / INTERNAL USE ONLY: it feeds Jared's home projector wall and his
/admin Sky map. Never client-facing, never sold (see bestly_memory house/compliance/citizen-feed-internal-only).

v2 (Oct 28 2026): one adapter per source, each with its own health, backoff and auto-retry; every item carries a `category`
(fire_medical, police, sheriff_city, earthquake, wildfire, power, closures, transit, weather, traffic). Sources live in the
citizen_sources table (poll interval, stale limit, max distance); this file only fetches. Agent B writes heli/scanner through citizen_ingest.
Adapters: citizen (gone, hourly probe), chp, nws, usgs, calfire, aqi, sce, lafd, nixle, closures (Caltrans), metro (needs a key).
Reports to Supabase through citizen_ingest() (token = home-hub agent key from /opt/bestly/wall/.report.json).
"""
import json, math, os, re, sys, time, urllib.error, urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from citizen_common import *
import citizen_adapters as AD

STATE = os.path.join(DIR, "state.json")
ONLY = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--only=")), None)
RADIUS_MI = 1.2                                    # CHP/Citizen fetch radius (a little wider than the 1 mi the wall shows)
DLAT = RADIUS_MI / 69.0
DLON = RADIUS_MI / (69.172 * math.cos(math.radians(HOME_LAT)))
BBOX = (HOME_LAT - DLAT, HOME_LON - DLON, HOME_LAT + DLAT, HOME_LON + DLON)   # lowLat, lowLon, upLat, upLon


def load_state():
    return load_json(STATE, {})


def save_state(st):
    save_json(STATE, st)


# ---------------------------------------------------------------- Citizen (web feed; field names INFERRED from open source)
def cit_cat(title):
    t = title.lower()
    if re.search(r"fire|smoke|medical|rescue|ambulance|paramedic|crash|collision|hazmat", t):
        return "fire_medical"
    if re.search(r"shoot|stab|robber|burglar|assault|suspect|police|gunfire|theft|homicide|arrest|vandal", t):
        return "police"
    return "sheriff_city"


def fetch_citizen():
    q = ("lowerLatitude=%.5f&lowerLongitude=%.5f&upperLatitude=%.5f&upperLongitude=%.5f&fullResponse=true&limit=200" %
         (BBOX[0], BBOX[1], BBOX[2], BBOX[3]))
    url = "https://citizen.com/api/incident/trending?" + q
    try:
        _, body = http_get(url, BROWSER_UA, {"Accept": "application/json", "Referer": "https://citizen.com/explore"})
    except HttpFail as e:
        if e.code == 410:
            raise RuntimeError("gone: Citizen removed this endpoint (HTTP 410)")
        raise RuntimeError("http %d" % e.code)
    j = json.loads(body)
    rows = j.get("results") if isinstance(j, dict) else j
    if not isinstance(rows, list):
        raise RuntimeError("unexpected shape")
    out = []
    for r in rows:
        try:
            lat, lon = float(r.get("latitude")), float(r.get("longitude"))
        except Exception:
            continue
        if hav_ft(lat, lon) > RADIUS_MI * 5280:
            continue
        ts = r.get("cs") or r.get("ts")
        ups = []
        u = r.get("updates")
        if isinstance(u, dict):
            u = list(u.values())
        for x in (u if isinstance(u, list) else []):
            if isinstance(x, dict) and x.get("text"):
                ups.append({"t": x.get("ts"), "text": re.sub(r"\s+", " ", str(x["text"]))[:160]})
        ups.sort(key=lambda x: x.get("t") or 0)
        lvl = {0: "low", 1: "moderate", 2: "high"}.get(r.get("level"), "low")
        title = str(r.get("title") or "Incident")
        if re.search(r"shooting|stabbing|fire|explosion|hostage|homicide", title, re.I):
            lvl = "critical" if lvl == "high" else lvl
        out.append({"key": str(r.get("key") or r.get("id") or ""), "title": title, "short": short_text(title),
                    "lat": lat, "lng": lon, "address": str(r.get("address") or "")[:120], "level": lvl,
                    "occurred_ms": int(ts) if isinstance(ts, (int, float)) else None, "updates": ups[-12:], "ping": True, "category": cit_cat(title)})
    return out


# ---------------------------------------------------------------- CHP CAD incidents
CHP_CODES = {  # code -> (plain words, level)
    "1179": ("Traffic collision, ambulance on the way", "high"),
    "1180": ("Major-injury traffic collision", "critical"),
    "1181": ("Minor-injury traffic collision", "moderate"),
    "1182": ("Traffic collision, no injuries", "low"),
    "1183": ("Traffic collision", "moderate"),
    "1184": ("Traffic control needed", "low"),
    "1125": ("Traffic hazard", "moderate"),
    "1126": ("Disabled vehicle", "low"),
    "1144": ("Fatality", "critical"),
    "20001": ("Hit and run with injuries", "high"),
    "20002": ("Hit and run, no injuries", "low"),
    "SIGALERT": ("Sig Alert, lanes blocked", "high"),
    "FIRE": ("Fire", "high"),
}


def chp_time(s):
    try:
        s = re.sub(r"\s+", " ", s.strip().strip('"'))
        return int(datetime.strptime(s, "%b %d %Y %I:%M%p").replace(tzinfo=PT).timestamp() * 1000)
    except Exception:
        return None


def fetch_chp():
    # A plain URL sometimes returns an old, cut-off copy from a cache; a changing query string gets the live file.
    _, body, hd = http_get("https://media.chp.ca.gov/sa_xml/sa.xml?t=%d" % (time.time() // 60), BROWSER_UA, timeout=30, want_headers=True)
    lm = hd.get("Last-Modified")
    if lm:
        from email.utils import parsedate_to_datetime
        if time.time() - parsedate_to_datetime(lm).timestamp() > 20 * 60:
            raise RuntimeError("CHP feed is stale (last changed %s)" % lm)
    if not body.rstrip().endswith(b"</State>"):      # cut off mid-file: keep the complete incidents
        k = body.rfind(b"</Log>")
        if k < 0:
            raise RuntimeError("CHP feed cut off before any incident")
        body = body[:k + 6] + b"</Dispatch></Center></State>"
    root = ET.fromstring(body)
    out = []
    for log_el in root.iter("Log"):
        def g(tag):
            e = log_el.find(tag)
            return (e.text or "").strip().strip('"').strip() if e is not None else ""
        ll = g("LATLON")
        m = re.match(r"^(-?\d+):(-?\d+)$", ll)
        if not m:
            continue
        lat, lon = int(m.group(1)) / 1e6, -abs(int(m.group(2))) / 1e6
        if not (33 < lat < 35) or hav_ft(lat, lon) > RADIUS_MI * 5280:
            continue
        lt = g("LogType")
        code = lt.split("-", 1)[0].strip().upper().replace(" ", "")
        words, lvl = CHP_CODES.get(code, (None, None))
        if not words:
            words = re.sub(r"^[0-9A-Z]+-\s*", "", lt).strip().title() or "CHP incident"
            lvl = "low"
        ups = []
        for d in log_el.iter("details"):
            t = chp_time((d.findtext("DetailTime") or ""))
            tx = re.sub(r"^\s*\[\d+\]\s*", "", (d.findtext("IncidentDetail") or "").strip().strip('"')).strip()
            if tx:
                ups.append({"t": t, "text": tx[:160]})
        ups.sort(key=lambda x: x.get("t") or 0)
        loc = g("Location")
        desc = g("LocationDesc")
        out.append({"key": log_el.get("ID") or "", "title": words, "short": short_text(words),
                    "lat": lat, "lng": lon, "address": (loc + (" · " + desc if desc and desc.lower() not in loc.lower() else ""))[:120],
                    "level": lvl, "occurred_ms": chp_time(g("LogTime")), "updates": ups[-12:], "ping": True, "category": "traffic"})
    return out


# ---------------------------------------------------------------- NWS alerts for the home point
def fetch_nws():
    _, body = http_get("https://api.weather.gov/alerts/active?point=%.4f,%.4f" % (HOME_LAT, HOME_LON), NWS_UA,
                       {"Accept": "application/geo+json"})
    j = json.loads(body)
    out = []
    now = time.time()
    for f in j.get("features") or []:
        p = f.get("properties") or {}
        exp = p.get("expires") or p.get("ends")
        try:
            if exp and datetime.fromisoformat(exp).timestamp() < now:
                continue
        except Exception:
            pass
        sev = p.get("severity") or "Unknown"
        lvl = {"Extreme": "critical", "Severe": "high", "Moderate": "moderate"}.get(sev, "low")
        try:
            sent = int(datetime.fromisoformat(p.get("sent") or p.get("effective")).timestamp() * 1000)
        except Exception:
            sent = None
        ev = p.get("event") or "Weather alert"
        head = re.sub(r"\s+", " ", p.get("headline") or ev)
        out.append({"key": re.sub(r"[^A-Za-z0-9]", "", (p.get("id") or f.get("id") or ev))[-60:], "title": ev, "short": short_text(ev, 30),
                    "lat": HOME_LAT, "lng": HOME_LON, "address": re.sub(r"\s+", " ", p.get("areaDesc") or "")[:120], "level": lvl,
                    "occurred_ms": sent, "updates": [{"t": sent, "text": head[:160]}], "area": True, "place": "ring", "category": "weather", "persistent": True, "ping": sev in ("Severe", "Extreme")})
    return out


# ---------------------------------------------------------------- Supabase
def ingest(source, ok, err=None, items=None, next_try=None):
    if DRY:
        log("[dry] ingest %s ok=%s err=%s items=%s" % (source, ok, err, json.dumps(items)[:1500] if items else 0))
        return None
    c = cfg()
    body = {"p_token": c["agent_key"], "p_source": source, "p_ok": ok, "p_error": err, "p_items": items or [],
            "p_next_try": (datetime.fromtimestamp(next_try, timezone.utc).isoformat() if next_try else None)}
    req = urllib.request.Request(c["supabase_url"].rstrip("/") + "/rest/v1/rpc/citizen_ingest", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "apikey": PUBLISHABLE, "Authorization": "Bearer " + PUBLISHABLE})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read() or b"null")


def run_source(st, name, fn, every_s, max_backoff_s, takes_state=False):
    """One adapter: poll when due, report to Supabase, back off on failures (403/429 wait at least 30 min), recover on its own."""
    s = st.setdefault(name, {"fails": 0, "next": 0, "last_ok": 0})
    now = time.time()
    if ONLY and ONLY != name:
        return
    if now < s.get("next", 0):
        log("%s: waiting (retry in %d s)" % (name, s["next"] - now))
        return
    if now - s.get("last_ok", 0) < every_s - 10:
        return
    try:
        items = fn(s) if takes_state else fn()
        s.update(fails=0, next=0, last_ok=now, err=None)
        r = ingest(name, True, None, items, None)
        log("%s: ok, %d item(s); %s" % (name, len(items), json.dumps(r)[:200] if r else "dry"))
    except SetupNeeded as e:
        msg = str(e)[:180]
        s.update(next=now + 3600, err=msg)
        try:
            ingest(name, False, msg, None, now + 3600)
        except Exception as e2:
            log("%s: could not record setup state: %s" % (name, e2))
        log("%s: needs setup (%s)" % (name, msg))
    except Exception as e:
        msg = str(e)[:180] or e.__class__.__name__
        s["fails"] = s.get("fails", 0) + 1
        gone = msg.startswith("gone")
        delay = 3600 if gone else min(max_backoff_s, 120 * (2 ** min(s["fails"], 10)))
        if getattr(e, "code", None) in (403, 429):
            delay = max(delay, 1800)
        s.update(next=now + delay, err=msg)
        try:
            ingest(name, False, msg, None, now + delay)
        except Exception as e2:
            log("%s: could not record failure: %s" % (name, e2))
        log("%s: FAILED #%d (%s); next try in %d s" % (name, s["fails"], msg, delay))


def main():
    st = load_state()
    # (name, fetch, poll seconds, longest backoff seconds, fetch wants its state dict)
    run_source(st, "citizen", fetch_citizen, 3600, 7200)            # gone since Oct 28 2026 (HTTP 410): probed hourly, takes over if it returns
    run_source(st, "chp", fetch_chp, 120, 1800)
    run_source(st, "nws", fetch_nws, 290, 1800)
    run_source(st, "usgs", AD.fetch_usgs, 290, 1800)
    run_source(st, "calfire", AD.fetch_calfire, 590, 3600)
    run_source(st, "aqi", AD.fetch_aqi, 590, 3600)
    run_source(st, "sce", AD.fetch_sce, 290, 1800)
    run_source(st, "lafd", AD.fetch_lafd, 290, 3600)
    run_source(st, "nixle", AD.fetch_nixle, 590, 3600, True)
    run_source(st, "closures", AD.fetch_closures, 590, 3600, True)
    run_source(st, "metro", AD.fetch_metro, 290, 3600, True)
    st["last_run"] = time.time()
    save_state(st)
    if not DRY:
        try:
            ingest("collector", True)         # heartbeat for the Sky Sync freshness check
        except Exception as e:
            log("heartbeat failed: %s" % e)


if __name__ == "__main__":
    main()
