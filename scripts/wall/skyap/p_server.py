#!/usr/bin/env python3
"""SKYAP_20261102 server patcher: aircraft_enrich.py + server.py. Anchored, asserts count==1, ast.parse before writing."""
import ast, sys, shutil, time
ROOT = "/opt/bestly/wall/"
stamp = time.strftime("%Y%m%d-%H%M")

SK = r'''
# ---------------------------------------------------------------- SKYAP_20261102 airports on the sky, landing / taking-off planes, logos
AIRPORTS["ONT"] = ("Ontario International", 34.0560, -117.6012)
SK_RWY = {   # OurAirports threshold pairs: (end name, lat, lon, end name, lat, lon)
    "LAX": [("6L", 33.949119, -118.431187, "24R", 33.952112, -118.401954), ("6R", 33.94682, -118.434693, "24L", 33.95047, -118.399063),
            ("7L", 33.935556, -118.422089, "25R", 33.939881, -118.379794), ("7R", 33.933659, -118.419074, "25L", 33.937371, -118.3827)],
    "BUR": [("8", 34.197918, -118.369165, "26", 34.197654, -118.349982), ("15", 34.212342, -118.360479, "33", 34.193908, -118.355392)],
    "ONT": [("8L", 34.0569, -117.623, "26R", 34.0569, -117.583), ("8R", 34.055, -117.616, "26L", 34.055, -117.583)]}
SK_IATA = {"DAL": "DL", "UAL": "UA", "AAL": "AA", "SWA": "WN", "ASA": "AS", "JBU": "B6", "NKS": "NK", "FFT": "F9", "SKW": "OO",
           "HAL": "HA", "ACA": "AC", "WJA": "WS", "FDX": "FX", "UPS": "5X", "AMX": "AM", "VOI": "Y4", "BAW": "BA", "DLH": "LH",
           "AFR": "AF", "KLM": "KL", "UAE": "EK", "QFA": "QF", "ANA": "NH", "JAL": "JL", "KAL": "KE", "CPA": "CX", "EVA": "BR",
           "SIA": "SQ", "QTR": "QR", "THY": "TK", "VIR": "VS", "AAY": "G4", "MXY": "MX", "SCX": "SY", "RPA": "YX", "ENY": "MQ", "EDV": "9E"}
SK_NAMES = {"LAX": "Los Angeles Intl", "BUR": "Hollywood Burbank", "ONT": "Ontario Intl"}


def _sk_rwy_hdgs(code):
    out = []
    for r in SK_RWY.get(code, []):
        h = bearing_to(r[1], r[2], r[4], r[5])
        out += [h, (h + 180) % 360]
    return out


def sk_phase(live, rt):
    """arr / dep classification. -> {"fz","fa","fm"} or None"""
    alt, vr, trk, gs = live.get("alt"), live.get("vr") or 0, live.get("track"), live.get("gs")
    if alt is None or trk is None or live.get("ground"):
        return None
    la, lo, trk = live["lat"], live["lon"], float(trk)
    mph = max((gs or 0) * 1.15078, 60.0)
    to = ((rt or {}).get("to") or {}).get("iata")
    fr = ((rt or {}).get("from") or {}).get("iata")
    ok_rt = bool(rt) and bool(rt.get("from")) and bool(rt.get("to")) and plausible(live, rt["from"], rt["to"])
    if ok_rt and to in AIRPORTS and vr <= -300 and alt < 10000:
        _n, alat, alon = AIRPORTS[to]
        mi = mi_between(la, lo, alat, alon)
        if mi <= 40 and (mi <= 3 or angdiff(bearing_to(la, lo, alat, alon), trk) <= 75):
            return {"fz": "arr", "fa": to, "fm": max(0, round(mi / mph * 60))}
    if ok_rt and fr in AIRPORTS and vr >= 500:
        _n, alat, alon = AIRPORTS[fr]
        mi = mi_between(la, lo, alat, alon)
        if mi <= 25 and (mi <= 2 or angdiff(bearing_to(alat, alon, la, lo), trk) <= 75):
            return {"fz": "dep", "fa": fr}
    if not ok_rt and alt < 6000:                                   # no usable route: low, close, lined up with a runway
        best = None
        for code, (_n, alat, alon) in AIRPORTS.items():
            mi = mi_between(la, lo, alat, alon)
            if mi <= 12 and (best is None or mi < best[0]):
                best = (mi, code)
        if best and any(angdiff(h, trk) <= 15 for h in _sk_rwy_hdgs(best[1])):
            if vr <= -300:
                return {"fz": "arr", "fa": best[1], "fm": max(0, round(best[0] / mph * 60))}
            if vr >= 500:
                return {"fz": "dep", "fa": best[1]}
    return None


def sk_extra(live, rt, cs):
    out = {}
    try:
        if live:
            ph = sk_phase(live, rt)
            if ph:
                out.update(ph)
        if cs and re.match(r"^[A-Z]{3}\d", cs):
            out["al"] = cs[:3]
            if SK_IATA.get(cs[:3]):
                out["ai"] = SK_IATA[cs[:3]]
    except Exception:
        pass
    return out


def sk_flow(code, rows):
    """per-airport extras for /api/sky-board: flow word, mean landing heading, next ETA, arrivals in 15 min, night flag"""
    try:
        import math as _m
        low = [r for r in rows if r.get("track") is not None and (r.get("alt_ft") or 99999) < 5000 and r["dist_to_airport_mi"] <= 12] \
            or [r for r in rows if r.get("track") is not None]
        flow = hdg = None
        if low:
            x = sum(_m.sin(_m.radians(float(r["track"]))) for r in low)
            y = sum(_m.cos(_m.radians(float(r["track"]))) for r in low)
            hdg = int((_m.degrees(_m.atan2(x, y)) + 360) % 360)
            flow = ["north", "east", "south", "west"][int(((hdg + 45) % 360) // 90)]
        night = False
        if code == "LAX" and flow == "east":
            try:
                from zoneinfo import ZoneInfo
                d = datetime.datetime.now(ZoneInfo("America/Los_Angeles"))
                night = (d.hour * 60 + d.minute) < 6 * 60 + 30
            except Exception:
                pass
        return {"flow": flow, "flow_hdg": hdg, "next_eta": rows[0]["eta"] if rows else None,
                "count15": sum(1 for r in rows if r["minutes"] <= 15), "night": night, "short": SK_NAMES.get(code)}
    except Exception:
        return {"flow": None, "flow_hdg": None, "next_eta": None, "count15": 0, "night": False}
# ---------------------------------------------------------------- end SKYAP_20261102
'''


def patch(path, edits, extra_check=None):
    src = open(path).read()
    shutil.copy(path, path + ".bak_skyap_" + stamp)
    for old, new in edits:
        assert src.count(old) == 1, ("anchor count", src.count(old), old[:70])
        src = src.replace(old, new)
    ast.parse(src)
    open(path, "w").write(src)
    print("patched", path)


# ---- aircraft_enrich.py
AE = ROOT + "aircraft_enrich.py"
patch(AE, [
    ('    return {"hex": hx, "label": label, "sublabel": sub, "tier": tier,',
     '    _out = {"hex": hx, "label": label, "sublabel": sub, "tier": tier,'),
    ('"sources": m.get("src"), "pending": bool(m.get("pending")), "updated_at": ts}',
     '"sources": m.get("src"), "pending": bool(m.get("pending")), "updated_at": ts}\n    _out.update(sk_extra(live, rt, cs))   # SKYAP_20261102\n    return _out'),
    ('def sky_board():', SK + 'def sky_board():'),
    ('"dist_from_home_mi": rec["dist"]})', '"dist_from_home_mi": rec["dist"], "track": rec["track"]})'),
    ('"airports": {k: {"name": AIRPORTS[k][0], "arrivals": arr[k]} for k in AIRPORTS},',
     '"airports": {k: dict({"name": AIRPORTS[k][0], "arrivals": arr[k]}, **sk_flow(k, arr[k])) for k in AIRPORTS},   # SKYAP_20261102'),
])

# ---- server.py
SV = ROOT + "server.py"
patch(SV, [
    ('"ph": ph.get("thumb"), "pc": ph.get("credit"), "hel": True if r.get("helicopter") else None}',
     '"ph": ph.get("thumb"), "pc": ph.get("credit"), "hel": True if r.get("helicopter") else None,\n         "fz": r.get("fz"), "fa": r.get("fa"), "fm": r.get("fm"), "al": r.get("al"), "ai": r.get("ai")}   # SKYAP_20261102'),
    ('        if p.startswith("/logo/"):\n            return self.logo(p)',
     '        if p.startswith("/logo/"):\n            return self.logo(p)\n        if p.startswith("/logos/"):                                   # SKYAP_20261102: airline logos by ICAO (LAN only, read-only)\n            if not lan_ok(self.client_address[0]):\n                return self.send(403, \'{"error":"lan only"}\')\n            try:\n                import skyap_logos as _SL\n                _lc, _lb, _lt, _lh = _SL.serve(p)\n            except Exception:\n                _lc, _lb, _lt, _lh = 404, b\'{"error":"no logo"}\', "application/json", {}\n            return self.send(_lc, _lb, _lt, _lh)'),
    ('        _AE0.start(_w2_report, lambda _hx: NEWS["map"].get(str(_hx).lower()))',
     '        _AE0.start(_w2_report, lambda _hx: NEWS["map"].get(str(_hx).lower()))\n        import skyap_logos as _SL0   # SKYAP_20261102 logo watchdog (wall.skysync.logos)\n        _SL0.start(_w2_report)'),
])
print("OK")
