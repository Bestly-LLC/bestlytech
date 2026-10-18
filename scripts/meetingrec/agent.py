#!/usr/bin/env python3
"""Meeting recorder agent for the Mac mini.

Lets Scout (bestly.tech/admin) start and stop call recording, and shows it the
recorder's live state. Runs under launchd (tech.bestly.meetingrec-agent),
polls the meeting-recorder edge function every few seconds, and runs the same
start.sh / stop.sh the Desktop apps use, so both ways keep working.

It also ships every finished transcript to the admin (meeting_recordings), no
matter which way the call was recorded.

Standard library only: it runs on the system python3.
"""
import base64, glob, hashlib, json, os, re, shutil, signal, subprocess, sys, threading, time, traceback, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

VERSION = "1.10.2"  # 1.10.2: Jared's Talk track is the source for his lines; the Mac mic only stands in for it on a call he is in, never on one he is not. 1.10.1: the log says when the auto-record rule first holds and when a call empties. 1.10: Scout records Talk calls by itself (AUTO_ROOMS), the notetaker never starts a call and rejoins if dropped, client_slug/room on ingest, client folder copy, call watchdogs. 1.9: Spam Desk worker (mailspam.py). 1.8: voice bank (voicebank.py)
HOME = os.path.expanduser("~/MeetingRec")
REC = f"{HOME}/recordings"
URL = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/meeting-recorder"
KEY = open(f"{HOME}/.agent-key").read().strip()
LOG = f"{HOME}/agent.log"
INGESTED = f"{HOME}/.ingested"
POLL_S = 3
NODE = os.path.expanduser("~/.local/node/bin/node")
NT_DIR = f"{HOME}/notetaker"
TALK_API = "https://cloud.bestly.tech/ocs/v2.php/apps/spreed/api/v4"
BOT_USER = "scout-notetaker"
# The notetaker: joins the Talk call and records each person on their own track.
nt = {"proc": None, "name": None, "room": None, "title": None, "next_try": 0, "status": "off", "fails": 0, "t0": 0, "stop_at": None}
NT_NOT_LIVE = 4         # notetaker.js exit code: there was no live call to join (it never starts one)
NT_LOST_CALL = 5        # notetaker.js exit code: it was dropped from the call and could not get back in

# ── Auto-record ──────────────────────────────────────────────────────────────
# Scout starts the recorder by itself when a Talk call in one of these rooms has the right people in it, and stops
# and transcribes it when the call empties. Only these rooms; every other room still needs a manual start.
#   rule "jared+1": Jared and at least one other human are in the call.   rule "any2": any two humans (rehearsal).
# Switches (no deploy needed): `touch ~/MeetingRec/.auto-off` turns ALL auto-recording off, `touch ~/MeetingRec/.auto-off-<room>`
# turns one room off; delete the file to turn it back on. A manual start always works and always wins.
AUTO_ROOMS = {
    "fyqvdsa4": {"rule": "jared+1", "label": "Centering YOU"},
    # Jared and Eli's room (Jared, 12:07 PM Oct 18: "auto record with eli and i meeting"). No client: nothing is filed in a client
    # folder and no approval pop-up is made; scout-daily handles the call as it always has.
    "sm33w3fu": {"rule": "jared+1", "label": "Eli & Jared - BDC Universal"},
    # The rehearsal room (sandbox client bestly-test). It switches itself off at midnight after Monday, Oct 19, 2026.
    # To switch it off sooner: touch ~/MeetingRec/.auto-off-yqne2jpr   (or delete this line)
    "yqne2jpr": {"rule": "any2", "label": "Bestly call test", "until": "2026-10-20T00:00:00-07:00"},
}
# Test rooms (Jared, 2026-10-18: "Scout must NOT push me about a test call"). A call in one of these is recorded like any other, but
# it never raises a Scout alert, never opens or closes a real room's alert (the keys are shared), and never shows a macOS banner.
# Its trouble is only written to the agent log. Kept apart from AUTO_ROOMS so removing the rehearsal room's line there after Monday
# does not make an old test recording start alerting.
TEST_ROOMS = {"yqne2jpr"}
AUTO_OFF = f"{HOME}/.auto-off"
AUTO_FILE = f"{HOME}/.auto"                 # {"name", "room", "started"} while a recording Scout started is running
META_DIR = f"{HOME}/.meta"                  # one small json per recording: which Talk room it was, whether Scout started it,
                                            # when it ended, and whether its row in the admin has been seen (verified)
AUTO_HOLD_S = 20         # the rule must hold this long before a recording starts
AUTO_EMPTY_S = 90         # no human in the call this long -> stop and transcribe
AUTO_CAP_S = 4 * 3600     # a recording Scout started never runs longer than this
AUTO_REARM_S = 30         # after a recording, the rule must be false this long before the next auto-start
AUTO_FRESH_S = 75         # a person counts as in the call only while Talk has heard from them this recently
AUTO_ALERT_S = 120        # the rule held this long and nothing is recording -> tell Scout
AUTO_ROW_S = 45 * 60      # no row in the admin this long after a recording stopped -> tell Scout
HUMAN_TYPES = ("users", "guests", "emails", "federated_users")
BOTS = {BOT_USER, "cowork-bot"}
# Talk room -> where the client's calls are filed in Nextcloud (private to Jared; nothing in here is shared with anyone).
CLIENT_FOLDERS = {"centering-you": "Bestly/CenteringYOU/Calls", "bestly-test": "Bestly/_admin/test-client-calls"}
DAV = "https://cloud.bestly.tech/remote.php/dav/files/jared"
AUTO_LONG_S = 4 * 3600    # a recording somebody started by hand has run this long -> remind Scout (it is never stopped for them)
AUTO_MAX_STARTS = 3       # at most this many auto-started recordings per hour
auto = {"next": 0, "fails": 0, "hold": {}, "false_since": {}, "blocked": set(), "rooms": {}, "last_human": None,
        "stopping": False, "last_error": None, "alert_open": False, "talk_alert": False, "long_alert": False,
        "retry_at": 0, "verify_next": 0, "jared_marked": None}

# Self-healing. The notetaker drives Talk's web page, so a Talk update can break it.
#  - code sync: the scripts below are pulled from the repo (main) every 10 minutes,
#    so a fix Scout commits reaches this Mac without anyone touching it.
#  - self-test: a fake guest + the notetaker in a throwaway room, run when Talk's
#    version changes, after every code update, daily, and whenever Scout asks.
#  - a failed self-test after an update rolls the update back and blocks that version.
#  - every failure lands in the monitor (recorder.notetaker) with the diagnostics
#    Scout needs to write the fix.
RAW = "https://raw.githubusercontent.com/Bestly-LLC/bestlytech/main/scripts/meetingrec/"
SYNC = {"notetaker/notetaker.js": f"{HOME}/notetaker/notetaker.js",
        "notetaker/tester.js": f"{HOME}/notetaker/tester.js",
        "talk_tracks.py": f"{HOME}/talk_tracks.py",
        "voicebank.py": f"{HOME}/voicebank.py",
        "mailspam.py": f"{HOME}/mailspam.py",
        "agent.py": f"{HOME}/agent.py"}
BAD = f"{HOME}/.bad-versions"
heal = {"next_sync": 0, "next_version_check": 0, "selftest": None, "last": None, "verify_after_update": False}
START_APPS = [os.path.expanduser(p) for p in (
    "~/Desktop/Start Recording.app", "~/Applications/Start Recording.app", "/Applications/Start Recording.app")]
# Turning on iCloud "Desktop & Documents" moves everything on the Desktop into a "Desktop - <Mac name>" folder
# (it happened 2026-09-22: Jared lost his Start/Stop buttons and Scout's Record a call broke). Look there too.
START_GLOBS = ["~/Desktop/*/Start Recording.app", "~/Documents/*/Start Recording.app"]
SCOUT_AVATAR_URL = "https://bestly.tech/scout-mark.png"


def find_start_app():
    for a in START_APPS:
        if os.path.isdir(a):
            return a
    for g in START_GLOBS:
        hits = sorted(glob.glob(os.path.expanduser(g)))
        if hits:
            return hits[0]
    return None

busy = {"stage": None}          # set while this agent is running stop.sh
# Shell jobs from Scout. Scout proposes, Jared taps Run in the admin, the server
# hands the approved job over with a poll. One at a time; output streams back
# every couple of seconds, and a Cancel in the admin kills the whole process group.
JOB_FILE = f"{HOME}/.job-running"
job = {"id": None}
lock = threading.Lock()


def notify(title, text, subtitle="", sound="Glass"):
    """A real macOS banner on the mini, not a card in the admin. Jared is at the machine;
    he should see the recorder start without looking at a browser tab."""
    def esc(v):
        return str(v).replace("\\", "\\\\").replace('"', '\\"')
    script = (f'display notification "{esc(text)}" with title "{esc(title)}"'
              + (f' subtitle "{esc(subtitle)}"' if subtitle else "")
              + (f' sound name "{esc(sound)}"' if sound else ""))
    try:
        subprocess.run(["osascript", "-e", script], capture_output=True, timeout=10)
    except Exception as e:  # noqa: BLE001
        log("notify failed", e)


def log(*a):
    with open(LOG, "a") as f:
        f.write(datetime.now().strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(x) for x in a) + "\n")


def call(body, timeout=20):
    req = urllib.request.Request(
        URL, data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "x-recorder-key": KEY},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def read(path, default=""):
    try:
        return open(path).read().strip()
    except OSError:
        return default


def alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError):
        return False


def read_meta(name):
    """What we know about one recording besides its files: {room, title, auto}. {} if nothing."""
    try:
        return json.load(open(f"{META_DIR}/{name}.json"))
    except (OSError, ValueError):
        return {}


def write_meta(name, **kv):
    try:
        os.makedirs(META_DIR, exist_ok=True)
        m = read_meta(name)
        m.update({k: v for k, v in kv.items() if v is not None})
        with open(f"{META_DIR}/{name}.json", "w") as f:
            json.dump(m, f)
    except OSError as e:
        log("write meta failed", name, e)


def recording_room(name):
    """The Talk room a recording was made in: what Scout noted when it started, else where the notetaker joined."""
    room = read_meta(name).get("room")
    if room:
        return room
    try:
        return json.load(open(f"{REC}/{name}-talk/manifest.json")).get("token") or None
    except (OSError, ValueError):
        return None


def recording_pid():
    pid = read(f"{HOME}/.pid")
    if not pid or not alive(pid):
        return None
    # make sure it is still talkrec and not a recycled pid
    out = subprocess.run(["ps", "-p", pid, "-o", "comm="], capture_output=True, text=True).stdout
    return pid if "talkrec" in out else None


def stop_running_elsewhere():
    # "Stop & Transcribe" from the Desktop runs stop.sh itself
    out = subprocess.run(["pgrep", "-f", r"MeetingRec/stop\.sh"], capture_output=True, text=True).stdout
    return bool(out.strip())


def roster_list(text):
    return [r for r in re.split(r"[,\s]+", text.strip().lower()) if r and r not in ("-", "jared")]


def started_iso(name):
    t = read(f"{HOME}/.started")
    if t.isdigit():
        return datetime.fromtimestamp(int(t), timezone.utc).isoformat()
    m = re.match(r"meeting-(\d{8})-(\d{4})", name or "")
    if m:
        return datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M").astimezone(timezone.utc).isoformat()
    return None


def known_voices():
    try:
        return sorted(f[:-4] for f in os.listdir(f"{HOME}/voices") if f.endswith(".npy") and f != "jared.npy")
    except OSError:
        return []


_nc_pw_cache = {"pw": None, "at": 0}


def nc_password(fresh=False):
    """Jared's Nextcloud password from the keychain. Kept in memory for 5 minutes so the call watcher doesn't run
    `security` every few seconds."""
    if fresh or not _nc_pw_cache["pw"] or time.time() - _nc_pw_cache["at"] > 300:
        _nc_pw_cache["pw"] = subprocess.run(["security", "find-generic-password", "-s", "nextcloud-meetingrec", "-a", "jared", "-w"],
                                            capture_output=True, text=True).stdout.strip()
        _nc_pw_cache["at"] = time.time()
    return _nc_pw_cache["pw"]


def talk(method, path, data=None, timeout=15):
    body = urllib.parse.urlencode(data).encode() if data else None
    for attempt in (1, 2):
        pw = nc_password(fresh=attempt == 2)
        req = urllib.request.Request(TALK_API + path, data=body, method=method, headers={
            "OCS-APIRequest": "true", "Accept": "application/json",
            "Authorization": "Basic " + base64.b64encode(f"jared:{pw}".encode()).decode()})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode())["ocs"]["data"]
        except urllib.error.HTTPError as e:
            if e.code == 401 and attempt == 1:      # the password changed: read it again once
                continue
            raise


def active_room():
    """The Talk room with a call going on - the one Jared is in, if we can tell."""
    rooms = talk("GET", "/room")
    live = [r for r in rooms if r.get("hasCall") and r["token"] != heal.get("test_room")
            and r.get("displayName") != "Scout self-test"]
    mine = [r for r in live if (r.get("participantFlags") or 0) > 0]
    pick = mine or (live if len(live) == 1 else [])
    if not pick:
        return None
    r = pick[0]
    if r.get("type") == 1:          # one-to-one rooms can't take a third person
        return None
    return r["token"], r.get("displayName") or r.get("name")


def remove_bot(token):
    try:
        for p in talk("GET", f"/room/{token}/participants"):
            if p.get("actorType") == "users" and p.get("actorId") == BOT_USER:
                talk("DELETE", f"/room/{token}/attendees?attendeeId={p['attendeeId']}")
                log("notetaker removed from", token)
    except Exception as e:  # noqa: BLE001
        log("remove notetaker failed", e)


def notetaker_names(name):
    try:
        m = json.load(open(f"{REC}/{name}-talk/manifest.json"))
        return sorted({t["name"] for t in m.get("tracks", []) if t.get("name")})
    except (OSError, ValueError):
        return []


def jared_in_call(name):
    """Was Jared in this call? The Mac mini's mic is his voice only when he is at this Mac, so on a call he was not in (the
    rehearsal room, Eli on his own) nothing it heard may reach a transcript. Yes when he started the recording by hand (or nothing is
    known about it: older recordings), when Scout saw him in the call's participants while it recorded (meta jared_seen), or when the
    notetaker recorded a track under his name. talk_tracks.py has the same rule (jared_in_call); keep them the same."""
    m = read_meta(name)
    if not m.get("auto") or m.get("jared_seen"):
        return True
    return any(is_jared({"type": "", "id": "", "name": n}) for n in notetaker_names(name))


def mark_jared(name, people):
    """Note on the recording that Jared is in its call (talk_tracks.py and the ingest read it)."""
    if name and auto.get("jared_marked") != name and any(is_jared(p) for p in people or []):
        write_meta(name, jared_seen=True)
        auto["jared_marked"] = name


def without_mic_lines(text):
    """The transcript minus the lines the Mac's mic wrote (JARED). Returns (text, how many lines went)."""
    lines = text.split("\n")
    keep = [ln for ln in lines if not re.match(r"\[\d+:\d+\] JARED: ", ln)]
    return "\n".join(keep), len(lines) - len(keep)


def room_live(token):
    """Is a call going on in this Talk room right now? True / False, or None when Talk couldn't be asked."""
    try:
        for r in talk("GET", "/room?noStatusUpdate=1", timeout=10):
            if r.get("token") == token:
                return bool(r.get("hasCall"))
    except Exception as e:  # noqa: BLE001
        log("room lookup failed", e)
    return None


def notetaker_stuck():
    """True when the notetaker process is alive but has stopped writing its heartbeat (alive.json), or never started to."""
    try:
        beat = os.path.getmtime(f"{REC}/{nt['name']}-talk/alive.json")
    except OSError:
        beat = 0
    if beat >= (nt.get("t0") or 0):
        return time.time() - beat > 90          # it was reporting and went quiet
    return time.time() - (nt.get("t0") or time.time()) > 300     # it never got past joining


def notetaker_tick():
    """While a recording runs, get the notetaker into the Talk call and keep it there."""
    name = read(f"{HOME}/.current")
    if nt["proc"] and nt["proc"].poll() is not None:
        code = nt["proc"].returncode
        log("notetaker exited", code)
        nt["proc"] = None
        out = f"{REC}/{nt['name']}-talk"
        ran = time.time() - (nt.get("t0") or time.time())
        if code == NT_NOT_LIVE:
            # No live call to join. The notetaker never starts a call (that is how it double-started one on Oct 6),
            # so this is not a failure: look again in a few seconds.
            nt["status"] = "waiting for the call"
            nt["next_try"] = time.time() + 10
        elif code != 0:
            if ran > 300:
                nt["fails"] = 0         # it was in the call for a while first: a new drop, not a broken page
            nt["fails"] += 1
            health("notetaker", "problem", "Notetaker dropped out of a live call",
                   f"Exit {code} on {nt['title']} (try {nt['fails']} of 3). This call falls back to voice matching "
                   "if it can't rejoin.\nTo fix: scripts/meetingrec/notetaker/notetaker.js in the site repo, then run "
                   "the recorder self-test.\n" + diag_text(out), room=nt["room"], name=nt["name"])
            if nt["fails"] >= 3:
                nt["status"] = "gave up"
                nt["next_try"] = time.time() + 10 ** 9
        elif notetaker_names(nt["name"]):
            health("notetaker", "resolved", "Notetaker worked on a live call", nt["title"] or "", "info", room=nt["room"], name=nt["name"])
        if not recording_pid() and nt["room"]:
            remove_bot(nt["room"])
            nt.update(room=None, status="done")
    rec = recording_pid()
    if not rec:
        if nt["proc"]:
            open(f"{REC}/{nt['name']}-talk/STOP", "w").close()
            nt["stop_at"] = nt.get("stop_at") or time.time()
            if time.time() - nt["stop_at"] > 90:        # it should have left by now; a stuck one would hold Chrome's profile
                log("notetaker did not leave after the recording stopped; killing it")
                nt["proc"].kill()
        return
    nt["stop_at"] = None
    if nt["proc"] and nt["proc"].poll() is None and notetaker_stuck():
        # Alive but no heartbeat: it is hung (the Sep 29 dropout left one sitting there recording nothing). Kill it; the exit is
        # handled above on the next loop, and a new one joins the call.
        log("notetaker stopped reporting; killing it so a new one can join")
        nt["proc"].kill()
        return
    if nt["name"] != name:
        nt.update(name=name, room=None, title=None, next_try=0, status="looking", fails=0)
    if nt["proc"] or time.time() < nt["next_try"] or not os.path.exists(f"{NT_DIR}/notetaker.js"):
        return
    if selftest_lock.locked():
        nt["status"] = "waiting for the self-test"      # the self-test uses the notetaker's Chrome profile
        nt["next_try"] = time.time() + 10
        return
    nt["next_try"] = time.time() + 15
    meta = read_meta(name)
    try:
        if meta.get("room"):
            # Scout started this recording for a known room: no guessing which call it is.
            room = (meta["room"], meta.get("title") or meta["room"])
            live = room_live(room[0])
            if live is None:
                nt["status"] = "talk unreachable"
                return
            if not live:
                nt["status"] = "waiting for the call"
                return
        else:
            room = active_room()
    except Exception as e:  # noqa: BLE001
        log("talk lookup failed", e)
        nt["status"] = "talk unreachable"
        return
    if not room:
        nt["status"] = "no talk call"
        return
    token, title = room
    try:
        talk("POST", f"/room/{token}/participants", {"newParticipant": BOT_USER, "source": "users"})
    except urllib.error.HTTPError:
        pass                        # already a participant
    out = f"{REC}/{name}-talk"
    os.makedirs(out, exist_ok=True)
    try:
        os.remove(f"{out}/STOP")
    except OSError:
        pass
    nt["proc"] = subprocess.Popen([NODE, f"{NT_DIR}/notetaker.js", token, out], cwd=NT_DIR,
                                  stdout=subprocess.DEVNULL, stderr=open(f"{out}/stderr.log", "a"))
    nt.update(room=token, title=title, status="in call", t0=time.time())
    log("notetaker joining", token, title)
    if not meta.get("room"):
        write_meta(name, room=token, title=title)       # the ingest files this call under its client from here


def quiet_room(token):
    """True for a test room: nothing about it reaches Scout's alerts, Jared's phone or the Mac's banners."""
    return bool(token) and token in TEST_ROOMS


def quiet_recording(name):
    return quiet_room(recording_room(name)) if name else False


def health(key, kind, title="", body="", severity="warning", healed=False, room=None, name=None):
    """Tell Scout (the monitor) about trouble or that it is fixed. room / name say which Talk room or recording it is about:
    a test room's trouble is only logged, and (the keys are shared by every room) it can't open or close a real room's alert."""
    if quiet_room(room) or quiet_recording(name):
        log("not reported (test room)", key, kind, title)
        return
    try:
        call({"op": "health", "key": key, "kind": kind, "title": title, "body": body[:3900],
              "severity": severity, "healed": healed})
    except Exception as e:  # noqa: BLE001
        log("health report failed", e)


def sha(path):
    try:
        return hashlib.sha256(open(path, "rb").read()).hexdigest()[:12]
    except OSError:
        return None


def diag_text(out):
    parts = []
    for f in ("diag.json", "notetaker.log", "stderr.log"):
        t = read(f"{out}/{f}")
        if t:
            parts.append(f"--- {f}\n" + t[-1500:])
    return "\n".join(parts)


def talk_version():
    pw = subprocess.run(["security", "find-generic-password", "-s", "nextcloud-meetingrec", "-a", "jared", "-w"],
                        capture_output=True, text=True).stdout.strip()
    req = urllib.request.Request("https://cloud.bestly.tech/ocs/v2.php/cloud/capabilities", headers={
        "OCS-APIRequest": "true", "Accept": "application/json",
        "Authorization": "Basic " + base64.b64encode(f"jared:{pw}".encode()).decode()})
    with urllib.request.urlopen(req, timeout=15) as r:
        caps = json.loads(r.read().decode())["ocs"]["data"]["capabilities"]
    return caps.get("spreed", {}).get("version") or ""


def sync_code():
    """Pull the notetaker scripts from the repo. Returns True if anything changed."""
    bad = set(read(BAD).split())
    changed = []
    for rel, dest in SYNC.items():
        try:
            with urllib.request.urlopen(RAW + rel + f"?t={int(time.time())}", timeout=20) as r:
                new = r.read()
        except Exception as e:  # noqa: BLE001
            log("sync fetch failed", rel, e)
            continue
        h = hashlib.sha256(new).hexdigest()[:12]
        if h == sha(dest) or h in bad:
            continue
        tmp = dest + ".incoming" + os.path.splitext(dest)[1]   # keep the extension: node --check needs .js
        open(tmp, "wb").write(new)
        check = ([NODE, "--check", tmp] if dest.endswith(".js") else ["python3", "-m", "py_compile", tmp])
        if subprocess.run(check, capture_output=True).returncode != 0:
            log("sync rejected (does not parse)", rel, h)
            os.remove(tmp)
            continue
        if os.path.exists(dest):
            shutil.copy2(dest, dest + ".last-good")
        os.replace(tmp, dest)
        changed.append((rel, h))
        log("synced", rel, h)
    if changed:
        heal["updated"] = changed
    return bool(changed)


def rollback():
    for rel, h in heal.get("updated", []):
        dest = SYNC[rel]
        if os.path.exists(dest + ".last-good"):
            shutil.copy2(dest + ".last-good", dest)
        with open(BAD, "a") as f:
            f.write(h + "\n")
        log("rolled back", rel, "blocked", h)
    back_agent = any(rel == "agent.py" for rel, _ in heal.get("updated", []))
    heal["updated"] = []
    if back_agent:            # the old agent.py is back on disk; run it
        time.sleep(3)
        os._exit(0)


selftest_lock = threading.Lock()


def run_selftest(reason, quiet=False):
    """One at a time: if a self-test is already running, wait for it and use its answer."""
    if not selftest_lock.acquire(blocking=False):
        with selftest_lock:
            return (heal["selftest"] or {}).get("status") == "passed"
    try:
        return _run_selftest(reason, quiet)
    finally:
        selftest_lock.release()


def _run_selftest(reason, quiet=False):
    """Fake guest joins a throwaway Talk room; the notetaker must hear it, by name."""
    heal["selftest"] = {"status": "running", "reason": reason, "at": datetime.now(timezone.utc).isoformat()}
    out = f"/tmp/scout-selftest-{int(time.time())}"
    token, tester, bot, step, ok = None, None, None, "create room", False
    wav = f"{HOME}/notetaker/canary.wav"
    try:
        if not os.path.exists(wav):
            subprocess.run(["say", "-o", "/tmp/canary.aiff", "This is the Scout canary check. Testing one two three."], check=True)
            subprocess.run([f"{HOME}/bin/ffmpeg", "-loglevel", "error", "-y", "-i", "/tmp/canary.aiff", "-ar", "48000", "-ac", "1", wav], check=True)
        token = talk("POST", "/room", {"roomType": 3, "roomName": "Scout self-test"})["token"]
        heal["test_room"] = token
        talk("POST", f"/room/{token}/participants", {"newParticipant": BOT_USER, "source": "users"})
        step = "test guest starts a call"
        tlog = open(f"{out}-tester.log", "w")
        tester = subprocess.Popen([NODE, f"{HOME}/notetaker/tester.js", token, "Canary Check", "150", wav],
                                  cwd=f"{HOME}/notetaker", stdout=tlog, stderr=tlog)
        for _ in range(60):
            time.sleep(1)
            if "in call" in read(f"{out}-tester.log"):
                break
        if "in call" not in read(f"{out}-tester.log"):
            raise RuntimeError("the fake guest couldn't get into a call")
        step = "notetaker joins and records"
        os.makedirs(out, exist_ok=True)
        bot = subprocess.Popen([NODE, f"{HOME}/notetaker/notetaker.js", token, out], cwd=f"{HOME}/notetaker",
                               stdout=subprocess.DEVNULL, stderr=open(f"{out}/stderr.log", "w"))
        named = False
        for _ in range(75):
            time.sleep(1)
            if bot.poll() is not None:
                raise RuntimeError(f"notetaker quit (exit {bot.returncode})")
            try:
                m = json.load(open(f"{out}/manifest.json"))
                t = [x for x in m.get("tracks", []) if x.get("name") == "Canary Check"
                     and os.path.getsize(f"{out}/{x['file']}") > 15000]
                if t:
                    named = True
                    break
            except (OSError, ValueError):
                pass
        if not named:
            raise RuntimeError("no track named 'Canary Check' after 75s")
        step = "stop cleanly"
        open(f"{out}/STOP", "w").close()
        bot.wait(timeout=40)
        step = "transcribe the track"
        m = json.load(open(f"{out}/manifest.json"))
        f = [x for x in m["tracks"] if x.get("name") == "Canary Check"][0]["file"]
        subprocess.run([f"{HOME}/bin/ffmpeg", "-loglevel", "error", "-y", "-i", f"{out}/{f}", "-ac", "1", "-c:a", "aac", f"{out}/c.m4a"])
        text = subprocess.run([f"{HOME}/bin/talkscribe", f"{out}/c.m4a", "X"], capture_output=True, text=True).stdout.lower()
        if "canary" not in text and "scout" not in text:
            raise RuntimeError("recorded the guest but the audio was not the test phrase: " + text[:120])
        ok = True
    except Exception as e:  # noqa: BLE001
        err = f"failed at '{step}': {e}"
    finally:
        for p in (bot, tester):
            if p and p.poll() is None:
                p.terminate()
                try:
                    p.wait(timeout=15)
                except Exception:  # noqa: BLE001
                    p.kill()
        if token:
            try:
                talk("DELETE", f"/room/{token}")
            except Exception:  # noqa: BLE001
                pass
        heal["test_room"] = None
    try:
        tv = talk_version()
    except Exception:  # noqa: BLE001
        tv = "?"
    if ok:
        heal["selftest"] = {"status": "passed", "reason": reason, "at": datetime.now(timezone.utc).isoformat(), "talk": tv}
        health("notetaker", "resolved", "Notetaker self-test passed", f"Talk {tv}, reason: {reason}", "info")
        heal["updated"] = []
        log("selftest passed", reason)
        return True
    detail = diag_text(out)
    rolled = ""
    if heal.get("updated"):
        rollback()
        rolled = " The update that caused it was rolled back and blocked."
    heal["selftest"] = {"status": "failed", "reason": reason, "at": datetime.now(timezone.utc).isoformat(), "talk": tv, "error": err}
    health("notetaker", "problem", "Notetaker can't join Talk calls" + (" (test)" if quiet else ""),
           f"Self-test ({reason}) {err}.{rolled} Talk version {tv}. notetaker.js {sha(SYNC['notetaker/notetaker.js'])}.\n"
           "Until it's fixed, recordings fall back to voice matching.\n"
           "To fix: edit scripts/meetingrec/notetaker/notetaker.js in the site repo (the page selectors in the join "
           "section or WHO), commit to main, then run the recorder self-test. The Mac pulls main within 10 minutes.\n"
           + detail, "warning", healed=quiet)
    log("selftest failed", err)
    return False


def check_start_app():
    """The Desktop Start/Stop apps are how Jared (and Scout) start a recording. Tell Scout if they go missing."""
    app = find_start_app()
    heal["start_app"] = app
    home_desk = os.path.expanduser("~/Desktop/Start Recording.app")
    if not app:
        health("start_app", "problem", "Start Recording.app is missing",
               "Neither Jared nor Scout can start a call recording: Start Recording.app is not on the Desktop or in "
               "Applications. Find it (Spotlight: Start Recording) and put it back on the Desktop next to "
               "Stop & Transcribe.app.", "warning")
    elif app != home_desk:
        health("start_app", "problem", "The Start/Stop recording apps moved off the Desktop",
               f"Found at {app}. Scout still records (it looks there), but Jared won't see the buttons on his Desktop. "
               "iCloud Desktop & Documents does this. Move both apps back to the Desktop.", "info", healed=True)
    else:
        health("start_app", "resolved", "Start/Stop recording apps are on the Desktop", app, "info")


def check_scout_avatar():
    """Scout (notetaker) shows its avatar in the Talk call (camera stays off). Put the Scout mark back if it's gone."""
    try:
        req = urllib.request.Request(f"https://cloud.bestly.tech/avatar/{BOT_USER}/64", method="GET")
        with urllib.request.urlopen(req, timeout=15) as r:
            custom = r.headers.get("X-NC-IsCustomAvatar")
        if custom == "1":
            health("scout_avatar", "resolved", "Scout's picture shows in Talk calls", "", "info")
            return True
        pw = subprocess.run(["security", "find-generic-password", "-s", "nextcloud-notetaker", "-a", BOT_USER, "-w"],
                            capture_output=True, text=True).stdout.strip()
        with urllib.request.urlopen(SCOUT_AVATAR_URL, timeout=20) as r:
            png = r.read()
        boundary = "scoutavatar" + hashlib.sha256(png).hexdigest()[:12]
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"files[]\"; filename=\"scout.png\"\r\n"
                "Content-Type: image/png\r\n\r\n").encode() + png + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request("https://cloud.bestly.tech/index.php/avatar/", data=body, method="POST", headers={
            "OCS-APIRequest": "true", "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Authorization": "Basic " + base64.b64encode(f"{BOT_USER}:{pw}".encode()).decode()})
        with urllib.request.urlopen(req, timeout=30) as r:
            out = r.read().decode()[:300]
        with urllib.request.urlopen(f"https://cloud.bestly.tech/avatar/{BOT_USER}/64?t={int(time.time())}", timeout=15) as r:
            fixed = r.headers.get("X-NC-IsCustomAvatar") == "1"
        if fixed:
            health("scout_avatar", "resolved", "Scout's picture is back in Talk calls", "Re-uploaded the Scout mark.", "info")
            log("scout avatar re-uploaded")
            return True
        health("scout_avatar", "problem", "Scout's picture is missing in Talk calls",
               f"The scout-notetaker Nextcloud user has no picture, so Talk shows a letter. Re-upload failed: {out}. "
               "Fix: log in to cloud.bestly.tech as scout-notetaker and set the avatar to bestly.tech/scout-mark.png.")
    except Exception as e:  # noqa: BLE001
        log("avatar check failed", e)
    return False


def upkeep_checks():
    for f in (check_start_app, check_scout_avatar):
        try:
            f()
        except Exception as e:  # noqa: BLE001
            log("upkeep failed", f.__name__, e)


voicebank_job = {"running": False, "fails": 0}


def run_voicebank():
    """Hourly while idle: bank Jared's clean speech from new meetings into his Pro voice clone (voicebank.py), then tick
    the ava-voicebank edge function. Low priority, and voicebank.py stops between meetings if a recording starts.
    Problems go to the monitor as recorder.voicebank (two failures in a row, so one network blip doesn't page him)."""
    vb = f"{HOME}/voicebank.py"
    if not os.path.exists(vb):
        return
    py = f"{HOME}/.venv-diar/bin/python"
    py = py if os.path.exists(py) else "python3"
    voicebank_job["running"] = True
    try:
        r = subprocess.run(["nice", "-n", "15", py, vb], capture_output=True, text=True, timeout=3000, cwd=HOME)
        tail = (r.stdout + r.stderr)[-1500:]
        if r.returncode == 0:
            if voicebank_job["fails"] >= 2:
                health("voicebank", "resolved", "Voice bank is working again", tail, healed=True)
            voicebank_job["fails"] = 0
        else:
            voicebank_job["fails"] += 1
            log("voicebank failed", tail[-300:])
            if voicebank_job["fails"] == 2:
                health("voicebank", "problem", "Ava's voice bank failed twice in a row",
                       "voicebank.py on the Mac mini (Jared's Pro voice clone from his meetings) exited with an error twice.\n" + tail)
    except subprocess.TimeoutExpired:
        voicebank_job["fails"] += 1
        log("voicebank timed out")
    except Exception as e:  # noqa: BLE001
        log("voicebank run failed", e)
    finally:
        voicebank_job["running"] = False


mailspam_job = {"running": False, "next": 0}


def run_mailspam():
    """Every 60 s on a background thread: the Spam Desk worker (mailspam.py) junks and reports spam through Apple Mail.
    The file is loaded fresh each time, so a synced fix applies without a restart, and a broken or missing mailspam.py is
    only logged: it can never stop the recorder."""
    if mailspam_job["running"]:
        return
    mailspam_job["running"] = True
    try:
        path = f"{HOME}/mailspam.py"
        if not os.path.exists(path):
            return
        import importlib.util
        spec = importlib.util.spec_from_file_location("mailspam", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.tick(KEY, log)
    except Exception as e:  # noqa: BLE001
        log("mailspam failed", e)
    finally:
        mailspam_job["running"] = False


def heal_tick():
    """Idle-time upkeep: code sync, Talk version watch, daily self-test."""
    if recording_pid() or busy["stage"] or (heal["selftest"] or {}).get("status") == "running":
        return
    now = time.time()
    reason = None
    if now >= heal["next_sync"]:
        heal["next_sync"] = now + 600
        if sync_code():
            reason = "code updated from the repo"
            # a new agent.py only takes effect in a new process: exit while idle and launchd (KeepAlive) starts the new
            # one, which runs the self-test on boot (.agent-updated) and still rolls back if it fails
            if any(rel == "agent.py" for rel, _ in heal.get("updated", [])):
                open(f"{HOME}/.agent-updated", "w").write(json.dumps(heal["updated"]))
                log("agent.py updated; restarting into the new version")
                os._exit(0)
    if not reason and now >= heal["next_version_check"]:
        heal["next_version_check"] = now + 3600
        try:
            v = talk_version()
            old = read(f"{HOME}/.talk-version")
            if v and v != old:
                open(f"{HOME}/.talk-version", "w").write(v)
                if old:
                    reason = f"Talk updated {old} -> {v}"
        except Exception as e:  # noqa: BLE001
            log("version check failed", e)
    if now >= heal.get("next_voicebank", 120) and not voicebank_job["running"]:
        heal["next_voicebank"] = now + 3600
        threading.Thread(target=run_voicebank, daemon=True).start()
    if now >= heal.get("next_upkeep", 0):
        heal["next_upkeep"] = now + 3600
        threading.Thread(target=upkeep_checks, daemon=True).start()
    last = (heal["selftest"] or {}).get("at")
    if not reason and datetime.now().hour == 4 and (not last or now - datetime.fromisoformat(last).timestamp() > 20 * 3600):
        reason = "daily check"
    if reason:
        threading.Thread(target=run_selftest, args=(reason,), daemon=True).start()


# ── Auto-record: what to do ──────────────────────────────────────────────────

def auto_rooms_on():
    """The AUTO_ROOMS that are switched on right now (see the switches above AUTO_ROOMS)."""
    if os.path.exists(AUTO_OFF):
        return {}
    now = datetime.now(timezone.utc)
    out = {}
    for tok, cfg in AUTO_ROOMS.items():
        if os.path.exists(f"{AUTO_OFF}-{tok}"):
            continue
        try:
            if cfg.get("until") and now >= datetime.fromisoformat(cfg["until"]):
                continue
        except ValueError:
            pass
        out[tok] = cfg
    return out


def room_people(token):
    """The humans in the call in this room right now: [{id, name, type, sessions}].
    Someone counts only while Talk says they are in the call (inCall) AND has heard from them lately (lastPing): a closed laptop
    leaves its session behind for a minute or more, and the room's hasCall can stay true for days (Sep 29). The bots never count."""
    now = time.time()
    people = []
    for p in talk("GET", f"/room/{token}/participants", timeout=8):
        who = str(p.get("actorId") or "")
        if p.get("actorType") not in HUMAN_TYPES or who in BOTS:
            continue
        if not ((p.get("inCall") or 0) & 1):
            continue
        ping = p.get("lastPing") or 0
        if ping and now - ping > AUTO_FRESH_S:
            continue
        sessions = [s for s in (p.get("sessionIds") or []) if s]
        people.append({"id": who, "name": str(p.get("displayName") or who), "type": p.get("actorType"),
                       "sessions": max(1, len(sessions))})
    return people


JARED_NAME = re.compile(r"^jared(\s+best)?(\s*[(\[\-–—].*)?$", re.I)      # "Jared", "Jared Best", "Jared (Studio)", "jared [iPhone]"


def is_jared(p):
    """Jared himself: his Nextcloud user, or anyone in the call under his name (he can join from Studio, a browser or his phone, and
    a guest or an email-invited seat shows up under the name he typed)."""
    if p["type"] == "users" and p["id"] == "jared":
        return True
    return bool(JARED_NAME.match(str(p.get("name") or "").strip()))


def rule_holds(rule, people):
    if rule == "jared+1":
        return any(is_jared(p) for p in people) and any(not is_jared(p) for p in people)
    if rule == "any2":
        return sum(p["sessions"] for p in people) >= 2
    return False


def roster_from(people):
    """Names for the recording's roster: everyone in the call except Jared, the way the Mac writes them (a-z, 0-9, dash)."""
    names = []
    for p in people:
        if is_jared(p):
            continue
        raw = p["id"] if p["type"] == "users" else p["name"]
        if re.fullmatch(r"[0-9a-f]{32,}", raw.strip().lower()):
            continue                    # an invited-by-email guest whose name is just a hash
        n = re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", raw.strip().lower()))[:32]
        if n and n != "jared" and n not in names:
            names.append(n)
    return names


def auto_current():
    """The recording Scout started and is still running: {"name", "room", "started"}, else None."""
    try:
        cur = json.load(open(AUTO_FILE))
    except (OSError, ValueError):
        return None
    if recording_pid() and read(f"{HOME}/.current") == cur.get("name"):
        return cur
    if auto["stopping"] or busy["stage"] or stop_running_elsewhere():
        return None                     # it is being stopped right now: look again when that is over
    try:
        os.remove(AUTO_FILE)            # that recording is over
    except OSError:
        pass
    name = cur.get("name") or ""
    if name and not os.path.exists(f"{REC}/{name}-transcript.txt") and glob.glob(f"{REC}/{name}-*.m4a"):
        # The recorder ended and nobody stopped it: it died. The audio is on disk, but there is nothing to ingest.
        log("recording ended on its own, no transcript", name)
        write_meta(name, ended=recording_ended(name), alerted=True)
        alert_nofile(name, "The recorder stopped by itself in the middle of the call, so there is no transcript.")
        auto["blocked"].discard(cur.get("room"))        # if the call is still going, record the rest of it
    return None


def auto_failed(e, now):
    auto["fails"] += 1
    auto["next"] = now + min(60, 4 * auto["fails"])
    if auto["fails"] in (1, 5) or auto["fails"] % 30 == 0:
        log("auto-record can't read Talk", auto["fails"], e)
    if auto["fails"] >= 12 and not auto["talk_alert"]:         # about five minutes in a row
        auto["talk_alert"] = True
        health("talkread", "problem", "Scout can't see Talk calls",
               f"The Mac mini could not read Talk (cloud.bestly.tech) for about five minutes: {str(e)[:200]}\n"
               "Until it can, Scout will not start recording calls by itself. Start Recording on the Desktop still works.")


def auto_start(tok, cfg, people):
    roster = roster_from(people)
    now = time.time()
    auto["starts"] = [t for t in auto.get("starts", []) if now - t < 3600]
    if len(auto["starts"]) >= AUTO_MAX_STARTS:
        # Something is flapping (a recorder that keeps dying, a call that keeps emptying). Don't make a pile of recordings.
        auto["last_error"] = f"Scout already started {AUTO_MAX_STARTS} recordings in the last hour, so it will not start another by itself."
        auto["retry_at"] = now + 60
        return
    log("auto-start", tok, roster)
    auto["starts"].append(now)
    try:
        ok, _result, err = do_start({"roster": roster, "room": tok, "auto": True, "title": cfg.get("label")})
    except Exception as e:  # noqa: BLE001
        ok, err = False, str(e)
    if ok:
        auto["last_error"] = None
        auto["last_human"] = time.time()
        auto["empty_logged"] = False
        auto["blocked"].add(tok)
        mark_jared((_result or {}).get("name"), people)
        return
    auto["starts"].pop()                # it did not start: that one does not count
    auto["last_error"] = str(err or "unknown")[:300]
    auto["retry_at"] = time.time() + 30
    log("auto-start failed", auto["last_error"])


def auto_stop(cur, why):
    """Stop the recording Scout started: the normal stop, transcribe, upload, ingest, on its own thread."""
    auto["stopping"] = True
    log("auto-stop", cur["name"], why)

    def run():
        try:
            do_stop(None)
        except Exception as e:  # noqa: BLE001
            log("auto-stop failed", e)
        finally:
            auto["stopping"] = False
            auto["last_human"] = None
    threading.Thread(target=run, daemon=True).start()


def auto_idle():
    """Nothing may start: a recording or a stop is running, or the notetaker's self-test has the Chrome profile."""
    return bool(recording_pid() or busy["stage"] or stop_running_elsewhere() or auto["stopping"]
                or selftest_lock.locked() or (heal["selftest"] or {}).get("status") == "running")


def auto_tick():
    """Every loop. Starts a recording when the rule holds for AUTO_HOLD_S in one of the AUTO_ROOMS, stops one Scout started when
    nobody has been in the call for AUTO_EMPTY_S (or after AUTO_CAP_S), and tells Scout when something is wrong."""
    now = time.time()
    if now < auto["next"]:
        return
    cur = auto_current()
    rooms = auto_rooms_on()
    if cur and not auto["stopping"] and now - cur["started"] >= AUTO_CAP_S and not busy["stage"]:
        auto_stop(cur, "the 4-hour limit")
        cur = None
    watch = set(rooms)
    if cur and cur.get("room"):
        watch.add(cur["room"])
    verify_tick(now)
    recording = bool(recording_pid())
    # A recording somebody started by hand is never stopped for them, but a forgotten one (the 22-hour run) gets mentioned.
    started = read(f"{HOME}/.started")
    long_manual = bool(recording and not cur and started.isdigit() and now - int(started) > AUTO_LONG_S)
    if long_manual and not auto["long_alert"]:
        auto["long_alert"] = True
        health("longrec", "problem", "A recording has been running for hours",
               f"{read(f'{HOME}/.current')} started at {datetime.fromtimestamp(int(started)).strftime('%-I:%M %p on %b %-d')} and is still "
               "recording. If the call is over, tap Stop & Transcribe on the Mac mini's Desktop (or ask Scout to stop recording).")
    elif auto["long_alert"] and not long_manual:
        auto["long_alert"] = False
        health("longrec", "resolved", "That long recording has stopped", "", "info")
    if not watch:
        auto["next"] = now + 10
        return
    # One look at Talk: which of our rooms have a call. A room jared isn't in is skipped: reading it would be a failed room
    # read, and Nextcloud locks Talk out for a while after ten of those (Oct 18). noStatusUpdate: reading the list from this
    # script must not keep marking Jared as online.
    try:
        listing = {r["token"]: r for r in talk("GET", "/room?noStatusUpdate=1", timeout=8)}
    except Exception as e:  # noqa: BLE001
        return auto_failed(e, now)
    seen = {}
    for tok in watch:
        r = listing.get(tok)
        if r is None or r.get("type") == 1 or tok == heal.get("test_room") or r.get("displayName") == "Scout self-test":
            seen[tok] = None
            continue
        seen[tok] = []
        if r.get("hasCall"):
            try:
                seen[tok] = room_people(tok)
            except Exception as e:  # noqa: BLE001
                return auto_failed(e, now)
    auto["fails"] = 0
    if auto["talk_alert"]:
        auto["talk_alert"] = False
        health("talkread", "resolved", "Scout can see Talk calls again", "", "info")
    live = any(seen[t] for t in seen if seen[t])
    auto["next"] = now + (4 if (live or cur) else 10)

    # the rule, per room
    for tok in [t for t in auto["hold"] if t not in rooms]:
        auto["hold"].pop(tok, None)         # switched off (a .auto-off file, or the rehearsal room's end date)
    for tok, cfg in rooms.items():
        people = seen.get(tok)
        if people is None:
            auto["hold"].pop(tok, None)
            auto["rooms"].pop(tok, None)
            continue
        ok = rule_holds(cfg["rule"], people)
        if ok:
            auto["false_since"].pop(tok, None)
            if tok not in auto["hold"]:
                log("auto-record: the rule holds in", tok, [p["name"] for p in people][:6])
            auto["hold"].setdefault(tok, now)
            if recording:
                auto["blocked"].add(tok)    # a recording is running: don't start another, and don't restart it if it ends mid-call
        else:
            auto["hold"].pop(tok, None)
            if now - auto["false_since"].setdefault(tok, now) >= AUTO_REARM_S:
                auto["blocked"].discard(tok)
        auto["rooms"][tok] = {"live": bool(listing[tok].get("hasCall")), "people": len(people),
                              "jared": any(is_jared(p) for p in people), "ok": ok, "names": [p["name"] for p in people][:6]}

    # Remember that Jared is in the call: the Mac's mic may only stand in for him on a call he is in (talk_tracks.py, ingest)
    if cur:
        mark_jared(cur["name"], seen.get(cur["room"]))

    # the recording Scout started: stop it when the call is empty
    if cur and not busy["stage"] and not auto["stopping"] and seen.get(cur["room"]) is not None:
        if seen[cur["room"]] or auto["last_human"] is None:
            if auto.get("empty_logged"):
                log("auto-record: someone is back in the call", cur["room"])
            auto["empty_logged"] = False
            auto["last_human"] = now
        else:
            if not auto.get("empty_logged"):
                auto["empty_logged"] = True
                log("auto-record: nobody is in the call", cur["room"], f"- stopping in {AUTO_EMPTY_S} s unless someone comes back")
            if now - auto["last_human"] >= AUTO_EMPTY_S:
                auto_stop(cur, "everyone has left the call")

    # start
    if not auto_idle() and now >= auto.get("retry_at", 0):
        for tok, cfg in rooms.items():
            t0 = auto["hold"].get(tok)
            if t0 and tok not in auto["blocked"] and now - t0 >= AUTO_HOLD_S:
                auto_start(tok, cfg, seen[tok])
                break

    # watchdog: two people have been in the call a while and nothing is recording. A test room is watched too, but only in the log.
    waiting = [now - t for tok, t in auto["hold"].items() if tok not in auto["blocked"] and not quiet_room(tok)]
    held = max(waiting) if waiting else 0
    test_held = [t for tok, t in auto["hold"].items() if tok not in auto["blocked"] and quiet_room(tok)]
    if test_held and now - min(test_held) >= AUTO_ALERT_S and not recording:
        if not auto.get("test_alert"):
            auto["test_alert"] = True
            log("watchdog: a test-room call has gone", int(now - min(test_held)), "s with nothing recording (not reported)", auto["last_error"] or "")
    else:
        auto["test_alert"] = False
    if held >= AUTO_ALERT_S and not recording:
        if not auto["alert_open"]:
            auto["alert_open"] = True
            tok = next(t for t, s in auto["hold"].items() if t not in auto["blocked"] and not quiet_room(t))
            who = ", ".join(p["name"] for p in seen.get(tok) or [])
            since = datetime.fromtimestamp(auto["hold"][tok]).strftime("%-I:%M %p")
            why = auto["last_error"] or ("Scout is still saving the last call." if busy["stage"] or auto["stopping"] else "")
            if not why and (selftest_lock.locked() or (heal["selftest"] or {}).get("status") == "running"):
                why = "Scout is running its self-test and starts recording when it is done."
            health("autostart", "problem", f"A call is going and nothing is recording ({AUTO_ROOMS[tok].get('label', tok)})",
                   f"{who} have been in the call since {since}, and Scout has not started recording. {why}\n"
                   "To record it now: tap Start Recording on the Mac mini's Desktop, or ask Scout to start recording.", "error")
    elif auto["alert_open"] and (recording or held == 0):
        auto["alert_open"] = False
        health("autostart", "resolved", "Recording is running again" if recording else "That call ended", "", "info")


def auto_summary():
    """A small picture of the auto-recorder for the admin (meeting_recorder_state.info.auto)."""
    on = auto_rooms_on()
    return {"on": sorted(on), "rooms": {t: auto["rooms"].get(t) for t in on}, "blocked": sorted(auto["blocked"]),
            "test": sorted(t for t in on if quiet_room(t)), "err": auto["last_error"], "talk_fails": auto["fails"]}


# ── After a recording: client folder, and "did the admin really get it" ─────────

def name_time(name):
    """The local start time in a recording's name (meeting-YYYYMMDD-HHMM), else None."""
    m = re.match(r"meeting-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})", name or "")
    try:
        return datetime(*[int(x) for x in m.groups()]) if m else None
    except ValueError:
        return None


def recording_ended(name):
    """When the call ended (epoch seconds): what do_stop noted, else the last time the recorder wrote any audio."""
    e = read_meta(name).get("ended")
    if isinstance(e, (int, float)) and e > 0:
        return e
    times = []
    for p in glob.glob(f"{REC}/{name}-*.m4a"):
        try:
            times.append(os.path.getmtime(p))
        except OSError:
            pass
    return max(times) if times else None


def meeting_row(name):
    """What the admin has for this recording: {exists, deleted, row: {id, client_slug, room}}. None if it could not be asked."""
    try:
        r = call({"op": "meeting_exists", "name": name}, timeout=30)
        return r if r.get("ok") else None
    except Exception as e:  # noqa: BLE001
        log("row check failed", name, e)
        return None


def dav(method, rel, headers=None, timeout=180, body_path=None):
    """One WebDAV request on Jared's Nextcloud files. Returns the HTTP status, 0 if there was no answer."""
    h = {"Authorization": "Basic " + base64.b64encode(f"jared:{nc_password()}".encode()).decode()}
    h.update(headers or {})
    data = None
    if body_path:
        data = open(body_path, "rb")
        h["Content-Length"] = str(os.path.getsize(body_path))
    req = urllib.request.Request(DAV + "/" + urllib.parse.quote(rel), data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except Exception as e:  # noqa: BLE001
        log("webdav failed", method, rel, e)
        return 0
    finally:
        if data:
            data.close()


def shared_paths(folder):
    """The folders from the top of Jared's files down to this one that are shared with anyone (people, groups, links).
    [] when none is, None when Nextcloud could not be asked."""
    out, parts = [], folder.split("/")
    for i in range(1, len(parts) + 1):
        path = "/" + "/".join(parts[:i])
        req = urllib.request.Request(
            "https://cloud.bestly.tech/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json&path=" + urllib.parse.quote(path),
            headers={"OCS-APIRequest": "true", "Accept": "application/json",
                     "Authorization": "Basic " + base64.b64encode(f"jared:{nc_password()}".encode()).decode()})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                shares = json.loads(r.read().decode())["ocs"]["data"]
        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue                # that folder does not exist yet, so nothing shares it
            return None
        except Exception as e:  # noqa: BLE001
            log("share check failed", path, e)
            return None
        if shares:
            out.append(path)
    return out


def file_under_client(name, slug):
    """Copy this call's audio and transcripts into the client's own folder in Nextcloud; the day folder in Meeting Recordings keeps
    them too. A server-side COPY, so nothing is uploaded twice. The client folder must stay private to Jared: if it, or a folder
    above it, is shared with anyone, nothing is copied and Scout says so.
    True = filed (or was already), None = nothing to do, False = it failed and will be tried again."""
    folder = CLIENT_FOLDERS.get(slug or "")
    if not folder:
        return None
    if name in read(f"{HOME}/.client-filed").split():
        return True
    m = re.match(r"meeting-(\d{4})(\d{2})(\d{2})-", name)
    day = f"{m.group(1)}-{m.group(2)}-{m.group(3)}" if m else datetime.now().strftime("%Y-%m-%d")
    files = [f"{name}-{s}" for s in ("system.m4a", "mic.m4a", "room.m4a", "transcript.txt", "transcript-named.txt", "transcript-turns.txt")]
    files = [f for f in files if os.path.exists(f"{REC}/{f}")]
    if not jared_in_call(name):
        files = [f for f in files if not f.endswith("-mic.m4a")]        # the Mac's mic only heard a room Jared was not on the call from
    if not files:
        return None
    shared = shared_paths(folder)
    if shared is None:
        return False
    if shared:
        health("clientfile", "problem", "A call was not filed in the client's folder",
               f"{name} was not copied into {folder} because {', '.join(shared)} is shared with someone, and a call's transcript "
               "should not be seen by the client. It is still in Meeting Recordings and on the Mac mini. To file calls there again, "
               "stop sharing that folder (or move the Calls folder out of it).", name=name)
        return None
    path = ""
    for part in f"{folder}/{day}".split("/"):
        path = f"{path}/{part}" if path else part
        dav("MKCOL", path)                          # 201 made it, 405 was already there
    bad = []
    for f in files:
        dest = f"{folder}/{day}/{f}"
        code = dav("COPY", f"Meeting Recordings/{day}/{f}", {"Destination": f"{DAV}/{urllib.parse.quote(dest)}", "Overwrite": "T"})
        if code == 404:                             # the day folder doesn't have it (that upload failed): send it from here
            code = dav("PUT", dest, timeout=900, body_path=f"{REC}/{f}")
        if code not in (201, 204):
            bad.append(f"{f} (HTTP {code})")
    if bad:
        health("clientfile", "problem", "A call was not filed in the client's folder",
               f"{name}: could not copy {', '.join(bad)} into {folder}/{day}/. The files are still in Meeting Recordings/{day}/ "
               "and on the Mac mini. Scout tries again.", name=name)
        return False
    with open(f"{HOME}/.client-filed", "a") as f:
        f.write(name + "\n")
    log("filed under", folder, name, len(files), "files")
    health("clientfile", "resolved", "Calls are being filed in the client's folder", name, "info", name=name)
    return True


def alert_nofile(name, why, tail=""):
    t = name_time(name)
    when = t.strftime("%-I:%M %p on %b %-d") if t else ""
    health("nofile", "problem", "A call was recorded but Scout does not have it yet",
           f"{name}{' (started ' + when + ')' if when else ''} did not reach the admin. {why}\n"
           f"Nothing is lost: the audio is on the Mac mini in ~/MeetingRec/recordings (files start with {name}).\n{tail[-500:]}", "error",
           name=name)


def after_save(name, saved, err=None, tail=""):
    """A recording has been saved (its transcript is in the admin), or could not be."""
    m = read_meta(name)
    watched = bool(m.get("auto")) or recording_room(name) in AUTO_ROOMS
    if not saved:
        if err and watched:
            write_meta(name, alerted=True)
            alert_nofile(name, err[:300], tail)     # right away: there is nothing to wait for
        return
    row = meeting_row(name)
    if not (row and row.get("exists")):
        return                                      # verify_tick looks again 45 minutes after the call ended
    filed = file_under_client(name, (row.get("row") or {}).get("client_slug"))
    if watched and filed is not False:
        write_meta(name, verified=True)
        if m.get("alerted"):
            health("nofile", "resolved", "Scout has the call now", name, "info", name=name)


def check_row(name, m, now):
    """Forty-five minutes after a call ended, its row must be in the admin. Looks, tries to fix it, and tells Scout if it can't."""
    row = meeting_row(name)
    if row is None:
        return                                      # the admin could not be asked: try again next minute
    if row.get("exists") or row.get("deleted"):
        filed = file_under_client(name, (row.get("row") or {}).get("client_slug")) if row.get("exists") else None
        if filed is False:
            write_meta(name, recheck=now + 600)
            return
        write_meta(name, verified=True)
        if m.get("alerted"):
            health("nofile", "resolved", "Scout has the call now", name, "info", name=name)
        return
    if os.path.exists(f"{REC}/{name}-transcript.txt"):          # the transcript is here but never went up: send it now
        try:
            if ingest(name):
                if name not in read(INGESTED).split():
                    with open(INGESTED, "a") as f:
                        f.write(name + "\n")
                log("sent late", name)
                write_meta(name, recheck=now + 30)
                return
        except Exception as e:  # noqa: BLE001
            log("late ingest failed", name, e)
    if not m.get("alerted"):
        write_meta(name, alerted=True)
        alert_nofile(name, f"It has been {AUTO_ROW_S // 60} minutes since the call ended and the admin has no row for it.")
    write_meta(name, recheck=now + 600)


def verify_tick(now):
    """Once a minute: every recording from an AUTO room (or started by Scout) that ended 45 minutes ago must have its row in the admin."""
    if now < auto["verify_next"]:
        return
    auto["verify_next"] = now + 60
    try:
        names = sorted(f[:-5] for f in os.listdir(META_DIR) if f.endswith(".json"))
    except OSError:
        return
    live = read(f"{HOME}/.current") if (recording_pid() or busy["stage"] or stop_running_elsewhere()) else None
    for name in names:
        t = name_time(name)
        if t is None or datetime.now() - t > timedelta(days=3) or name == live:
            continue
        m = read_meta(name)
        if m.get("verified") or not (m.get("auto") or m.get("room") in AUTO_ROOMS):
            continue
        ended = recording_ended(name)
        if not ended or now - ended < AUTO_ROW_S or now < m.get("recheck", 0):
            continue
        try:
            check_row(name, m, now)
        except Exception as e:  # noqa: BLE001
            log("verify failed", name, e)


def snapshot():
    name = read(f"{HOME}/.current") or None
    roster = roster_list(read(f"{HOME}/.roster"))
    s = {"version": VERSION, "known_voices": known_voices(),
         "info": {"host": os.uname().nodename, "job": job["id"], "start_app": heal.get("start_app", "?")}}
    if heal["selftest"]:
        s["info"]["selftest"] = heal["selftest"]
    try:
        s["info"]["auto"] = auto_summary()
    except Exception as e:  # noqa: BLE001
        s["info"]["auto"] = {"error": str(e)[:120]}
    if name and (nt["proc"] or nt["status"] in ("no talk call", "talk unreachable", "looking", "gave up",
                                                "waiting for the call", "waiting for the self-test")) and recording_pid():
        s["info"]["notetaker"] = {"status": nt["status"], "room": nt["title"], "names": notetaker_names(name)}
    if busy["stage"] or stop_running_elsewhere():
        s.update(status="transcribing", current_name=name, roster=roster,
                 stage=busy["stage"] or read(f"{HOME}/.stage") or "transcribing", started_at=started_iso(name))
    elif recording_pid():
        s.update(status="recording", current_name=name, roster=roster, started_at=started_iso(name), stage=None)
    else:
        s.update(status="idle", current_name=None, roster=[], started_at=None, stage=None)
    return s


def new_recording_name():
    """meeting-YYYYMMDD-HHMM for right now. If that name is taken (two recordings in one minute), the next free minute:
    a second recording must never overwrite the first one's files or its row in the admin."""
    t = datetime.now()
    taken = set(read(INGESTED).split())
    name = "meeting-" + t.strftime("%Y%m%d-%H%M")
    for _ in range(60):
        name = "meeting-" + t.strftime("%Y%m%d-%H%M")
        if name not in taken and not glob.glob(f"{REC}/{name}-*") and not os.path.exists(f"{REC}/{name}.log"):
            break
        t += timedelta(minutes=1)
    return name


def do_start(payload):
    """Start the recorder. payload: roster (names besides Jared), room (the Talk room, when known: no guessing which call it is),
    auto (Scout started it by itself), title."""
    if recording_pid():
        return False, {"note": "already recording"}, "Already recording."
    if busy["stage"] or stop_running_elsewhere():
        return False, {"note": "transcribing"}, "Still transcribing the last call. Give it a minute."
    roster = [r for r in payload.get("roster", []) if re.fullmatch(r"[a-z0-9-]{1,32}", r)]
    room = str(payload.get("room") or "")
    room = room if re.fullmatch(r"[a-z0-9]{4,32}", room) else None
    name = new_recording_name()
    app = find_start_app()
    if not app:
        return False, {"name": name}, "Can't find Start Recording.app (looked on the Desktop and in Applications)."
    for attempt in (1, 2):
        # macOS only lets "Start Recording.app" capture the call (Screen Recording
        # permission belongs to that app), so hand it the names and open it.
        with open(f"{HOME}/.pending-name", "w") as f:
            f.write(name)
        with open(f"{HOME}/.pending-roster", "w") as f:
            f.write(",".join(roster) or "-")
        # ScreenCaptureKit needs an awake display ("no display" otherwise). Overnight the display sleeps and locks, so wake it,
        # keep it awake while the recorder starts, and give it a moment to come up before opening the app.
        subprocess.run(["/bin/sh", "-c", "caffeinate -u -t 15 >/dev/null 2>&1 &"], timeout=10)
        time.sleep(1.5)
        subprocess.run(["open", "-g", app], capture_output=True, text=True, timeout=30)
        for _ in range(15):
            time.sleep(1)
            if recording_pid():
                name = read(f"{HOME}/.current") or name         # what start.sh really called it
                write_meta(name, room=room, title=payload.get("title"), auto=True if payload.get("auto") else None)
                if payload.get("auto"):
                    with open(AUTO_FILE, "w") as f:
                        json.dump({"name": name, "room": room, "started": time.time()}, f)
                for f in (".pending-name", ".pending-roster"):      # start.sh takes these; if it didn't, don't leave them for the next start
                    try:
                        os.remove(f"{HOME}/{f}")
                    except OSError:
                        pass
                nt["next_try"] = 0          # the notetaker joins the call right away
                if not quiet_room(room):
                    notify("Recording", "Scout is recording this call.", ", ".join(roster) if roster else name)
                return True, {"name": name, "roster": roster, "room": room}, None
        log("recording did not start, try", attempt, read(f"{REC}/{name}.log")[-200:].replace("\n", " "))
    tail = read(f"{REC}/{name}.log")[-600:]
    for f in (".pending-name", ".pending-roster"):
        try:
            os.remove(f"{HOME}/{f}")
        except OSError:
            pass
    return False, {"name": name}, f"Recording didn't start. {tail}".strip()


def ingest(name):
    named = f"{REC}/{name}-transcript-named.txt"
    plain = f"{REC}/{name}-transcript.txt"
    text = read(named) or read(plain)
    if not text:
        return False
    if not jared_in_call(name):
        # Safety net: talk_tracks.py already left the Mac mic's lines out, but the fallback paths (no Talk tracks, a crash) must not
        # let them through either. On a call Jared was not in they are the room, not him.
        text, left_out = without_mic_lines(text)
        if left_out:
            text = "# Jared was not in this call, so the Mac mini's mic lines were left out.\n" + text
            log("ingest: Jared was not in", name, "- left out", left_out, "mic lines")
    speakers = {}
    try:
        speakers = json.load(open(f"/tmp/{name}-speakers.json"))
    except (OSError, ValueError):
        pass
    stopped = os.path.getmtime(plain) if os.path.exists(plain) else time.time()
    roster = speakers.get("roster") or (roster_list(read(f"{HOME}/.roster")) if read(f"{HOME}/.current") == name else [])
    started = started_iso(name) if read(f"{HOME}/.current") == name else None
    if not started:
        m = re.match(r"meeting-(\d{8})-(\d{4})", name)
        started = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M").astimezone(timezone.utc).isoformat()
    body = {"op": "ingest", "name": name, "transcript": text, "roster": roster, "speakers": speakers,
            "started_at": started, "stopped_at": datetime.fromtimestamp(stopped, timezone.utc).isoformat()}
    room = recording_room(name)
    if room:
        body["room"] = room         # the database turns the room into the client (approval_clients.talk_room)
    r = call(body, timeout=60)
    return bool(r.get("ok"))


def sweep_transcripts():
    """Send any finished transcript the admin hasn't got yet."""
    if not lock.acquire(blocking=False):
        return
    try:
        _sweep()
    finally:
        lock.release()


def _sweep():
    done = set(read(INGESTED).split())
    try:
        names = sorted({f[: -len("-transcript.txt")] for f in os.listdir(REC) if f.endswith("-transcript.txt")})
    except OSError:
        return
    for name in names:
        if name in done or name == busy.get("name"):
            continue
        # a transcript still being written: wait until stop.sh is finished
        if name == read(f"{HOME}/.current") and (busy["stage"] or stop_running_elsewhere()):
            continue
        try:
            if ingest(name):
                with open(INGESTED, "a") as f:
                    f.write(name + "\n")
                log("ingested", name)
                after_save(name, True)
        except Exception as e:  # noqa: BLE001
            log("ingest failed", name, e)
            return


def do_stop(cmd_id):
    """Stop the running recording, transcribe it, upload it, ingest it. cmd_id is Scout's stop command, or None when the agent
    stops a recording it started itself (auto_stop)."""
    name = read(f"{HOME}/.current")
    busy.update(stage="stopping", name=name)
    if read_meta(name):
        write_meta(name, ended=time.time())         # the 45-minute "is it in the admin" clock starts here
    ok, err, tail = True, None, ""
    try:
        env = dict(os.environ, SCOUT="1")
        p = subprocess.Popen([f"{HOME}/stop.sh"], cwd=HOME, env=env, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True)
        out = []
        for line in p.stdout:
            out.append(line)
            if line.startswith("== "):
                busy["stage"] = line.strip("= \n")
        p.wait(timeout=3 * 3600)
        tail = "".join(out)[-800:]
        if not os.path.exists(f"{REC}/{name}-transcript.txt"):
            ok, err = False, "No transcript came out. " + tail
    except Exception as e:  # noqa: BLE001
        ok, err = False, f"stop failed: {e}"
    busy.update(stage=None, name=None)
    saved = False
    try:
        if ok and ingest(name):
            saved = True
            with open(INGESTED, "a") as f:
                f.write(name + "\n")
    except Exception as e:  # noqa: BLE001
        log("stop ingest failed (the sweep tries again)", e)
    if cmd_id:
        try:
            call({"op": "result", "command_id": cmd_id, "ok": ok, "result": {"name": name}, "error": err})
        except Exception as e:  # noqa: BLE001
            log("stop report failed", e)
    try:
        if json.load(open(AUTO_FILE)).get("name") == name:
            os.remove(AUTO_FILE)                    # Scout's own recording is over
    except (OSError, ValueError):
        pass
    try:
        after_save(name, saved, err, tail)
    except Exception as e:  # noqa: BLE001
        log("after-save failed", name, e)
    if not quiet_recording(name):
        notify("Recording stopped", "Transcript is ready in Bestly admin." if ok else (err or "Stop failed."),
               name, "Glass" if ok else "Basso")
    log("stop", name, "ok" if ok else err)


def handle(cmd):
    action, cid = cmd.get("action"), cmd.get("id")
    log("command", action, cid)
    if action == "start":
        try:
            ok, result, err = do_start(cmd.get("payload") or {})
        except Exception as e:  # noqa: BLE001
            ok, result, err = False, None, str(e)
        call({"op": "result", "command_id": cid, "ok": ok, "result": result, "error": err})
    elif action == "selftest":
        if recording_pid() or busy["stage"]:
            call({"op": "result", "command_id": cid, "ok": False, "error": "Busy recording; try when idle."})
            return
        def go():
            sync_code()
            ok = run_selftest("asked for by Scout", quiet=bool((cmd.get("payload") or {}).get("quiet")))
            call({"op": "result", "command_id": cid, "ok": ok, "result": heal["selftest"],
                  "error": None if ok else (heal["selftest"] or {}).get("error")})
        threading.Thread(target=go, daemon=True).start()
    elif action == "stop":
        if not recording_pid():
            call({"op": "result", "command_id": cid, "ok": False, "error": "Nothing is recording."})
            return
        threading.Thread(target=do_stop, args=(cid,), daemon=True).start()
    else:
        call({"op": "result", "command_id": cid, "ok": False, "error": f"unknown action {action}"})


def run_job(j):
    jid = j["id"]
    job["id"] = jid
    with open(JOB_FILE, "w") as f:
        f.write(jid)
    out, code, err = [], None, None
    cwd = os.path.expanduser(j.get("cwd") or "~")
    timeout = int(j.get("timeout_s") or 300)
    log("job", jid, "start:", j.get("title"))

    def text():
        return "".join(out)

    try:
        if not os.path.isdir(cwd):
            raise RuntimeError(f"no such folder: {cwd}")
        env = dict(os.environ, BESTLY_JOB_ID=jid, TERM="dumb")
        p = subprocess.Popen(["/bin/zsh", "-l", "-c", j["script"]], cwd=cwd, env=env,
                             stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                             start_new_session=True)

        def pump():
            for raw in iter(p.stdout.readline, b""):
                out.append(raw.decode("utf-8", "replace"))
        t = threading.Thread(target=pump, daemon=True)
        t.start()
        deadline, last_push = time.time() + timeout, 0
        while p.poll() is None:
            time.sleep(0.5)
            if time.time() - last_push >= 2:
                last_push = time.time()
                try:
                    if call({"op": "job_output", "id": jid, "output": text()}).get("cancel"):
                        os.killpg(p.pid, signal.SIGTERM)
                        time.sleep(2)
                        if p.poll() is None:
                            os.killpg(p.pid, signal.SIGKILL)
                        err = "cancelled from the admin"
                        break
                except Exception as e:  # noqa: BLE001
                    log("job output push failed", e)
            if time.time() > deadline:
                os.killpg(p.pid, signal.SIGTERM)
                time.sleep(2)
                if p.poll() is None:
                    os.killpg(p.pid, signal.SIGKILL)
                err = f"timed out after {timeout}s"
                break
        p.wait()
        t.join(3)
        code = p.returncode
    except Exception as e:  # noqa: BLE001
        err = str(e)
    for attempt in range(5):
        try:
            call({"op": "job_done", "id": jid, "exit_code": code, "output": text(), "error": err})
            break
        except Exception as e:  # noqa: BLE001
            log("job_done failed", e)
            time.sleep(3 * (attempt + 1))
    log("job", jid, "exit", code, err or "")
    job["id"] = None
    try:
        os.remove(JOB_FILE)
    except OSError:
        pass


def orphan_job():
    """A job that was running when this agent last stopped (a restart, a reboot) is over."""
    jid = read(JOB_FILE).strip()
    if not jid:
        return
    try:
        call({"op": "job_done", "id": jid, "exit_code": None, "output": "",
              "error": "the agent restarted while this was running (fine if the job restarted it)"})
        os.remove(JOB_FILE)
    except Exception as e:  # noqa: BLE001
        log("orphan job report failed", e)


# ── Supabase watchdog ────────────────────────────────────────────────────────
# Everything that watches Bestly - the monitors, the fix ladder, the alert bell -
# lives inside Supabase, so when Supabase itself goes down nothing is left to
# notice. This Mac is the only thing outside it that talks to it every three
# seconds, so it is the watchdog. Alerts go through ~/bin/hapush (ntfy retired 2026-09-27):
# ssh to the Pi, which pushes via Home Assistant directly when Supabase is down - a route
# that does not need the database, which is the whole point.
HAPUSH = os.path.expanduser("~/bin/hapush")
down = {"since": None, "told": 0}
DOWN_AFTER_S = 180          # a blip is not an outage
REMIND_EVERY_S = 900


def ntfy(title, body, priority="urgent", tags="rotating_light"):
    """Name kept for callers. Pushes via Home Assistant (~/bin/hapush) on a background
    thread so a slow ssh never stalls the 3-second poll loop."""
    def _send():
        try:
            r = subprocess.run([HAPUSH, title, body, str(priority), "Mac MeetingRec"],
                               capture_output=True, text=True, timeout=90)
            if r.returncode:
                log("hapush failed", r.returncode, (r.stderr or "").strip()[:200])
        except Exception as e:  # noqa: BLE001
            log("hapush failed", e)
    threading.Thread(target=_send, daemon=True).start()


def watch_backend(ok):
    """Called after every poll. Shouts, by a route that does not touch Supabase."""
    now = time.time()
    if ok:
        if down["since"] and now - down["since"] >= DOWN_AFTER_S:
            mins = int((now - down["since"]) / 60)
            notify("Bestly is back", f"Supabase answered again after {mins} min.", "", "Glass")
            ntfy("Bestly is back", f"Supabase answered again after {mins} minutes.", "default", "white_check_mark")
        down.update(since=None, told=0)
        return
    if down["since"] is None:
        down["since"] = now
        return
    out = now - down["since"]
    if out < DOWN_AFTER_S or now - down["told"] < REMIND_EVERY_S:
        return
    down["told"] = now
    mins = int(out / 60)
    msg = (f"Supabase has not answered for {mins} minutes. The admin dashboard, the partner "
           "portal and every scheduled job are down with it.\n\n"
           "Fix: Supabase dashboard > Project Settings > General > Restart project.")
    log("BACKEND DOWN", f"{mins} min")
    notify("Bestly backend is down", f"Supabase unreachable for {mins} min. Restart the project.", "", "Basso")
    ntfy(f"Bestly backend down {mins} min", msg)


def main():
    log("agent", VERSION, "up")
    orphan_job()
    if os.path.exists(f"{HOME}/.agent-updated"):
        try:
            heal["updated"] = [tuple(x) for x in json.loads(read(f"{HOME}/.agent-updated") or "[]")]
        except ValueError:
            heal["updated"] = []
        os.remove(f"{HOME}/.agent-updated")
        threading.Thread(target=run_selftest, args=(f"agent updated to {VERSION}",), daemon=True).start()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    last_sweep = 0
    while True:
        try:
            try:
                auto_tick()
            except Exception as e:  # noqa: BLE001
                auto["next"] = time.time() + 10
                if auto.get("tick_err") != str(e):
                    auto["tick_err"] = str(e)
                    log("auto-record tick failed", traceback.format_exc()[-600:])
            try:
                notetaker_tick()
                heal_tick()
            except Exception as e:  # noqa: BLE001
                log("notetaker/heal tick failed", e)
            try:
                if time.time() >= mailspam_job["next"]:
                    mailspam_job["next"] = time.time() + 60
                    threading.Thread(target=run_mailspam, daemon=True).start()
            except Exception as e:  # noqa: BLE001
                log("mailspam start failed", e)
            r = call({"op": "poll", "state": snapshot(), "can_run_jobs": job["id"] is None})
            watch_backend(True)
            if r.get("job") and job["id"] is None:
                job["id"] = r["job"]["id"]
                threading.Thread(target=run_job, args=(r["job"],), daemon=True).start()
            if r.get("command"):
                handle(r["command"])
                continue            # poll again right away so Scout sees the change
            if time.time() - last_sweep > 30:
                last_sweep = time.time()
                threading.Thread(target=sweep_transcripts, daemon=True).start()
        except Exception as e:  # noqa: BLE001
            log("poll error", e)
            watch_backend(False)
            if "--debug" in sys.argv:
                traceback.print_exc()
            time.sleep(10)
        time.sleep(POLL_S)


if __name__ == "__main__":
    main()
