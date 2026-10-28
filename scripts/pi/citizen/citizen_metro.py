"""LA Metro service alerts (official GTFS-realtime alerts via Swiftly). Needs a free API key in Vault as lametro_api_key.

The protobuf decoder is dependency-free. Relevance without a static GTFS: an alert counts when its text names a street or
area near home, or its route is in NEAR_ROUTES. Shown only; it pings only while Blue Steel is out on a Turo trip.
"""
import re, time
from citizen_common import *

FEEDS = ("https://api.goswift.ly/real-time/lametro/gtfs-rt-alerts", "https://api.goswift.ly/real-time/lametro-rail/gtfs-rt-alerts")
NEAR_ROUTES = set()
NEAR_WORDS = re.compile(r"west hollywood|weho|santa monica (?:blvd|boulevard)|sunset (?:blvd|boulevard)|la cienega|fairfax|highland|"
                        r"melrose|beverly (?:blvd|boulevard)|hollywood|crescent heights|san vicente|doheny|laurel canyon", re.I)


def varint(b, i):
    r = s = 0
    while True:
        c = b[i]
        i += 1
        r |= (c & 0x7F) << s
        if not c & 0x80:
            return r, i
        s += 7


def fields(b):
    out, i = [], 0
    while i < len(b):
        k, i = varint(b, i)
        f, w = k >> 3, k & 7
        if w == 0:
            v, i = varint(b, i)
        elif w == 2:
            n, i = varint(b, i)
            v, i = b[i:i + n], i + n
        elif w == 1:
            v, i = b[i:i + 8], i + 8
        elif w == 5:
            v, i = b[i:i + 4], i + 4
        else:
            raise ValueError("bad wire type")
        out.append((f, w, v))
    return out


def tstring(b):
    for f, w, v in fields(b):
        if f == 1 and w == 2:
            for f2, w2, v2 in fields(v):
                if f2 == 1 and w2 == 2:
                    return v2.decode("utf-8", "replace")
    return ""


def parse_alerts(buf):
    out = []
    for f, w, v in fields(buf):
        if f != 2 or w != 2:
            continue
        eid, alert = "", None
        for f2, w2, v2 in fields(v):
            if f2 == 1:
                eid = v2.decode("utf-8", "replace")
            elif f2 == 5 and w2 == 2:
                alert = v2
        if alert is None:
            continue
        a = {"id": eid, "header": "", "desc": "", "routes": [], "stops": [], "start": None, "end": None}
        for f3, w3, v3 in fields(alert):
            if f3 == 10:
                a["header"] = tstring(v3)
            elif f3 == 11:
                a["desc"] = tstring(v3)
            elif f3 == 1:
                for f4, w4, v4 in fields(v3):
                    if f4 == 1:
                        a["start"] = v4
                    elif f4 == 2:
                        a["end"] = v4
            elif f3 == 5:
                for f4, w4, v4 in fields(v3):
                    if f4 == 2:
                        a["routes"].append(v4.decode())
                    elif f4 == 5:
                        a["stops"].append(v4.decode())
        out.append(a)
    return out


def alerts_to_items(alerts, out_on_trip, now=None):
    now = now or time.time()
    items = []
    for a in alerts:
        if (a["end"] and a["end"] < now) or (a["start"] and a["start"] > now + 6 * 3600):
            continue
        text = a["header"] + " " + a["desc"]
        if not (NEAR_WORDS.search(text) or any(r in NEAR_ROUTES for r in a["routes"])):
            continue
        t0 = int((a["start"] or now) * 1000)
        lines = ", ".join(sorted(set(a["routes"]))[:3])
        head = clean(a["header"], 90) or "Metro service alert"
        items.append({"key": "metro:" + a["id"], "category": "transit", "title": head, "short": short_text(head),
                      "lat": HOME_LAT, "lng": HOME_LON, "place": "note", "address": "", "level": "moderate", "occurred_ms": t0, "persistent": True,
                      "sub": ("Line %s%s·%s" % (lines, NBSP, NBSP) if lines else "Metro%s·%s" % (NBSP, NBSP)) + t12(t0),
                      "updates": [{"t": t0, "text": clean(a["desc"], 150)}] if a["desc"] else [],
                      "ping": bool(out_on_trip), "ping_force": True})
    return items


def fetch_metro_alerts(key, out_on_trip):
    alerts = []
    for url in FEEDS:
        _, body = http_get(url, BROWSER_UA, {"Authorization": key, "Accept": "application/x-protobuf"}, timeout=30)
        alerts += parse_alerts(body)
    return alerts_to_items(alerts, out_on_trip)
