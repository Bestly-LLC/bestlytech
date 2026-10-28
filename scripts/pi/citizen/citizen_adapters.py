"""Local alerts adapters (Sky Sync, v2). Each fetch_* returns a list of citizen_ingest items. Standard library only, no AI.

PRIVATE / INTERNAL USE ONLY. Official sources: USGS, CAL FIRE, LAFD alerts, Caltrans lane closures, NWS, CHP, Open-Meteo.
Unofficial (internal only): SCE outage map layer, Nixle agency page scrape. PulsePoint is NOT used: its API sits behind an AWS WAF
challenge that refuses non-browser and headless clients, and we do not work around that (bestly_memory house/compliance/citizen-feed-internal-only).
Item fields: see supabase/migrations/20261028170000_local_alerts_v2.sql (citizen_ingest).
"""
import json, math, os, re, time, urllib.parse
from datetime import datetime, timedelta
from html import unescape
from citizen_common import *

# ---------------------------------------------------------------- USGS earthquakes (official)
def km_to_mi_text(s):
    return re.sub(r"(\d+(?:\.\d+)?)\s*km", lambda m: "%d%smi" % (round(float(m.group(1)) * 0.621371), NBSP), s or "")


def felt_rules(mag, mi):
    """-> (show, ping). Likely felt at home: tuned for Los Angeles ground (soft basin sediments shake farther)."""
    show = (mag >= 2.0 and mi <= 8) or (mag >= 3.0 and mi <= 30) or (mag >= 4.0 and mi <= 100) or (mag >= 5.0 and mi <= 250)
    ping = (mag >= 3.5 and mi <= 50) or (mag >= 5.0 and mi <= 150)
    return show, ping


def fetch_usgs():
    _, body = http_get("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson", BROWSER_UA, timeout=30)
    out = []
    for f in json.loads(body).get("features") or []:
        p, g = f.get("properties") or {}, f.get("geometry") or {}
        try:
            lon, lat, depth = g["coordinates"][:3]
            mag = float(p["mag"])
        except Exception:
            continue
        ft = hav_ft(lat, lon)
        show, ping = felt_rules(mag, ft / 5280.0)
        if not show:
            continue
        lvl = "critical" if mag >= 5.5 and ft < 100 * 5280 else "high" if ping else "moderate" if mag >= 3.0 else "low"
        ups = [{"t": p.get("time"), "text": "Magnitude %.1f, %d%smi deep" % (mag, round(abs(depth) * 0.621371), NBSP)}]
        if p.get("felt"):
            ups.append({"t": p.get("updated"), "text": "%d people reported feeling it" % p["felt"]})
        out.append({"key": f.get("id") or p.get("code"), "category": "earthquake", "title": "M%.1f earthquake" % mag, "short": "M%.1f quake" % mag,
                    "lat": lat, "lng": lon, "address": km_to_mi_text(p.get("place")), "level": lvl, "occurred_ms": p.get("time"),
                    "updates": ups, "ping": ping, "meta": {"mag": mag}})
    return out


# ---------------------------------------------------------------- CAL FIRE incidents (official)
def fetch_calfire():
    _, body = http_get("https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List?inactive=false", BROWSER_UA, timeout=30)
    rows = json.loads(body)
    out = []
    for r in rows if isinstance(rows, list) else []:
        try:
            lat, lon = float(r["Latitude"]), float(r["Longitude"])
        except Exception:
            continue
        ft = hav_ft(lat, lon)
        mi = ft / 5280.0
        if mi > 25 or r.get("Final"):
            continue
        acres = r.get("AcresBurned") or 0
        pct = r.get("PercentContained")
        started = None
        try:
            started = int(datetime.fromisoformat(str(r["Started"]).replace("Z", "+00:00")).timestamp() * 1000)
        except Exception:
            pass
        fresh = started is not None and time.time() * 1000 - started < 48 * 3600e3
        near = mi <= 10
        lvl = "critical" if near and (pct or 0) < 50 else "high" if near or acres >= 1000 else "moderate"
        name = str(r.get("Name") or "Wildfire").strip()
        got = ("%d%%%scontained" % (pct, NBSP)) if pct is not None else ("%s%sacres" % (format(int(acres), ","), NBSP))
        sub = "%s%s·%s%s" % (where_text(lat, lon), NBSP, NBSP, got)
        out.append({"key": r.get("UniqueId") or name, "category": "wildfire", "title": name if "fire" in name.lower() else name + " fire", "short": short_text(name if "fire" in name.lower() else name + " fire"),
                    "lat": lat, "lng": lon, "address": clean(r.get("Location"), 120), "level": lvl, "occurred_ms": started, "persistent": True,
                    "sub": sub, "ping": bool(near and fresh), "ping_force": True,
                    "updates": [{"t": started, "text": "%s acres, %s contained" % (format(int(acres), ","), ("%d%%" % pct) if pct is not None else "containment not reported")}]})
    return out


# ---------------------------------------------------------------- Air quality spike at home (Open-Meteo US AQI, same source as the wall widget)
def aqi_label(a):
    return "Good" if a <= 50 else "Moderate" if a <= 100 else "Unhealthy for some" if a <= 150 else "Unhealthy" if a <= 200 else "Very unhealthy" if a <= 300 else "Hazardous"


def fetch_aqi():
    _, body = http_get("https://air-quality-api.open-meteo.com/v1/air-quality?latitude=%s&longitude=%s&current=us_aqi,pm2_5&timezone=America%%2FLos_Angeles"
                       % (HOME_LAT, HOME_LON), BROWSER_UA)
    c = (json.loads(body).get("current") or {})
    if not isinstance(c.get("us_aqi"), (int, float)):
        raise RuntimeError("no us_aqi in reply")
    a = int(round(c["us_aqi"]))
    if a <= 100:                                   # routine air is not an alert (the wall's air widget already shows it)
        return []
    band = "usg" if a <= 150 else "unhealthy" if a <= 200 else "very" if a <= 300 else "haz"
    lvl = "moderate" if a <= 150 else "high" if a <= 200 else "critical"
    day = datetime.now(PT).strftime("%Y%m%d")
    return [{"key": "home-%s-%s" % (day, band), "category": "wildfire", "title": "Air quality %d, %s" % (a, aqi_label(a).lower()), "short": "AQI %d, %s" % (a, aqi_label(a).lower()),
             "lat": HOME_LAT, "lng": HOME_LON, "place": "note", "level": lvl, "ttl_min": 240,
             "sub": "At home%s·%s%s" % (NBSP, NBSP, t12(time.time() * 1000)), "ping": a > 150, "ping_force": True,
             "updates": [{"t": int(time.time() * 1000), "text": "US AQI %d (%s), PM2.5 %s" % (a, aqi_label(a), c.get("pm2_5"))}]}]


# ---------------------------------------------------------------- SCE power outages (unofficial ArcGIS layer behind sce.com/outage-center; internal only)
def sce_time(s):
    try:
        return int(datetime.strptime(s.strip(), "%m/%d/%Y %I:%M:%S %p").replace(tzinfo=PT).timestamp() * 1000)
    except Exception:
        return None


def fetch_sce():
    d = 0.06
    q = {"f": "json", "where": "1=1", "geometry": "%f,%f,%f,%f" % (HOME_LON - d * 1.2, HOME_LAT - d, HOME_LON + d * 1.2, HOME_LAT + d), "geometryType": "esriGeometryEnvelope",
         "inSR": "4326", "outSR": "4326", "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "returnGeometry": "true"}
    _, body = http_get("https://sce-outage-ags.esriemcs.com/arcgis/rest/services/43/outage/MapServer/0/query?" + urllib.parse.urlencode(q), BROWSER_UA, timeout=30)
    j = json.loads(body)
    if "error" in j:
        raise RuntimeError("sce: %s" % str(j["error"])[:100])
    out = []
    for f in j.get("features") or []:
        a, g = f.get("attributes") or {}, f.get("geometry") or {}
        try:
            lon, lat = float(g["x"]), float(g["y"])
        except Exception:
            continue
        ft = hav_ft(lat, lon)
        if ft > 15840:
            continue
        n = int(a.get("NoOfAffectedCust_Inci") or 0)
        ert = sce_time(a.get("ERT") or "")
        planned = str(a.get("OutageType") or "").lower().startswith("plan") or "upgrade" in str(a.get("MemoCauseCdDesc") or "").lower()
        back = ("back by " + t12(ert, day=True)) if ert else "restore time pending"
        lvl = "high" if n >= 1000 else "moderate" if n >= 100 else "low"
        cause = clean(a.get("MemoCauseCdDesc"), 60)
        crew = clean(a.get("CrewStatusCdDesc"), 60)
        out.append({"key": str(a.get("IncidentId") or a.get("OBJECTID")), "category": "power", "title": ("Planned power work" if planned else "Power outage") + ", %s customers" % n,
                    "short": "Planned power work" if planned else "Power outage", "lat": lat, "lng": lon, "address": clean("%s %s" % (a.get("CityName") or "", a.get("ZipcodeName") or ""), 60),
                    "level": lvl, "occurred_ms": a.get("OutageStartDateTime"), "persistent": True, "sub": "%s%s·%s%s" % (where_text(lat, lon), NBSP, NBSP, back),
                    "updates": [{"t": sce_time(a.get("LastChngDateTime") or ""), "text": ("%s. %s. %s customers affected." % (cause, crew, n)).replace(" .", ".")}], "meta": {"customers": n}})
    return out


# ---------------------------------------------------------------- LAFD alerts (official lafd.org/alerts: major incidents; no coordinates, so geocoded)
def lafd_expand(addr, community):
    a = street_words(addr)
    return "%s, %s, Los Angeles, CA" % (a, community) if community else "%s, Los Angeles, CA" % a


def parse_lafd(html):
    rows = []
    for m in re.finditer(r'<div class="views-row">\s*<h2 class="alert-node-title"><a href="([^"]+)"[^>]*>(.*?)</a></h2>\s*<div class="alert-node-body">(.*?)</div>', html, re.S):
        href, title, body = m.group(1), clean(unescape(m.group(2)), 200), unescape(re.sub(r"<[^>]+>", " ", m.group(3)))
        parts = [p.strip() for p in body.split(";")]
        inc = re.search(r"INC#\s*(\d+)", body)
        dm = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", title)
        tm = re.search(r"(\d{1,2}):(\d{2})\s*([AP]M)", body)
        if not (inc and dm and tm):
            continue
        when = datetime.strptime("%s/%s/%s %s:%s %s" % (dm.group(1), dm.group(2), dm.group(3), tm.group(1), tm.group(2), tm.group(3)), "%m/%d/%Y %I:%M %p").replace(tzinfo=PT)
        addr = parts[3] if len(parts) > 3 else ""
        link = [i for i, p in enumerate(parts) if p.startswith("http")]
        comm = parts[link[0] + 1] if link and len(parts) > link[0] + 1 else ""
        text = parts[link[0] + 2] if link and len(parts) > link[0] + 2 else ""
        head = re.sub(r"\*+UPDATE\*+\s*|\bUPDATE\s+", "", parts[0]).strip()
        rows.append({"inc": inc.group(1), "date": dm.group(0), "when": when, "head": head, "addr": addr, "comm": comm, "text": clean(text, 150), "update": "UPDATE" in title.upper()})
    return rows


def fetch_lafd():
    _, body = http_get("https://www.lafd.org/alerts", BROWSER_UA, timeout=30)
    rows = parse_lafd(body.decode("utf-8", "replace"))
    if not rows:
        raise RuntimeError("lafd: no alerts parsed (page changed?)")
    out, seen = [], set()
    for r in rows:
        key = "%s-%s" % (r["date"].replace("/", ""), r["inc"])
        if key in seen:
            continue
        seen.add(key)
        age_min = (datetime.now(PT) - r["when"]).total_seconds() / 60
        if age_min > 180 and not ANY_AGE:
            continue
        ll = geocode(lafd_expand(r["addr"], r["comm"])) if r["addr"] else None
        if not ll:
            continue
        ft = hav_ft(*ll)
        if ft > 7920:
            continue
        hot = re.search(r"structure fire|working|major|rescue|hazmat|explosion|collapse|brush|vehicle fire", r["head"], re.I)
        lvl = "high" if hot else "moderate"
        out.append({"key": key, "category": "fire_medical", "title": r["head"].title()[:90], "short": short_text(r["head"].title()), "lat": ll[0], "lng": ll[1],
                    "address": clean("%s, %s" % (r["addr"], r["comm"]), 100), "level": lvl, "occurred_ms": int(r["when"].timestamp() * 1000),
                    "updates": [{"t": int(r["when"].timestamp() * 1000), "text": r["text"]}] if r["text"] else [],
                    "ping": ft <= 1320 and age_min <= 90, "ping_force": True})
    return out


# ---------------------------------------------------------------- Nixle: LASD West Hollywood Station public agency page (unofficial scrape; internal only)
NIXLE_URL = "https://local.nixle.com/lasd---west-hollywood-station-los-angeles-county-sheriff/"
CLOSURE_RE = re.compile(r"clos(?:ed|ure)|road\s*closure|street\s*closure|detour|lane reduction|roadway|blvd\.? is down|traffic alert|avoid the area|carnaval|parade|cicLAvia|marathon", re.I)
REOPEN_RE = re.compile(r"\b(now open|is open|reopen|cleared|lifted|all clear)\b", re.I)
URGENT_RE = re.compile(r"shelter in place|evacuat|active (shooter|threat)|armed|barricad|suspect at large|amber alert|missing|explosion|gas leak|earthquake|emergency alert", re.I)
STREET_RE = re.compile(r"(\d{2,5}\s+(?:block of\s+)?(?:[NSEW]\.?\s+)?[A-Z][A-Za-z0-9 ]+?\s+(?:Blvd|Boulevard|Ave|Avenue|St|Street|Dr|Drive|Rd|Road|Pl|Place|Way|Ln|Lane|Ct|Court)\b)")
CROSS_RE = re.compile(r"([A-Za-z][A-Za-z ]+?\s+(?:Blvd|Boulevard|Ave|Avenue|St|Street|Dr|Drive|Rd|Road)\.?)\s+(?:and|&|at|near)\s+([A-Za-z][A-Za-z ]+?\s+(?:Blvd|Boulevard|Ave|Avenue|St|Street|Dr|Drive|Rd|Road))", re.I)
NIXLE_AGO = {"minute": 60, "hour": 3600, "day": 86400, "week": 604800, "month": 2592000, "year": 31536000}


def parse_nixle_list(html):
    rows = []
    for m in re.finditer(r'<li id="pub_(\d+)"[^>]*>(.*?)</li>', html, re.S):
        blk = m.group(2)
        pr = re.search(r'class="priority (\w+)"', blk)
        ago = re.search(r"Entered:\s*(.*?)\s*ago", blk, re.S)
        head = re.search(r'<p class="headline_agency">\s*(.*?)\s*<a href="([^"]+)"', blk, re.S)
        if not (head and ago):
            continue
        secs = 0
        for n, unit in re.findall(r"(\d+)\s+(minute|hour|day|week|month|year)", ago.group(1)):
            secs += int(n) * NIXLE_AGO[unit]
        if not secs and re.search(r"(less than a minute|moments?|seconds?)", ago.group(1)):
            secs = 30
        rows.append({"id": m.group(1), "prio": (pr.group(1) if pr else "community"), "title": clean(unescape(head.group(1)), 200), "url": head.group(2), "age_s": secs})
    return rows


def nixle_detail(url):
    try:
        _, body = http_get(url, BROWSER_UA, timeout=25)
    except Exception:
        return ""
    t = body.decode("utf-8", "replace")
    m = re.search(r'<div[^>]+class="[^"]*(?:message|wire_body|alert_body|body)[^"]*"[^>]*>(.*?)</div>', t, re.S)
    txt = clean(unescape(m.group(1)), 600) if m else ""
    return txt or clean(unescape(re.sub(r"(?s)<script.*?</script>|<style.*?</style>", "", t)), 600)


def fetch_nixle(st=None):
    _, body = http_get(NIXLE_URL, BROWSER_UA, timeout=30)
    rows = parse_nixle_list(body.decode("utf-8", "replace"))
    if not rows:
        raise RuntimeError("nixle: no alerts parsed (page changed?)")
    ctx = trips_context()
    out = []
    for r in rows:
        if r["age_s"] > 36 * 3600 and not ANY_AGE:
            continue
        txt = nixle_detail(r["url"]) if r["age_s"] < 36 * 3600 or ANY_AGE else ""
        full = r["title"] + ". " + txt
        reopen = bool(REOPEN_RE.search(r["title"]))
        closure = bool(CLOSURE_RE.search(r["title"])) and not reopen
        cat = "closures" if closure else "sheriff_city"
        ll = None
        m = STREET_RE.search(full)
        if m:
            ll = geocode("%s, West Hollywood, CA" % street_words(m.group(1)))
        if not ll:
            c = CROSS_RE.search(full)
            if c:
                ll = geocode_cross(c.group(1), c.group(2))
        occ = int((time.time() - r["age_s"]) * 1000)
        ft = hav_ft(*ll) if ll else 0
        lvl = "high" if r["prio"] == "alert" else "moderate" if r["prio"] == "advisory" else "low"
        if reopen:
            lvl = "low"
        urgent = bool(URGENT_RE.search(full)) or r["prio"] == "alert"
        conflict = conflict_for(ll[0], ll[1], occ, occ + 12 * 3600e3, ctx) if (ll and closure) else None
        item = {"key": r["id"], "category": cat, "title": r["title"][:90], "short": short_text(r["title"].title() if r["title"].isupper() else r["title"]),
                "lat": ll[0] if ll else HOME_LAT, "lng": ll[1] if ll else HOME_LON, "place": "point" if ll else "note",
                "address": clean(m.group(1), 80) if m else "", "level": lvl, "occurred_ms": occ, "ttl_min": 360 if not closure else 720,
                "updates": [{"t": occ, "text": clean(txt, 150)}] if txt else [], "ping": bool(not reopen and (urgent or (ll and ft <= 2640 and r["prio"] != "community"))), "ping_force": True}
        if conflict:
            item.update(short=short_text("Closure near " + conflict), level="high", ping=True, ping_force=True,
                        sub="Conflict%s·%s%s" % (NBSP, NBSP, t12(occ)))
        out.append(item)
    return out


# ---------------------------------------------------------------- Closures: Caltrans lane closures (official CWWP feed, District 7)
CALTRANS_URL = "https://cwwp2.dot.ca.gov/data/d7/lcs/lcsStatusD07.json"


def fetch_closures(st):
    """Conditional GET (ETag) so the 18 MB file is downloaded only when Caltrans changed it."""
    hdr = {}
    if st.get("etag") and st.get("closures_cache_ok"):
        hdr["If-None-Match"] = st["etag"]
    status, body, h = http_get(CALTRANS_URL, BROWSER_UA, hdr, timeout=90, want_headers=True)
    cache_path = os.path.join(DIR, "caltrans_near.json")
    if status == 304:
        near = load_json(cache_path, [])
    else:
        s = body.decode("utf-8", "replace")
        dec = json.JSONDecoder()
        near = []
        for m in re.finditer(r'\{\s*"lcs"\s*:', s):
            try:
                rec = dec.raw_decode(s, m.start())[0]["lcs"]
                b, e = rec["location"]["begin"], rec["location"]["end"]
                la1, lo1, la2, lo2 = float(b["beginLatitude"]), float(b["beginLongitude"]), float(e["endLatitude"]), float(e["endLongitude"])
            except Exception:
                continue
            if min(hav_ft(la1, lo1), hav_ft(la2, lo2)) > 30000:
                continue
            cl = rec["closure"]
            ts = cl["closureTimestamp"]
            near.append({"index": rec["index"], "la1": la1, "lo1": lo1, "la2": la2, "lo2": lo2, "route": b.get("beginRoute"), "name": b.get("beginLocationName"),
                         "name2": e.get("endLocationName"), "type": cl.get("typeOfClosure"), "lanes": cl.get("lanesClosed"), "total": cl.get("totalExistingLanes"),
                         "work": cl.get("typeOfWork"), "fac": cl.get("facility"), "dir": rec["location"].get("travelFlowDirection"),
                         "start": int(ts["closureStartEpoch"]) * 1000, "end": int(ts["closureEndEpoch"]) * 1000, "open_end": ts.get("isClosureEndIndefinite") == "true"})
        save_json(cache_path, near)
        st["etag"] = h.get("ETag") or h.get("Etag")
        st["closures_cache_ok"] = True
    now = time.time() * 1000
    ctx = trips_context()
    out = []
    for r in near:
        if r["end"] < now or r["start"] > now + 6 * 3600e3:
            continue
        mid = ((r["la1"] + r["la2"]) / 2, (r["lo1"] + r["lo2"]) / 2)
        ft = min(hav_ft(r["la1"], r["lo1"]), hav_ft(r["la2"], r["lo2"]), hav_ft(*mid))
        full = str(r["type"] or "").lower() in ("full", "full closure", "ramp", "connector")
        if ft > (7920 if full else 2640):           # calm by design: freeway ramps miles away do not belong on a 1 mi sky
            continue
        active = r["start"] <= now
        route = str(r["route"] or "").replace("SR-", "SR ").replace("US-", "US ").replace("I-", "I ")
        lanes = (str(r["lanes"] or "").strip() or None)
        title = "%s %s closure%s" % (route, str(r["type"] or "Lane").lower(), (", lanes %s" % lanes) if lanes else "")
        when = ("until " + t12(r["end"], day=True)) if active else ("starts " + t12(r["start"], day=True))
        conflict = conflict_for(mid[0], mid[1], r["start"], r["end"], ctx, 900)
        item = {"key": r["index"], "category": "closures", "title": title[:90], "short": short_text("%s %s closure" % (route, str(r["type"] or "lane").lower())),
                "lat": mid[0], "lng": mid[1], "address": clean("%s to %s" % (r["name"], r["name2"]), 100), "level": "high" if str(r["type"] or "").lower().startswith("full") and str(r["fac"] or "").lower() != "ramp" else "moderate" if full or active else "low",
                "occurred_ms": int(r["start"] if r["start"] <= now else now), "persistent": True,
                "sub": "%s%s·%s%s" % (where_text(*mid), NBSP, NBSP, when),
                "updates": [{"t": r["start"], "text": clean("%s, %s. %s" % (r["fac"], r["work"], r["dir"] and ("Traffic flows " + r["dir"].lower())), 150)}]}
        if conflict and (active or r["start"] < now + 24 * 3600e3):
            item.update(short=short_text("Closure near " + conflict), title="Closure near %s: %s" % (conflict, title), level="high", ping=True, ping_force=True,
                        sub="Conflict%s·%s%s" % (NBSP, NBSP, when))
        out.append(item)
    return out


# ---------------------------------------------------------------- LA Metro service alerts (official GTFS-RT alerts; needs a free API key)
def fetch_metro(st):
    key = vault_secret("lametro_api_key")
    if not key:
        raise SetupNeeded("setup: LA Metro GTFS-RT alerts need a free API key (Vault: lametro_api_key)")
    from citizen_metro import fetch_metro_alerts
    return fetch_metro_alerts(key, blue_steel_out_on_trip())
