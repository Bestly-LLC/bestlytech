#!/usr/bin/env python3
"""MAINCLEAN_20261102 aircraft_enrich.py patcher. usage: p_enrich.py in.py out.py
Helicopters, police / news / medical / fire / military aircraft never get an arrival / departure phase; the no-route fallback needs a
fixed-wing aircraft moving 60+ kt; unknown planes get a best-guess label instead of 'Aircraft <hex>'."""
import sys, ast
src, dst = sys.argv[1], sys.argv[2]
h = open(src, encoding='utf-8').read()
assert 'MAINCLEAN_20261102' not in h, 'already patched'

def rep(a, b, n=1):
    global h
    assert h.count(a) == n, (a[:70], h.count(a))
    h = h.replace(a, b)

rep('''    if alt is None or trk is None or live.get("ground"):
        return None
    la, lo, trk = live["lat"], live["lon"], float(trk)''',
    '''    if alt is None or trk is None or live.get("ground"):
        return None
    if str(live.get("cat") or "").upper() == "A7":                   # MAINCLEAN_20261102: helicopters never arrive / depart
        return None
    la, lo, trk = live["lat"], live["lon"], float(trk)''')
rep('    if not ok_rt and alt < 6000:                                   # no usable route: low, close, lined up with a runway',
    '    if not ok_rt and alt < 6000 and (gs or 0) >= 60 and str(live.get("cat") or "").upper() in ("", "A1", "A2", "A3", "A4", "A5", "A6"):   # no usable route: fixed-wing, low, close, lined up with a runway (MAINCLEAN_20261102)')
rep('def sk_extra(live, rt, cs):', 'def sk_extra(live, rt, cs, exempt=False):')
rep('            ph = sk_phase(live, rt)\n            if ph:', '            ph = None if exempt else sk_phase(live, rt)\n            if ph:')
rep('    _out.update(sk_extra(live, rt, cs))   # SKYAP_20261102',
    '    _out.update(sk_extra(live, rt, cs, exempt=bool(heli or police or news or fire or medical or (flags & 1))))   # SKYAP_20261102 + MAINCLEAN_20261102')
rep('        label = reg or (cs if cs else f"Aircraft {hx.upper()}")', '        label = reg or (cs if cs else _mc_guess(live, m, hx))')
rep('def build(hx, live, m, rt, photo, now_ts=None):',
    '''def _mc_guess(live, m, hx):
    """MAINCLEAN_20261102: best-guess label for a plane with no registration or callsign (never 'Unknown')"""
    cat = str((live or {}).get("cat") or "").upper()
    t = m.get("icao") or (live or {}).get("t") or ""
    if cat == "A7" or HELI_T.match(t):
        return "Helicopter"
    if cat in ("A1", "A2"):
        return "Small plane"
    if cat in ("A3", "A4", "A5"):
        return "Jet"
    if cat == "A6":
        return "Fast jet"
    alt = (live or {}).get("alt")
    if alt is not None and alt < 5000 and ((live or {}).get("gs") or 0) < 160:
        return "Small plane"
    return "Aircraft"


def build(hx, live, m, rt, photo, now_ts=None):''')
ast.parse(h)
open(dst, 'w', encoding='utf-8').write(h)
print('ok')
