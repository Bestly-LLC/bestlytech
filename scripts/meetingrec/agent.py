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
import base64, json, os, re, signal, subprocess, sys, threading, time, traceback, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

VERSION = "1.2.0"
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
nt = {"proc": None, "name": None, "room": None, "title": None, "next_try": 0, "status": "off"}
START_APPS = [os.path.expanduser(p) for p in (
    "~/Desktop/Start Recording.app", "~/Applications/Start Recording.app", "/Applications/Start Recording.app")]

busy = {"stage": None}          # set while this agent is running stop.sh
lock = threading.Lock()


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


def talk(method, path, data=None):
    pw = subprocess.run(["security", "find-generic-password", "-s", "nextcloud-meetingrec", "-a", "jared", "-w"],
                        capture_output=True, text=True).stdout.strip()
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(TALK_API + path, data=body, method=method, headers={
        "OCS-APIRequest": "true", "Accept": "application/json",
        "Authorization": "Basic " + base64.b64encode(f"jared:{pw}".encode()).decode()})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())["ocs"]["data"]


def active_room():
    """The Talk room with a call going on - the one Jared is in, if we can tell."""
    rooms = talk("GET", "/room")
    live = [r for r in rooms if r.get("hasCall")]
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


def notetaker_tick():
    """While a recording runs, get the notetaker into the Talk call and keep it there."""
    name = read(f"{HOME}/.current")
    if nt["proc"] and nt["proc"].poll() is not None:
        log("notetaker exited", nt["proc"].returncode)
        nt["proc"] = None
        if not recording_pid() and nt["room"]:
            remove_bot(nt["room"])
            nt.update(room=None, status="done")
    rec = recording_pid()
    if not rec:
        if nt["proc"]:
            open(f"{REC}/{nt['name']}-talk/STOP", "w").close()
        return
    if nt["name"] != name:
        nt.update(name=name, room=None, title=None, next_try=0, status="looking")
    if nt["proc"] or time.time() < nt["next_try"] or not os.path.exists(f"{NT_DIR}/notetaker.js"):
        return
    nt["next_try"] = time.time() + 15
    try:
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
    nt.update(room=token, title=title, status="in call")
    log("notetaker joining", token, title)


def snapshot():
    name = read(f"{HOME}/.current") or None
    roster = roster_list(read(f"{HOME}/.roster"))
    s = {"version": VERSION, "known_voices": known_voices(), "info": {"host": os.uname().nodename}}
    if name and (nt["proc"] or nt["status"] in ("no talk call", "talk unreachable", "looking")) and recording_pid():
        s["info"]["notetaker"] = {"status": nt["status"], "room": nt["title"], "names": notetaker_names(name)}
    if busy["stage"] or stop_running_elsewhere():
        s.update(status="transcribing", current_name=name, roster=roster,
                 stage=busy["stage"] or read(f"{HOME}/.stage") or "transcribing", started_at=started_iso(name))
    elif recording_pid():
        s.update(status="recording", current_name=name, roster=roster, started_at=started_iso(name), stage=None)
    else:
        s.update(status="idle", current_name=None, roster=[], started_at=None, stage=None)
    return s


def do_start(payload):
    if recording_pid():
        return False, {"note": "already recording"}, "Already recording."
    roster = [r for r in payload.get("roster", []) if re.fullmatch(r"[a-z0-9-]{1,32}", r)]
    name = "meeting-" + datetime.now().strftime("%Y%m%d-%H%M")
    # macOS only lets "Start Recording.app" capture the call (Screen Recording
    # permission belongs to that app), so hand it the names and open it.
    with open(f"{HOME}/.pending-name", "w") as f:
        f.write(name)
    with open(f"{HOME}/.pending-roster", "w") as f:
        f.write(",".join(roster) or "-")
    app = next((a for a in START_APPS if os.path.isdir(a)), None)
    if not app:
        return False, {"name": name}, "Can't find Start Recording.app (looked on the Desktop and in Applications)."
    # ScreenCaptureKit needs an awake display ("no display" otherwise).
    subprocess.run(["caffeinate", "-u", "-t", "2"], capture_output=True, timeout=10)
    subprocess.run(["open", "-g", app], capture_output=True, text=True, timeout=30)
    for _ in range(20):
        time.sleep(1)
        if recording_pid():
            return True, {"name": name, "roster": roster}, None
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
    r = call({"op": "ingest", "name": name, "transcript": text, "roster": roster, "speakers": speakers,
              "started_at": started, "stopped_at": datetime.fromtimestamp(stopped, timezone.utc).isoformat()}, timeout=60)
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
        except Exception as e:  # noqa: BLE001
            log("ingest failed", name, e)
            return


def do_stop(cmd_id):
    name = read(f"{HOME}/.current")
    busy.update(stage="stopping", name=name)
    ok, err = True, None
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
        if not os.path.exists(f"{REC}/{name}-transcript.txt"):
            ok, err = False, "No transcript came out. " + "".join(out)[-800:]
    except Exception as e:  # noqa: BLE001
        ok, err = False, f"stop failed: {e}"
    busy.update(stage=None, name=None)
    try:
        if ok and ingest(name):
            with open(INGESTED, "a") as f:
                f.write(name + "\n")
        call({"op": "result", "command_id": cmd_id, "ok": ok, "result": {"name": name}, "error": err})
    except Exception as e:  # noqa: BLE001
        log("stop report failed", e)
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
    elif action == "stop":
        if not recording_pid():
            call({"op": "result", "command_id": cid, "ok": False, "error": "Nothing is recording."})
            return
        threading.Thread(target=do_stop, args=(cid,), daemon=True).start()
    else:
        call({"op": "result", "command_id": cid, "ok": False, "error": f"unknown action {action}"})


def main():
    log("agent", VERSION, "up")
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    last_sweep = 0
    while True:
        try:
            try:
                notetaker_tick()
            except Exception as e:  # noqa: BLE001
                log("notetaker tick failed", e)
            r = call({"op": "poll", "state": snapshot()})
            if r.get("command"):
                handle(r["command"])
                continue            # poll again right away so Scout sees the change
            if time.time() - last_sweep > 30:
                last_sweep = time.time()
                threading.Thread(target=sweep_transcripts, daemon=True).start()
        except Exception as e:  # noqa: BLE001
            log("poll error", e)
            if "--debug" in sys.argv:
                traceback.print_exc()
            time.sleep(10)
        time.sleep(POLL_S)


if __name__ == "__main__":
    main()
