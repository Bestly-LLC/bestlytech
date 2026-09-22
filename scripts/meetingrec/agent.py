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
import base64, hashlib, json, os, re, shutil, signal, subprocess, sys, threading, time, traceback, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timezone

VERSION = "1.6.0"
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
nt = {"proc": None, "name": None, "room": None, "title": None, "next_try": 0, "status": "off", "fails": 0}

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
        "agent.py": f"{HOME}/agent.py"}
BAD = f"{HOME}/.bad-versions"
heal = {"next_sync": 0, "next_version_check": 0, "selftest": None, "last": None, "verify_after_update": False}
START_APPS = [os.path.expanduser(p) for p in (
    "~/Desktop/Start Recording.app", "~/Applications/Start Recording.app", "/Applications/Start Recording.app")]

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


def notetaker_tick():
    """While a recording runs, get the notetaker into the Talk call and keep it there."""
    name = read(f"{HOME}/.current")
    if nt["proc"] and nt["proc"].poll() is not None:
        code = nt["proc"].returncode
        log("notetaker exited", code)
        nt["proc"] = None
        out = f"{REC}/{nt['name']}-talk"
        if code != 0:
            nt["fails"] += 1
            health("notetaker", "problem", "Notetaker dropped out of a live call",
                   f"Exit {code} on {nt['title']} (try {nt['fails']} of 3). This call falls back to voice matching "
                   "if it can't rejoin.\nTo fix: scripts/meetingrec/notetaker/notetaker.js in the site repo, then run "
                   "the recorder self-test.\n" + diag_text(out))
            if nt["fails"] >= 3:
                nt["status"] = "gave up"
                nt["next_try"] = time.time() + 10 ** 9
        elif notetaker_names(nt["name"]):
            health("notetaker", "resolved", "Notetaker worked on a live call", nt["title"] or "", "info")
        if not recording_pid() and nt["room"]:
            remove_bot(nt["room"])
            nt.update(room=None, status="done")
    rec = recording_pid()
    if not rec:
        if nt["proc"]:
            open(f"{REC}/{nt['name']}-talk/STOP", "w").close()
        return
    if nt["name"] != name:
        nt.update(name=name, room=None, title=None, next_try=0, status="looking", fails=0)
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


def health(key, kind, title="", body="", severity="warning", healed=False):
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
    heal["updated"] = []


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
    last = (heal["selftest"] or {}).get("at")
    if not reason and datetime.now().hour == 4 and (not last or now - datetime.fromisoformat(last).timestamp() > 20 * 3600):
        reason = "daily check"
    if reason:
        threading.Thread(target=run_selftest, args=(reason,), daemon=True).start()


def snapshot():
    name = read(f"{HOME}/.current") or None
    roster = roster_list(read(f"{HOME}/.roster"))
    s = {"version": VERSION, "known_voices": known_voices(), "info": {"host": os.uname().nodename, "job": job["id"]}}
    if heal["selftest"]:
        s["info"]["selftest"] = heal["selftest"]
    if name and (nt["proc"] or nt["status"] in ("no talk call", "talk unreachable", "looking", "gave up")) and recording_pid():
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
            notify("Recording", "Scout is recording this call.",
                   ", ".join(roster) if roster else name)
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
# seconds, so it is the watchdog. ntfy is a different service on a different
# network path, which is the whole point: it still works when the database does not.
NTFY = "https://ntfy.sh/bestly-sysalert-7q2k9mx4"
down = {"since": None, "told": 0}
DOWN_AFTER_S = 180          # a blip is not an outage
REMIND_EVERY_S = 900


def ntfy(title, body, priority="urgent", tags="rotating_light"):
    try:
        req = urllib.request.Request(NTFY, data=body.encode(), method="POST",
                                     headers={"Title": title, "Priority": priority, "Tags": tags})
        urllib.request.urlopen(req, timeout=10).read()
    except Exception as e:  # noqa: BLE001
        log("ntfy failed", e)


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
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    last_sweep = 0
    while True:
        try:
            try:
                notetaker_tick()
                heal_tick()
            except Exception as e:  # noqa: BLE001
                log("notetaker/heal tick failed", e)
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
