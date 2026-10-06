#!/usr/bin/env python3
"""Mac Display - the Home app's "Mac Display" switch for the Mac mini's monitor (2026-10-06).

Homebridge on the Pi exposes a switch; flipping it sets a wanted state on the Pi wall server. This agent polls the Pi
every 2 s through the Mac's existing SSH tunnel (127.0.0.1:18099 -> Pi :8099), reports whether the display is asleep,
and applies a new request: off = `pmset displaysleepnow`, on = `caffeinate -u` (a user-activity wake).
The wall keeps rendering at 60 fps with the display asleep (headless Chrome), checked on Oct 6.

Deployed copy: ~/Bestly/macdisplay/macdisplay.py, LaunchAgent tech.bestly.macdisplay (KeepAlive).
Checks in with Scout as agent_beat slug "mac-display" every 10 min (uses Sweep's config.json + the Keychain key).
"""
import ctypes, json, os, subprocess, time, urllib.request

HOME = os.path.expanduser("~")
DIR = os.path.join(HOME, "Bestly", "macdisplay")
LOG = os.path.join(DIR, "macdisplay.log")
CFG = os.path.join(HOME, "Bestly", "sweep", "config.json")
POLL = "http://127.0.0.1:18099/api/macdisplay/poll?state=%d"
SLUG = "mac-display"

cg = ctypes.CDLL("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics")
cg.CGMainDisplayID.restype = ctypes.c_uint32
cg.CGDisplayIsAsleep.argtypes = [ctypes.c_uint32]


def log(msg):
    with open(LOG, "a") as f:
        f.write(time.strftime("%Y-%m-%d %I:%M:%S %p ") + msg + "\n")
    try:
        if os.path.getsize(LOG) > 2_000_000:
            os.replace(LOG, LOG + ".old")
    except OSError:
        pass


def asleep():
    return bool(cg.CGDisplayIsAsleep(cg.CGMainDisplayID()))


def beat(ok, summary):
    try:
        cfg = json.load(open(CFG))
        key = subprocess.run(["security", "find-generic-password", "-s", "bestly-home-hub-agent", "-w"],
                             capture_output=True, text=True, timeout=20).stdout.strip()
        if not key:
            return
        req = urllib.request.Request(cfg["supabase_url"].rstrip("/") + "/rest/v1/rpc/agent_beat", method="POST",
                                     data=json.dumps({"p_slug": SLUG, "p_ok": ok, "p_summary": summary[:480], "p_token": key}).encode(),
                                     headers={"Content-Type": "application/json", "apikey": cfg["publishable"],
                                              "Authorization": "Bearer " + cfg["publishable"]})
        urllib.request.urlopen(req, timeout=20).read()
    except Exception as e:
        log("beat failed: %s" % e)


def main():
    os.makedirs(DIR, exist_ok=True)
    last_seq, beat_at, fails, applied = None, 0.0, 0, 0
    log("started")
    while True:
        try:
            r = json.load(urllib.request.urlopen(POLL % (0 if asleep() else 1), timeout=5))
            seq, want = r.get("seq"), r.get("want")
            if last_seq is not None and seq != last_seq and want is not None:
                if want:
                    subprocess.run(["caffeinate", "-u", "-t", "2"], timeout=10)
                else:
                    subprocess.run(["pmset", "displaysleepnow"], timeout=10)
                applied += 1
                log("display " + ("on" if want else "off") + " (Home app)")
            last_seq, fails = seq, 0
        except Exception as e:
            fails += 1
            if fails in (3, 30) or fails % 300 == 0:
                log("can't reach the Pi through the tunnel (%d tries): %s" % (fails, e))
        if time.time() - beat_at > 600:
            beat_at = time.time()
            beat(fails < 30, ("display asleep" if asleep() else "display awake") +
                 ("; Pi unreachable %d tries" % fails if fails else "") + ("; %d switch flips" % applied if applied else ""))
        time.sleep(2)


if __name__ == "__main__":
    main()
