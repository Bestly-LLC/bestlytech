"""Apple TV link watchdog - owned by Tinker (Home Automation Engineer). Built on Hestia 2026-10-29 (Claude, for Jared).

Why: Jared's "TV on" automation (made in the Automation Maker) triggers on the Vizio and wakes the Apple TV, and the news-chopper
Watch buttons drive the Apple TV. On 2026-10-28 Home Assistant lost the Vizio link and nobody noticed. This job notices and fixes it.

Checks (alert keys tinker.appletv.appletv / tinker.appletv.vizio, signed Tinker via notification_owners prefix 'tinker.'):
  appletv  remote.studio_studio + media_player.studio_studio both unavailable. Heal after 2 bad runs (10 min): reload that entry,
           at most every 30 min. Alert (warning, held overnight by quiet hours) after 4 bad runs the reload did not fix.
  vizio    remote.tv + media_player.tv_3 both unavailable. Same heal; reports to the evening recap (info) only after an hour.
Runs from cron every 5 minutes via run.sh, needs no AI and no internet to check or heal. Reports to pi_jobs (Scout watches the gap).
Flags: --dry --no-heal --simulate appletv|vizio.  Off switch: touch /opt/bestly/cron/state/appletv_watch.OFF
"""
import subprocess
import time

import watchkit as wk

NAME = "appletv_watch"
# Corrected 2026-10-29: in Home Assistant "TV" (remote.tv, media_player.tv_3) is the Vizio and "Studio"
# (remote.studio_studio, media_player.studio_studio) is the Apple TV. The TV-on automation triggers on the Vizio and wakes the Apple TV.
DEVICES = {
    "appletv": {"ents": ["remote.studio_studio", "media_player.studio_studio"], "reload": "remote.studio_studio",
                "what": "the Apple TV (Studio)", "why": "the TV-on automation and the news buttons cannot wake it"},
    "vizio": {"ents": ["remote.tv", "media_player.tv_3"], "reload": "remote.tv",
              "what": "the Vizio TV", "why": "the TV-on automation cannot see the TV turn on"},
    # 2026-10-31: both HomePods (Desk 192.168.1.171, Bathroom 192.168.1.168) vanished from the network after the Hestia
    # reboot and nothing said so for 19 hours (only "Dance Wave isn't playing" hinted). This check says it plainly.
    "homepods": {"ents": ["media_player.desk_2", "media_player.bathroom_homepod"], "reload": "media_player.desk_2",   # the Music Assistant players: unavailable when the pods are gone (the apple_tv ones just say off)
                 "what": "the HomePods (Desk and Bathroom)", "why": "announcements, Dance Wave and the shower music have nowhere to play",
                 "ips": ["192.168.1.171", "192.168.1.168"]},
}
# The Apple TV stays reachable while asleep, so a lost link is real. The Vizio can drop off when it is fully powered down,
# so it only heals quietly and reports to the evening recap (info) after an hour of failed reloads.
POLICY = {"appletv": dict(heal=2, raise_=4, sev="warning", cool=1800),
          "vizio": dict(heal=2, raise_=12, sev="info", cool=1800),
          "homepods": dict(heal=2, raise_=12, sev="warning", cool=3600)}
TITLES = {"appletv": "Home Assistant lost the Apple TV", "vizio": "Home Assistant lost the Vizio TV",
          "homepods": "Both HomePods are off the network"}
# The Vizio drops off the network completely when it is powered down (no ping, port 7345 closed), and Home Assistant then
# shows its entities unavailable. That is the TV being OFF, not a lost link. 2026-10-31 (Jared): only alert when the TV is
# actually on, i.e. it answers on the network and Home Assistant still cannot see it.
VIZIO_IP = "192.168.1.206"


def _on_network(ip):
    try:
        return subprocess.run(["ping", "-c", "1", "-W", "1", ip], capture_output=True, timeout=5).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False
ENTITIES = [e for d in DEVICES.values() for e in d["ents"]]


def _states():
    return {e: (wk.ha_state(e) or {}).get("state", "missing") for e in ENTITIES}


def _down(states, ents):
    return all(states.get(e, "missing") in ("unavailable", "missing") for e in ents)


def _healer(dev):
    def heal(ctx):
        wk.ha_call("homeassistant", "reload_config_entry", {"entity_id": dev["reload"]})
        time.sleep(25)
        now = _states()
        ok = not _down(now, dev["ents"])
        return ok, f"reloaded the {dev['what']} connection (now: " + ", ".join(f"{e} {now[e]}" for e in dev["ents"]) + ")"
    return heal


def check(name, ctx, sim):
    dev = DEVICES[name]
    s = ctx["states"]
    bad = _down(s, dev["ents"]) or sim == name
    tv_off = False
    if name == "vizio" and bad and sim != name and not _on_network(VIZIO_IP):
        bad, tv_off = False, True   # powered down: nothing to heal, nothing to raise; any open card resolves
    pods_gone = False
    if name == "homepods" and bad and sim != name:
        pods_gone = not any(_on_network(ip) for ip in dev["ips"])
    detail = (f"Home Assistant on Hestia cannot reach {dev['what']}, so {dev['why']}. " if bad else "") + \
        ("The Vizio TV is off (it does not answer on the network at all), so Home Assistant showing it unavailable is expected. " if tv_off else "") + \
        ("Neither HomePod answers on the network (no ping at 192.168.1.171 or 192.168.1.168), so this is the speakers themselves: unplugged, or dropped off the home Wi-Fi. Power-cycle them or check they are on the home Wi-Fi; nothing on Hestia can fix that. " if pods_gone else "") + \
        "State: " + ", ".join(f"{e} {s.get(e)}" for e in dev["ents"]) + "."
    return wk.res(name, bad, detail, _healer(dev))


def main(argv):
    off = wk.off_switch(NAME)
    if off:
        return "skip: appletv_watch is switched off (" + off + ")"
    dry, sim, no_heal = wk.parse_flags(argv)
    st = wk.load_state(NAME)
    try:
        states = _states()
    except Exception as e:  # noqa: BLE001
        return f"skip: Home Assistant is not answering ({type(e).__name__}); its own watchdog covers that"
    ctx = {"states": states, "st": st}
    results = [check(n, ctx, sim) for n in DEVICES if not sim or sim == n]
    out, alerts = wk.evaluate(NAME, "tinker.appletv", results, POLICY, TITLES, st, dry, sim, no_heal, ctx)
    if dry:
        wk.print_results(results)
    else:
        wk.save_state(NAME, st)
    summary = ", ".join(f"{k} {v}" for k, v in states.items())
    if alerts:
        return f"attention: {', '.join(alerts)} | {summary} | " + " | ".join(out)[:500]
    return f"ok: Apple TV and Vizio links fine ({summary})" + (" | " + " | ".join(out)[:400] if out else "")
