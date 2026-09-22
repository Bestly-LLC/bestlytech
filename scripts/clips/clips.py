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

VERSION = "1.0.0"
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


def upload(path, source="airdrop"):
    """Send the bytes to clip-ingest; returns the clip id."""
    data = open(path, "rb").read()
    made = datetime.fromtimestamp(os.path.getmtime(path), timezone.utc).isoformat()
    req = urllib.request.Request(f"{SB}/functions/v1/clip-ingest", data=data, method="POST", headers={
        "Authorization": f"Bearer {ANON}", "x-worker-key": KEY, "x-file-name": os.path.basename(path),
        "x-source": source, "x-recorded-at": made, "Content-Type": "application/octet-stream"})
    with urllib.request.urlopen(req, timeout=300) as r:
        out = json.loads(r.read().decode() or "{}")
    if not out.get("ok"):
        raise RuntimeError(out.get("error", "upload failed"))
    return out["id"]


def download(storage_path, to):
    req = urllib.request.Request(f"{SB}/storage/v1/object/voice-clips/{urllib.parse.quote(storage_path)}",
                                 headers={"apikey": ANON, "Authorization": f"Bearer {ANON}"})
    with urllib.request.urlopen(req, timeout=300) as r, open(to, "wb") as f:
        f.write(r.read())


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
    """talkscribe writes TSV: start<TAB>end<TAB>LABEL<TAB>text. Join it into plain lines."""
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
        if len(bits) >= 4 and bits[3].strip():
            t = int(float(bits[0]))
            lines.append(f"[{t // 60:02d}:{t % 60:02d}] {bits[3].strip()}")
    return "\n".join(lines)


def summarise(text):
    """Title plus a few bullets, written by the local model. Costs nothing."""
    prompt = ("Summarise this voice note. Answer as JSON only:\n"
              '{"title": "under 8 words", "summary": "one or two sentences", '
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
    return {k: j.get(k) for k in ("title", "summary", "points", "todos") if j.get(k)}


def work(clip):
    """One clip: download, transcribe, summarise, write back."""
    tmp = f"/tmp/clip-{clip['id']}{os.path.splitext(clip['path'])[1] or '.m4a'}"
    try:
        download(clip["path"], tmp)
        text = transcribe(tmp)
        summary = summarise(text) if text.strip() else None
        rpc("clip_write", {"p_key": KEY, "p_id": clip["id"], "p_transcript": text or "(no speech found)",
                           "p_summary": summary, "p_seconds": seconds(tmp),
                           "p_title": (summary or {}).get("title") or clip.get("title")})
        log("done", clip["id"], f"{len(text)} chars")
    except Exception as e:
        log("failed", clip["id"], repr(e), traceback.format_exc()[-500:])
        try: rpc("clip_write", {"p_key": KEY, "p_id": clip["id"], "p_error": repr(e)[:300]})
        except Exception: pass
    finally:
        try: os.remove(tmp)
        except OSError: pass


def sweep():
    """New audio dropped into the watched folders (AirDrop lands in Downloads)."""
    known = seen()
    for folder in WATCH:
        if not os.path.isdir(folder):
            continue
        for name in os.listdir(folder):
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
