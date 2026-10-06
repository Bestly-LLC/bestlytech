#!/usr/bin/env python3
"""Bake OSM roads for the Bestly Wall sky map -> roads.json (no API key).

Jared item 2 (2026-10-01): dense drivable roads within ~2 mi of home, major roads
(motorway/trunk everywhere, primary within ~8 mi) across the strip view. The Pi
renders roads.json from wall.html (geoRoads); live traffic (TomTom) colors later.

  python3 scripts/wall/roads-bake.py            # writes /tmp/wall-roads.json
  python3 scripts/wall/roads-bake.py -o out.json

Geometry: decimated (~12 m), rounded to 4 dp (~11 m), flat [lat,lon,...] arrays.
Data: (c) OpenStreetMap contributors, ODbL — the wall render carries a credit line.
Regenerate whenever the house/road story changes; upload to /opt/bestly/wall/www/roads.json.
"""
import argparse, json, math, sys, time, urllib.parse, urllib.request

HOME = (34.0835, -118.3698)          # 733 N Kings Rd, West Hollywood (server.py HOME_LAT/LON)
DENSE_MI = 2.2                       # dense bucket is clipped to this radius (spec: 2 mi + soft edge)
DENSE_BOX = (0.035, 0.042)           # lat/lon degrees, >= DENSE_MI so the clip decides the edge
FREEWAY_BOX = (0.36, 0.43)           # ±25 mi: freeways for the widest strip view
ARTERIAL_BOX = (0.10, 0.14)          # ±7 mi: primaries; beyond that only freeways read at zoom
SECONDARY_BOX = (0.06, 0.075)        # ±4 mi: secondary/tertiary for the mid zooms (v2)
MIN_STEP_M = 12                      # drop vertices closer than this to the last kept one
ENDPOINTS = ("https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter")

DENSE_RE = ("motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|"
            "tertiary|tertiary_link|residential|unclassified|living_street|road")


def overpass(query, tries=3):
    body = urllib.parse.urlencode({"data": query}).encode()
    last = ""
    for i in range(tries):
        ep = ENDPOINTS[i % len(ENDPOINTS)]
        try:
            req = urllib.request.Request(ep, data=body, headers={"User-Agent": "bestly-wall-roads-bake/1.0"})
            with urllib.request.urlopen(req, timeout=240) as r:
                return json.load(r)
        except Exception as e:  # noqa: BLE001 - mirror rotation + retry is the whole point
            last = f"{ep}: {e}"
            print(f"  overpass try {i+1} failed ({e}), rotating", file=sys.stderr)
            time.sleep(5 + 5 * i)
    raise SystemExit(f"overpass failed: {last}")


def q(bbox, classes):
    s, w, n, e = bbox
    return (f"[out:json][timeout:180];way[\"highway\"~\"^({classes})$\"]"
            f"({s:.5f},{w:.5f},{n:.5f},{e:.5f});out geom;")


def box(dlat, dlon):
    return (HOME[0] - dlat, HOME[1] - dlon, HOME[0] + dlat, HOME[1] + dlon)


def haversine_m(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    x = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(x))


def way_lines(way, clip_mi=None):
    """Overpass way geometry -> list of flat [lat,lon,...] lines (decimated, rounded, optional clip)."""
    pts = [(p["lat"], p["lon"]) for p in way.get("geometry") or []]
    keep = []
    for p in pts:
        if not keep or haversine_m(keep[-1], p) >= MIN_STEP_M:
            keep.append(p)
    if len(pts) and (not keep or keep[-1] != pts[-1]):
        keep.append(pts[-1])
    if clip_mi:
        lim = clip_mi * 1609.34
        keep = [p for p in keep if haversine_m(HOME, p) <= lim]
    if len(keep) < 2:
        return []
    # split at big jumps (Overpass can hand back unconnected fragments in one way)
    out, cur = [], [keep[0]]
    for p in keep[1:]:
        if haversine_m(cur[-1], p) > 400:
            if len(cur) >= 2:
                out.append(cur)
            cur = [p]
        else:
            cur.append(p)
    if len(cur) >= 2:
        out.append(cur)
    return [[round(v, 4) for xy in line for v in xy] for line in out]


def fetch(label, bbox, classes, clip_mi=None):
    print(f"{label}: querying overpass ...", file=sys.stderr)
    t0 = time.time()
    data = overpass(q(bbox, classes))
    lines = []
    seen = set()
    for el in data.get("elements", []):
        if el.get("type") != "way" or el.get("id") in seen:
            continue
        seen.add(el.get("id"))
        lines.extend(way_lines(el, clip_mi))
    print(f"{label}: {len(seen)} ways -> {len(lines)} lines in {time.time()-t0:.0f}s", file=sys.stderr)
    return lines


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default="/tmp/wall-roads.json")
    a = ap.parse_args()
    dense = fetch("dense", box(*DENSE_BOX), DENSE_RE, clip_mi=DENSE_MI)
    fwy = fetch("freeways", box(*FREEWAY_BOX), "motorway|trunk")
    link = fetch("ramps", box(*ARTERIAL_BOX), "motorway_link|trunk_link")
    art = fetch("arterials", box(*ARTERIAL_BOX), "primary|primary_link")
    sec = fetch("secondary", box(*SECONDARY_BOX), "secondary|tertiary")
    out = {
        "v": 2,
        "home": list(HOME),
        "gen": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()),
        "dense_mi": DENSE_MI,
        "credit": "(c) OpenStreetMap contributors, ODbL",
        "dense": dense,
        "major": fwy + link + art,   # v1 readers
        # v2: one bucket per road class so the wall can thin the map by zoom (Oct 5: "spaghetti" at 25 mi)
        "fwy": fwy, "link": link, "art": art, "sec": sec,
    }
    with open(a.out, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    n = len(dense) + len(fwy) + len(link) + len(art) + len(sec)
    print(f"wrote {a.out}: {n} lines, {len(out['major'])} major / {len(dense)} dense, "
          f"{len(open(a.out,'rb').read())//1024} KiB", file=sys.stderr)


if __name__ == "__main__":
    main()
