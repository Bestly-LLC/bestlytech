#!/usr/bin/env python3
# Patch /opt/bestly/watchdog.py (run with sudo on the Pi): sky_ret_watch for the Turo return Live Activity.
import sys
import glob
cands = glob.glob("/opt/bestly/wall/watchdog.py")
P = cands[0]
s = open(P).read()
if "def sky_ret_watch" in s:
    sys.exit("already patched")
FN = '''def sky_ret_watch(mem, hb):
    """Turo return Live Activity (2026-10-06), same pattern as sky_la_watch. Self-heal: the Pi loop retries pushes and ends by
    itself, and the Home Assistant return card takes over automatically while pushes fail (server.py sky_ret_owns). If the loop is
    dead 5+ min the Pi restarts bestly-wall (once an hour, shared with the plane loop). Scout, signed Turo Reader: pushes failing
    10+ min (with the APNs codes), a card still on the phone 10+ min after the trip closed, or one older than 8 h."""
    sr = hb.get("sky_ret")
    if not isinstance(sr, dict):
        return
    now = time.time()
    la = sr.get("loop_age_s")
    if la is not None and la > 300 and now - mem.get("sky_la_restart_at", 0) > 3600:
        mem["sky_la_restart_at"] = now
        subprocess.run(["sudo", "systemctl", "restart", "bestly-wall"], timeout=30)
        log(f"turo return live activity loop silent {round(la)} s -> restarted bestly-wall")
        report(mem, "wall.sky_ret_loop", "problem", "warning", "Turo Reader: return card stopped updating",
               f"The Pi loop that updates the Turo return card on your iPhone was silent for {round(la / 60)} min, so the Pi restarted the wall service.")
    elif la is not None and la < 30:
        report(mem, "wall.sky_ret_loop", "resolved", "info", "Turo Reader: return card is updating again", "The loop is running.")
    last = sr.get("last") or {}
    if (sr.get("fail_min") or 0) >= 10 and ((sr.get("tokens") or {}).get("start") or 0) > 0:
        report(mem, "wall.sky_ret", "problem", "warning", "Turo Reader: return card can't reach the phone",
               f"Pushes of the Turo return card to the Bestly Sky app have failed for {sr['fail_min']} min (APNs: {', '.join(last.get('codes') or []) or sr.get('error') or 'no answer'}). "
               "The Home Assistant return card is showing instead. The Pi keeps retrying; send this to Claude if it stays.")
    elif (sr.get("fail_min") is None and last.get("ok")) or not ((sr.get("tokens") or {}).get("start") or 0):
        report(mem, "wall.sky_ret", "resolved", "info", "Turo Reader: return card is reaching the phone", "APNs is accepting the pushes again.")
    tg = sr.get("target") or {}
    stuck = sr.get("active") and not tg.get("trip")
    mem["sky_ret_unseen_since"] = (mem.get("sky_ret_unseen_since") or now) if stuck else None
    old = (sr.get("active_min") or 0) > 480
    if (stuck and now - mem["sky_ret_unseen_since"] > 600) or old or (sr.get("ending") or 0) > 5:
        report(mem, "wall.sky_ret_stuck", "problem", "warning", "Turo Reader: return card stuck on the iPhone",
               f"The Turo return card should have ended ({'over 8 hours old' if old else 'the trip is closed'}) but the end didn't get through "
               f"(last: {', '.join(last.get('codes') or []) or sr.get('error') or 'unknown'}). The Pi retries; swipe it away on the phone if it bothers you.")
    elif not sr.get("active") and not sr.get("ending"):
        report(mem, "wall.sky_ret_stuck", "resolved", "info", "Turo Reader: return card ended", "Nothing is stuck on the phone.")


'''
anchor = "def page_watch(mem, hb):"
assert anchor in s
s = s.replace(anchor, FN + anchor, 1)
old = "        sky_la_watch(mem, hb)   # W6 round 4\n"
assert old in s
s = s.replace(old, old + "        sky_ret_watch(mem, hb)   # Turo return Live Activity\n", 1)
open(P, "w").write(s)
print("patched", P)
