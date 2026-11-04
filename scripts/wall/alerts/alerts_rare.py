"""ALERTS_20261103  Rare / special aircraft matcher (owner: Sky Sync).

One source of truth for both the alert daemon (alerts_batch.py) and the enrichment poller (aircraft_enrich.py), which uses it
to put a gold NOTABLE card on the wall. The list lives in /opt/bestly/wall/alerts_rare.json so it can be edited without code.
Never raises; returns None when nothing matches.
"""
import json
import os
import re
import time

CFG = "/opt/bestly/wall/alerts_rare.json"
_C = {"at": 0.0, "mt": 0.0, "rules": []}


def _load():
    now = time.time()
    if now - _C["at"] < 20:
        return _C["rules"]
    _C["at"] = now
    try:
        mt = os.path.getmtime(CFG)
        if mt != _C["mt"]:
            d = json.load(open(CFG))
            rules = []
            for r in d.get("rules", []):
                r = dict(r)
                r["types"] = {str(t).upper() for t in r.get("types", [])}
                r["hexes"] = {str(h).lower() for h in r.get("hexes", [])}
                r["_cs"] = re.compile(r["callsign_re"], re.I) if r.get("callsign_re") else None
                rules.append(r)
            _C["rules"], _C["mt"] = rules, mt
    except Exception:
        pass
    return _C["rules"]


def rare_match(cs, tcode, flags=0, hx=""):
    """Returns the display name of the first rule that matches (every condition a rule lists must hold), else None."""
    try:
        cs = (cs or "").strip().upper()
        tcode = (tcode or "").strip().upper()
        hx = (hx or "").lower()
        mil = bool(int(flags or 0) & 1)
        for r in _load():
            if r["hexes"] and hx not in r["hexes"]:
                continue
            if r["types"] and tcode not in r["types"]:
                continue
            if r["_cs"] is not None and not (cs and r["_cs"].search(cs)):
                continue
            if r.get("mil") and not mil:
                continue
            if not (r["hexes"] or r["types"] or r["_cs"] is not None):
                continue
            return r["name"]
    except Exception:
        return None
    return None
