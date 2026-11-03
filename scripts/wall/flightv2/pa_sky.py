# FLIGHTV2 patch part A: sky_alerts.py predictive additions. usage: pa_sky.py <path>
import sys,re
p=sys.argv[1]; s=open(p).read()
assert 'FLIGHTV2' not in s
# 1) route+line3 hook in build_state
old='''        line1, line3, route = _plane_line1(t), _plane_line3(t), _plane_route(t, now)
'''
new='''        line1, line3, route = _plane_line1(t), _plane_line3(t), _plane_route(t, now)
        if t.get("pred"):                                   # FLIGHTV2: predictive heads-up wording + stage progress
            line1, line3, route, footnote = _pred_lines(t, line1, line3, route, now)
'''
assert s.count(old)==1; s=s.replace(old,new)
# 2) plane_target carries label ladder + squawk
old='''            "from_ll": a.get("from_ll"), "to_ll": a.get("to_ll")}
'''
new='''            "from_ll": a.get("from_ll"), "to_ll": a.get("to_ll"), "vr": _num(a.get("vr")), "sq": a.get("sq"),
            "elabel": ((a.get("v2") or {}).get("l") or ""), "esub": ((a.get("v2") or {}).get("s") or "")}
'''
assert s.count(old)==1; s=s.replace(old,new)
# 3) line1 uses the label ladder when we have it
old='''    typ, reg = t["typ"], t["reg"]
    if t.get("police"):'''
new='''    typ, reg = t["typ"], t["reg"]
    if t.get("elabel") and not t.get("police") and not t.get("news"):
        el = t["elabel"]
        short = (t.get("esub") or "").split(" · ")[0]
        return fit(LIMITS["line1"], f"{el} · {short}" if short else "", el, f"{t['code']} {t['num']}".strip(), "Aircraft")
    if t.get("police"):'''
assert s.count(old)==1; s=s.replace(old,new)
add='''

# ---------- FLIGHTV2 (2026-11-02): predictive sky heads-up ----------
PRED_START_MI = 0.25        # predicted closest approach to home that starts a card
PRED_START_S = 45           # ... when it is this close in time
PRED_ABORT_MI = 0.4         # the prediction moved past this = it turned away
EMERGENCY_SQUAWKS = ("7700", "7600", "7500")


def cpa(a, home=HOME):
    """Closest point of approach of aircraft a (lat, lon, gs kt, track deg, alt ft, vr ft/min) to home.
    -> {range_mi, miles (at closest), secs (to closest, negative = already past), alt (ft at closest), along (mi still to fly to it)} or None."""
    lat, lon = _num(a.get("lat")), _num(a.get("lon"))
    if lat is None or lon is None:
        return None
    ky = 69.0
    kx = 69.172 * math.cos(math.radians(home[0]))
    px, py = (lon - home[1]) * kx, (lat - home[0]) * ky
    rng = math.hypot(px, py)
    gs, trk = _num(a.get("gs"), 0.0), _num(a.get("track"))
    alt, vr = _num(a.get("alt")), _num(a.get("vr"), 0.0) or 0.0
    if trk is None or gs is None or gs < 25:           # hovering helicopter: it is where it is
        return {"range_mi": rng, "miles": rng, "secs": 0.0, "alt": alt, "along": 0.0}
    sp = gs * 1.15078                                  # mph
    vx, vy = sp * math.sin(math.radians(trk)), sp * math.cos(math.radians(trk))
    t = -(px * vx + py * vy) / (vx * vx + vy * vy)     # hours to closest approach
    cx, cy = px + vx * t, py + vy * t
    secs = t * 3600.0
    altc = None if alt is None else max(0.0, alt + vr * (secs / 60.0))
    return {"range_mi": rng, "miles": math.hypot(cx, cy), "secs": secs, "alt": altc, "along": t * sp}


def pred_progress(c, d0):
    """0 at first sighting, 0.5 at closest, 1 once it is as far past as it was before. d0 = along-track miles at the start."""
    d0 = max(0.3, d0 or 0.3)
    return round(min(1.0, max(0.0, (d0 - c["along"]) / (2.0 * d0))), 3)


def _pred_lines(t, line1, line3, route, now):
    p = t["pred"]
    st, secs, alt = p.get("stage"), p.get("secs"), p.get("alt")
    alts = ft(round(alt / 100.0) * 100) if alt else ""
    foot = None
    if st == "emergency":
        line1 = fit(LIMITS["line1"], f"{p.get('sq')} · {t.get('elabel') or t.get('reg') or 'Aircraft'}", f"Squawk {p.get('sq')}", "Emergency")
        line3 = fit(LIMITS["line3"], f"Emergency squawk · {alts}" if alts else "", "Emergency squawk")
        foot = "Emergency squawk"
    elif st == "rapid":
        fpm = abs(int(p.get("vr") or 0))
        line3 = fit(LIMITS["line3"], f"Descending {fpm:,}{NB}ft/min", f"Dropping {fpm:,}{NB}fpm", "Rapid descent")
        foot = "Rapid descent"
    elif st == "approaching":
        s = max(1, int(round(secs or 0)))
        line3 = fit(LIMITS["line3"], f"Over you in {s}{NB}sec · {alts}" if alts else "", f"Over you in {s}{NB}sec", "Approaching")
    elif st == "overhead":
        line3 = fit(LIMITS["line3"], f"Overhead now · {alts}" if alts else "", "Overhead now")
    elif st == "passed":
        line3 = fit(LIMITS["line3"], f"Passed over · {alts}" if alts else "", "Passed over")
    elif st == "turned":
        line3 = "Turned away"
    fr, to = (t.get("from") or "Near"), (t.get("to") or "Past")
    eta = {"approaching": "Over you " + t12(now + (secs or 0)), "overhead": "Overhead now", "passed": "Passed over",
           "turned": "Turned away", "emergency": "Emergency", "rapid": "Rapid descent"}.get(st, "")
    route = {"from": str(fr)[:4], "to": str(to)[:4], "progress": float(p.get("progress") or 0.0), "eta": eta}
    return line1, line3, route, foot
'''
s=s.rstrip('\n')+'\n'+add
# the __main__ block must stay last: move it
mm='\n\nif __name__ == "__main__":\n    dry_run()\n'
assert mm in s
s=s.replace(mm,'\n')+mm
# footnote variable init: build_state sets footnote=None earlier; the tuple return sets it
open(p,'w').write(s)
print('sky_alerts patched')
