#!/usr/bin/env python3
"""Ava's voice bank: cut Jared's own clean speech out of his meeting recordings and feed his Pro voice clone.

Run by the recorder agent (agent.py) about once an hour while the Mac is idle. Free and local: no AI, just signal checks.

For every meeting with a separate mic track (<name>-mic.m4a, Jared's mic only) and the far-end track (<name>-system.m4a):
  1. decode both to 16 kHz mono and measure loudness every 30 ms
  2. keep stretches where Jared is talking AND the far end is silent (so no crosstalk and no speaker bleed: Eli's voice
     is never kept), 2.5 to 15 s long, at least 20 dB above the room noise
  3. drop clipped stretches and anything from a narrowband (Bluetooth headset) mic, which would teach the clone a phone sound
  4. take the best 20 minutes, level them, write them as m4a parts of up to 8 minutes
  5. upload each part to the private ava-voice bucket and hand it to the ava-voicebank edge function, which adds it to the
     Pro clone in ElevenLabs and deletes the file
Then one "tick" so the edge function can train / retrain / switch Ava over (and so the team card sees a heartbeat).

Recordings come from ~/MeetingRec/recordings, or from Nextcloud (Meeting Recordings/<day>/) when the Mac no longer has
them. Nothing here ever deletes a recording.

usage: voicebank.py [--max N] [--dry-run] [--only <meeting-name>]
"""
import base64, json, os, re, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request, wave
import numpy as np

HOME = os.path.expanduser("~/MeetingRec")
REC = f"{HOME}/recordings"
URL = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/ava-voicebank"
NC = "https://cloud.bestly.tech/remote.php/dav/files/jared"
ROOT = "Meeting%20Recordings"
LOG = f"{HOME}/voicebank.log"

FR = 480                    # 30 ms at 16 kHz
SR_OUT = 44100
MIN_RUN, MAX_RUN = 2.5, 15.0
GAP_FRAMES = 17             # a pause up to ~0.5 s stays inside one stretch
BUSY_PAD = 20               # ~0.6 s either side of far-end speech is off limits
FAR_SILENT_DB = -50.0
MIN_SNR = 20.0
PER_MEETING_S = 20 * 60
MIN_MEETING_S = 2 * 60
PART_S = 8 * 60


def log(*a):
    line = time.strftime("%Y-%m-%d %I:%M:%S %p ") + " ".join(str(x) for x in a)
    print(line, flush=True)
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def key():
    return open(f"{HOME}/.agent-key").read().strip()


def call(body, timeout=120):
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "x-recorder-key": key()})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return json.loads(e.read().decode())
        except Exception:  # noqa: BLE001
            return {"ok": False, "error": f"HTTP {e.code}"}


def recording_now():
    try:
        pid = int(open(f"{HOME}/.pid").read().strip())
        os.kill(pid, 0)
        return True
    except (OSError, ValueError):
        return False


def nc_auth():
    pw = subprocess.run(["security", "find-generic-password", "-s", "nextcloud-meetingrec", "-a", "jared", "-w"],
                        capture_output=True, text=True).stdout.strip()
    return "Basic " + base64.b64encode(f"jared:{pw}".encode()).decode() if pw else None


def nc_tracks(auth):
    """{meeting: {"mic": rel, "system": rel}} for every two-track meeting in the Nextcloud archive."""
    out = {}
    if not auth:
        return out
    body = b'<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>'
    req = urllib.request.Request(f"{NC}/{ROOT}/", data=body, method="PROPFIND",
                                 headers={"Authorization": auth, "Depth": "infinity", "Content-Type": "application/xml"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            xml = r.read().decode()
    except Exception as e:  # noqa: BLE001
        log("nextcloud listing failed", e)
        return out
    for href in re.findall(r"<[a-zA-Z]*:?href>([^<]*)</[a-zA-Z]*:?href>", xml):
        m = re.search(r"/(\d{4}-\d{2}-\d{2})/(meeting-\d{8}-\d{4}[a-z0-9-]*?)-(mic|system)\.m4a$", urllib.parse.unquote(href))
        if m:
            out.setdefault(m.group(2), {})[m.group(3)] = f"{m.group(1)}/{m.group(2)}-{m.group(3)}.m4a"
    return out


def local_tracks():
    out = {}
    try:
        for f in os.listdir(REC):
            m = re.match(r"(meeting-\d{8}-\d{4}[a-z0-9-]*?)-(mic|system)\.m4a$", f)
            if m:
                out.setdefault(m.group(1), {})[m.group(2)] = f"{REC}/{f}"
    except OSError:
        pass
    return out


def fetch(auth, rel, dest):
    req = urllib.request.Request(f"{NC}/{ROOT}/{urllib.parse.quote(rel)}", headers={"Authorization": auth})
    with urllib.request.urlopen(req, timeout=600) as r, open(dest, "wb") as f:
        while True:
            b = r.read(1 << 20)
            if not b:
                break
            f.write(b)


def decode(src, dest, rate):
    subprocess.run(["afconvert", "-f", "WAVE", "-d", f"LEI16@{rate}", "-c", "1", src, dest],
                   check=True, capture_output=True, timeout=1800)


def frame_db(path):
    """Loudness (dBFS) of every 30 ms frame, read in one-minute blocks so a 2-hour call stays small in memory."""
    out = []
    with wave.open(path) as w:
        while True:
            b = w.readframes(FR * 2000)
            if not b:
                break
            x = np.frombuffer(b, dtype="<i2").astype(np.float32) / 32768.0
            n = len(x) // FR
            if n == 0:
                break
            x = x[: n * FR].reshape(n, FR)
            out.append(10 * np.log10(np.mean(x * x, axis=1) + 1e-10))
    return np.concatenate(out) if out else np.zeros(0)


def stretches(mic, far):
    """(start_frame, end_frame, snr) where Jared talks and the far end is silent."""
    n = min(len(mic), len(far))
    mic, far = mic[:n], far[:n]
    floor = float(np.percentile(mic, 10))
    talk = mic > max(floor + 12.0, -50.0)
    busy = far > FAR_SILENT_DB
    if busy.any():   # widen far-end speech so the edges of a turn don't sneak in
        k = np.ones(2 * BUSY_PAD + 1)
        busy = np.convolve(busy.astype(float), k, mode="same") > 0
    runs, i = [], 0
    while i < n:
        if not talk[i] or busy[i]:
            i += 1
            continue
        j, last = i, i
        while j < n and not busy[j] and (talk[j] or j - last <= GAP_FRAMES):
            if talk[j]:
                last = j
            j += 1
        s, e = i, last + 1
        dur = (e - s) * FR / 16000
        if dur >= MIN_RUN:
            # long stretches are cut into ~MAX_RUN pieces rather than thrown away
            step = int(MAX_RUN * 16000 / FR)
            for a in range(s, e, step):
                b = min(e, a + step)
                if (b - a) * FR / 16000 >= MIN_RUN:
                    seg = mic[a:b]
                    snr = float(np.mean(seg[talk[a:b]]) - floor)
                    if snr >= MIN_SNR:
                        runs.append((a, b, snr))
        i = j + 1
    return runs, floor


def wideband(x):
    """False for a mic that stops at ~8 kHz (Bluetooth headset, phone line). Speech energy falls gently from 6 to 11 kHz on
    a real wideband mic; a 16 kHz-sampled mic falls off a cliff at 8 kHz. So compare 8.5-11 kHz with 5.5-7.5 kHz."""
    if len(x) < 4096:
        return False
    spec = np.abs(np.fft.rfft(x * np.hanning(len(x)))) ** 2
    f = np.fft.rfftfreq(len(x), 1 / SR_OUT)
    hi = spec[(f > 8500) & (f < 11000)].sum()
    mid = spec[(f > 5500) & (f < 7500)].sum() + 1e-12
    return 10 * np.log10(hi / mid + 1e-12) > -22.0


def level(x):
    rms = np.sqrt(np.mean(x * x) + 1e-12)
    g = min(10 ** (-20 / 20) / rms, 10 ** (-1 / 20) / (np.max(np.abs(x)) + 1e-9))
    return x * g


def cut_meeting(name, mic_src, far_src, tmp):
    mic16, far16, mic44 = f"{tmp}/mic16.wav", f"{tmp}/far16.wav", f"{tmp}/mic44.wav"
    decode(mic_src, mic16, 16000)
    decode(far_src, far16, 16000)
    runs, floor = stretches(frame_db(mic16), frame_db(far16))
    if not runs:
        return [], 0.0, "no clean stretches"
    decode(mic_src, mic44, SR_OUT)
    keep, total, snrs = [], 0.0, []
    with wave.open(mic44) as w:
        for a, b, snr in sorted(runs, key=lambda r: -r[2]):
            if total >= PER_MEETING_S:
                break
            s0 = int(a * FR / 16000 * SR_OUT)
            s1 = int(b * FR / 16000 * SR_OUT)
            w.setpos(min(s0, w.getnframes()))
            x = np.frombuffer(w.readframes(s1 - s0), dtype="<i2").astype(np.float32) / 32768.0
            if len(x) == 0 or np.max(np.abs(x)) >= 0.98 or not wideband(x):
                continue
            keep.append((s0, level(x)))
            total += len(x) / SR_OUT
            snrs.append(snr)
    if total < MIN_MEETING_S:
        return [], 0.0, f"only {total / 60:.1f} min of clean wideband speech (floor {floor:.0f} dBFS)"
    keep.sort(key=lambda k: k[0])            # back in time order: reads more naturally
    gap = np.zeros(int(0.35 * SR_OUT), dtype=np.float32)
    parts, cur, cur_s = [], [], 0.0
    for _, x in keep:
        if cur and cur_s + len(x) / SR_OUT > PART_S:
            parts.append(cur)
            cur, cur_s = [], 0.0
        cur += [x, gap]
        cur_s += len(x) / SR_OUT + 0.35
    if cur:
        parts.append(cur)
    files = []
    for i, p in enumerate(parts, 1):
        y = np.clip(np.concatenate(p), -1, 1)
        wav, m4a = f"{tmp}/part{i}.wav", f"{tmp}/{name}-{i}.m4a"
        with wave.open(wav, "wb") as o:
            o.setnchannels(1); o.setsampwidth(2); o.setframerate(SR_OUT)
            o.writeframes((y * 32767).astype("<i2").tobytes())
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "128000", wav, m4a], check=True, capture_output=True)
        files.append((i, m4a, len(y) / SR_OUT))
    return files, float(np.mean(snrs)), None


def put(url, path):
    data = open(path, "rb").read()
    req = urllib.request.Request(url, data=data, method="PUT", headers={"Content-Type": "audio/mp4", "x-upsert": "true"})
    with urllib.request.urlopen(req, timeout=300) as r:
        r.read()


def main():
    args = sys.argv[1:]
    dry = "--dry-run" in args
    mx = int(args[args.index("--max") + 1]) if "--max" in args else 3
    only = args[args.index("--only") + 1] if "--only" in args else None

    st = call({"op": "state"})
    if not st.get("ok"):
        raise SystemExit(f"state failed: {st.get('error')}")
    if st.get("state") == "paused":
        log("paused (Jared deleted his voice); nothing to do")
        return
    done = set(st.get("done") or [])
    auth = nc_auth()
    tracks = nc_tracks(auth)
    for k, v in local_tracks().items():
        tracks.setdefault(k, {}).update(v)
    todo = sorted(n for n, t in tracks.items() if n not in done and (only is None or n == only))
    log(f"{len(todo)} meeting(s) to look at; {st.get('total_sec', 0) / 60:.0f} min banked")
    worked = 0
    for name in todo:
        if worked >= mx or recording_now():
            break
        t = tracks[name]
        if "mic" not in t or "system" not in t:
            if not dry:
                call({"op": "skip", "meeting": name, "why": "no separate mic and far-end tracks"})
            continue
        worked += 1
        with tempfile.TemporaryDirectory(prefix="voicebank-") as tmp:
            src = {}
            for kind in ("mic", "system"):
                p = t[kind]
                if not p.startswith("/"):
                    dest = f"{tmp}/{kind}.m4a"
                    fetch(auth, p, dest)
                    p = dest
                src[kind] = p
            files, score, why = cut_meeting(name, src["mic"], src["system"], tmp)
            if why:
                log(name, "skipped:", why)
                if not dry:
                    call({"op": "skip", "meeting": name, "why": why})
                continue
            full = st.get("total_sec", 0) >= st.get("cap_sec", 1e9)
            if full and st.get("weakest_score") is not None and score <= st["weakest_score"]:
                log(name, f"bank full and this one ({score:.1f} dB) isn't better; skipped")
                if not dry:
                    call({"op": "skip", "meeting": name, "why": "bank full, not better"})
                continue
            for part, path, secs in files:
                log(name, f"part {part}: {secs / 60:.1f} min, {score:.1f} dB")
                if dry:
                    continue
                u = call({"op": "upload_url", "meeting": name, "part": part})
                if not u.get("ok"):
                    raise RuntimeError(f"upload_url: {u.get('error')}")
                put(u["url"], path)
                c = call({"op": "commit", "meeting": name, "part": part, "seconds": round(secs, 1), "score": round(score, 2)}, timeout=300)
                if not c.get("ok"):
                    raise RuntimeError(f"commit {name}-{part}: {c.get('error')}")
                log(name, "part", part, "kept" if c.get("kept") else f"not kept ({c.get('why')})")
    if not dry:
        r = call({"op": "tick"}, timeout=120)
        log("tick:", r.get("state"), r.get("error") or "")
        if not r.get("ok"):
            raise RuntimeError(f"tick: {r.get('error')}")


if __name__ == "__main__":
    main()
