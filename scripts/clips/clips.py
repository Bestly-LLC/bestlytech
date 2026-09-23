#!/usr/bin/env python3
"""Bestly voice clips (Mac mini, launchd tech.bestly.clips).

AirDrop a recording from the Soundcore Work (or anything else) to this Mac and it lands in
~/Downloads. This watcher picks up new audio there, uploads it to Bestly, transcribes it with the
same Apple Speech binary the call recorder uses (MeetingRec/bin/talkscribe), writes a short summary
with the local model in Ollama, and files the original in ~/BestlyClips/done.

It also claims clips dropped onto /admin/clips in the browser and transcribes those the same way.

Standard library only. Key in ~/PartnerAI/.key (Vault: partner_ai_worker_key).
"""
import json, os, re, subprocess, time, traceback, urllib.error, urllib.request
from datetime import datetime, timezone

VERSION = "1.4.1"   # 1.4: meetings (kind=meeting, or 10+ min) go through the call recorder's pipeline   # 1.3: parse talkscribe's 3-column output; a playable copy for parted clips; no silent empties
# 1.2: big files go up and come down in parts (storage caps one object at 50MB)
HOME = os.path.expanduser("~")
SB = "https://rcqfqhguwpmaarseifqg.supabase.co"
ANON = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjcWZxaGd1d3BtYWFyc2VpZnFnIiwicm9sZSI6"
        "ImFub24iLCJpYXQiOjE3NzUzNTc1OTUsImV4cCI6MjA5MDkzMzU5NX0.MHwsTd3CmaTViv3HoFRbeF1t6hmlf5W-p_4eHFBQP9k")
KEY = open(f"{HOME}/PartnerAI/.key").read().strip()
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")
MODEL = os.environ.get("PARTNER_AI_MODEL", "qwen3:8b")
SCRIBE = f"{HOME}/MeetingRec/bin/talkscribe"
FFMPEG = f"{HOME}/MeetingRec/bin/ffmpeg"
WATCH = [f"{HOME}/Downloads", f"{HOME}/BestlyClips/inbox"]
DONE = f"{HOME}/BestlyClips/done"
LOG = f"{HOME}/BestlyClips/clips.log"
SEEN = f"{HOME}/BestlyClips/.seen"
KINDS = (".m4a", ".mp3", ".wav", ".aac", ".caf", ".amr", ".ogg", ".opus", ".flac", ".aiff")
SKIP = ("meeting-",)          # the call recorder's own files
MIN_AGE_S = 20                # let AirDrop finish writing
POLL_S = 15


def log(*a):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a") as f:
        f.write(datetime.now().strftime("%Y-%m-%d %H:%M:%S ") + " ".join(str(x) for x in a) + "\n")


def rpc(name, body, timeout=30):
    req = urllib.request.Request(f"{SB}/rest/v1/rpc/{name}", data=json.dumps(body).encode(), method="POST",
                                 headers={"apikey": ANON, "Authorization": f"Bearer {ANON}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or "null")


def seen():
    try:
        return set(json.load(open(SEEN)))
    except Exception:
        return set()


def remember(path):
    s = seen(); s.add(path)
    os.makedirs(os.path.dirname(SEEN), exist_ok=True)
    json.dump(sorted(s)[-500:], open(SEEN, "w"))


PART = 40 * 1024 * 1024      # storage refuses any one object over 50MB, so bigger files go in parts


def _post(data, headers, tries=4):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(f"{SB}/functions/v1/clip-ingest", data=data, method="POST", headers=headers)
            with urllib.request.urlopen(req, timeout=300) as r:
                out = json.loads(r.read().decode() or "{}")
            if not out.get("ok"):
                raise RuntimeError(out.get("error", "upload failed"))
            return out
        except urllib.error.HTTPError as e:
            last = RuntimeError(f"{e.code} {e.read().decode(errors='replace')[:200]}")
            if 400 <= e.code < 500 and e.code not in (408, 429):
                raise last
        except Exception as e:  # dropped connection, timeout
            last = e
        time.sleep(2 * 2 ** i)
    raise last


def upload(path, source="airdrop"):
    """Send the bytes to clip-ingest (in parts when big); returns the clip id."""
    size = os.path.getsize(path)
    made = datetime.fromtimestamp(os.path.getmtime(path), timezone.utc).isoformat()
    base = {"Authorization": f"Bearer {ANON}", "x-worker-key": KEY, "x-file-name": os.path.basename(path),
            "x-source": source, "x-recorded-at": made, "Content-Type": "application/octet-stream"}
    if size <= PART:
        return _post(open(path, "rb").read(), base)["id"]
    n = -(-size // PART)
    stem = None
    with open(path, "rb") as f:
        for i in range(n):
            h = dict(base, **{"x-part": str(i), "x-parts": str(n), "x-total-bytes": str(size)})
            if stem:
                h["x-path"] = stem
            out = _post(f.read(PART), h)
            stem = out["path"]
    return out["id"]


def download(storage_path, to, parts=None):
    """One object, or <path>.part000.. stitched back into the original bytes."""
    # The bucket is admin-only: ask clip-ingest (worker key) for signed links, one per part.
    h = {"Authorization": f"Bearer {ANON}", "x-worker-key": KEY, "x-sign": storage_path}
    if parts:
        h["x-parts"] = str(parts)
    urls = _post(b"", h)["urls"]
    with open(to, "wb") as f:
        for url in urls:
            with urllib.request.urlopen(url, timeout=600) as r:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)


def seconds(path):
    try:
        out = subprocess.run([FFMPEG, "-i", path], capture_output=True, text=True, timeout=60).stderr
        m = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", out)
        if m:
            return round(int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3]), 1)
    except Exception:
        pass
    return None


def transcribe(path):
    """talkscribe writes TSV: start<TAB>LABEL<TAB>text (older builds: start<TAB>end<TAB>LABEL<TAB>text).
    Join it into plain lines. 1.2 and earlier only read the 4-column form, so every clip came back
    as "(no speech found)" - the first column is the start, the LAST is always the text."""
    wav = None
    if not path.lower().endswith((".m4a", ".mp4", ".wav")):
        wav = f"/tmp/clip-{os.getpid()}.m4a"
        subprocess.run([FFMPEG, "-y", "-i", path, "-c:a", "aac", wav], capture_output=True, timeout=600)
        path = wav
    out = subprocess.run([SCRIBE, path, "CLIP"], capture_output=True, text=True, timeout=3600).stdout
    if wav:
        try: os.remove(wav)
        except OSError: pass
    lines = []
    for row in out.splitlines():
        bits = row.split("\t")
        if len(bits) < 3 or not bits[-1].strip():
            continue
        try:
            t = int(float(bits[0]))
        except ValueError:
            continue
        lines.append(f"[{t // 60:02d}:{t % 60:02d}] {bits[-1].strip()}")
    return "\n".join(lines)


PLAY_MAX = 44 * 1024 * 1024


def playable(src, clip):
    """Parted clips get one small copy at clip['path'] so the browser can stream and seek it
    (the original stays as parts). Speech-friendly mono AAC, bitrate picked to fit under 44MB."""
    secs = seconds(src) or 0
    kbps = 64 if not secs else max(24, min(64, int(PLAY_MAX * 8 / secs / 1000 * 0.9)))
    out = f"/tmp/clip-play-{clip['id']}.m4a"
    try:
        subprocess.run([FFMPEG, "-y", "-i", src, "-vn", "-ac", "1", "-c:a", "aac", "-b:a", f"{kbps}k",
                        "-movflags", "+faststart", out], capture_output=True, timeout=1800, check=True)
        if os.path.getsize(out) > PLAY_MAX:
            raise RuntimeError(f"playable copy still {os.path.getsize(out)} bytes")
        _post(open(out, "rb").read(), {"Authorization": f"Bearer {ANON}", "x-worker-key": KEY,
              "x-attach": clip["id"], "Content-Type": "audio/mp4"})
        log("playable copy", clip["id"], f"{kbps}k", os.path.getsize(out))
    finally:
        try: os.remove(out)
        except OSError: pass


def summarise(text):
    """Title plus a few bullets, written by the local model. Costs nothing."""
    prompt = ("Summarise this voice note. Answer as JSON only:\n"
              '{"title": "<3 to 7 words naming what it is about>", "summary": "<one or two sentences>", '
              '"points": ["short bullet", "..."], "todos": ["something the speaker said they would do"]}\n'
              "Use only what is said; empty lists are fine.\n\nNOTE:\n" + text[:12000])
    body = json.dumps({"model": MODEL, "stream": False, "think": False, "format": "json",
                       "messages": [{"role": "user", "content": prompt}],
                       "options": {"temperature": 0.2, "num_ctx": 8192}}).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/chat", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=300) as r:
        raw = (json.loads(r.read()).get("message") or {}).get("content", "{}")
    try:
        j = json.loads(raw)
    except Exception:
        return None
    out = {k: j.get(k) for k in ("title", "summary", "points", "todos") if j.get(k)}
    # The small model sometimes copies the instruction instead of writing a title ("under 8 words").
    t = str(out.get("title") or "").strip()
    if not t or re.search(r"\bwords?\b|^title$|short title", t, re.I) or len(t.split()) > 10:
        out.pop("title", None)
    return out


MR = f"{HOME}/MeetingRec"
MEETING_MIN_S = 600          # a clip this long with no kind set is treated as a meeting


def _iso(v):
    try:
        return datetime.fromisoformat(str(v).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def meeting_name(clip, secs):
    """meeting-YYYYMMDD-HHMM in this Mac's time, from when the recording STARTED (the file time is
    when it ended), bumped a minute at a time until nothing in recordings/ has that name."""
    # Recorders put the start in the file name ("2026-09-22 113758.mp3", "20260922_113758.m4a");
    # that beats the file time, which is often when it was copied or uploaded.
    # lookahead so overlapping candidates are all seen; the LAST one is the recorder's own stamp
    found = list(re.finditer(r"(?=(20\d\d)-?(\d\d)-?(\d\d)[ _T]+([01]\d|2[0-3])[:.]?([0-5]\d)(?:[:.]?[0-5]\d)?(?!\d))",
                             str(clip.get("title") or "")))
    m = found[-1] if found else None
    start = None
    if m:
        try:
            start = datetime(*[int(x) for x in m.groups()])
        except ValueError:
            start = None
    if start is None:
        end = _iso(clip.get("recorded_at")) or _iso(clip.get("created_at")) or datetime.now(timezone.utc)
        start = datetime.fromtimestamp(end.timestamp() - (secs or 0))
    start = start.replace(second=0, microsecond=0)
    names = os.listdir(f"{MR}/recordings")
    while True:
        n = start.strftime("meeting-%Y%m%d-%H%M")
        if not any(f.startswith(n) for f in names):
            return n
        start = datetime.fromtimestamp(start.timestamp() + 60)


def as_meeting(clip, src, secs):
    """Hand a one-track meeting to the call recorder's pipeline, so it lands in Calls exactly like a
    call recorded here: recordings/<name>-room.m4a, transcribed, every voice named (name_mixed.py,
    voiceprints in ~/MeetingRec/voices), uploaded to Nextcloud (upload.sh), and picked up by the
    meetingrec agent's transcript sweep into meeting_recordings (summary, to-dos, partner portal)."""
    name = meeting_name(clip, secs)
    room = f"{MR}/recordings/{name}-room.m4a"
    subprocess.run([FFMPEG, "-loglevel", "error", "-y", "-i", src, "-vn", "-ac", "1", "-c:a", "aac", "-b:a", "64k", room],
                   check=True, timeout=1800)
    tsv = f"/tmp/{name}.room.tsv"
    with open(tsv, "w") as f:
        subprocess.run([SCRIBE, room, "ROOM"], stdout=f, stderr=subprocess.DEVNULL, timeout=3 * 3600, check=False)
    if os.path.getsize(tsv) < 10:
        raise RuntimeError("the transcriber returned nothing for the meeting")
    out = subprocess.run([f"{MR}/.venv-diar/bin/python", f"{MR}/name_mixed.py", name, clip.get("roster") or ""],
                         capture_output=True, text=True, timeout=3 * 3600, cwd=MR)
    log("name_mixed", name, out.returncode, (out.stdout or "")[-400:], (out.stderr or "")[-400:])
    named = f"{MR}/recordings/{name}-transcript-named.txt"
    if out.returncode != 0 or not os.path.exists(named):
        # voices couldn't be told apart: still a meeting, with one ROOM speaker
        rows = []
        for line in open(tsv):
            p = line.rstrip("\n").split("\t")
            if len(p) >= 3 and p[-1].strip():
                t = int(float(p[0]))
                rows.append(f"[{t // 60:02d}:{t % 60:02d}] ROOM: {p[-1].strip()}")
        open(named, "w").write("# One-track recording: speakers couldn't be told apart by voice this time.\n" + "\n".join(rows) + "\n")
        open(f"{MR}/recordings/{name}-transcript.txt", "w").write("\n".join(rows) + "\n")
    up = subprocess.run([f"{MR}/upload.sh", name], capture_output=True, text=True, timeout=1800, cwd=MR)
    log("upload.sh", name, (up.stdout or "")[-300:])
    return name, open(named).read()


def work(clip):
    """One clip: download, transcribe, summarise, write back. Meetings also go to Calls."""
    tmp = f"/tmp/clip-{clip['id']}{os.path.splitext(clip['path'])[1] or '.m4a'}"
    try:
        download(clip["path"], tmp, clip.get("parts"))
        if clip.get("parts"):
            try:
                playable(tmp, clip)
            except Exception as e:  # playback copy is a nicety; the transcript still matters
                log("playable copy failed", clip["id"], repr(e))
        secs = seconds(tmp)
        kind = clip.get("kind")
        mname, merr = None, None
        if kind == "meeting" or (kind is None and (secs or 0) >= MEETING_MIN_S):
            try:
                mname, text = as_meeting(clip, tmp, secs)
                text = "\n".join(l for l in text.splitlines() if not l.startswith("#"))
            except Exception as e:  # noqa: BLE001 - still give him the clip's own transcript
                merr = f"couldn't file it under Calls: {e!r}"[:300]
                log("meeting failed", clip["id"], merr, traceback.format_exc()[-400:])
                text = transcribe(tmp)
        else:
            text = transcribe(tmp)
        if not text.strip() and (secs or 0) > 90:
            # Minutes of audio and not one word is a transcriber problem, not silence. Say so,
            # so clips_watch raises it for Scout instead of it passing as "(no speech found)".
            raise RuntimeError(f"no words found in {int(secs // 60)} min of audio - the transcriber returned nothing")
        summary = summarise(text) if text.strip() else None
        if merr:
            summary = {**(summary or {}), "meeting_error": merr}
        rpc("clip_write", {"p_key": KEY, "p_id": clip["id"], "p_transcript": text or "(no speech found)",
                           "p_summary": summary, "p_seconds": secs,
                           "p_title": (summary or {}).get("title") or clip.get("title"),
                           "p_meeting_name": mname})
        log("done", clip["id"], f"{len(text)} chars")
    except Exception as e:
        log("failed", clip["id"], repr(e), traceback.format_exc()[-500:])
        try: rpc("clip_write", {"p_key": KEY, "p_id": clip["id"], "p_error": repr(e)[:300]})
        except Exception: pass
    finally:
        try: os.remove(tmp)
        except OSError: pass


BLOCKED = set()          # folders macOS won't let a launchd job read (TCC), logged once each


def sweep():
    """New audio dropped into the watched folders (AirDrop lands in Downloads)."""
    known = seen()
    for folder in WATCH:
        if not os.path.isdir(folder) or folder in BLOCKED:
            continue
        # ~/Downloads and ~/Desktop are TCC-protected: a launchd job can't read them until
        # /usr/bin/python3 has Full Disk Access. Say so once, keep watching everything else.
        try:
            names = os.listdir(folder)
        except PermissionError:
            BLOCKED.add(folder)
            log(f"no permission to read {folder} - give /usr/bin/python3 Full Disk Access "
                "(System Settings > Privacy & Security), or drop clips in ~/BestlyClips/inbox")
            continue
        for name in names:
            p = os.path.join(folder, name)
            if p in known or not name.lower().endswith(KINDS) or name.startswith(SKIP) or name.startswith("."):
                continue
            try:
                if not os.path.isfile(p) or time.time() - os.path.getmtime(p) < MIN_AGE_S or os.path.getsize(p) < 4000:
                    continue
                log("picked up", p, os.path.getsize(p))
                upload(p)
                remember(p)
                os.makedirs(DONE, exist_ok=True)
                target = os.path.join(DONE, name)
                if not os.path.exists(target):
                    os.rename(p, target)
            except Exception as e:
                log("upload failed", p, repr(e))
                remember(p)


def main():
    os.makedirs(DONE, exist_ok=True)
    os.makedirs(f"{HOME}/BestlyClips/inbox", exist_ok=True)
    log(f"clips worker {VERSION} starting")
    while True:
        try:
            sweep()
            clip = rpc("clip_claim", {"p_key": KEY})
            if clip:
                work(clip)
                continue
        except urllib.error.HTTPError as e:
            log("http", e.code, e.read()[:200])
        except Exception as e:
            log("loop error", repr(e))
        time.sleep(POLL_S)


if __name__ == "__main__":
    import urllib.parse  # noqa: E402  (used by download)
    main()
