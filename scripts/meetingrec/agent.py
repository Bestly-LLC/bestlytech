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
import json, os, re, signal, subprocess, sys, threading, time, traceback, urllib.request
from datetime import datetime, timezone

VERSION = "1.1.0"
HOME = os.path.expanduser("~/MeetingRec")
REC = f"{HOME}/recordings"
URL = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/meeting-recorder"
KEY = open(f"{HOME}/.agent-key").read().strip()
LOG = f"{HOME}/agent.log"
INGESTED = f"{HOME}/.ingested"
POLL_S = 3
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


def snapshot():
    name = read(f"{HOME}/.current") or None
    roster = roster_list(read(f"{HOME}/.roster"))
    s = {"version": VERSION, "known_voices": known_voices(), "info": {"host": os.uname().nodename}}
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
