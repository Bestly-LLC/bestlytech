"""Montage: Spark's video crew on the Pi (Bestly, 2026-10-06).

systemd bestly-montage runs this forever. Each loop it checks in (agent_beats 'montage'), claims the oldest queued job
from studio_video_jobs (montage_claim) and makes the video:
  writing    brand module writes the script with free AI and passes the brand's claim rules + fact check
  voicing    ElevenLabs reads each scene (Piper, local and free, takes over for the whole video if credits are low or ElevenLabs
             fails); scene lengths follow the voice
  rendering  OpenMontage VideoCompose, atelier mode, our hand-authored brand composition (om_render.py)
  checking   OpenMontage's post-render review + our own ffprobe / loudness / size checks
  filing     MP4 + thumbnail to storage, then montage_file puts it in Studio > Drafts > To review
A heartbeat goes out every minute while it works. Supabase cron montage-watch requeues a job whose heartbeat stops
(3 tries) and alerts as Montage if the worker itself goes quiet; systemd restarts the process.
"""
import json
import os
import random
import shutil
import socket
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request

sys.path.insert(0, "/opt/bestly/cron")
sys.path.insert(0, "/opt/bestly/montage")
import lib  # noqa: E402

OM = "/mnt/ssd/apps/openmontage"
OMPY = f"{OM}/.venv/bin/python"
PIPER = f"{OM}/.venv/bin/piper"
VOICES = "/mnt/ssd/montage/voices"
JOBS = "/mnt/ssd/montage/jobs"
WORKER = f"montage@{socket.gethostname()}"
BUCKET = "review"
FPS = 30


def beat(ok=True, summary=""):
    body = json.dumps({"slug": "montage", "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "ok": ok,
                       "summary": summary[:500]}).encode()
    h = {"apikey": lib.KEY, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"}
    if lib.KEY.startswith("eyJ"):
        h["Authorization"] = "Bearer " + lib.KEY
    try:
        urllib.request.urlopen(urllib.request.Request(f"{lib.URL}/rest/v1/agent_beats?on_conflict=slug", data=body,
                                                      method="POST", headers=h), timeout=20).read()
    except Exception as e:  # noqa: BLE001  (a missed beat must never kill the worker)
        print("beat failed:", e, flush=True)


def report(job_id, **p):
    try:
        lib.rpc("montage_report", p_id=job_id, p=p)
    except Exception as e:  # noqa: BLE001
        print("report failed:", e, flush=True)


def run(cmd, job_id, stage, timeout, cwd=None):
    """Run a command, sending a heartbeat every minute. Returns stdout; raises with the tail of stderr."""
    out_path = f"/tmp/montage-{job_id}-{stage}.log"
    with open(out_path, "w") as log:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=log, cwd=cwd, text=True)
        start = last = time.time()
        while proc.poll() is None:
            time.sleep(5)
            if time.time() - last > 60:
                report(job_id, stage=stage)
                beat(True, f"working on {job_id} ({stage})")
                last = time.time()
            if time.time() - start > timeout:
                proc.kill()
                raise RuntimeError(f"{stage} timed out after {timeout}s")
        out = proc.stdout.read()
    if proc.returncode != 0:
        tail = open(out_path).read()[-1500:]
        raise RuntimeError(f"{stage} failed (exit {proc.returncode}): {tail}")
    return out


def probe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height",
                        "-of", "json", path], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def dur(path):
    return float(probe(path)["format"]["duration"])


EL_API = "https://api.elevenlabs.io"
EL_USD_PER_CREDIT = 22 / 131000      # Creator plan: $22 for 131,000 credits
_el_key = {}


def _el_secret():
    """ElevenLabs key through pi_secret (Vault). Never raises: no key just means "use Piper"."""
    if "k" not in _el_key:
        try:
            _el_key["k"] = lib.rpc("pi_secret", p_name="elevenlabs_api_key") or ""
        except Exception:  # noqa: BLE001
            _el_key["k"] = ""
    return _el_key["k"]


def _el_call(method, path, key, body=None, timeout=30, retries=2):
    """One ElevenLabs request; 2 retries on 429 / 5xx / network trouble. Returns bytes, raises RuntimeError with a short reason."""
    last = "?"
    for attempt in range(retries + 1):
        req = urllib.request.Request(EL_API + path, method=method, headers={
            "xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg" if method == "POST" else "application/json"},
            data=json.dumps(body).encode() if body is not None else None)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:160].replace(key, "***")
            last = f"HTTP {e.code} {detail}"
            if e.code != 429 and e.code < 500:
                raise RuntimeError(last)
        except Exception as e:  # noqa: BLE001  (timeout, reset, DNS)
            last = f"{type(e).__name__}: {str(e)[:120]}"
        if attempt < retries:
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(last)


def _voice_alert(kind, why):
    """kind 'low' = credits protect Ava's calls (warning + push, once a day); 'down' = outage or error (info, no push, once a day)."""
    day = time.strftime("%Y-%m-%d", time.gmtime())
    try:
        if kind == "low":
            lib.notify("Montage: ElevenLabs credits are low, videos use the Piper voice", why[:400], severity="warning", push=True,
                       url="/admin/team", dedupe=f"montage-voice-low-{day}")
        else:
            lib.notify("Montage: ElevenLabs did not answer, this video used the Piper voice", why[:400], severity="info", push=False,
                       url="/admin/team", dedupe=f"montage-voice-down-{day}")
    except Exception as e:  # noqa: BLE001  (an alert must never fail a video)
        print("voice alert failed:", e, flush=True)


def _eleven(brand, lines, jd, client_slug):
    """Try ElevenLabs for the whole video. Returns (wavs, info) on success, (None, info) when Piper must take over.
    info = {"line": job-log text, "chars": credits-worth of characters actually sent, "cost": estimated USD}.
    Rules: setting says elevenlabs + client ai_voice_ok + brand VOICE_11 + key + subscription answers + credits left after
    this video stay >= reserve_pct of the limit (that reserve is Ava's calls). One voice per video, never mixed."""
    info = {"line": "", "chars": 0, "cost": 0.0}
    try:
        st = (lib.get("montage_settings", "select=value&key=eq.voice") or [{}])[0].get("value") or {}
    except Exception as e:  # noqa: BLE001
        info["line"] = f"voice: piper (settings unreadable: {str(e)[:80]})"
        return None, info
    if st.get("provider") != "elevenlabs":
        info["line"] = f"voice: piper (setting is {st.get('provider') or 'unset'})"
        return None, info
    v11 = getattr(brand, "VOICE_11", None)
    if not v11 or not v11.get("voice_id"):
        info["line"] = "voice: piper (brand has no ElevenLabs voice)"
        return None, info
    try:
        pol = (lib.get("montage_brand_policy", f"select=ai_voice_ok&client_slug=eq.{client_slug}") or [{}])[0]
    except Exception:  # noqa: BLE001
        pol = {}
    if not pol.get("ai_voice_ok"):
        info["line"] = "voice: piper (client policy does not allow an AI voice)"
        return None, info
    model = st.get("model") or "eleven_multilingual_v2"
    rate = 0.5 if model.startswith(("eleven_flash", "eleven_turbo")) else 1.0
    reserve = float(st.get("reserve_pct", 30))
    key = _el_secret()
    if not key:
        info["line"] = "voice: piper (no ElevenLabs key)"
        _voice_alert("down", "No ElevenLabs key could be read from Vault, so this video used the free Piper voice.")
        return None, info
    chars = sum(len(t) for t in lines)
    try:
        sub = json.loads(_el_call("GET", "/v1/user/subscription", key, timeout=20))
        limit, used = int(sub["character_limit"]), int(sub["character_count"])
    except Exception as e:  # noqa: BLE001
        info["line"] = f"voice: piper (ElevenLabs subscription check failed: {str(e)[:100]})"
        _voice_alert("down", f"ElevenLabs subscription check failed ({str(e)[:160]}). The video used Piper; nothing else is affected.")
        return None, info
    left_after = limit - used - chars * rate
    if left_after < limit * reserve / 100:
        info["line"] = (f"voice: piper (credits low: {limit - used} left, this video needs {int(chars * rate)}, "
                        f"reserve {reserve:g}% = {int(limit * reserve / 100)} is kept for calls)")
        _voice_alert("low", f"{limit - used:,} of {limit:,} ElevenLabs credits left; a video needs about {int(chars * rate)} and the last "
                            f"{reserve:g}% is kept for Ava's calls, so videos use the Piper voice until the credits reset.")
        return None, info
    ss = {"stability": v11.get("stability", 0.5), "similarity_boost": v11.get("similarity_boost", 0.75),
          "style": v11.get("style", 0.0), "speed": v11.get("speed", 1.0), "use_speaker_boost": True}
    wavs = []
    try:
        for i, text in enumerate(lines):
            body = {"text": text, "model_id": model, "voice_settings": ss}
            if i > 0:
                body["previous_text"] = " ".join(lines[max(0, i - 2):i])
            if i + 1 < len(lines):
                body["next_text"] = lines[i + 1]
            mp3 = _el_call("POST", f"/v1/text-to-speech/{v11['voice_id']}?output_format=mp3_44100_128", key, body)
            info["chars"] += len(text)
            m, w = f"{jd}/v{i:02d}.mp3", f"{jd}/v{i:02d}.wav"
            with open(m, "wb") as f:
                f.write(mp3)
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", m, "-ar", "44100", "-ac", "1", w], check=True, timeout=60)
            wavs.append((w, dur(w)))
    except Exception as e:  # noqa: BLE001  (any scene failing throws all ElevenLabs audio away)
        for i in range(len(lines)):
            for ext in ("mp3", "wav"):
                try:
                    os.remove(f"{jd}/v{i:02d}.{ext}")
                except OSError:
                    pass
        info["cost"] = info["chars"] * rate * EL_USD_PER_CREDIT
        info["line"] = f"voice: piper (ElevenLabs failed on line {len(wavs) + 1}: {str(e)[:120]})"
        _voice_alert("down", f"ElevenLabs failed on line {len(wavs) + 1} of {len(lines)} ({str(e)[:160]}). "
                             "The whole video used the Piper voice; nothing else is affected.")
        return None, info
    info["cost"] = chars * rate * EL_USD_PER_CREDIT
    info["line"] = f"voice: elevenlabs {v11.get('name') or v11['voice_id']} ({chars} chars)"
    return wavs, info


def _piper(brand, lines, jd):
    v = brand.VOICE
    wavs = []
    for i, text in enumerate(lines):
        w = f"{jd}/v{i:02d}.wav"
        p = subprocess.run([PIPER, "-m", v["model"], "--data-dir", VOICES, "--length-scale", str(v["length_scale"]),
                            "--sentence-silence", "0.25", "-f", w], input=text, capture_output=True, text=True)
        if p.returncode != 0 or not os.path.exists(w):
            raise RuntimeError(f"voice failed on line {i + 1}: {p.stderr[-400:]}")
        wavs.append((w, dur(w)))
    return wavs


def voice(brand, script, jd, job_id, client_slug=None):
    """Read every scene (ElevenLabs when the rules allow, else Piper, one provider for the whole video), lay the scenes out to
    fit the voice, build narration.wav + a quiet pad. Returns (total_seconds, info); info["line"] is the voice line for the job log."""
    pub = f"{jd}/public"
    lines = [s["say"] for s in script["scenes"]] + [script["end"]["say"]]
    wavs, info = _eleven(brand, lines, jd, client_slug or "")
    if wavs is None:
        wavs = _piper(brand, lines, jd)
        info["provider"] = "piper"
    else:
        info["provider"] = "elevenlabs"
    t, lead = 0.0, 0.35
    for s, (_, d) in zip(script["scenes"], wavs):
        s["start"], s["end"] = round(t, 3), round(t + max(d + lead + 0.6, 2.8), 3)
        s["voice_at"] = t + lead
        t = s["end"]
    d_end = wavs[-1][1]
    script["end"]["start"], script["end"]["end"] = round(t, 3), round(t + max(d_end + lead + 1.6, 4.2), 3)
    script["end"]["voice_at"] = t + lead
    total = script["end"]["end"]
    ats = [s["voice_at"] for s in script["scenes"]] + [script["end"]["voice_at"]]
    cmd = ["ffmpeg", "-y", "-v", "error"]
    for w, _ in wavs:
        cmd += ["-i", w]
    parts = [f"[{i}:a]aresample=44100,adelay={int(a * 1000)}:all=1[a{i}]" for i, a in enumerate(ats)]
    mix = "".join(f"[a{i}]" for i in range(len(ats)))
    cmd += ["-filter_complex", ";".join(parts) + f";{mix}amix=inputs={len(ats)}:normalize=0,apad=whole_dur={total:.3f},atrim=0:{total:.3f}[out]",
            "-map", "[out]", "-ac", "2", f"{pub}/narration.wav"]
    subprocess.run(cmd, check=True)
    # Soft A-major pad, low-passed, faded; sits ~-20 dB under the voice. Free and local (no music keys yet).
    root = random.choice([110.0, 123.47, 98.0])
    pad = "+".join(f"{a}*sin(2*PI*{root * m}*t)*(0.6+0.4*sin(2*PI*{lfo}*t+{ph}))"
                   for a, m, lfo, ph in [(0.05, 2, 0.09, 0), (0.04, 2.52, 0.13, 1), (0.04, 3, 0.07, 2), (0.03, 1, 0.05, 3)])
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"aevalsrc='{pad}':s=44100:d={total + 0.5:.2f}",
                    "-af", f"lowpass=f=900,aecho=0.8:0.6:180:0.25,afade=t=in:d=2,afade=t=out:st={max(total - 2.5, 0):.2f}:d=2.5",
                    "-ac", "2", f"{pub}/pad.wav"], check=True)
    json.dump({k: info.get(k) for k in ("provider", "line", "chars", "cost")}, open(f"{jd}/voice.json", "w"))
    return total, info


def _voice_report(job_id, info):
    """Put the voice line in the job log and add what ElevenLabs cost (credits actually used) to cost_usd."""
    p = {"note": info["line"]}
    if info.get("cost"):
        try:
            cur = float(((lib.get("studio_video_jobs", f"select=cost_usd&id=eq.{job_id}") or [{}])[0].get("cost_usd")) or 0)
            p["cost_usd"] = round(cur + info["cost"], 4)
        except Exception as e:  # noqa: BLE001
            print("cost lookup failed:", e, flush=True)
    report(job_id, **p)


def upload(path, name, ctype):
    with open(path, "rb") as f:
        data = f.read()
    h = {"apikey": lib.KEY, "Content-Type": ctype, "x-upsert": "true", "cache-control": "max-age=31536000"}
    if lib.KEY.startswith("eyJ"):
        h["Authorization"] = "Bearer " + lib.KEY
    urllib.request.urlopen(urllib.request.Request(f"{lib.URL}/storage/v1/object/{BUCKET}/{name}", data=data,
                                                  method="POST", headers=h), timeout=300).read()
    url = f"{lib.URL}/storage/v1/object/public/{BUCKET}/{name}"
    with urllib.request.urlopen(urllib.request.Request(url, method="HEAD"), timeout=60) as r:
        if r.status != 200:
            raise RuntimeError(f"uploaded file is not readable: {url}")
    return url


def fetch_clip(path, dst):
    h = {"apikey": lib.KEY}
    if lib.KEY.startswith("eyJ"):
        h["Authorization"] = "Bearer " + lib.KEY
    with urllib.request.urlopen(urllib.request.Request(f"{lib.URL}/storage/v1/object/ltx-clips/{path}", headers=h), timeout=300) as r, \
            open(dst, "wb") as f:
        shutil.copyfileobj(r, f)


def clips_for(job, script, jd, note):
    """Download the LTX b-roll for this job (or the parent's, on a re-cut) and fit each clip to its scene:
    vertical 1080x1920 cover-crop (landscape clips from an older box script get center-cropped), looped if short,
    trimmed to the scene, sound off. Returns {scene_index: "clips/sN.mp4"}; scenes without a clip stay plain cards."""
    order = job.get("clips")
    src_job = job["id"]
    if not order and job.get("parent_job_id"):
        rows = lib.get("studio_video_jobs", f"select=clips&id=eq.{job['parent_job_id']}") or []
        order, src_job = (rows[0].get("clips") if rows else None), job["parent_job_id"]
    if not order:
        return {}
    rows = {r["id"]: r for r in (lib.get("ltx_jobs", f"select=id,code,status,path,width,height&montage_job_id=eq.{src_job}") or [])}
    os.makedirs(f"{jd}/public/clips", exist_ok=True)
    out, missing = {}, []
    for c in order:
        i, r = int(c.get("scene", 0)), rows.get(c.get("id")) or {}
        if i >= len(script["scenes"]) or r.get("status") != "done" or not r.get("path"):
            missing.append(str(i + 1))
            continue
        raw = f"{jd}/clip{i}.mp4"
        fetch_clip(r["path"], raw)
        sc = script["scenes"][i]
        d = sc["end"] - sc["start"]
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-stream_loop", "-1", "-i", raw, "-t", f"{d + 0.2:.2f}",
                        "-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30",
                        "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p",
                        f"{jd}/public/clips/s{i}.mp4"], check=True)
        out[i] = f"clips/s{i}.mp4"
    note(f"b-roll: {len(out)} clip(s) placed" + (f"; scene(s) {', '.join(missing)} stay plain cards" if missing else ""))
    return out


def check(out, total):
    """Our own gate on top of OpenMontage's review. Returns a list of problems."""
    e = []
    pr = probe(out)
    v = [s for s in pr["streams"] if s["codec_type"] == "video"]
    a = [s for s in pr["streams"] if s["codec_type"] == "audio"]
    if not v or (v[0].get("width"), v[0].get("height")) != (1080, 1920):
        e.append(f"video is not 1080x1920 ({v[0].get('width') if v else '?'}x{v[0].get('height') if v else '?'})")
    if not a:
        e.append("no audio track")
    d = float(pr["format"]["duration"])
    if abs(d - total) > 1.0:
        e.append(f"length {d:.1f}s, expected {total:.1f}s")
    vol = subprocess.run(["ffmpeg", "-v", "info", "-i", out, "-af", "volumedetect", "-f", "null", "-"],
                         capture_output=True, text=True).stderr
    mean = [l for l in vol.splitlines() if "mean_volume" in l]
    if mean and float(mean[0].split(":")[1].split()[0]) < -40:
        e.append("audio is nearly silent")
    if os.path.getsize(out) > 90 * 1024 * 1024:
        e.append("file is over 90 MB")
    return e


def brand_for(slug):
    """brands/<slug with - as _>.py, only when montage_brand_policy says montage_ok for that client (default: refuse)."""
    pol = (lib.get("montage_brand_policy", f"select=montage_ok,note&client_slug=eq.{slug}") or [None])[0]
    if not pol or not pol.get("montage_ok"):
        raise RuntimeError(f"Montage does not make videos for '{slug}': {(pol or {}).get('note') or 'no policy row for this client'}")
    import importlib
    try:
        return importlib.import_module("brands." + slug.replace("-", "_"))
    except ModuleNotFoundError as e:
        raise RuntimeError(f"no Montage brand style for '{slug}' yet ({e})")


def process(job):
    jid = job["id"]
    jd = f"{JOBS}/{jid}"
    note = lambda msg: report(jid, note=msg)  # noqa: E731
    brand = brand_for(job["client_slug"])
    resumed = bool(job.get("stage") == "resumed" and job.get("script"))
    if not resumed:
        shutil.rmtree(jd, ignore_errors=True)
    os.makedirs(f"{jd}/public", exist_ok=True)
    for rel, src in brand.ASSETS.items():
        os.makedirs(os.path.dirname(f"{jd}/public/{rel}"), exist_ok=True)
        shutil.copy(src, f"{jd}/public/{rel}")

    if resumed:
        script = job["script"]
        vinfo = {}
        if os.path.exists(f"{jd}/public/narration.wav") and os.path.exists(f"{jd}/public/pad.wav"):
            total = script["end"]["end"]
            try:
                vinfo = json.load(open(f"{jd}/voice.json"))
            except (OSError, ValueError):
                pass
        else:  # voice files lost (reboot, cleanup): re-read the same script, never re-order clips
            total, vinfo = voice(brand, script, jd, jid, job["client_slug"])
            _voice_report(jid, vinfo)
        note("b-roll is back from the LTX box; picking the video up again")
    else:
        report(jid, stage="writing", note="re-cutting with the change note" if job.get("parent_job_id") else "writing the script with free AI")
        script = brand.write(job, note)
        report(jid, stage="voicing", script=script, note=f"script ok via {script['provider']} (editor {script['score']:g}/10)")
        total, vinfo = voice(brand, script, jd, jid, job["client_slug"])
        _voice_report(jid, vinfo)
        if job.get("broll") and not job.get("parent_job_id") and all(s.get("shot") for s in script["scenes"]):
            shots = [{"scene": i, "seconds": max(3, min(10, int(s["end"] - s["start"] + 0.99))),
                      "prompt": f"{s['shot']} {brand.SHOT_STYLE}"} for i, s in enumerate(script["scenes"])]
            report(jid, script=script)
            r = lib.rpc("montage_clip_request", p_id=jid, p_shots=shots) or {}
            lib.rpc("montage_post", p_id=jid, body=f"Script and voice are done (\"{script['title']}\", {total:.0f} sec). "
                    f"I ordered {len(shots)} b-roll clips from the LTX box (est. ${float(r.get('est_usd') or 0):.2f}); "
                    "I pick the video back up when they land.")
            return f"parked {jid}: waiting on {len(shots)} LTX clips"

    clips = clips_for(job, script, jd, note) if (job.get("clips") or job.get("parent_job_id")) else {}
    props = {"theme": script["theme"],
             "scenes": [{**{k: s[k] for k in ("kicker", "line", "start", "end")}, **({"clip": clips[i]} if i in clips else {})}
                        for i, s in enumerate(script["scenes"])],
             "end": {k: v for k, v in script["end"].items() if k != "say"},
             "audio": {"narration": "narration.wav", "music": "pad.wav", "musicVolume": 0.1}}
    if getattr(brand, "BRAND", None):        # shared composition (comp/brand): palettes, fonts, logo, closing art ride in the props
        props["brand"] = brand.BRAND
    json.dump(props, open(f"{jd}/props.json", "w"))
    json.dump({"composition_id": brand.COMPOSITION, "comp_dir": getattr(brand, "COMP_DIR", None),
               "script_text": " ".join(s["say"] for s in script["scenes"]) + " " + script["end"]["say"]},
              open(f"{jd}/comp.json", "w"))
    report(jid, stage="rendering", script=script, note=f"{total:.1f}s long, {len(clips)} b-roll clip(s); rendering in OpenMontage")

    t0 = time.time()
    raw = run([OMPY, "/opt/bestly/montage/om_render.py", jd, job["client_slug"]], jid, "rendering", 2400)
    render_s = int(time.time() - t0)
    res = json.loads(raw.strip().splitlines()[-1])
    out = f"{jd}/out.mp4"
    if not res.get("success") or not os.path.exists(out):
        raise RuntimeError(f"OpenMontage render failed: {res.get('error')} {res.get('issues')}")
    report(jid, stage="checking", render_s=render_s,
           note=f"rendered in {render_s}s; OpenMontage review: {res.get('review_status')} {('; '.join(map(str, res.get('issues') or [])))[:300]}")

    problems = check(out, total)
    if problems:
        raise RuntimeError("video failed the checks: " + "; ".join(problems))
    thumb = f"{jd}/thumb.jpg"
    first = script["scenes"][0]
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{first['start'] + 1.6:.2f}", "-i", out, "-frames:v", "1",
                    "-q:v", "3", thumb], check=True)

    report(jid, stage="filing", note="uploading")
    base = f"video/{job['client_slug']}/montage-{jid}"
    media = upload(out, f"{base}.mp4", "video/mp4")
    turl = upload(thumb, f"{base}.jpg", "image/jpeg")
    r = lib.rpc("montage_file", p_id=jid, p={
        "title": script["title"], "caption": script["caption"], "media_url": media, "thumb_url": turl,
        "variants": [{"platform": "instagram", "caption": script["caption"]}],
        "provenance": {"theme": script["theme"], "provider": script["provider"], "editor_score": script["score"], "broll_clips": len(clips),
                       "render_s": render_s, "length_s": round(total, 1), "openmontage": "9327439"},
        "note": ((f"Re-cut with the note: \"{(job.get('revise_note') or '')[:300]}\". " if job.get("parent_job_id") else "")
                 + f"Montage made this from the brief: \"{job['brief'][:300]}\". Script by free AI ({script['provider']}), "
                 f"passed {getattr(brand, 'NAME', 'HOKU')}'s claim rules and fact check (editor {script['score']:g}/10). Voice: {'ElevenLabs' if vinfo.get('provider') == 'elevenlabs' else 'Piper'}. "
                 + (f"{len(clips)} b-roll clip(s) from the LTX box. " if clips else "")
                 + f"Rendered on the Pi in {render_s}s with OpenMontage.")})
    return f"filed #{r.get('code')} '{script['title']}' ({total:.0f}s video, rendered in {render_s}s)"


def main():
    print(f"{WORKER} up", flush=True)
    last_beat = 0
    while True:
        try:
            jobs = lib.rpc("montage_claim", p_worker=WORKER) or []
        except Exception as e:  # noqa: BLE001
            print("claim failed:", e, flush=True)
            beat(False, f"cannot reach the queue: {str(e)[:200]}")
            time.sleep(60)
            continue
        if not jobs:
            if time.time() - last_beat > 120:
                beat(True, "idle, queue empty")
                last_beat = time.time()
            time.sleep(30)
            continue
        job = jobs[0]
        beat(True, f"started {job['id']}")
        try:
            msg = process(job)
            beat(True, msg)
            print(msg, flush=True)
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"
            print(traceback.format_exc(), flush=True)
            report(job["id"], status="failed", stage="failed", error=err[:2000], note=err[:400])
            beat(True, f"job {job['id']} failed: {err[:200]}")
            lib.notify("Montage: a video job failed", f"{job['client_slug']}: {err[:300]}", severity="warning",
                       push=False, url="/admin/team", dedupe=f"montage-jobfail-{job['id']}")
        last_beat = time.time()


if __name__ == "__main__":
    main()
