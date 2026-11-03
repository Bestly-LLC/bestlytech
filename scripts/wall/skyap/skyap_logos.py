"""SKYAP_20261102 - airline logos for the wall sky tags (private wall only).
Source: github.com/Jxck-S/airline-logos (flightaware_logos, then radarbox_logos), keyed by airline ICAO.
Lazy: first sight of a code fetches ONE png (magic bytes + <=200 KB checked), cached in LOGO_DIR/<ICAO>.png.
Misses are remembered 7 days (<ICAO>.none). Max 1 fetch per 2 s. Nothing from the repo is ever executed.
Watchdog key wall.skysync.logos (signed Sky Sync): warning when 80%+ of fetches fail over 15 min or the dir is unwritable."""
import os, re, time, threading, collections, urllib.request, urllib.error

LOGO_DIR = os.environ.get("SKYAP_LOGO_DIR", "/opt/bestly/wall/logos")
BASE = "https://raw.githubusercontent.com/Jxck-S/airline-logos/main/%s/%s.png"
DIRS = ("flightaware_logos", "radarbox_logos")
UA = "BestlyWall/1.0 (+https://bestly.tech; jared@bestly.tech)"
KEY = "wall.skysync.logos"
NEG_TTL = 7 * 86400
MAX_BYTES = 200 * 1024
_lock = threading.Lock()
_last = [0.0]
STATS = collections.deque(maxlen=400)     # (ts, ok) per network attempt; a clean 404 counts as ok
W = {"open": False, "ok_streak": 0}
REPORT = None


def _path(code, ext):
    return os.path.join(LOGO_DIR, code + ext)


def _fetch(code):
    """-> bytes | None (miss) ; raises on network trouble"""
    for d in DIRS:
        try:
            req = urllib.request.Request(BASE % (d, code), headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=6) as r:
                data = r.read(MAX_BYTES + 1)
            if len(data) <= MAX_BYTES and data[:8] == b"\x89PNG\r\n\x1a\n" and len(data) > 100:
                STATS.append((time.time(), True))
                return data
            STATS.append((time.time(), True))
        except urllib.error.HTTPError as e:
            STATS.append((time.time(), e.code < 500 and e.code != 429))
        except Exception:
            STATS.append((time.time(), False))
            raise
    return None


def serve(p):
    """/logos/<ICAO>.png -> (code, bytes, content_type, headers)"""
    m = re.match(r"^/logos/([A-Z]{3})\.png$", p)
    if not m:
        return 404, b'{"error":"bad code"}', "application/json", {}
    code = m.group(1)
    png, neg = _path(code, ".png"), _path(code, ".none")
    try:
        os.makedirs(LOGO_DIR, exist_ok=True)
        if os.path.isfile(png) and os.path.getsize(png) > 100:
            return 200, open(png, "rb").read(), "image/png", {"Cache-Control": "max-age=604800"}
        if os.path.isfile(neg) and time.time() - os.path.getmtime(neg) < NEG_TTL:
            return 404, b'{"error":"no logo"}', "application/json", {}
        with _lock:
            if time.time() - _last[0] < 2.0:                       # 1 fetch / 2 s: the page falls back to the code tile and asks again later
                return 404, b'{"error":"busy"}', "application/json", {"Retry-After": "3"}
            _last[0] = time.time()
        data = _fetch(code)
        if data is None:
            open(neg, "w").close()
            return 404, b'{"error":"no logo"}', "application/json", {}
        open(png + ".tmp", "wb").write(data)
        os.replace(png + ".tmp", png)
        return 200, data, "image/png", {"Cache-Control": "max-age=604800"}
    except Exception:
        return 404, b'{"error":"no logo"}', "application/json", {}


def problems():
    t = time.time()
    p = []
    try:
        os.makedirs(LOGO_DIR, exist_ok=True)
        probe = _path("_probe", ".tmp")
        open(probe, "w").close()
        os.remove(probe)
    except Exception as e:
        p.append("the logo folder is not writable (" + str(e)[:60] + ")")
    rec = [x for x in STATS if t - x[0] < 900]
    bad = sum(1 for x in rec if not x[1])
    if len(rec) >= 5 and bad / len(rec) >= 0.8:
        p.append("logo downloads are failing (%d of %d in 15 minutes); tags show the airline code instead" % (bad, len(rec)))
    return p


def watch_once():
    p = problems()
    if p and not W["open"]:
        W["open"], W["ok_streak"] = True, 0
        if REPORT:
            REPORT(KEY, "problem", "warning", "Sky Sync: airline logos need a look", "; ".join(p) + ".")
    elif p:
        W["ok_streak"] = 0
    elif W["open"]:
        W["ok_streak"] += 1
        if W["ok_streak"] >= 2:
            W["open"] = False
            if REPORT:
                REPORT(KEY, "resolved", "info", "Sky Sync: airline logos are back", "Logo downloads and the logo folder are healthy.")


def _loop():
    time.sleep(45)
    while True:
        try:
            watch_once()
        except Exception as e:
            print("skyap_logos watch:", e, flush=True)
        time.sleep(60)


def start(report=None):
    global REPORT
    REPORT = report
    threading.Thread(target=_loop, daemon=True, name="skyap-logos-watch").start()
