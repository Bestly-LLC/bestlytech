"""Shared helpers for the Local alerts collector (Sky Sync). Standard library only. PRIVATE / INTERNAL USE ONLY.

Everything the adapters need: HTTP with polite headers, home distance/direction, 12-hour times with no-break spaces,
a cached forward geocoder (OpenStreetMap Nominatim, 1 request/second, tiny volume), the Supabase RPC helper and
the trips/car context used to flag closure conflicts.
"""
import gzip, json, math, os, re, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

HOME_LAT, HOME_LON = 34.0835, -118.3698            # 733 N Kings Rd, West Hollywood (same as wall server.py)
DIR = os.environ.get("CITIZEN_DIR", "/opt/bestly/citizen")
REPORT = "/opt/bestly/wall/.report.json"           # {supabase_url, agent_key}
PUBLISHABLE = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"
BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) "
              "Chrome/130.0.0.0 Safari/537.36")
NWS_UA = "BestlyHome/1.0 (jared@bestly.tech)"
PT = ZoneInfo("America/Los_Angeles")
NBSP = " "
DRY = "--dry" in sys.argv
ANY_AGE = os.environ.get("CITIZEN_TEST_ANY_AGE") == "1"     # tests only: keep old items so parsers can be checked on real pages


class SetupNeeded(Exception):
    """The source cannot run until a one-time step is done (key, subscription). Shown as a quiet 'setup' state, not an alert."""


class HttpFail(RuntimeError):
    def __init__(self, code, msg=None):
        super().__init__(msg or "http %d" % code)
        self.code = code


def log(msg):
    print(time.strftime("%Y-%m-%d %I:%M:%S %p ") + msg, flush=True)


# ---------------------------------------------------------------- http
def http_get(url, ua=BROWSER_UA, headers=None, timeout=25, want_headers=False):
    h = {"User-Agent": ua, "Accept": "*/*", "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip"}
    h.update(headers or {})
    req = urllib.request.Request(url, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
            return (r.status, body, dict(r.headers)) if want_headers else (r.status, body)
    except urllib.error.HTTPError as e:
        if e.code == 304:
            return (304, b"", dict(e.headers)) if want_headers else (304, b"")
        raise HttpFail(e.code)


# ---------------------------------------------------------------- geometry and text
def hav_ft(lat, lon, lat0=HOME_LAT, lon0=HOME_LON):
    r = 3958.8 * 5280
    p1, p2 = math.radians(lat0), math.radians(lat)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon - lon0) / 2) ** 2
    return 2 * r * math.asin(min(1, math.sqrt(a)))


def compass(lat, lon):
    b = (math.degrees(math.atan2((lon - HOME_LON) * math.cos(math.radians(HOME_LAT)), lat - HOME_LAT)) + 360) % 360
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][int(round(b / 45)) % 8]


def fmt_dist(ft):
    """Same rule as SQL citizen_dist_text: '820 ft', '0.4 mi', '41 mi'; no-break space keeps number and unit together."""
    if ft < 1000:
        return "%d%sft" % (round(ft / 10.0) * 10, NBSP)
    if ft < 52800:
        return "%.1f%smi" % (round(ft / 528.0) / 10.0, NBSP)
    return "%d%smi" % (round(ft / 5280.0), NBSP)


def where_text(lat, lon):
    ft = hav_ft(lat, lon)
    return fmt_dist(ft) + ((NBSP + compass(lat, lon)) if ft >= 5280 else "")


def t12(ms_or_dt, day=False):
    dt = ms_or_dt if isinstance(ms_or_dt, datetime) else datetime.fromtimestamp(ms_or_dt / 1000.0, PT)
    dt = dt.astimezone(PT)
    h = dt.strftime("%I:%M").lstrip("0")
    s = h + NBSP + dt.strftime("%p")
    if day and dt.date() != datetime.now(PT).date():
        s = dt.strftime("%a") + " " + s
    return s


def short_text(s, n=34):
    """Shorten by dropping words (never '...'). Keeps whole words."""
    s = re.sub(r"\s+", " ", (s or "").strip())
    if len(s) <= n:
        return s
    if "," in s and len(s.split(",")[0]) >= 8:
        s = s.split(",")[0]
        if len(s) <= n:
            return s
    cut = s[:n].rsplit(" ", 1)[0]
    return re.sub(r"[\s,;:/&.-]+(and|of|at|on|in|to|the|a|no|w/|with|for|near)?$", "", cut, flags=re.I).strip() or s[:n]


def clean(s, n=160):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", s or "")).strip()[:n]


# ---------------------------------------------------------------- state / config
def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return default


def save_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".tmp", "w") as f:
        json.dump(obj, f)
    os.replace(path + ".tmp", path)


def cfg():
    return json.load(open(REPORT))


def sb_rpc(name, params, timeout=25):
    c = cfg()
    req = urllib.request.Request(c["supabase_url"].rstrip("/") + "/rest/v1/rpc/" + name, data=json.dumps(params).encode(),
                                 headers={"Content-Type": "application/json", "apikey": PUBLISHABLE, "Authorization": "Bearer " + PUBLISHABLE})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"null")


def vault_secret(name):
    """Read a secret through the token-gated vault reader if one exists; None when missing (never printed)."""
    try:
        return sb_rpc("citizen_secret", {"p_token": cfg()["agent_key"], "p_name": name})
    except Exception:
        return None


# ---------------------------------------------------------------- geocoder (OSM Nominatim, cached, polite)
GEO_FILE = os.path.join(DIR, "geocache.json")
_geo = {"cache": None, "last": 0.0, "budget": 5}
LA_VIEWBOX = "-118.95,34.35,-117.95,33.70"      # lon1,lat1,lon2,lat2 (west, north, east, south): Los Angeles basin


def street_words(s):
    s = " " + s + " "
    for a, b in ((r"\bBl\b", "Blvd"), (r"\bAv\b", "Ave"), (r"\bWy\b", "Way"), (r"\bPl\b", "Place"), (r"\bCt\b", "Court"),
                 (r"\bBlvd\.", "Blvd"), (r"\bBoulevard\b", "Blvd"), (r"\bAvenue\b", "Ave")):
        s = re.sub(a, b, s)
    return s.strip()


def geocode(query):
    """-> (lat, lon) or None. Cached on disk. At most 5 live lookups per collector run, 1 per second."""
    if _geo["cache"] is None:
        _geo["cache"] = load_json(GEO_FILE, {})
    key = query.strip().lower()
    hit = _geo["cache"].get(key)
    if hit is not None and time.time() - hit.get("t", 0) < (7 if hit.get("none") else 30) * 86400:
        return None if hit.get("none") else (hit["lat"], hit["lon"])
    if _geo["budget"] <= 0:
        return None
    _geo["budget"] -= 1
    wait = 1.1 - (time.time() - _geo["last"])
    if wait > 0:
        time.sleep(wait)
    _geo["last"] = time.time()
    try:
        _, body = http_get("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&viewbox=%s&bounded=1&q=%s"
                           % (LA_VIEWBOX, urllib.parse.quote(query)), "BestlyHome/1.0 (jared@bestly.tech)", {"Accept": "application/json"})
        rows = json.loads(body)
    except Exception as e:
        log("geocode failed (%s): %s" % (query[:40], e))
        return None
    if rows:
        _geo["cache"][key] = {"lat": float(rows[0]["lat"]), "lon": float(rows[0]["lon"]), "t": time.time()}
    else:
        _geo["cache"][key] = {"none": 1, "t": time.time()}
    save_json(GEO_FILE, _geo["cache"])
    c = _geo["cache"][key]
    return (c["lat"], c["lon"]) if "lat" in c else None


# ---------------------------------------------------------------- Turo trips + Blue Steel spot (for closure conflicts)
def trips_context():
    """-> list of {label, lat, lon, from_ms, to_ms} places Jared cares about in the next 24 hr. Never raises."""
    out = []
    try:
        now = time.time() * 1000
        d = sb_rpc("wall_pi_trips", {"p_token": cfg()["agent_key"]})
        for c in d.get("cars") or []:
            if c.get("lat") is not None and c.get("lon") is not None:
                out.append({"label": c.get("name") or "the Tesla", "lat": float(c["lat"]), "lon": float(c["lon"]), "from_ms": now, "to_ms": now + 24 * 3600e3, "car": True})
        for t in d.get("trips") or []:
            try:
                st = datetime.fromisoformat(t["start"]).timestamp() * 1000
                en = datetime.fromisoformat(t["end"]).timestamp() * 1000
            except Exception:
                continue
            lat = t.get("lat") if t.get("lat") is not None else HOME_LAT
            lon = t.get("lon") if t.get("lon") is not None else HOME_LON
            if t.get("airport"):
                continue                       # LAX handoffs happen at the airport, not on our streets
            guest = t.get("guest") or "guest"
            if st > now - 3600e3 and st < now + 24 * 3600e3:
                out.append({"label": "%s's pickup" % guest, "lat": float(lat), "lon": float(lon), "from_ms": st - 3600e3, "to_ms": st + 3600e3})
            if en > now - 3600e3 and en < now + 24 * 3600e3:
                out.append({"label": "%s's return" % guest, "lat": HOME_LAT, "lon": HOME_LON, "from_ms": en - 3600e3, "to_ms": en + 3600e3})
    except Exception as e:
        log("trips_context unavailable: %s" % e)
    return out


def blue_steel_out_on_trip():
    """True while a Turo trip is in progress with the Tesla (he rides Metro then). None when unknown."""
    try:
        d = sb_rpc("wall_pi_trips", {"p_token": cfg()["agent_key"]})
        return any(bool(t.get("in_progress")) for t in d.get("trips") or [])
    except Exception:
        return None


def conflict_for(lat, lon, from_ms, to_ms, ctx, radius_ft=800):
    """First place in ctx whose window overlaps [from_ms, to_ms] and sits within radius_ft of the closure. -> label or None"""
    for p in ctx:
        if p["to_ms"] < from_ms or p["from_ms"] > to_ms:
            continue
        if hav_ft(lat, lon, p["lat"], p["lon"]) <= radius_ft:
            return p["label"]
    return None


SUFFIX_RE = re.compile(r"\s+(Blvd|Boulevard|Ave|Avenue|St|Street|Dr|Drive|Rd|Road|Pl|Place|Way|Ln|Lane|Ct|Court)\.?$", re.I)


def geocode_cross(a, b):
    """Intersection of two street names around West Hollywood via OpenStreetMap Overpass (cached; Nominatim cannot do intersections)."""
    key = ("x:" + "&".join(sorted([a.lower().strip(" ."), b.lower().strip(" .")])))
    if _geo["cache"] is None:
        _geo["cache"] = load_json(GEO_FILE, {})
    hit = _geo["cache"].get(key)
    if hit is not None and time.time() - hit.get("t", 0) < (7 if hit.get("none") else 60) * 86400:
        return None if hit.get("none") else (hit["lat"], hit["lon"])
    if _geo["budget"] <= 0:
        return None
    _geo["budget"] -= 1
    names = [re.sub(r"[^A-Za-z0-9 ]", "", SUFFIX_RE.sub("", street_words(x).strip(" ."))).strip() for x in (a, b)]
    box = "(34.03,-118.45,34.14,-118.28)"
    q = ('[out:json][timeout:20];way["highway"]["name"~"^%s",i]%s->.a;way["highway"]["name"~"^%s",i]%s->.b;node(w.a)(w.b);out 3;' % (names[0], box, names[1], box))
    els, last = None, None
    for base in ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"):
        try:
            req = urllib.request.Request(base, data=urllib.parse.urlencode({"data": q}).encode(), headers={"User-Agent": "BestlyHome/1.0 (jared@bestly.tech)"})
            with urllib.request.urlopen(req, timeout=15) as r:
                els = json.loads(r.read()).get("elements") or []
            break
        except Exception as e:
            last = e
    if els is None:
        log("overpass failed (%s & %s): %s" % (a, b, last))
        return None
    if els:
        _geo["cache"][key] = {"lat": els[0]["lat"], "lon": els[0]["lon"], "t": time.time()}
    else:
        _geo["cache"][key] = {"none": 1, "t": time.time()}
    save_json(GEO_FILE, _geo["cache"])
    c = _geo["cache"][key]
    return (c["lat"], c["lon"]) if "lat" in c else None
