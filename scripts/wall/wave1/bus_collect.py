#!/usr/bin/env python3
"""Bestly bus collector v2 (WAVE1_20261102). Owner: Mae. Runs on Clio as bestly-bus.service. Stdlib only, no AI.

Serves http://<clio>:8097/bus.json (snapshot) and /health. The wall server proxies it at /api/bus.
Live: Metro 4, 10, 105 (Swiftly GTFS-RT trip updates, vehicle positions, service alerts) and WeHo CityLine (Umo IQ public rider feed,
agency west-hollywood). Schedule: DASH Fairfax (LADOT has no free live feed) and the CityLine commuter printed times (fallback).
Walk times: free OpenStreetMap foot routing (routing.openstreetmap.de, FOSSGIS), computed once per stop, refreshed weekly with the stops.
Self-heal: recreates its data folder if it vanishes (it did once), keeps serving from memory, retries every feed with backoff, falls back to
the printed schedule when Metro live data is older than 5 minutes. Sky Sync (Mac mini) restarts the service when /health stalls and
reports to Scout as Mae (digest only, never a push).
"""
import collections, csv, gzip, io, json, math, os, re, sys, threading, time, urllib.error, urllib.parse, urllib.request, zipfile, zoneinfo
from datetime import datetime, timedelta, date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DIR = os.environ.get("BUS_DIR", "/opt/bestly/bus")
PORT = int(os.environ.get("BUS_PORT", "8097"))
REPORT = "/opt/bestly/wall/.report.json"
PUBLISHABLE = "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw"
HOME_LAT, HOME_LON = 34.08436, -118.37193
PT = zoneinfo.ZoneInfo("America/Los_Angeles")
UA = "BestlyHome/1.0"
SWIFTLY = "https://api.goswift.ly/real-time/lametro/"
UMO = "https://retro.umoiq.com/service/publicJSONFeed"
UMO_AGENCY = "west-hollywood"
FOOT = "https://routing.openstreetmap.de/routed-foot/route/v1/foot/%s,%s;%s,%s?overview=full&geometries=geojson&steps=false"
METRO_ZIP = "https://gitlab.com/LACMTA/gtfs_bus/raw/master/gtfs_bus.zip"
DASH_ZIP = "https://ladotbus.com/gtfs"
METRO_LINES = ("4", "10", "105")
PINS = {"105": {"12151", "3658"}}
METRO_COLOR, DASH_COLOR, CITY_COLOR = "#E16710", "#8A2528", "#E63540"
POLL_S, STALE_S, VEH_MAX_FT = 25, 300, 15840
STATIC_MAX_AGE_S = 7 * 86400
CITY_HOLIDAYS = {"2026-11-26", "2026-12-25", "2027-01-01", "2027-02-15", "2027-05-31", "2027-07-05", "2027-09-06", "2026-11-27"}
CITY_ROUTES = (("HHL", "Commuter", 1), ("CLEB", "Local", 2), ("CLWB", "Local", 2))
ORDER = {"10": 1, "4": 2, "105": 3, "DASH": 4, "CityLine": 5}
SEV = {"DETOUR": 0, "NO_SERVICE": 1, "REDUCED_SERVICE": 2, "SIGNIFICANT_DELAYS": 3, "MODIFIED_SERVICE": 4, "STOP_MOVED": 5, "ADDITIONAL_SERVICE": 8}

LOCK = threading.RLock()
S = {"static": {}, "rt": {"at": 0, "etas": {}, "trips": [], "err": "not polled yet", "fails": 0},
     "veh": {"at": 0, "list": [], "err": "not polled yet", "fails": 0, "occ": False},
     "alr": {"at": 0, "list": [], "err": "not polled yet", "fails": 0},
     "umo": {"at": 0, "preds": {}, "veh": [], "err": "not polled yet", "fails": 0},
     "key": None, "static_state": {}, "cycle_at": time.time(), "snap": None, "snap_at": 0, "heal": []}


def log(m):
    print(time.strftime("%Y-%m-%d %I:%M:%S %p ") + str(m), flush=True)


def ensure_dir():
    for p in (DIR, os.path.join(DIR, "gtfs")):
        if not os.path.isdir(p):
            os.makedirs(p, exist_ok=True)
            S["heal"].append([int(time.time()), "recreated " + p])
            log("data folder was missing, recreated " + p)


def load_json(p, d):
    try:
        with open(p) as f:
            return json.load(f)
    except Exception:
        return d


def save_json(p, o):
    ensure_dir()
    with open(p + ".tmp", "w") as f:
        json.dump(o, f)
    os.replace(p + ".tmp", p)


def http_get(url, headers=None, timeout=40):
    h = {"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"}
    if headers:
        h.update(headers)
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
        body = r.read()
        if r.headers.get("Content-Encoding") == "gzip":
            body = gzip.decompress(body)
        return body


def agent_cfg():
    return load_json(REPORT, {})


def sb_rpc(name, params, timeout=25):
    c = agent_cfg()
    req = urllib.request.Request(c["supabase_url"].rstrip("/") + "/rest/v1/rpc/" + name, data=json.dumps(params).encode(),
                                 headers={"Content-Type": "application/json", "apikey": PUBLISHABLE, "Authorization": "Bearer " + PUBLISHABLE})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        b = r.read()
    return json.loads(b) if b and b != b"null" else None


def swiftly_key():
    if not S["key"]:
        S["key"] = sb_rpc("citizen_secret", {"p_token": agent_cfg()["agent_key"], "p_name": "lametro_api_key"})
    return S["key"]


def swiftly(path, timeout=60):
    try:
        return json.loads(http_get(SWIFTLY + path, {"Authorization": swiftly_key()}, timeout))
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            S["key"] = None                      # re-read from the Vault next time
        raise


def hav_ft(lat, lon, lat0=HOME_LAT, lon0=HOME_LON):
    p1, p2 = math.radians(lat0), math.radians(lat)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon - lon0) / 2) ** 2
    return 2 * 20925525.0 * math.asin(math.sqrt(a))


def bearing(lat1, lon1, lat2, lon2):
    p1, p2, dl = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def cardinal(b):
    return ["Northbound", "Eastbound", "Southbound", "Westbound"][int(((b + 45) % 360) // 90)]


def walk_est(ft):
    return max(1, int(math.ceil(ft * 1.3 / 264.0)))


def secs(t):
    h, m, s = [int(x) for x in str(t).strip().split(":")]
    return h * 3600 + m * 60 + s


def day_base(d):
    return int(datetime(d.year, d.month, d.day, tzinfo=PT).timestamp() * 1000)


# ---------------- static GTFS ----------------
def csv_rows(zf, name):
    with zf.open(name) as f:
        for r in csv.DictReader(io.TextIOWrapper(f, "utf-8-sig")):
            yield r


def download(url, dst):
    ensure_dir()
    tmp = dst + ".part"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)
    zipfile.ZipFile(tmp).testzip()
    os.replace(tmp, dst)


def pick_metro(r):
    sn = (r.get("route_short_name") or "").strip()
    if sn in METRO_LINES:
        return sn
    if sn.startswith("10/"):
        return "10"
    return None


def pick_dash(r):
    return "DASH" if (r.get("route_long_name") or "").strip().lower() == "dash fairfax" else None


def build_gtfs(path, pick, prev):
    z = zipfile.ZipFile(path)
    pickd, color = {}, {}
    for r in csv_rows(z, "routes.txt"):
        ln = pick(r)
        if ln:
            pickd[r["route_id"]] = ln
            color.setdefault(ln, (r.get("route_color") or "").strip())
    trips = {}
    for t in csv_rows(z, "trips.txt"):
        ln = pickd.get(t["route_id"])
        if ln:
            trips[t["trip_id"]] = (ln, str(t.get("direction_id") or "0"), t["service_id"], t.get("trip_headsign") or "", t.get("shape_id") or "")
    stops = {s["stop_id"]: s for s in csv_rows(z, "stops.txt")}
    seq = collections.defaultdict(list)
    for r in csv_rows(z, "stop_times.txt"):
        if r["trip_id"] in trips:
            tm = r.get("arrival_time") or r.get("departure_time")
            if tm:
                seq[r["trip_id"]].append((int(r["stop_sequence"]), r["stop_id"], secs(tm), (r.get("stop_headsign") or "").strip()))
    groups = collections.defaultdict(list)
    for tid, (ln, d, _svc, _hs, _shp) in trips.items():
        if tid in seq:
            groups[(ln, d)].append(tid)
    lines, services = {}, set()
    for (ln, d), tids in sorted(groups.items()):
        cand = collections.Counter()
        for tid in tids:
            for _, sid, *_x in seq[tid]:
                cand[sid] += 1
        want = prev.get(ln, {}).get("dirs", {}).get(d, {}).get("stop_id")
        pool = [s for s in cand if s in PINS[ln]] if ln in PINS else list(cand)
        if want in cand:
            pin = want
        elif pool:
            pin = min(pool, key=lambda s: hav_ft(float(stops[s]["stop_lat"]), float(stops[s]["stop_lon"])))
        else:
            continue
        st = stops[pin]
        sched, hs, brg, shp = [], collections.Counter(), None, collections.Counter()
        for tid in tids:
            ss = sorted(seq[tid])
            ix = [i for i, x in enumerate(ss) if x[1] == pin]
            if not ix:
                continue
            i = ix[0]
            sched.append([trips[tid][2], ss[i][2], tid])
            if trips[tid][4]:
                shp[trips[tid][4]] += 1
            services.add(trips[tid][2])
            h = re.sub(r"^\d+\s*-\s*", "", ss[i][3] or trips[tid][3]).strip()
            if h:
                hs[h] += 1
            if brg is None:
                a, b = (ss[i], ss[i + 1]) if i + 1 < len(ss) else ((ss[i - 1], ss[i]) if i > 0 else (None, None))
                if a:
                    sa, sb = stops[a[1]], stops[b[1]]
                    brg = bearing(float(sa["stop_lat"]), float(sa["stop_lon"]), float(sb["stop_lat"]), float(sb["stop_lon"]))
        sched.sort(key=lambda x: (x[1], x[0]))
        lat, lon = float(st["stop_lat"]), float(st["stop_lon"])
        lines.setdefault(ln, {"dirs": {}, "gtfs_color": color.get(ln, "")})["dirs"][d] = {
            "stop_id": pin, "stop": st.get("stop_name", pin), "lat": lat, "lon": lon, "dist_ft": int(hav_ft(lat, lon)),
            "headsign": hs.most_common(1)[0][0] if hs else "", "card": cardinal(brg) if brg is not None else "", "sched": sched,
            "shape_id": shp.most_common(1)[0][0] if shp else ""}
    need = {v["shape_id"] for L in lines.values() for v in L["dirs"].values() if v.get("shape_id")}
    pts = collections.defaultdict(list)
    if need and "shapes.txt" in z.namelist():
        for r in csv_rows(z, "shapes.txt"):
            if r["shape_id"] in need:
                pts[r["shape_id"]].append((int(r["shape_pt_sequence"]), float(r["shape_pt_lat"]), float(r["shape_pt_lon"])))
    for L in lines.values():
        for v in L["dirs"].values():
            pl = [(a, b) for _, a, b in sorted(pts.get(v.get("shape_id"), []))]
            if not pl:
                continue
            ds = [hav_ft(a, b) for a, b in pl]
            i0 = min(range(len(pl)), key=lambda i: hav_ft(pl[i][0], pl[i][1], v["lat"], v["lon"]))
            lo = hi = i0
            while lo > 0 and ds[lo - 1] <= 4 * 5280:
                lo -= 1
            while hi < len(pl) - 1 and ds[hi + 1] <= 4 * 5280:
                hi += 1
            seg = pl[lo:hi + 1]
            if len(seg) > 70:
                k = len(seg) / 69.0
                seg = [seg[int(i * k)] for i in range(69)] + [seg[-1]]
            v["shape"] = [[round(a, 5), round(b, 5)] for a, b in seg]
    cal, cd = {}, {}
    if "calendar.txt" in z.namelist():
        for r in csv_rows(z, "calendar.txt"):
            if r["service_id"] in services:
                cal[r["service_id"]] = [r["start_date"], r["end_date"], [int(r[k]) for k in ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")]]
    if "calendar_dates.txt" in z.namelist():
        lo = (date.today() - timedelta(days=2)).strftime("%Y%m%d")
        for r in csv_rows(z, "calendar_dates.txt"):
            if r["service_id"] in services and r["date"] >= lo:
                cd.setdefault(r["date"], {"add": [], "rem": []})["add" if r["exception_type"] == "1" else "rem"].append(r["service_id"])
    return {"built": time.time(), "lines": lines, "cal": cal, "cd": cd}


# ---------------- OpenStreetMap walking routes ----------------
def osm_walk(lat, lon):
    d = json.loads(http_get(FOOT % (HOME_LON, HOME_LAT, lon, lat), timeout=30))
    r = d["routes"][0]
    pts = r["geometry"]["coordinates"]
    if len(pts) > 40:
        step = len(pts) / 39.0
        pts = [pts[int(i * step)] for i in range(39)] + [pts[-1]]
    return {"min": max(1, int(math.ceil(r["duration"] / 60.0))), "ft": int(r["distance"] * 3.28084), "src": "osm",
            "geom": [[round(y, 5), round(x, 5)] for x, y in pts], "at": time.time()}


def walk_targets(st):
    out = {}
    for ag in ("metro", "dash"):
        for ln, L in ((st.get(ag) or {}).get("lines") or {}).items():
            for d, v in L["dirs"].items():
                out["%s:%s" % (ag, v["stop_id"])] = (v["lat"], v["lon"])
    for c in (st.get("city") or {}).get("stops", []):
        out["weho:" + c["key"]] = (c["lat"], c["lon"])
    return out


def refresh_walks(st, force=False):
    walk = st.setdefault("walk", {})
    ok = bad = 0
    for k, (lat, lon) in walk_targets(st).items():
        w = walk.get(k)
        if w and w.get("src") == "osm" and not force and abs(w.get("lat", lat) - lat) < 1e-6 and time.time() - w.get("at", 0) < STATIC_MAX_AGE_S:
            ok += 1
            continue
        try:
            w = osm_walk(lat, lon)
            w["lat"] = lat
            walk[k] = w
            ok += 1
        except Exception as e:
            bad += 1
            log("walk route failed for %s: %s" % (k, e))
            if not w:
                ft = hav_ft(lat, lon)
                walk[k] = {"min": walk_est(ft), "ft": int(ft * 1.3), "src": "est", "geom": [], "at": 0, "lat": lat}
        time.sleep(1.3)
    S["static_state"]["walks"] = {"ok": bad == 0, "age_h": 0, "err": ("%d routes failed" % bad) if bad else None, "at": time.time(), "n": ok}


# ---------------- WeHo CityLine stops (Umo IQ routeConfig) ----------------
def build_city():
    stops = []
    for rt, variant, _ in CITY_ROUTES:
        d = json.loads(http_get("%s?command=routeConfig&a=%s&r=%s" % (UMO, UMO_AGENCY, rt), timeout=25))["route"]
        sm = {s["tag"]: s for s in d["stop"]}
        dirs = d["direction"] if isinstance(d["direction"], list) else [d["direction"]]
        for dr in dirs:
            c = [x["tag"] for x in dr["stop"] if x["tag"] in sm]
            best = min(c, key=lambda t: hav_ft(float(sm[t]["lat"]), float(sm[t]["lon"])))
            s = sm[best]
            lat, lon = float(s["lat"]), float(s["lon"])
            name = str(s["title"]).strip()
            if "/" in name and " / " not in name:
                name = name.replace("/", " / ")
            dtitle = str(dr.get("title") or dr.get("name") or "").capitalize()
            stops.append({"key": "%s:%s" % (rt, best), "route": rt, "stop_tag": best, "variant": variant, "stop": name, "lat": lat, "lon": lon,
                          "dist_ft": int(hav_ft(lat, lon)), "dir_tag": dr["tag"], "direction": cardinal({"eastbound": 90, "westbound": 270}.get(dtitle.lower(), 90)),
                          "toward": ("Toward Hollywood/Highland (B Line)" if dtitle.lower() == "eastbound" else "Toward West Hollywood") if rt == "HHL" else ""})
    return {"built": time.time(), "stops": stops}


def static_ok(st):
    return all(st.get(k, {}).get("lines") for k in ("metro", "dash")) and (st.get("city") or {}).get("stops")


def build_static_all(force=False):
    st = load_json(os.path.join(DIR, "static.json"), None) or S["static"] or {}
    S["static"] = st or S["static"]
    age = time.time() - min([st.get(k, {}).get("built", 0) for k in ("metro", "dash", "city")] or [0])
    ends = [v[1] for k in ("metro", "dash") for v in (st.get(k, {}).get("cal") or {}).values()]
    soon = (date.today() + timedelta(days=3)).strftime("%Y%m%d")
    expiring = bool(ends) and max(ends) < soon
    if not force and static_ok(st) and age < STATIC_MAX_AGE_S and not expiring:
        if not all(("metro:%s" % v["stop_id"]) in st.get("walk", {}) for L in st["metro"]["lines"].values() for v in L["dirs"].values()):
            refresh_walks(st)
            save_json(os.path.join(DIR, "static.json"), st)
        S["static"] = st
        return
    new = dict(st)
    for key, url, pick, fn in (("metro", METRO_ZIP, pick_metro, "metro.zip"), ("dash", DASH_ZIP, pick_dash, "dash.zip")):
        try:
            p = os.path.join(DIR, "gtfs", fn)
            download(url, p)
            new[key] = build_gtfs(p, pick, (st.get(key) or {}).get("lines", {}))
            S["static_state"]["static_" + key] = {"ok": True, "err": None, "at": time.time()}
            log("static %s rebuilt" % key)
        except Exception as e:
            S["static_state"]["static_" + key] = {"ok": False, "err": str(e)[:120], "at": S["static_state"].get("static_" + key, {}).get("at", 0)}
            log("static %s rebuild failed: %s" % (key, e))
    try:
        new["city"] = build_city()
    except Exception as e:
        log("cityline stops failed: %s" % e)
    if static_ok(new):
        refresh_walks(new, force=True)
        new["built_at"] = time.time()
        save_json(os.path.join(DIR, "static.json"), new)
        S["static"] = new


def static_loop():
    while True:
        try:
            build_static_all()
        except Exception as e:
            log("static loop error: %s" % e)
        time.sleep(3600)


# ---------------- schedule helpers ----------------
def active(sec, d, st):
    cal = st.get("cal", {}).get(sec)
    ds = d.strftime("%Y%m%d")
    cd = st.get("cd", {}).get(ds, {})
    if sec in cd.get("rem", []):
        return False
    if sec in cd.get("add", []):
        return True
    return bool(cal and cal[0] <= ds <= cal[1] and cal[2][d.weekday()])


def sched_times(src, dinfo, now_ms, horizon_h=16):
    out = []
    today = datetime.fromtimestamp(now_ms / 1000, PT).date()
    for off in (-1, 0, 1):
        d = today + timedelta(days=off)
        base = day_base(d)
        for sec, s, tid in dinfo["sched"]:
            if active(sec, d, src):
                eta = base + s * 1000
                if now_ms - 30000 <= eta <= now_ms + horizon_h * 3600000:
                    out.append((eta, tid + "@" + d.strftime("%m%d")))
    return sorted(out)


def city_times(now_ms):
    out = []
    today = datetime.fromtimestamp(now_ms / 1000, PT).date()
    for off in range(0, 4):
        d = today + timedelta(days=off)
        if d.isoformat() in CITY_HOLIDAYS or d.weekday() == 6:
            continue
        mins = list(range(420, 540, 20)) if d.weekday() < 5 else []
        mins += list(range(1020, 1200, 20))
        for m in mins:
            eta = day_base(d) + m * 60 * 1000
            if eta >= now_ms - 60000 and eta < now_ms + 36 * 3600000:
                out.append(eta)
    return sorted(out)


# ---------------- feeds ----------------
def stop_index():
    idx = collections.defaultdict(dict)
    for ln, L in ((S["static"].get("metro") or {}).get("lines") or {}).items():
        for d, v in L["dirs"].items():
            idx[ln][str(v["stop_id"])] = d
    return idx


def fetch_trips():
    d = swiftly("gtfs-rt-trip-updates?format=json", 60)
    idx, etas, trips = stop_index(), collections.defaultdict(list), set()
    for e in d.get("entity") or []:
        tu = e.get("tripUpdate")
        if not tu:
            continue
        tr = tu.get("trip") or {}
        ln = str(tr.get("routeId") or "").split("-")[0]
        if ln not in METRO_LINES:
            continue
        tid = tr.get("tripId")
        trips.add(tid)
        if tr.get("scheduleRelationship") == "CANCELED":
            continue
        for su in tu.get("stopTimeUpdate") or []:
            k = idx.get(ln, {}).get(str(su.get("stopId")))
            if k is None:
                continue
            t = (su.get("arrival") or su.get("departure") or {}).get("time")
            if t:
                etas[(ln, k)].append([int(t) * 1000, tid])
    return {"at": time.time(), "etas": dict(etas), "trips": sorted(trips)}


OCC = {"EMPTY": "seats", "MANY_SEATS_AVAILABLE": "seats", "FEW_SEATS_AVAILABLE": "standing", "STANDING_ROOM_ONLY": "standing",
       "CRUSHED_STANDING_ROOM_ONLY": "full", "FULL": "full", "NOT_ACCEPTING_PASSENGERS": "full"}
OCC_NUM = {0: "seats", 1: "seats", 2: "standing", 3: "standing", 4: "full", 5: "full", 6: "full"}


def fetch_vehicles():
    d = swiftly("gtfs-rt-vehicle-positions?format=json", 40)
    st = (S["static"].get("metro") or {}).get("lines") or {}
    now, out, occ_any = time.time(), [], False
    for e in d.get("entity") or []:
        v = e.get("vehicle")
        if not v:
            continue
        tr = v.get("trip") or {}
        ln = str(tr.get("routeId") or "").split("-")[0]
        p = v.get("position")
        if ln not in METRO_LINES or not p or "latitude" not in p:
            continue
        if now - int(v.get("timestamp") or now) > 180:
            continue
        ft = hav_ft(p["latitude"], p["longitude"])
        if ft > VEH_MAX_FT:
            continue
        dinfo = (st.get(ln) or {}).get("dirs", {}).get(str(tr.get("directionId", 0)))
        o = v.get("occupancyStatus")
        oc = OCC.get(o) if isinstance(o, str) else OCC_NUM.get(o) if isinstance(o, int) else None
        occ_any = occ_any or oc is not None
        out.append({"id": str((v.get("vehicle") or {}).get("id") or e.get("id")), "line": ln, "agency": "metro",
                    "direction": (dinfo or {}).get("card", ""), "dir_id": str(tr.get("directionId", 0)),
                    "lat": p["latitude"], "lng": p["longitude"], "bearing": round(p["bearing"]) if p.get("bearing") is not None else None,
                    "mph": round((p.get("speed") or 0) * 2.23694, 1), "dist_ft": int(ft), "trip_id": tr.get("tripId"), "occ": oc})
    out.sort(key=lambda x: x["dist_ft"])
    return {"at": time.time(), "list": out, "occ": occ_any}


def parse_iso(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp() * 1000
    except Exception:
        return None


def first_sentence(t, n=90):
    t = " ".join(str(t or "").replace("\r", "\n").split("\n\n")[0].split())
    for i, ch in enumerate(t):
        if ch == "." and i > 20 and (i + 1 == len(t) or t[i + 1] == " "):
            t = t[:i]
            break
    if len(t) > n:
        t = t[:n].rsplit(" ", 1)[0]
    return t.rstrip(" ,;:")


def fetch_alerts():
    d = json.loads(http_get(SWIFTLY + "gtfs-rt-alerts/v2?format=json", {"Authorization": swiftly_key()}, 40))
    pins = {str(v["stop_id"]) for L in ((S["static"].get("metro") or {}).get("lines") or {}).values() for v in L["dirs"].values()}
    now, out = time.time() * 1000, []
    for a in d if isinstance(d, list) else []:
        if a.get("deletedAt"):
            continue
        lines, stops = set(), set()
        for i in a.get("informedEntities") or []:
            ln = str(i.get("routeId") or "").split("-")[0]
            if ln in METRO_LINES:
                lines.add(ln)
                if i.get("stopId"):
                    stops.add(str(i["stopId"]))
        if not lines:
            continue
        per = a.get("activePeriods") or []
        st_ms = en_ms = None
        ok = not per
        for p in per:
            s, e = parse_iso(p.get("start")), parse_iso(p.get("end"))
            if (s is None or s <= now) and (e is None or e >= now):
                ok, st_ms, en_ms = True, s, e
        if not ok:
            continue
        # a stop-only closure on some other stop of the line is not about Jared's stop: keep it but rank it lower
        match = (not stops) or bool(stops & pins)
        out.append({"id": a.get("id"), "lines": sorted(lines), "header": str(a.get("headerText") or "")[:80], "text": first_sentence(a.get("descriptionText") or a.get("headerText")),
                    "effect": a.get("effect"), "cause": a.get("cause"), "start": st_ms, "end": en_ms, "stops": sorted(stops), "at_my_stop": match and bool(stops & pins)})
    return {"at": time.time(), "list": out}


def umo_stops():
    return [c for c in (S["static"].get("city") or {}).get("stops", [])]


def fetch_umo():
    stops = umo_stops()
    if not stops:
        raise RuntimeError("no CityLine stops yet")
    q = "&".join("stops=" + urllib.parse.quote("%s|%s" % (c["route"], c["stop_tag"])) for c in stops)
    d = json.loads(http_get("%s?command=predictionsForMultiStops&a=%s&%s" % (UMO, UMO_AGENCY, q), timeout=25))
    preds = collections.defaultdict(list)
    plist = d.get("predictions") or []
    plist = plist if isinstance(plist, list) else [plist]
    for p in plist:
        key = "%s:%s" % (p.get("routeTag"), p.get("stopTag"))
        dirs = p.get("direction") or []
        dirs = dirs if isinstance(dirs, list) else [dirs]
        for dr in dirs:
            pr = dr.get("prediction") or []
            for x in (pr if isinstance(pr, list) else [pr]):
                try:
                    preds[key].append([int(x["epochTime"]), str(x.get("tripTag") or x.get("vehicle") or ""), str(x.get("vehicle") or "")])
                except Exception:
                    pass
    v = json.loads(http_get("%s?command=vehicleLocations&a=%s&t=0" % (UMO, UMO_AGENCY), timeout=25))
    veh = []
    vl = v.get("vehicle") or []
    for x in (vl if isinstance(vl, list) else [vl]):
        try:
            if x.get("routeTag") not in [r[0] for r in CITY_ROUTES]:
                continue
            lat, lon = float(x["lat"]), float(x["lon"])
            ft = hav_ft(lat, lon)
            if ft <= VEH_MAX_FT:
                veh.append({"id": "w" + str(x.get("id")), "line": "CityLine", "agency": "weho", "direction": str(x.get("dirTag") or ""), "lat": lat, "lng": lon,
                            "bearing": int(float(x.get("heading"))) if x.get("heading") not in (None, "") else None, "mph": round(float(x.get("speedKmHr") or 0) * 0.621371, 1),
                            "dist_ft": int(ft), "trip_id": None, "occ": None})
        except Exception:
            pass
    return {"at": time.time(), "preds": {k: sorted(v) for k, v in preds.items()}, "veh": veh}


def poll_feed(name, fn, every):
    ok_at = 0
    while True:
        try:
            r = fn()
            r.update(err=None, fails=0)
            with LOCK:
                S[name].update(r)
            ok_at = time.time()
            time.sleep(every)
        except Exception as e:
            with LOCK:
                S[name]["fails"] = S[name].get("fails", 0) + 1
                S[name]["err"] = (type(e).__name__ + ": " + str(e))[:140]
            wait = min(300, every * (2 ** min(S[name]["fails"], 4)))
            log("%s poll failed (%s), retry in %ds" % (name, S[name]["err"], wait))
            time.sleep(wait)


# ---------------- snapshot ----------------
def build_snapshot():
    now_ms = int(time.time() * 1000)
    with LOCK:
        st, rt, veh, alr, umo = S["static"], dict(S["rt"]), dict(S["veh"]), dict(S["alr"]), dict(S["umo"])
        sst = dict(S["static_state"])
    rt_ok = bool(rt.get("at")) and time.time() - rt["at"] < STALE_S and not rt.get("err")
    veh_ok = bool(veh.get("at")) and time.time() - veh["at"] < STALE_S
    alr_ok = bool(alr.get("at")) and time.time() - alr["at"] < 900
    umo_ok = bool(umo.get("at")) and time.time() - umo["at"] < STALE_S
    walk = st.get("walk", {})
    occ_by_trip = {v["trip_id"]: v["occ"] for v in veh.get("list", []) if v.get("trip_id") and v.get("occ")}
    lines = []

    def add(line, agency, name, color, direction, headsign, toward, sid, stop, lat, lon, wkey, pairs, live_row, source, approx, note, stale, did=None):
        ft = hav_ft(lat, lon)
        w = walk.get(wkey) or {}
        wm = int(w.get("min") or walk_est(ft))
        pairs = sorted([p for p in pairs if p[0] > now_ms - 30000], key=lambda p: p[0])
        arr = []
        for e, lf, tid in pairs[:4]:
            a = {"eta": e, "mins": max(0, int(math.ceil((e - now_ms) / 60000.0))), "live": bool(lf), "trip": tid}
            if lf and occ_by_trip.get(tid):
                a["occ"] = occ_by_trip[tid]
            arr.append(a)
        lv = [p[0] - wm * 60000 for p in pairs if p[0] - wm * 60000 >= now_ms]
        nt = note
        if ft > 5280:
            nt = ((note + " ") if note else "") + "Nearest stop is %.1f mi from home (about %d min walk)." % (ft / 5280.0, wm)
        lines.append({"line": line, "agency": agency, "name": name, "color": color, "text_color": "#FFFFFF", "direction": direction, "headsign": headsign,
                      "toward": toward, "stop_id": sid, "stop": stop, "stop_lat": lat, "stop_lon": lon, "walk_min": wm, "walk_ft": int(w.get("ft") or ft * 1.3),
                      "walk_src": w.get("src") or "est", "dist_ft": int(ft), "arrivals": arr, "leave_by": min(lv) if lv else None,
                      "live": any(a["live"] for a in arr), "source": source, "approx": approx, "note": nt, "updated_at": now_ms, "stale": stale, "dir_id": did})

    def toward_text(ln, dinfo):
        hs = dinfo.get("headsign") or ""
        if ln == "105":
            return "LAX trips" if dinfo.get("card") == "Southbound" else ""
        return ("Toward " + hs)[:80] if hs else ""

    msrc = st.get("metro") or {}
    for ln in METRO_LINES:
        L = (msrc.get("lines") or {}).get(ln)
        if not L:
            continue
        for d, v in sorted(L["dirs"].items()):
            sched = sched_times(msrc, v, now_ms)
            live = sorted((e, t) for e, t in (rt.get("etas", {}).get((ln, d)) or []) if e > now_ms - 30000) if rt_ok else []
            live_ids = {t for _, t in live}
            pairs = [(e, True, t) for e, t in live]
            for e, t in sched:
                base = t.split("@")[0]
                if rt_ok and (base in live_ids or e < now_ms + 1800000):
                    continue
                pairs.append((e, False, base))
            add(ln, "metro", "Metro " + ln, METRO_COLOR, v["card"], v.get("headsign", ""), toward_text(ln, v), v["stop_id"], v["stop"], v["lat"], v["lon"],
                "metro:" + v["stop_id"], pairs, rt_ok, "swiftly" if rt_ok else "gtfs", False,
                None if rt_ok else "Live feed unavailable, showing the printed schedule.", not rt_ok, d)
    dsrc = st.get("dash") or {}
    DL = (dsrc.get("lines") or {}).get("DASH")
    if DL:
        for d, v in sorted(DL["dirs"].items()):
            pairs = [(e, False, t.split("@")[0]) for e, t in sched_times(dsrc, v, now_ms)]
            add("DASH", "ladot", "DASH Fairfax", "#" + (DL.get("gtfs_color") or DASH_COLOR.lstrip("#")).lstrip("#"), v["card"], v.get("headsign", ""), "",
                v["stop_id"], v["stop"], v["lat"], v["lon"], "dash:" + v["stop_id"], pairs, False, "gtfs", False, "Printed schedule. LADOT has no free live feed.", False)
    for c in umo_stops():
        k = c["key"]
        live = [(e, True, t) for e, t, _ in (umo.get("preds", {}).get(k) or []) if e > now_ms - 30000] if umo_ok else []
        pairs = list(live)
        note = None
        if c["route"] == "HHL":
            for e in city_times(now_ms):
                if not any(abs(e - le) < 6 * 60000 for le, _, _ in live):
                    pairs.append((e, False, "s%d" % (e // 60000)))
            if not live:
                note = "Printed commuter schedule; live tracking shows nothing right now."
        elif not live:
            continue
        if not pairs:
            continue
        add("CityLine", "weho", "WeHo CityLine", CITY_COLOR, c["direction"], "", c["toward"], c["stop_tag"], c["stop"], c["lat"], c["lon"], "weho:" + k, pairs, umo_ok,
            "umo" if live else "weho-schedule", not live, note, not umo_ok)
        lines[-1]["variant"] = c["variant"]
    lines.sort(key=lambda r: (ORDER.get(r["line"], 9), r["direction"]))

    def src(ok, at, err):
        if ok:
            return {"status": "ok", "ok_s": int(time.time() - at), "note": None}
        return {"status": "failing" if at else "setup", "ok_s": int(time.time() - at) if at else None, "note": err}
    sources = {"collector": {"status": "ok", "ok_s": 0, "note": None}, "metro_trips": src(rt_ok, rt.get("at"), rt.get("err")),
               "metro_vehicles": src(veh_ok, veh.get("at"), veh.get("err")), "metro_alerts": src(alr_ok, alr.get("at"), alr.get("err")),
               "cityline": src(umo_ok, umo.get("at"), umo.get("err"))}
    for k, v in sst.items():
        sources[k] = {"status": "ok" if v.get("ok") else "failing", "ok_s": int(time.time() - v["at"]) if v.get("at") else None, "note": v.get("err")}
    alerts = sorted(alr.get("list", []), key=lambda a: (not a.get("at_my_stop"), SEV.get(a.get("effect"), 9)))
    best = alerts[0] if alerts else None
    card_alert = None
    if best and alr_ok:
        card_alert = {"line": best["lines"][0], "lines": best["lines"], "effect": best["effect"], "text": best["text"], "id": best["id"],
                      "label": "Line %s: %s" % (best["lines"][0], best["text"]) if len(best["lines"]) == 1 else "Lines %s: %s" % (" and ".join(best["lines"]), best["text"])}
    vehicles = []
    if veh_ok:
        etas_by_trip = {}
        for (ln, d), lst in rt.get("etas", {}).items():
            for e, t in lst:
                etas_by_trip[t] = (e, d)
        for x in veh.get("list", []):
            y = dict(x)
            if x.get("trip_id") in etas_by_trip:
                y["stop_eta"] = etas_by_trip[x["trip_id"]][0]
            y["at"] = int(veh["at"] * 1000)
            vehicles.append(y)
    if umo_ok:
        vehicles += [dict(x, at=int(umo["at"] * 1000)) for x in umo.get("veh", [])]
    routes = {"%s:%s" % (ln, d): v["shape"] for ln, L in (msrc.get("lines") or {}).items() for d, v in L["dirs"].items() if v.get("shape")}
    walks = {k: {"min": v.get("min"), "ft": v.get("ft"), "src": v.get("src"), "geom": v.get("geom", [])} for k, v in walk.items()}
    return {"at": now_ms, "home": [HOME_LAT, HOME_LON], "rev": 2, "metro_live": rt_ok, "cityline_live": umo_ok, "occupancy": bool(veh.get("occ")),
            "sources": sources, "lines": lines, "vehicles": vehicles, "alerts": [dict(a) for a in alerts], "alert": card_alert, "walks": walks, "routes": routes}


def snapshot_cached():
    with LOCK:
        if S["snap"] and time.time() - S["snap_at"] < 3:
            return S["snap"]
    s = build_snapshot()
    with LOCK:
        S["snap"], S["snap_at"] = s, time.time()
    return s


def health():
    now = time.time()
    with LOCK:
        rt, veh, alr, umo = S["rt"], S["veh"], S["alr"], S["umo"]
        sst = dict(S["static_state"])
        st = S["static"]
    starts = [t for t in load_json(os.path.join(DIR, "starts.json"), []) if now - t < 3600]
    age = lambda d: int(now - d["at"]) if d.get("at") else None
    walk = st.get("walk", {})
    return {"at": int(now), "cycle_age_s": int(now - S["cycle_at"]), "metro_trips_age_s": age(rt), "metro_trips_err": rt.get("err"),
            "metro_veh_age_s": age(veh), "metro_veh_err": veh.get("err"), "metro_alerts_age_s": age(alr), "metro_alerts_err": alr.get("err"),
            "cityline_age_s": age(umo), "cityline_err": umo.get("err"),
            "static": {k: {"ok": v.get("ok"), "age_h": round((now - v["at"]) / 3600, 1) if v.get("at") else None, "err": v.get("err")} for k, v in sst.items()},
            "static_age_d": round((now - st.get("built_at", 0)) / 86400, 1) if st.get("built_at") else None,
            "walks_osm": sum(1 for w in walk.values() if w.get("src") == "osm"), "walks_est": sum(1 for w in walk.values() if w.get("src") != "osm"),
            "starts_1h": len(starts), "ingest": "off", "static_ready": bool(static_ok(st)), "occupancy": bool(veh.get("occ")), "heals": S["heal"][-5:],
            "dir_ok": os.path.isdir(DIR)}


class H(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self):
        p = self.path.split("?")[0]
        try:
            if p in ("/bus.json", "/bus", "/"):
                self._send(200, snapshot_cached())
            elif p == "/health":
                self._send(200, health())
            else:
                self._send(404, {"error": "not found"})
        except Exception as e:
            self._send(500, {"error": str(e)[:200]})

    def log_message(self, *a):
        pass


def cycle_loop():
    n = 0
    while True:
        try:
            ensure_dir()
            s = snapshot_cached()
            S["cycle_at"] = time.time()
            n += 1
            if n % 5 == 1:
                save_json(os.path.join(DIR, "snapshot.json"), s)
        except Exception as e:
            log("cycle error: %s" % e)
        time.sleep(5)


def main():
    ensure_dir()
    S["static"] = load_json(os.path.join(DIR, "static.json"), {}) or {}
    starts = [t for t in load_json(os.path.join(DIR, "starts.json"), []) if time.time() - t < 86400] + [time.time()]
    save_json(os.path.join(DIR, "starts.json"), starts)
    for name, fn, every in (("rt", fetch_trips, POLL_S), ("veh", fetch_vehicles, POLL_S), ("alr", fetch_alerts, 120), ("umo", fetch_umo, 30)):
        threading.Thread(target=poll_feed, args=(name, fn, every), daemon=True).start()
    threading.Thread(target=static_loop, daemon=True).start()
    threading.Thread(target=cycle_loop, daemon=True).start()
    ThreadingHTTPServer.daemon_threads = True
    log("bus collector v2 on :%d, data %s" % (PORT, DIR))
    ThreadingHTTPServer(("0.0.0.0", PORT), H).serve_forever()


if __name__ == "__main__":
    if "--rebuild-static" in sys.argv:
        ensure_dir()
        S["static"] = load_json(os.path.join(DIR, "static.json"), {}) or {}
        build_static_all(force=True)
        print("ok", static_ok(S["static"]))
    else:
        main()
