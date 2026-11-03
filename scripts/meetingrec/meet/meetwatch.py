#!/usr/bin/env python3
"""Scout Notetaker for Google Meet (Mac mini). launchd job tech.bestly.meetwatch.

Every 20 s it: reads Meet calls from Jared's invites (bestly_mail, via the meeting-recorder edge function) and Jared's own Google calendar,
keeps them in the meet_watch table, starts meetbot.js (a visible guest, "Scout Notetaker (recording)") about a minute before each call,
turns the recording + Meet captions into a named transcript, files it exactly like a Talk recording (meeting_recordings, source
'google-meet'; the existing debrief / to-do pipeline fires on the insert), and watches all of it (alerts recorder.meet.*, heartbeat
pi_jobs 'meet_watch').

Why a fallback: Meet turns an anonymous guest away unless the host allows "anyone with the link can ask to join" (Eli's calendar
invites usually do not). When the bot is turned away, the watcher asks agent.py to record this Mac's audio instead (Start Recording
app: system audio + mic; works when Jared is on the call from this Mac). See README.

Kill switches: touch ~/MeetingRec/.meet-off (everything), ~/MeetingRec/.meet-skip-<abc-defg-hij> (one call), meet_watch.skip = true.
"""
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import meetparse  # noqa: E402

HOME = os.path.expanduser("~/MeetingRec")
MEET = f"{HOME}/meet"
REC = f"{HOME}/recordings"
URL = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1"
NODE = os.path.expanduser("~/.local/node/bin/node")
FFMPEG = f"{HOME}/bin/ffmpeg"
SCRIBE = f"{HOME}/bin/talkscribe"
LOG = f"{MEET}/meetwatch.log"
RUNS = f"{MEET}/runs"
PT = ZoneInfo("America/Los_Angeles")
KILL = f"{HOME}/.meet-off"
try:
    KEY = open(f"{HOME}/.agent-key").read().strip()
except OSError:
    KEY = ""

TICK_S = 20
SYNC_EVERY_S = 300
SYNC_STALE_S = 2 * 3600
JOIN_LEAD_S = 60               # start the bot this long before the call
BOT_LATE_S = 180               # a watched call has started and the bot is not in it after this long: relaunch once, then alert
END_GRACE_S = 30 * 60          # the bot gives up this long after the scheduled end
VERIFY_AFTER_S = 45 * 60       # no meeting_recordings row this long after a watched call ended: re-ingest, then alert
LOCAL_STOP_AFTER_END_S = 10 * 60
KNOCK_S = 600
OWN = ("jared@bestly.tech", "jareds.mac@gmail.com")
KNOWN = {
    "eli.cooper@bdcuniversal.com": "eli-cooper",
    "elizabethobrienlpc@gmail.com": "elizabeth-obrien",
    "samantha@prairiemovement.com": "sam-cauthon",
}
CLIENTS = [(re.compile(r"centering\s*you", re.I), "centering-you")]
JARED_RE = re.compile(r"^jared(\s+best)?(\s*[(\[\-–—].*)?$", re.I)


def log(*a):
    try:
        with open(LOG, "a") as f:
            f.write(datetime.now().strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(x) for x in a) + "\n")
    except OSError:
        pass


def call(fn, body, timeout=30):
    req = urllib.request.Request(f"{URL}/{fn}", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "x-recorder-key": KEY})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def rec(body, timeout=30):
    return call("meeting-recorder", body, timeout)


def health(key, kind, title="", body="", severity="warning", healed=False):
    """Alert Scout (owner: Scout Notetaker, key recorder.meet.<key>). Problems reach Jared only through the 7 AM digest / bell."""
    try:
        rec({"op": "health", "key": f"meet.{key}", "kind": kind, "title": title, "body": body[:3500], "severity": severity, "healed": healed})
    except Exception as e:  # noqa: BLE001
        log("health report failed", key, e)


def parse_ts(s):
    return datetime.fromisoformat(str(s).replace("Z", "+00:00"))


def now_utc():
    return datetime.now(timezone.utc)


# ── transcripts ──────────────────────────────────────────────────────────────

def label(n):
    n = (n or "").strip()
    if JARED_RE.match(n):
        return "JARED"
    return re.sub(r"[^A-Z0-9-]", "", re.sub(r"\s+", "-", n.upper())) or "SPEAKER"


def slug(n):
    return re.sub(r"[^a-z0-9-]", "", re.sub(r"\s+", "-", (n or "").strip().lower()))[:32]


def merge_words(cur, new):
    """Meet captions grow in place and scroll off the front. cur / new are word lists; returns the merged list."""
    if not cur:
        return list(new)
    if len(new) >= len(cur) and new[: min(len(cur), 4)] == cur[: min(len(cur), 4)]:
        return list(new)                                    # same utterance, longer
    cs, ns = " ".join(cur), " ".join(new)
    if ns in cs:
        return cur                                          # older / shorter echo
    for k in range(min(len(cur), len(new)), 1, -1):         # scrolled: the end of cur is the start of new
        if cur[-k:] == new[:k]:
            return cur + new[k:]
    return cur + new


def build_utterances(snaps, gap_s=12):
    """snaps: [{t (epoch ms), name, text}] in order -> [{name, t0, t1, text}] (t in epoch seconds)."""
    open_by = {}
    out = []
    for s in snaps:
        name = (s.get("name") or "").strip()
        text = (s.get("text") or "").strip()
        if not name or not text or name.lower() == "you":
            continue
        t = s["t"] / 1000.0
        words = text.split()
        cur = open_by.get(name)
        if cur and t - cur["t1"] <= gap_s:
            cur["words"] = merge_words(cur["words"], words)
            cur["t1"] = t
        else:
            cur = {"name": name, "t0": t, "t1": t, "words": words}
            open_by[name] = cur
            out.append(cur)
    return [{"name": u["name"], "t0": u["t0"], "t1": u["t1"], "text": " ".join(u["words"])} for u in out]


def pick_speaker(utts, t_abs, lead=3.0, tail=2.0):
    """The caption utterance that was being shown when a whisper segment starting at t_abs (epoch s) was spoken (captions lag speech)."""
    best, best_d = None, 1e9
    for u in utts:
        lo, hi = u["t0"] - lead, u["t1"] + tail
        d = 0 if lo <= t_abs <= hi else min(abs(t_abs - lo), abs(t_abs - hi))
        if d < best_d:
            best, best_d = u, d
    return best["name"] if best is not None and best_d <= 8 else None


def mmss(sec):
    sec = max(0, int(sec))
    return f"[{sec // 60:02d}:{sec % 60:02d}]"


def build_transcript(segs, utts, t0):
    """segs: [(seconds into the audio, text)] from whisper; utts: caption utterances; t0: epoch seconds of audio start.
    Returns (lines, people {name: lines}, source)."""
    lines, people = [], {}
    if segs:
        for sec, text in segs:
            who = pick_speaker(utts, t0 + sec) or "Speaker"
            lines.append((sec, label(who), text))
            people[who] = people.get(who, 0) + 1
        src = "audio+captions" if utts else "audio"
    else:
        for u in utts:
            lines.append((u["t0"] - t0, label(u["name"]), u["text"]))
            people[u["name"]] = people.get(u["name"], 0) + 1
        src = "captions" if utts else "none"
    lines.sort(key=lambda r: r[0])
    return [f"{mmss(sec)} {lab}: {txt}" for sec, lab, txt in lines], people, src


def same_person(a, b):
    """'samantha-cauthon' and 'sam-cauthon' are one person: same last word, first words start alike."""
    if a == b or a in b or b in a:
        return True
    pa, pb = a.split("-"), b.split("-")
    return len(pa) > 1 and len(pb) > 1 and pa[-1] == pb[-1] and pa[0][:3] == pb[0][:3]


def roster_from(guests, caption_names):
    out = []
    for g in guests or []:
        g = g.lower()
        if g in OWN:
            continue
        s = KNOWN.get(g) or slug(g.split("@")[0].replace(".", "-"))
        if s and s not in out:
            out.append(s)
    for n in caption_names:
        if JARED_RE.match(n or "") or (n or "").lower() == "you":
            continue
        s = slug(n)
        if s and not any(same_person(s, r) for r in out):
            out.append(s)
    return out


def row_people(row):
    """Everyone the invite names: the guests plus the organizer."""
    return list(row.get("guests") or []) + ([row["organizer"]] if row.get("organizer") else [])


def client_for(row):
    if row.get("client_slug"):
        return row["client_slug"]
    for rx, slg in CLIENTS:
        if rx.search(row.get("title") or ""):
            return slg
    return None


def rec_name(row):
    return "meeting-" + parse_ts(row["starts_at"]).astimezone(PT).strftime("%Y%m%d-%H%M")


# ── bot runs ─────────────────────────────────────────────────────────────────
procs = {}          # row id -> {"p": Popen|None, "pid", "dir", "name", "t0", "relaunched", "kind": "bot"|"local"}


def pid_alive(pid):
    try:
        os.kill(int(pid), 0)
        return True
    except (OSError, ValueError, TypeError):
        return False


def run_file(rid):
    return f"{RUNS}/{rid}.json"


def save_run(rid):
    r = procs[rid]
    d = {k: v for k, v in r.items() if k != "p"}
    json.dump(d, open(run_file(rid), "w"))


def load_runs():
    os.makedirs(RUNS, exist_ok=True)
    for f in os.listdir(RUNS):
        if f.endswith(".json"):
            try:
                d = json.load(open(f"{RUNS}/{f}"))
                procs[f[:-5]] = dict(d, p=None)
            except (OSError, ValueError):
                pass


def free_gb():
    st = os.statvfs(HOME)
    return st.f_bavail * st.f_frsize / 1e9


def launch_bot(row, relaunch=False):
    name = rec_name(row)
    out = f"{REC}/{name}-meet"
    os.makedirs(out, exist_ok=True)
    try:
        os.remove(f"{out}/STOP")
    except OSError:
        pass
    end_ms = int((parse_ts(row["ends_at"]).timestamp() + END_GRACE_S) * 1000)
    cmd = [NODE, f"{MEET}/meetbot.js", row["meet_url"], out, f"--end-at={end_ms}", f"--knock-s={KNOCK_S}", f"--start-at={int(parse_ts(row['starts_at']).timestamp() * 1000)}"]
    p = subprocess.Popen(cmd, cwd=MEET, stdout=open(f"{out}/stdout.log", "a"), stderr=subprocess.STDOUT, start_new_session=True)
    procs[row["id"]] = {"p": p, "pid": p.pid, "dir": out, "name": name, "t0": time.time(), "relaunched": relaunch or procs.get(row["id"], {}).get("relaunched", False), "kind": "bot"}
    save_run(row["id"])
    log("bot launched", row["meet_code"], name, "pid", p.pid, "relaunch" if relaunch else "")
    upd(row["id"], status="joining", recording_name=name, attempts=(row.get("attempts") or 0) + 1)


def upd(rid, **patch):
    try:
        rec({"op": "meet_update", "id": rid, "patch": patch})
    except Exception as e:  # noqa: BLE001
        log("meet_update failed", rid, e)


def bot_state(r):
    try:
        return json.load(open(f"{r['dir']}/alive.json"))
    except (OSError, ValueError):
        return {}


def bot_exit_code(r):
    p = r.get("p")
    if p is not None:
        return p.poll()
    return None if pid_alive(r.get("pid")) else -999       # adopted after a restart: we only know it is gone


def kill_bot(r):
    try:
        os.killpg(os.getpgid(int(r["pid"])), signal.SIGTERM)
    except (OSError, ValueError):
        pass
    for _ in range(15):
        if not pid_alive(r.get("pid")):
            return
        time.sleep(1)
    try:
        os.killpg(os.getpgid(int(r["pid"])), signal.SIGKILL)
    except (OSError, ValueError):
        pass


# ── local fallback (agent.py records this Mac's audio) ────────────────────────
def start_local(row):
    roster = roster_from(row_people(row), [])
    try:
        os.remove(f"{HOME}/.start-result.json")
    except OSError:
        pass
    json.dump({"roster": roster, "title": row.get("title") or "", "client_slug": client_for(row), "source": "google-meet"}, open(f"{HOME}/.start-request.json", "w"))
    for _ in range(40):
        time.sleep(1)
        try:
            res = json.load(open(f"{HOME}/.start-result.json"))
            return res
        except (OSError, ValueError):
            pass
    return {"ok": False, "error": "the recorder agent did not answer"}


# ── post-processing ──────────────────────────────────────────────────────────
def read_caps(out):
    snaps = []
    try:
        for line in open(f"{out}/captions.jsonl"):
            try:
                snaps.append(json.loads(line))
            except ValueError:
                pass
    except OSError:
        pass
    return snaps


def transcribe(out, name):
    """audio.webm -> <name>-system.m4a -> [(sec, text)]. Empty list when there is no usable audio."""
    webm, m4a = f"{out}/audio.webm", f"{REC}/{name}-system.m4a"
    if not os.path.exists(webm) or os.path.getsize(webm) < 4000:
        return []
    if not os.path.exists(m4a):
        subprocess.run([FFMPEG, "-loglevel", "error", "-y", "-i", webm, "-ac", "1", "-c:a", "aac", "-b:a", "64k", m4a], timeout=900)
    if not os.path.exists(m4a) or os.path.getsize(m4a) < 2000:
        return []
    res = subprocess.run([SCRIBE, m4a, "MEET"], capture_output=True, text=True, timeout=3 * 3600)
    segs = []
    for line in res.stdout.splitlines():
        p = line.split("\t")
        if len(p) >= 3 and p[2].strip():
            try:
                segs.append((float(p[0]), p[2].strip()))
            except ValueError:
                pass
    return segs


def finalize(row, r):
    """The bot is done: build the transcript, ingest it, file the audio, verify. Returns (ok, note)."""
    out, name = r["dir"], r["name"]
    try:
        meta = json.load(open(f"{out}/meta.json"))
    except (OSError, ValueError):
        meta = {}
    t0 = (meta.get("audio_t0") or meta.get("joined_at") or int(parse_ts(row["starts_at"]).timestamp() * 1000)) / 1000.0
    segs = transcribe(out, name)
    utts = build_utterances(read_caps(out))
    lines, people, src = build_transcript(segs, utts, t0)
    if not lines:
        return False, f"nothing was heard or captioned (bot: {meta.get('end_reason')}, captions on: {meta.get('captions_on')})"
    mark_ingested(name)          # agent.py's sweep would otherwise ingest the transcript file again, with an empty roster and speakers
    hdr = ["# Google Meet call recorded by Scout Notetaker (visible guest, chat notice " + ("posted" if meta.get("notice_posted") else "NOT confirmed") + ").",
           f"# Source: {src}. Speaker names come from Meet's live captions."]
    for who, n in people.items():
        hdr.append(f"# {label(who)}: {n} lines")
    text = "\n".join(hdr) + "\n" + "\n".join(lines) + "\n"
    open(f"{REC}/{name}-transcript-named.txt", "w").write(text)
    open(f"{REC}/{name}-transcript.txt", "w").write(text)
    roster = roster_from(row_people(row), list(people))
    speakers = {"roster": roster, "source": "google-meet", "meet": row["meet_code"], "transcript_source": src,
                "voices": [{"name": w, "how": "captions", "lines": n} for w, n in people.items()]}
    started = datetime.fromtimestamp(t0, timezone.utc).isoformat()
    stopped = datetime.fromtimestamp((meta.get("left_at") or time.time() * 1000) / 1000.0, timezone.utc).isoformat()
    body = {"op": "ingest", "name": name, "transcript": text, "roster": roster, "speakers": speakers, "started_at": started, "stopped_at": stopped,
            "room": row["meet_code"], "source": "google-meet"}
    cs = client_for(row)
    if cs:
        body["client_slug"] = cs
    ok = bool(rec(body, timeout=60).get("ok"))
    if not ok:
        return False, "ingest was refused"
    filed = file_media(name)
    return True, f"{len(lines)} lines ({src}); {filed}"


def mark_ingested(name):
    try:
        if name not in open(f"{HOME}/.ingested").read().split():
            open(f"{HOME}/.ingested", "a").write(name + "\n")
    except OSError:
        open(f"{HOME}/.ingested", "a").write(name + "\n")


def file_media(name):
    """Upload the audio + transcripts like a Talk recording (upload.sh), then drop the local audio only after a verified upload."""
    try:
        res = subprocess.run([f"{HOME}/upload.sh", name], capture_output=True, text=True, timeout=1800)
        tail = res.stdout.strip().splitlines()[-1] if res.stdout.strip() else ""
        m = re.search(r"\((\d+) uploaded, (\d+) failed\)", tail)
        if m and int(m.group(1)) >= 1 and int(m.group(2)) == 0:
            for f in (f"{REC}/{name}-system.m4a", f"{REC}/{name}-meet/audio.webm"):
                try:
                    os.remove(f)
                except OSError:
                    pass
            return "filed in Nextcloud, local audio removed"
        return "Nextcloud upload incomplete, local audio kept: " + tail
    except Exception as e:  # noqa: BLE001
        return f"upload failed ({e}); local audio kept"


def exists(name):
    try:
        r = rec({"op": "meeting_exists", "name": name})
        return bool(r.get("exists")), bool(r.get("deleted")), r.get("row")
    except Exception as e:  # noqa: BLE001
        log("meeting_exists failed", e)
        return None, False, None


# ── the loop ─────────────────────────────────────────────────────────────────
state = {"last_sync_ok": time.time(), "next_sync": 0, "next_beat": 0, "alerts": set(), "next_gsync": 0, "last_gsync_ok": 0}


def alert(key, title, body, severity="warning"):
    health(key, "problem", title, body, severity)
    state["alerts"].add(key)


def clear(key, title="Fixed"):
    if key in state["alerts"]:
        health(key, "resolved", title, "", "info")
        state["alerts"].discard(key)


def sync_mail():
    r = rec({"op": "meet_mail"})
    mails = r.get("mails") or []
    rows, cancels = [], []
    for m in mails:
        subj, body = m.get("subject") or "", m.get("body_text") or ""
        c = meetparse.parse_cancel(subj, body)
        if c:
            cancels.append(c)
            continue
        p = meetparse.parse_invite(subj, body, m.get("sent_at"), m.get("id"))
        if p:
            rows.append(p)
    # the newest mail per event wins (mails come newest first)
    seen, uniq = set(), []
    for p in rows:
        if p["event_key"] not in seen:
            seen.add(p["event_key"])
            uniq.append(p)
    cur = rec({"op": "meet_list"}).get("rows") or []
    cancelled = [c for c in cancels]
    # an invite older than its cancellation is dropped: compare by title + date
    final = []
    for p in uniq:
        d = parse_ts(p["starts_at"]).astimezone(PT).strftime("%Y-%m-%d")
        gone = any(c["title"] == p["title"] and c["date"] == d for c in cancelled)
        if gone:
            for row in cur:
                if row["event_key"] == p["event_key"] and row["status"] == "scheduled":
                    upd(row["id"], status="cancelled", last_note="cancelled by mail")
            continue
        final.append(p)
    if final:
        rec({"op": "meet_upsert", "rows": final})
    state["last_sync_ok"] = time.time()
    clear("sync", "Meet invite sync is working again")
    return len(final)


def sync_google():
    try:
        r = call("meet-invite", {"action": "sync"})
        if r.get("ok"):
            state["last_gsync_ok"] = time.time()
    except Exception as e:  # noqa: BLE001
        log("google sync failed", e)


def tick():
    t = time.time()
    if t >= state["next_sync"]:
        state["next_sync"] = t + SYNC_EVERY_S
        try:
            n = sync_mail()
            log("mail sync ok:", n, "meet invites")
        except Exception as e:  # noqa: BLE001
            log("mail sync failed", e)
    if t >= state["next_gsync"]:
        state["next_gsync"] = t + 900
        sync_google()
    if t - state["last_sync_ok"] > SYNC_STALE_S:
        alert("sync", "Meet invite sync is stale", f"Scout Notetaker has not been able to read Meet invites for {int((t - state['last_sync_ok']) / 60)} minutes (meetwatch.py on the Mac mini, log ~/MeetingRec/meet/meetwatch.log).")
    rows = rec({"op": "meet_list"}).get("rows") or []
    killed = os.path.exists(KILL)
    upcoming = 0
    for row in rows:
        rid = row["id"]
        starts, ends = parse_ts(row["starts_at"]).timestamp(), parse_ts(row["ends_at"]).timestamp()
        st = row["status"]
        skip = row.get("skip") or os.path.exists(f"{HOME}/.meet-skip-{row['meet_code']}")
        if st == "scheduled" and ends > t:
            upcoming += 1
        r = procs.get(rid)
        # 1. start
        if st == "scheduled" and not r and not killed and not skip and starts - JOIN_LEAD_S <= t < ends + END_GRACE_S:
            if free_gb() < 1.0:
                alert("disk", "Mac mini disk almost full", f"{free_gb():.1f} GB free: Meet recording may fail.")
            launch_bot(row)
            continue
        if st == "scheduled" and skip and starts - JOIN_LEAD_S <= t < ends:
            upd(rid, status="skipped", last_note="skipped by switch")
            continue
        if not r:
            # 4. nothing recorded 45 min after the call ended?
            if st in ("processing", "done") and row.get("recording_name") and t > ends + VERIFY_AFTER_S:
                pass
            continue
        # a stop request when the switch is thrown mid-call
        if killed and r.get("kind") == "bot" and bot_exit_code(r) is None:
            open(f"{r['dir']}/STOP", "w").close()
        code = bot_exit_code(r)
        if r.get("kind") == "local":
            handle_local(row, r, t, ends)
            continue
        if code is None:
            alive = bot_state(r)
            in_call = alive.get("state") == "in_call"
            if in_call and st != "in_call":
                upd(rid, status="in_call", joined_at=now_utc().isoformat())
                clear("join", "Scout Notetaker is in the call")
                clear("bot_late", "Scout Notetaker is in the call")
            # bot not in the call BOT_LATE_S after the start
            if not in_call and t > starts + BOT_LATE_S and st in ("joining", "scheduled"):
                if not r.get("relaunched"):
                    log("bot late, relaunching once", row["meet_code"])
                    kill_bot(r)
                    launch_bot(row, relaunch=True)
                elif "late-alerted" not in r:
                    r["late-alerted"] = True
                    save_run(rid)
                    alert("bot_late", "Scout Notetaker is not in the call yet", f"'{row.get('title')}' started at {parse_ts(row['starts_at']).astimezone(PT).strftime('%-I:%M %p')} PT and the bot is still {alive.get('state', 'starting')} (waiting for the host to admit it, or Meet turned it away). It keeps knocking for up to {KNOCK_S // 60} minutes.")
            # alive.json stale = the bot hung
            if alive and t - alive.get("at", 0) / 1000.0 > 90:
                log("bot heartbeat stale, restarting", row["meet_code"])
                kill_bot(r)
                if t < ends + END_GRACE_S:
                    launch_bot(row, relaunch=True)
            continue
        # the bot has exited
        reason = ""
        try:
            reason = json.load(open(f"{r['dir']}/meta.json")).get("end_reason") or ""
        except (OSError, ValueError):
            pass
        log("bot exited", row["meet_code"], "code", code, reason)
        if code in (6, 3):
            why = "Meet turned the guest away (the host does not allow anyone with the link to ask to join)" if code == 6 else f"nobody admitted the guest within {KNOCK_S // 60} minutes"
            alert("join", "Scout Notetaker could not join the Meet call", f"'{row.get('title')}': {why}. Falling back to this Mac's own audio (records if Jared is on the call from the Mac mini).")
            if t < ends and not killed:
                res = start_local(row)
                if res.get("ok"):
                    procs[rid] = {"p": None, "pid": 0, "dir": r["dir"], "name": res.get("name") or r["name"], "t0": t, "kind": "local"}
                    save_run(rid)
                    upd(rid, status="in_call", recording_name=res.get("name"), last_note="local recorder (bot was turned away)")
                    continue
                alert("local", "Fallback recorder could not start", f"{res.get('error')}")
            upd(rid, status="failed", last_note=f"bot exit {code}: {reason}")
            procs.pop(rid, None)
            continue
        if code == 7:
            upd(rid, status="skipped", last_note="stopped before joining")
            procs.pop(rid, None)
            continue
        if code not in (0, -999) and t < ends + END_GRACE_S and (row.get("attempts") or 0) < 4:
            log("bot crashed, relaunching", code)
            launch_bot(row, relaunch=True)
            continue
        # finished (or gave up): build the transcript
        upd(rid, status="processing", left_at=now_utc().isoformat())
        try:
            ok, note = finalize(row, r)
        except Exception as e:  # noqa: BLE001
            ok, note = False, f"finalize crashed: {e}"
        log("finalize", row["meet_code"], ok, note)
        if ok:
            upd(rid, status="done", last_note=note)
            clear("ingest", "Meet recording filed")
        else:
            upd(rid, status="failed", last_note=note)
            alert("ingest", "A Meet call could not be turned into a transcript", f"'{row.get('title')}': {note}. The raw files are in ~/MeetingRec/recordings/{r['name']}-meet/.")
        procs.pop(rid, None)
        try:
            os.remove(run_file(rid))
        except OSError:
            pass
        shutil.rmtree(f"{MEET}/profile/Default/Cache", ignore_errors=True)
        shutil.rmtree(f"{MEET}/profile/Default/Code Cache", ignore_errors=True)
    verify_done(rows, t)
    if t >= state["next_beat"]:
        state["next_beat"] = t + 60
        nxt = next((r for r in rows if r["status"] == "scheduled" and parse_ts(r["ends_at"]).timestamp() > t), None)
        summ = f"{upcoming} upcoming Meet call(s)" + (f"; next {parse_ts(nxt['starts_at']).astimezone(PT).strftime('%a %-I:%M %p')} PT {nxt.get('title')}" if nxt else "") + ("; KILL SWITCH ON" if killed else "")
        try:
            rec({"op": "meet_beat", "ok": True, "summary": summ})
        except Exception as e:  # noqa: BLE001
            log("beat failed", e)


def handle_local(row, r, t, ends):
    """The agent is recording this Mac's audio: stop it a little after the scheduled end (the agent ingests it by itself)."""
    if t > ends + LOCAL_STOP_AFTER_END_S and not r.get("stop-sent"):
        open(f"{HOME}/.stop-request", "w").close()
        r["stop-sent"] = True
        save_run(row["id"])
        upd(row["id"], status="processing", last_note="local recording stopped after the scheduled end")
        log("local stop requested", row["meet_code"])
    if r.get("stop-sent") and t > ends + LOCAL_STOP_AFTER_END_S + 120:
        ex, deleted, _ = exists(r["name"])
        if ex or deleted:
            upd(row["id"], status="done", last_note="filed by the local recorder")
            procs.pop(row["id"], None)
            try:
                os.remove(run_file(row["id"]))
            except OSError:
                pass


def verify_done(rows, t):
    """45 minutes after a watched call ended with no meeting_recordings row: re-run the ingest from the saved files, then alert."""
    for row in rows:
        if row["status"] not in ("done", "processing", "failed", "in_call"):
            continue
        ends = parse_ts(row["ends_at"]).timestamp()
        name = row.get("recording_name")
        if not name or t < ends + VERIFY_AFTER_S or t > ends + 3 * 86400:
            continue
        key = f"verify-{row['id']}"
        if key in state["alerts"] or procs.get(row["id"]):
            continue
        ex, deleted, _ = exists(name)
        if ex is None or ex or deleted:
            continue
        out = f"{REC}/{name}-meet"
        if os.path.isdir(out):
            fake = {"dir": out, "name": name}
            try:
                ok, note = finalize(row, fake)
            except Exception as e:  # noqa: BLE001
                ok, note = False, str(e)
            log("re-ingest", name, ok, note)
            if ok:
                upd(row["id"], status="done", last_note="re-ingested by the watchdog: " + note)
                continue
        health(key, "problem", "A Meet call never reached meeting_recordings", f"'{row.get('title')}' ended over 45 minutes ago and there is no recording row named {name}. Files: ~/MeetingRec/recordings/{name}-meet/", "warning")
        state["alerts"].add(key)


def main():
    os.makedirs(RUNS, exist_ok=True)
    log("meetwatch up")
    load_runs()
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    while True:
        try:
            tick()
        except Exception as e:  # noqa: BLE001
            log("tick failed", repr(e)[:300])
            if "--debug" in sys.argv:
                raise
        time.sleep(TICK_S)


if __name__ == "__main__":
    main()
