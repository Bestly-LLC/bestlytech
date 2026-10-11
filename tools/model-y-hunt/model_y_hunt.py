"""Model Y Hunter: daily 7:57 AM scan for a used Tesla Model Y (bestly-pi, free).

Installed as /opt/bestly/cron/jobs/model_y_hunt.py; run by /opt/bestly/cron/run.sh model_y_hunt (heartbeat via runjob.py).
Replaces the Claude scheduled task "Used Model Y FSD Hunt" (trig_01DAVaR3LQHduUdgj6SYuDkh, left disabled as the fallback).

Jared's criteria (all required; numbers come from model_y_settings):
  * Tesla Model Y, used, any trim.
  * Full Self-Driving PURCHASED and attached. Rejected: subscription, trial, Autopilot only, EAP, "FSD-ready", "FSD capable
    hardware", vague "self-driving" wording.
  * HW4 / AI4 only. 2024+ model year = HW4. 2023 only when the listing itself says HW4/AI4. 2022 and older = HW3, rejected.
  * Price at or under max_price ($30,000). Within about radius_mi (100 mi) of West Hollywood 90069.
  * Report NEW listings only (and price drops on listings already told). The seen log is the model_y_seen table (60 days).

Sources reachable from the Pi without a login or a browser (public pages, politely: one request at a time, a pause between
requests, normal User-Agent, nothing that needs a challenge solved):
  * Find My Electric: its public listings sitemap, then each Model Y detail page (structured fields incl. Autopilot Software / Hardware).
  * Craigslist: the same search JSON the site's own page uses (areas LA, OC, Inland Empire, Ventura, San Diego), then the posting page.
Not reachable from the Pi without a browser or a challenge (403, Cloudflare/Akamai challenge, or empty shell): Tesla used
inventory, CarGurus, Autotrader, Cars.com, Carvana, CarMax, TrueCar, Edmunds, eBay, Autolist, OfferUp, Facebook Marketplace.
They are not worked around; the summary says so every run.

FSD proof grade: CONFIRMED only when the listing text itself says FSD was purchased/paid for/owned (the quote must appear
verbatim in the listing); LIKELY when the listing claims FSD (a field or a sentence) with no purchase wording ("verify with seller").
Anything else is excluded. The free AI only reads free text; code re-checks every quote it cites and can only make the grade stricter
(a subscription/trial/capable-only reading from either the rules or the AI rejects the listing).

Flags: --dry (read only: no log writes, no notification, no heartbeat), --limit N (cap detail fetches per source, default 40).
"""
import html
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date

import lib  # noqa: E402  (/opt/bestly/cron/lib.py)

try:  # the free AI ladder; the job still works (rules only) when it cannot be imported
    import freellm  # noqa: E402
except Exception:  # noqa: BLE001
    freellm = None

JOB = "model_y_hunt"
SLUG = "model-y-hunt"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) "
      "Version/17.0 Safari/605.1.15")
HOME = (34.0900, -118.3617)  # West Hollywood 90069
STATE_DIR = "/opt/bestly/cron/state"
GEO_CACHE = os.path.join(STATE_DIR, "model_y_geo.json")
GAP = 2.0  # seconds between requests to the same site

BLOCKED_NOTE = ("not reachable from the Pi without a browser: Tesla inventory, CarGurus, Autotrader, Cars.com, Carvana, CarMax, "
                "TrueCar, Edmunds, eBay, Autolist, OfferUp, Facebook Marketplace")

# Craigslist area ids (the batch parameter of its search JSON) and the host each posting lives on.
CL_AREAS = [("losangeles", 7), ("orangecounty", 103), ("inlandempire", 104), ("ventura", 208), ("sandiego", 8)]
CL_CATS = {145: "cto", 146: "ctd"}

# ---------------------------------------------------------------------------------------------- places (straight-line miles)
CITIES = {  # (lat, lon). Southern California and the edges of a ~100 mi circle around West Hollywood.
    "los angeles": (34.05, -118.24), "west hollywood": (34.09, -118.36), "beverly hills": (34.07, -118.40), "hollywood": (34.10, -118.33),
    "santa monica": (34.02, -118.49), "culver city": (34.02, -118.40), "burbank": (34.18, -118.31), "glendale": (34.14, -118.26),
    "pasadena": (34.15, -118.14), "long beach": (33.77, -118.19), "torrance": (33.84, -118.34), "inglewood": (33.96, -118.35),
    "hawthorne": (33.92, -118.35), "el segundo": (33.92, -118.42), "compton": (33.90, -118.22), "downey": (33.94, -118.13),
    "norwalk": (33.90, -118.08), "whittier": (33.98, -118.03), "pomona": (34.06, -117.75), "covina": (34.09, -117.89),
    "west covina": (34.07, -117.94), "el monte": (34.07, -118.03), "south el monte": (34.05, -118.05), "rosemead": (34.08, -118.07),
    "alhambra": (34.10, -118.13), "monterey park": (34.06, -118.12), "san gabriel": (34.10, -118.11), "arcadia": (34.14, -118.04),
    "monrovia": (34.15, -118.00), "azusa": (34.13, -117.91), "glendora": (34.14, -117.87), "claremont": (34.10, -117.72),
    "diamond bar": (34.03, -117.81), "walnut": (34.02, -117.87), "city of industry": (34.02, -117.96), "van nuys": (34.19, -118.45),
    "sherman oaks": (34.15, -118.45), "encino": (34.16, -118.50), "woodland hills": (34.17, -118.60), "northridge": (34.23, -118.54),
    "chatsworth": (34.26, -118.60), "north hollywood": (34.17, -118.38), "studio city": (34.14, -118.40), "valley village": (34.16, -118.39),
    "reseda": (34.20, -118.54), "canoga park": (34.20, -118.60), "san fernando": (34.28, -118.44), "sylmar": (34.31, -118.45),
    "santa clarita": (34.39, -118.54), "valencia": (34.44, -118.60), "palmdale": (34.58, -118.12), "lancaster": (34.70, -118.14),
    "calabasas": (34.14, -118.66), "malibu": (34.03, -118.78), "manhattan beach": (33.88, -118.41), "redondo beach": (33.85, -118.39),
    "gardena": (33.89, -118.31), "carson": (33.83, -118.28), "lakewood": (33.85, -118.13), "cerritos": (33.86, -118.06),
    "bellflower": (33.88, -118.12), "paramount": (33.89, -118.16), "south gate": (33.95, -118.21), "huntington park": (33.98, -118.23),
    "vernon": (34.00, -118.23), "montebello": (34.01, -118.11), "commerce": (34.00, -118.16), "baldwin park": (34.09, -117.96),
    "irwindale": (34.11, -117.93), "la puente": (34.02, -117.95), "hacienda heights": (33.99, -117.97), "rowland heights": (33.98, -117.91),
    "temple city": (34.11, -118.06), "altadena": (34.19, -118.13), "eagle rock": (34.14, -118.21), "lynwood": (33.93, -118.21),
    "santa fe springs": (33.95, -118.08), "pico rivera": (33.98, -118.10), "wilmington": (33.78, -118.26), "san pedro": (33.74, -118.29),
    "marina del rey": (33.98, -118.45), "venice": (33.99, -118.47), "anaheim": (33.84, -117.91), "santa ana": (33.75, -117.87),
    "irvine": (33.68, -117.83), "orange": (33.79, -117.85), "fullerton": (33.87, -117.92), "garden grove": (33.77, -117.94),
    "huntington beach": (33.66, -118.00), "costa mesa": (33.64, -117.92), "newport beach": (33.62, -117.93), "fountain valley": (33.71, -117.95),
    "westminster": (33.76, -117.99), "buena park": (33.87, -118.00), "la habra": (33.93, -117.95), "brea": (33.92, -117.90),
    "yorba linda": (33.89, -117.81), "tustin": (33.74, -117.83), "mission viejo": (33.60, -117.67), "lake forest": (33.65, -117.69),
    "laguna niguel": (33.52, -117.71), "laguna beach": (33.54, -117.78), "san clemente": (33.43, -117.61), "dana point": (33.47, -117.70),
    "san juan capistrano": (33.50, -117.66), "aliso viejo": (33.57, -117.73), "cypress": (33.82, -118.04), "placentia": (33.87, -117.87),
    "seal beach": (33.74, -118.10), "rancho santa margarita": (33.64, -117.60), "riverside": (33.95, -117.40),
    "san bernardino": (34.11, -117.29), "ontario": (34.06, -117.65), "rancho cucamonga": (34.11, -117.59), "fontana": (34.09, -117.43),
    "corona": (33.88, -117.57), "norco": (33.93, -117.55), "eastvale": (33.96, -117.58), "moreno valley": (33.94, -117.23),
    "upland": (34.10, -117.65), "chino": (34.01, -117.69), "chino hills": (33.99, -117.76), "montclair": (34.08, -117.69),
    "redlands": (34.06, -117.18), "colton": (34.07, -117.31), "rialto": (34.11, -117.37), "jurupa valley": (34.00, -117.47),
    "temecula": (33.49, -117.15), "murrieta": (33.55, -117.21), "menifee": (33.68, -117.19), "perris": (33.78, -117.23),
    "lake elsinore": (33.67, -117.33), "hemet": (33.75, -116.97), "beaumont": (33.93, -116.98), "yucaipa": (34.03, -117.04),
    "highland": (34.13, -117.21), "loma linda": (34.05, -117.26), "apple valley": (34.50, -117.19), "victorville": (34.54, -117.29),
    "hesperia": (34.43, -117.30), "palm springs": (33.83, -116.55), "ventura": (34.28, -119.29), "oxnard": (34.20, -119.18),
    "camarillo": (34.22, -119.04), "thousand oaks": (34.17, -118.84), "simi valley": (34.27, -118.78), "moorpark": (34.29, -118.88),
    "westlake village": (34.15, -118.81), "agoura hills": (34.15, -118.76), "santa paula": (34.35, -119.06), "port hueneme": (34.15, -119.19),
    "oceanside": (33.20, -117.38), "carlsbad": (33.16, -117.35), "vista": (33.20, -117.24), "san marcos": (33.14, -117.17),
    "escondido": (33.12, -117.09), "encinitas": (33.04, -117.29), "solana beach": (32.99, -117.27), "fallbrook": (33.38, -117.25),
    "santa barbara": (34.42, -119.70), "san diego": (32.72, -117.16), "bakersfield": (35.37, -119.02), "las vegas": (36.17, -115.14),
}


def haversine_mi(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 3958.8 * 2 * math.asin(math.sqrt(h))


def _load_geo():
    try:
        with open(GEO_CACHE) as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return {}


def _save_geo(g):
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(GEO_CACHE, "w") as f:
            json.dump(g, f)
    except Exception:  # noqa: BLE001
        pass


_geo = None


def city_point(city, state, allow_net=True):
    """(lat, lon) for a city, from the built-in table, then the cache, then one polite OpenStreetMap lookup. None if unknown."""
    global _geo
    c = re.sub(r"\s+", " ", (city or "").strip().lower())
    if not c:
        return None
    if (state or "").strip().lower() in ("ca", "california", "") and c in CITIES:
        return CITIES[c]
    if _geo is None:
        _geo = _load_geo()
    key = c + "|" + (state or "").strip().lower()
    if key in _geo:
        return tuple(_geo[key]) if _geo[key] else None
    if not allow_net or not state:
        return None
    try:
        time.sleep(1.1)  # OpenStreetMap asks for at most one request per second and an identifying agent
        q = urllib.parse.urlencode({"city": city, "state": state, "country": "US", "format": "json", "limit": 1})
        req = urllib.request.Request("https://nominatim.openstreetmap.org/search?" + q,
                                     headers={"User-Agent": "bestly-pi-cron/1.0 (+https://bestly.tech; model-y-hunt)"})
        with urllib.request.urlopen(req, timeout=20) as r:
            j = json.load(r)
        _geo[key] = [float(j[0]["lat"]), float(j[0]["lon"])] if j else None
    except Exception:  # noqa: BLE001
        return None
    _save_geo(_geo)
    return tuple(_geo[key]) if _geo.get(key) else None


# ---------------------------------------------------------------------------------------------- http
_last = {}


def http_get(url, headers=None, tries=3, timeout=40, gap=GAP):
    host = urllib.parse.urlparse(url).netloc
    last = None
    for attempt in range(tries):
        wait = gap - (time.time() - _last.get(host, 0))
        if wait > 0:
            time.sleep(wait)
        _last[host] = time.time()
        try:
            h = {"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"}
            h.update(headers or {})
            with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (403, 404, 406, 410):  # a refusal is final: never retried, never worked around
                raise
            time.sleep(2 ** attempt)
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 ** attempt)
    raise last


def log(msg):
    print("  " + msg, flush=True)


# ---------------------------------------------------------------------------------------------- reading listing text
def squash(s):
    return re.sub(r"\s+", " ", html.unescape(s or "")).strip()


def strip_tags(h):
    h = re.sub(r"(?is)<(script|style).*?</\1>", " ", h or "")
    return squash(re.sub(r"<[^>]+>", " ", h))


def to_int(s):
    d = re.sub(r"[^\d]", "", s or "")
    return int(d) if d else None


FSD_WORD = re.compile(r"\b(?:fsd|full[\s-]*self[\s-]*driving)\b", re.I)
FSD_NEG = re.compile(
    r"\b(?:subscri\w*|trial|monthly|per month|/\s*mo\b|rental|"
    r"(?:fsd|full[\s-]*self[\s-]*driving|self[\s-]*driving)[\s-]*(?:capable|capability|ready|hardware|computer)|"
    r"(?:capable|ready)[\s-]*(?:of|for)[\s-]*(?:fsd|full[\s-]*self)|"
    r"(?:no|not|without|lacks?|missing|never had|doesn'?t have|does not have)\s+(?:\w+\s+){0,2}(?:fsd|full[\s-]*self)|"
    r"(?:fsd|full[\s-]*self[\s-]*driving)\s+(?:is\s+)?(?:not|n'?t)\s+(?:included|transferr?\w*|available)|"
    r"eap|enhanced autopilot|autopilot only|basic autopilot)\b", re.I)
FSD_BUY = re.compile(r"\b(?:purchas\w*|paid|pay(?:ed|ment)? in full|bought|owned|own\b|included|comes? with|one[\s-]*time|lifetime|"
                     r"permanent|fully paid|paid[\s-]*off|\$\s*\d{1,2},?\d{3})\b", re.I)
HW4_YES = re.compile(r"\b(?:hw\s?-?4|ai\s?-?4|hardware\s?4|hw\s?4\.0|4\.0\s*(?:hw|hardware)|ap4)\b", re.I)
HW3_NO = re.compile(r"\b(?:hw\s?-?3|ai\s?-?3|hardware\s?3|hw\s?3\.0|3\.0\s*\(?hw3?)\b", re.I)


def fsd_from_text(text):
    """Rule reading of free text: ('none'|'claimed'|'rejected', purchase_wording_bool, quote)."""
    t = squash(text)
    found = None
    for m in FSD_WORD.finditer(t):
        a, b = max(0, m.start() - 70), min(len(t), m.end() + 70)
        win = t[a:b]
        near = t[max(0, m.start() - 40):min(len(t), m.end() + 40)]
        if FSD_NEG.search(near):
            return "rejected", False, win
        if found is None:
            found = (win, bool(FSD_BUY.search(near)))
    if found:
        return "claimed", found[1], found[0]
    return "none", False, ""


def hw4_from_text(text):
    t = squash(text)
    m = HW4_YES.search(t)
    if m and not HW3_NO.search(t[max(0, m.start() - 30):m.end() + 30]):
        return t[max(0, m.start() - 40):m.end() + 40]
    return ""


# ---------------------------------------------------------------------------------------------- Find My Electric
FME_SITEMAP_INDEX = "https://www.findmyelectric.com/sitemap_index.xml"
FME_URL = re.compile(r"/listings/(20\d\d)-tesla-model-y[a-z0-9\-]*-(\d+)/?$")


def fme_urls():
    """[(url, id, year)] of Model Y listings (2023 and newer) from the public sitemaps."""
    idx = http_get(FME_SITEMAP_INDEX)
    maps = [u for u in re.findall(r"<loc>([^<]+)</loc>", idx) if "listings-sitemap" in u]
    out = []
    for sm in maps:
        try:
            x = http_get(sm, gap=1.0)
        except Exception as e:  # noqa: BLE001
            log("fme sitemap failed: " + sm.rsplit("/", 1)[-1] + " " + type(e).__name__)
            continue
        for u in re.findall(r"<loc>([^<]+)</loc>", x):
            m = FME_URL.search(u)
            if m and int(m.group(1)) >= 2023:
                out.append((u, m.group(2), int(m.group(1))))
    return sorted(set(out), key=lambda t: -int(t[1]))  # newest listing ids first


def _fme_field(h, label):
    m = re.search(r'label-td">\s*(?:<i[^>]*></i>)?\s*' + re.escape(label) + r'\s*</td>\s*<td class="heading-font">\s*(.*?)\s*</td>', h, re.S)
    return squash(re.sub(r"<[^>]+>", "", m.group(1))) if m else None


def fme_parse(h):
    price = re.search(r'single-regular-price.*?<span class="h3">(.*?)</span>', h, re.S)
    desc = re.search(r'Vehicle Description</div>\s*</div>\s*(.*?)(?:</div>|\Z)', h, re.S)
    vd = h.find("Vehicle Description")
    fs = h.rfind("Features", 0, vd) if vd > 0 else -1
    feats = re.findall(r"<li>([^<]{2,80})</li>", h[fs:vd]) if fs >= 0 else []
    trim = _fme_field(h, "Model Specific Trim") or ""
    return {
        "year": to_int(_fme_field(h, "Year")), "trim": trim, "price": to_int(price.group(1)) if price else None,
        "miles": to_int(_fme_field(h, "Mileage")), "city": _fme_field(h, "City"), "state": _fme_field(h, "State"),
        "vin": (_fme_field(h, "VIN") or "").upper() or None,
        "software": _fme_field(h, "Autopilot Software") or "", "hardware": _fme_field(h, "Autopilot Hardware") or "",
        "seller": _fme_field(h, "Seller Type") or "", "title_type": _fme_field(h, "Title Type") or "",
        "desc": strip_tags(desc.group(1)) if desc else "", "features": [squash(f) for f in feats],
        "sold": bool(re.search(r"\bSOLD\b|no longer available|listing has been removed", strip_tags(h[:20000]), re.I)),
    }


# ---------------------------------------------------------------------------------------------- Craigslist
def cl_search(area, batch, max_price, min_year=2023):
    q = urllib.parse.urlencode({"batch": "%d-0-360-0-0" % batch, "cc": "US", "lang": "en", "searchPath": "cta",
                                "query": "tesla model y", "max_price": max_price, "min_auto_year": min_year})
    raw = http_get("https://sapi.craigslist.org/web/v8/postings/search/full?" + q,
                   headers={"Referer": "https://%s.craigslist.org/" % area, "Accept": "application/json"})
    return cl_items(json.loads(raw).get("data") or {})


def cl_items(d):
    """Decode Craigslist's compact search rows into dicts (id, price, miles, title, lat, lon, url, slug)."""
    dec = d.get("decode") or {}
    locs = dec.get("locations") or []
    base = dec.get("minPostingId") or 0
    out = []
    for it in d.get("items") or []:
        try:
            pid = base + it[0]
            cat = CL_CATS.get(it[2])
            if not cat:
                continue
            lat = lon = None
            host, sub = None, None
            m = re.match(r"(\d+):(\d+)~(-?[\d.]+)~(-?[\d.]+)", str(it[4]))
            if m:
                li = int(m.group(1))
                lat, lon = float(m.group(3)), float(m.group(4))
                if 0 < li < len(locs):
                    host, sub = locs[li][1], (locs[li][2] if len(locs[li]) > 2 else None)
            slug, miles = None, None
            for e in it[5:]:
                if isinstance(e, list) and e:
                    if e[0] == 6 and len(e) > 1:
                        slug = e[1]
                    elif e[0] == 9 and len(e) > 1 and isinstance(e[1], int):
                        miles = e[1]
            title = it[-1] if isinstance(it[-1], str) else ""
            if not (host and slug):
                continue
            url = "https://%s.craigslist.org/%s%s/d/%s/%d.html" % (host, (sub + "/") if sub else "", cat, slug, pid)
            out.append({"id": str(pid), "price": it[3], "miles": miles, "title": title, "lat": lat, "lon": lon,
                        "url": url, "slug": slug, "cat": cat})
        except Exception:  # noqa: BLE001
            continue
    return out


def cl_detail_parse(h):
    body = re.search(r'<section id="postingbody">(.*?)</section>', h, re.S)
    text = strip_tags(body.group(1)) if body else ""
    text = re.sub(r"QR Code Link to This Post", " ", text)
    vin = re.search(r'auto_vin">\s*<span class="labl">VIN:</span>\s*<span class="valu">([A-Za-z0-9]{11,17})</span>', h)
    odo = re.search(r'auto_miles">\s*<span class="labl">odometer:</span>\s*<span class="valu">([\d,]+)</span>', h)
    year = re.search(r'<span class="valu year">(\d{4})</span>', h)
    title = re.search(r'<span id="titletextonly">(.*?)</span>', h, re.S)
    removed = bool(re.search(r"This posting has been (?:deleted|flagged|expired)|posting has expired", h, re.I))
    return {"text": text, "vin": vin.group(1).upper() if vin else None, "miles": to_int(odo.group(1)) if odo else None,
            "year": int(year.group(1)) if year else None, "title": squash(title.group(1)) if title else "", "gone": removed}


# ---------------------------------------------------------------------------------------------- grading
YEAR_IN_TITLE = re.compile(r"\b(20[12]\d)\b")


def trim_of(text):
    t = (text or "").lower()
    for k, v in (("performance", "Performance"), ("long range", "Long Range"), ("standard range", "Standard Range"),
                 ("premium", "Premium"), ("rwd", "RWD"), ("awd", "AWD")):
        if k in t:
            return v
    return ""


def ai_read(text, deadline=None):
    """Free AI reads the listing and answers strictly; returns dict or None. Quotes are re-checked by the caller."""
    if freellm is None or not text:
        return None
    sys_msg = ("You read one used-car listing and answer in strict JSON, nothing else. Never guess; quote the listing's own words. "
               "fsd_status is exactly one of: purchased (the listing says Full Self-Driving was bought/paid for/owned/included "
               "and is on the car), subscription, trial, capable_only (FSD ready/capable hardware, not purchased), "
               "eap (Enhanced Autopilot), autopilot_only, none (no mention), unclear. hw4 is yes (the listing says HW4/AI4/hardware 4), "
               "no (HW3 or older), or unclear. fsd_quote and hw4_quote are exact substrings of the listing text or an empty string.")
    usr = ('Listing text:\n"""' + text[:3500] + '"""\nReturn {"fsd_status": "...", "fsd_quote": "...", "hw4": "...", "hw4_quote": "..."}')
    try:
        msg, _label = freellm.chat([{"role": "system", "content": sys_msg}, {"role": "user", "content": usr}],
                                   max_tokens=300, deadline=deadline, json_mode=True)
        raw = (msg.get("content") or "").strip()
        m = re.search(r"\{.*\}", raw, re.S)
        return json.loads(m.group(0)) if m else None
    except Exception as e:  # noqa: BLE001
        log("free AI unavailable for one listing: " + type(e).__name__)
        return None


def quote_ok(quote, text):
    q, t = squash(quote).lower(), squash(text).lower()
    return len(q) >= 6 and q in t


def grade(l, cfg, deadline=None):
    """l: dict(year, price, miles, city, state, lat, lon, text, software, hardware, source, vin).
    Returns (verdict, reject_reason, extra) where verdict is 'match' or 'rejected'."""
    extra = {}
    year, price = l.get("year"), l.get("price")
    if not year or year < 2023:
        return "rejected", "year %s is HW3 or older" % (year or "unknown"), extra
    if not price or price <= 0:
        return "rejected", "no price", extra
    if price > cfg["max_price"]:
        return "rejected", "price over $%s" % format(cfg["max_price"], ","), extra

    # --- where
    pt = (l.get("lat"), l.get("lon")) if l.get("lat") is not None else city_point(l.get("city"), l.get("state"))
    if not pt:
        return "rejected", "location unknown (%s, %s)" % (l.get("city"), l.get("state")), extra
    dist = int(round(haversine_mi(HOME, pt)))
    extra["distance_mi"] = dist
    if dist > cfg["radius_mi"] + 5:
        return "rejected", "%d mi away" % dist, extra

    text = squash(" ".join(x for x in (l.get("title"), l.get("text")) if x))

    # --- HW4
    hw_field = l.get("hardware") or ""
    hw_text = hw4_from_text(text + " " + hw_field)
    if re.search(r"\b4(\.0)?\b|ai4|hw4", hw_field, re.I) and not HW3_NO.search(hw_field):
        extra["hw4_evidence"] = "Listing field: Autopilot Hardware = %s" % hw_field
    elif HW3_NO.search(hw_field) or re.search(r"\b3(\.0)?\b", hw_field):
        return "rejected", "listing says %s" % hw_field, extra
    elif hw_text:
        extra["hw4_evidence"] = 'Listing says "%s"' % hw_text
    elif year >= 2024:
        extra["hw4_evidence"] = "%d model year (2024 and newer are HW4)" % year
    else:
        return "rejected", "2023 with no HW4/AI4 evidence in the listing", extra

    # --- FSD
    software = (l.get("software") or "").strip()
    if software.lower() in ("n/a", "na", "unknown", "none", "-", ""):
        software = ""
    status, buy, quote = fsd_from_text(text)
    if status == "rejected":
        return "rejected", "FSD wording is not a purchase: " + quote[:90], extra
    if re.search(r"subscri|trial|capable|ready", software, re.I):
        return "rejected", "listing field says " + software, extra
    field_fsd = bool(re.search(r"full self|fsd", software, re.I))
    if software and not field_fsd:
        return "rejected", "listing field says %s, not FSD" % software, extra
    if not field_fsd and status != "claimed":
        return "rejected", "no FSD claim", extra

    evidence = ("Listing field: Autopilot Software = %s" % software) if field_fsd else ('Listing says "%s"' % quote)
    purchased = bool(buy)
    ai = ai_read(text, deadline) if text else None
    if ai:
        st = str(ai.get("fsd_status") or "").lower()
        if st in ("subscription", "trial", "capable_only", "eap", "autopilot_only") and quote_ok(ai.get("fsd_quote", ""), text):
            return "rejected", "AI read: " + st.replace("_", " ") + " (" + squash(ai.get("fsd_quote", ""))[:70] + ")", extra
        if st == "purchased" and quote_ok(ai.get("fsd_quote", ""), text):
            purchased = True
            evidence = 'Listing says "%s"' % squash(ai["fsd_quote"])[:140]
        if str(ai.get("hw4", "")).lower() == "no" and quote_ok(ai.get("hw4_quote", ""), text):
            return "rejected", "AI read: HW3 (%s)" % squash(ai.get("hw4_quote", ""))[:70], extra
    extra["fsd_grade"] = "CONFIRMED" if purchased else "LIKELY"
    extra["fsd_evidence"] = evidence
    return "match", None, extra


# ---------------------------------------------------------------------------------------------- the run
def save(row, alerted=False):
    p = dict(row)
    p["alerted"] = alerted
    return lib.rpc("model_y_seen_save", p=p)


def row_of(l, verdict, reason, extra):
    return {"key": l["key"], "source": l["source"], "url": l["url"], "vin": l.get("vin"), "year": l.get("year"),
            "trim": l.get("trim"), "price": l.get("price"), "miles": l.get("miles"), "city": l.get("city"), "state": l.get("state"),
            "distance_mi": extra.get("distance_mi"), "hw4_evidence": extra.get("hw4_evidence"), "fsd_grade": extra.get("fsd_grade"),
            "fsd_evidence": extra.get("fsd_evidence"), "verdict": verdict, "reject_reason": reason}


def fme_run(cfg, seen, limit, dry, deadline):
    stats = {"urls": 0, "fetched": 0, "match": 0, "errors": 0}
    matches = []
    try:
        urls = fme_urls()
    except Exception as e:  # noqa: BLE001
        raise RuntimeError("Find My Electric sitemap unreadable: %s" % type(e).__name__)
    stats["urls"] = len(urls)
    todo = []
    for u, lid, year in urls:
        k = "fme:" + lid
        s = seen.get(k)
        if s is None:
            todo.append((u, lid, year, False))
        elif s["verdict"] == "rejected" and (s.get("reject_reason") or "").startswith("price") and s["last_seen"] < str(date.fromordinal(date.today().toordinal() - 2)):
            todo.append((u, lid, year, True))  # a price rejection is worth a second look every few days
        elif s["verdict"] == "match":
            todo.append((u, lid, year, True))  # known matches are re-read for price drops or a sold listing
    for u, lid, year, known in todo[:limit]:
        try:
            h = http_get(u)
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                continue
            stats["errors"] += 1
            continue
        except Exception:  # noqa: BLE001
            stats["errors"] += 1
            continue
        stats["fetched"] += 1
        p = fme_parse(h)
        if p["sold"] or not p["price"]:
            continue
        l = dict(p, key="fme:" + lid, source="findmyelectric", url=u, text=p["desc"] + " " + " ".join(p["features"]),
                 title="%s Tesla Model Y %s" % (p["year"], p["trim"]), software=p["software"], hardware=p["hardware"])
        l["trim"] = p["trim"]
        verdict, reason, extra = grade(l, cfg, deadline)
        record(l, verdict, reason, extra, seen, matches, stats, dry)
    return stats, matches


def cl_run(cfg, seen, limit, dry, deadline):
    stats = {"rows": 0, "fetched": 0, "match": 0, "errors": 0, "areas_ok": 0}
    matches = []
    items = {}
    for area, batch in CL_AREAS:
        try:
            for it in cl_search(area, batch, cfg["max_price"]):
                items.setdefault(it["id"], it)
            stats["areas_ok"] += 1
        except Exception as e:  # noqa: BLE001
            log("craigslist %s failed: %s" % (area, type(e).__name__))
    if not stats["areas_ok"]:
        raise RuntimeError("Craigslist search unreadable in every area")
    # the same car is often posted many times: one row per (title, price, miles)
    uniq = {}
    for it in items.values():
        if not re.search(r"\bmodel\s*y\b", it["title"], re.I):
            continue
        uniq.setdefault((it["slug"], it["price"], it["miles"]), it)
    stats["rows"] = len(uniq)
    todo = []
    for it in uniq.values():
        k = "cl:" + it["id"]
        s = seen.get(k)
        if s is None:
            todo.append(it)
        elif s is not None and (s["verdict"] == "match" or (s["price"] and it["price"] != s["price"])):
            todo.append(it)
    for it in todo[:limit]:
        try:
            h = http_get(it["url"])
        except Exception:  # noqa: BLE001
            stats["errors"] += 1
            continue
        stats["fetched"] += 1
        d = cl_detail_parse(h)
        if d["gone"]:
            continue
        ym = YEAR_IN_TITLE.search(it["title"])
        year = d["year"] or (int(ym.group(1)) if ym else None)
        l = {"key": "cl:" + it["id"], "source": "craigslist", "url": it["url"], "year": year, "trim": trim_of(it["title"] + " " + d["text"]),
             "price": it["price"], "miles": d["miles"] or it["miles"], "city": None, "state": "CA", "lat": it["lat"], "lon": it["lon"],
             "title": it["title"], "text": d["text"], "vin": d["vin"], "software": "", "hardware": ""}
        verdict, reason, extra = grade(l, cfg, deadline)
        record(l, verdict, reason, extra, seen, matches, stats, dry)
    return stats, matches


def record(l, verdict, reason, extra, seen, matches, stats, dry):
    """Write the listing to the seen log and collect it as news if it is a new match, or an already-told match that got cheaper."""
    prior = seen.get(l["key"])
    # the same car under a different key (same VIN): not news a second time
    twin = next((v for k, v in seen.items() if l.get("vin") and v.get("vin") == l["vin"] and k != l["key"] and v.get("alerted")), None)
    news = None
    if verdict == "match":
        if prior is None or not prior.get("alerted"):
            if twin is None:
                news = "new"
        elif prior.get("price") and l["price"] and l["price"] < prior["price"]:
            news = "drop"
        stats["match"] += 1
    if not dry:
        r = save(row_of(l, verdict, reason, extra), alerted=bool(news == "new"))
        if news == "new" and not r.get("new") and prior is None:
            news = "new"
    if news:
        matches.append(dict(l, extra=extra, news=news, old_price=(prior or {}).get("price")))


def line(m):
    e = m["extra"]
    name = ("%s Model Y %s" % (m["year"], m.get("trim") or "")).strip()
    bits = [name, "${:,}".format(m["price"]),
            ("{:,} mi".format(m["miles"]) if m.get("miles") else "mileage not listed"),
            "%s mi from WeHo" % e.get("distance_mi", "?"), "HW4: " + e.get("hw4_evidence", ""),
            "FSD %s: %s" % (e.get("fsd_grade"), e.get("fsd_evidence", ""))]
    if m["news"] == "drop":
        bits.insert(0, "PRICE DROP from ${:,}".format(m["old_price"]))
    if m["source"] == "findmyelectric" and m.get("state"):
        bits.append("%s, %s" % (m.get("city"), m.get("state")))
    bits.append(m["url"])
    return " | ".join(bits)


def main(argv):
    dry = "--dry" in argv
    limit = 40
    if "--limit" in argv:
        limit = int(argv[argv.index("--limit") + 1])
    cfg = lib.rpc("model_y_settings_get") or {"enabled": True, "max_price": 30000, "radius_mi": 100}
    if not cfg.get("enabled", True):
        return "skip: Model Y Hunter is switched off"
    deadline = time.time() + 1500
    seen = {r["key"]: r for r in (lib.rpc("model_y_seen_list", p_days=60) or [])}
    out, errs = [], []
    matches, parts = [], []
    for name, fn in (("fme", fme_run), ("cl", cl_run)):
        try:
            st, mt = fn(cfg, seen, limit, dry, deadline)
            matches += mt
            parts.append("%s %s" % (name, ", ".join("%s %s" % (k, v) for k, v in st.items())))
        except Exception as e:  # noqa: BLE001
            errs.append("%s: %s" % (name, e))
            parts.append("%s FAILED" % name)
    if len(errs) == 2:
        raise RuntimeError("both sources failed: " + "; ".join(errs))
    new = [m for m in matches if m["news"] == "new"]
    drops = [m for m in matches if m["news"] == "drop"]
    if (new or drops) and not dry:
        new.sort(key=lambda m: (m["extra"].get("fsd_grade") != "CONFIRMED", m["price"]))
        top = new[0] if new else None
        body = []
        if top:
            body.append("Best pick: %s %s, $%s, %s mi away, FSD %s." % (
                top["year"], top.get("trim") or "Model Y", format(top["price"], ","), top["extra"].get("distance_mi"), top["extra"].get("fsd_grade")))
        for m in (new + drops)[:6]:
            body.append(line(m))
        body.append("Before buying, confirm FSD on the VIN with Tesla or ask the seller for a screenshot of Software > Additional Upgrades.")
        lib.notify("Model Y Hunter: %d new match%s" % (len(new), "" if len(new) == 1 else "es") + (", %d price drop%s" % (len(drops), "" if len(drops) == 1 else "s") if drops else ""),
                   "\n".join(body), severity="success", push=False, url="/admin/team", dedupe="modely.%s" % date.today().isoformat())
    if not dry:
        try:
            lib.rpc("model_y_seen_prune")
        except Exception:  # noqa: BLE001
            pass
    head = ("%d new match%s" % (len(new), "" if len(new) == 1 else "es")) if (new or drops) else "no new matches"
    if drops:
        head += ", %d price drop%s" % (len(drops), "" if len(drops) == 1 else "s")
    summary = "ok: %s | %s%s | %s" % (head, " | ".join(parts), (" | source trouble: " + "; ".join(errs)) if errs else "", BLOCKED_NOTE)
    if errs:
        summary = summary.replace("ok: ", "partial: ", 1)
    return summary


if __name__ == "__main__":
    print(main(sys.argv[1:]))
