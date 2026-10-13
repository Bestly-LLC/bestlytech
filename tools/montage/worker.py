"""Montage: Spark's video crew on the Pi (Bestly, 2026-10-06).

systemd bestly-montage runs this forever. Each loop it checks in (agent_beats 'montage'), claims the oldest queued job
from studio_video_jobs (montage_claim) and makes the video:
  writing    brand module writes the script with free AI and passes the brand's claim rules + fact check
  voicing    ElevenLabs reads each scene; scene lengths follow the voice. No automatic Piper fallback (Jared 2026-10-10,
             answer 20 of docs/elevenlabs-studio-opusplan.md): when ElevenLabs is unavailable, below the 30% reserve or fails,
             the job goes `held`, Spark tells Jared once a day, and this worker re-checks every 30 min and resumes by itself
             (7 days held -> failed + alert). Piper only runs when montage_settings voice.provider = 'piper' (manual switch).
  music      a real music bed from the library (music.py, rule of 2026-10-12: every video ships with music): picked by brand + mood, never the
             track used last for the brand, fitted with soft fades and lowered under the narration. No track for the brand = the job is `held`
             before any voice is bought, Spark alerts once a day per brand (montage.music), never filed silent.
  rendering  OpenMontage VideoCompose, atelier mode, our hand-authored brand composition (om_render.py)
  checking   OpenMontage's post-render review + our own ffprobe / loudness / size checks
  filing     MP4 + thumbnail to storage, then montage_file puts it in Studio > Drafts > To review
A heartbeat goes out every minute while it works. Supabase cron montage-watch requeues a job whose heartbeat stops
(3 tries) and alerts as Montage if the worker itself goes quiet; systemd restarts the process.
"""
import datetime
import hashlib
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
import music  # noqa: E402

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
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries",
                        "format=duration:stream=codec_type,width,height,pix_fmt,color_range,color_space,color_primaries,color_transfer",
                        "-of", "json", path], capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def is_standard(pr):
    """True when the video stream is what Apple's decoder (Safari, the Studio app on a Mac) plays: yuv420p, limited (tv) range, bt709 tags."""
    v = [s for s in pr["streams"] if s["codec_type"] == "video"]
    return bool(v) and v[0].get("pix_fmt") == "yuv420p" and v[0].get("color_range") == "tv" \
        and v[0].get("color_space") == "bt709" and v[0].get("color_primaries") == "bt709" and v[0].get("color_transfer") == "bt709"


def normalize(path, jid=None):
    """Make the file a standard video (H.264 High 4.1, yuv420p, tv range, bt709, AAC, faststart) and swap it in.
    The Remotion render came out yuvj420p / full range / bt470bg with no bt709 tags (2026-10-12): Chrome plays that, Safari and the
    Studio app on a Mac do not. Returns True when it re-encoded, False when the file was already standard."""
    pr = probe(path)
    if is_standard(pr):
        return False
    v = [s for s in pr["streams"] if s["codec_type"] == "video"][0]
    full = v.get("color_range") == "pc" or str(v.get("pix_fmt", "")).startswith("yuvj")
    tmp = path + ".norm.mp4"
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", path, "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-profile:v", "high",
           "-level", "4.1", "-pix_fmt", "yuv420p", "-vf", "scale=in_range=full:out_range=tv" if full else "scale=out_range=tv",
           "-x264-params", "colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off",   # ffmpeg 7.1 on the Pi drops -color_primaries/-color_trc for libx264
           "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
           "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", tmp]
    if jid:
        run(cmd, jid, "checking", 1800)
    else:
        subprocess.run(cmd, check=True, timeout=1800)
    if not is_standard(probe(tmp)) or abs(dur(tmp) - float(pr["format"]["duration"])) > 0.5:
        os.remove(tmp)
        raise RuntimeError("normalize: re-encode did not give a standard video")
    os.replace(tmp, path)
    return True


def dur(path):
    return float(probe(path)["format"]["duration"])


EL_API = "https://api.elevenlabs.io"
EL_USD_PER_CREDIT = 99 / 600008      # Pro plan: $99 for 600,008 credits (the live plan; music_library.py reads it from the subscription)
HOLD_RECHECK_MIN = 30                # a held job is looked at again every 30 minutes
HOLD_GIVE_UP_DAYS = 7                # after 7 days held the job fails (+ alert)
_el_key = {}


class VoiceHeld(Exception):
    """ElevenLabs cannot read this video right now. The job is HELD (not voiced by Piper) and retried by the worker.
    kind: 'low' (credits under the reserve: money, pushes once a day), 'down' (outage / error / no key: info, no push),
    'switch' (the Studio voiceover switch is off for this brand: info, no push). cost/credits = what a partial run already spent."""

    def __init__(self, reason, kind="down", cost=0.0, credits=0.0, voice=None):
        super().__init__(reason)
        self.reason, self.kind, self.cost, self.credits, self.voice = reason, kind, cost, credits, voice or {}


class MusicHeld(VoiceHeld):
    """The brand has no music track (or the picked file is unreadable), so the video waits instead of being filed with no music
    (Jared 2026-10-12). Held like a voice hold: re-checked every 30 minutes, stopped after 7 days; Spark's alert is montage.music (info, once a day per brand)."""

    def __init__(self, reason, brand=""):
        super().__init__(reason, "music")
        self.brand = brand


def _music_alert(brand, why):
    day = time.strftime("%Y-%m-%d")
    try:
        lib.notify(f"Spark: a {brand} video is on hold, no music track yet", why[:600], severity="info", push=False,
                   url="/admin/team", dedupe=f"montage.music-{brand}-{day}")
    except Exception as e:  # noqa: BLE001  (an alert must never break the loop)
        print("music alert failed:", e, flush=True)


def _music_gate(brand, brand_slug):
    """Before anything is bought: the brand must have at least one usable track, or the job is held."""
    try:
        n = music.ready(brand_slug)
    except music.NoMusic as e:
        raise MusicHeld(f"no music: {e}", brand_slug)
    if n < 1:
        raise MusicHeld(f"no music track for {brand_slug} yet (the music library has nothing this brand can use)", brand_slug)


def _el_secret():
    """ElevenLabs key through pi_secret (Vault). Never raises; an empty key means the job is held ('down')."""
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
    """Spark's alert when a video is held (scout_notify, title starts "Spark:", owner prefix montage.voice -> Spark).
    'low' = plan credits are money: warning + push, once a day. 'down' (outage / error) and 'switch' (voiceover switch off):
    info, no push, once a day each."""
    day = time.strftime("%Y-%m-%d")
    try:
        if kind == "low":
            lib.notify("Spark: videos are on hold, ElevenLabs credits are low", why[:600], severity="warning", push=True,
                       url="/admin/team", dedupe=f"montage.voice-low-{day}")
        elif kind == "switch":
            lib.notify("Spark: a video is on hold, the voiceover switch is off", why[:600], severity="info", push=False,
                       url="/admin/team", dedupe=f"montage.voice-switch-{day}")
        else:
            lib.notify("Spark: a video is on hold, ElevenLabs did not answer", why[:600], severity="info", push=False,
                       url="/admin/team", dedupe=f"montage.voice-down-{day}")
    except Exception as e:  # noqa: BLE001  (an alert must never break the loop)
        print("voice alert failed:", e, flush=True)


def _feature_on(client_slug):
    """Studio > Settings > Audio switch for this brand's 'voiceover' (studio_audio_features). True / False, or None when the table does
    not exist yet (then only montage_brand_policy.ai_voice_ok decides). The table's own rule applies: a brand with no row has every switch off."""
    try:
        rows = lib.get("studio_audio_features", f"select=enabled&owner_slug=eq.{client_slug}&feature=eq.voiceover") or []
    except Exception as e:  # noqa: BLE001
        if "HTTP 404" in str(e) or "PGRST205" in str(e) or "does not exist" in str(e):
            return None
        raise
    return bool(rows[0]["enabled"]) if rows else False


def _eleven(brand, lines, jd, client_slug):
    """ElevenLabs for the whole video: returns (wavs, info) on success, (None, info) ONLY when the manual Piper switch is set
    (montage_settings voice.provider = 'piper'). Everything else that stops ElevenLabs raises VoiceHeld (held + retried) or, for
    a permanent no (client policy forbids AI voice, brand has no ElevenLabs voice), RuntimeError (the job fails with that reason).
    info = {"line": job-log text, "chars", "credits": credits actually spent now, "cost": estimated USD, "voice_id", "voice_name", "model"}.
    Rules: setting says elevenlabs + client ai_voice_ok + Studio voiceover switch not off + brand VOICE_11 + key + subscription answers +
    credits left after this video stay >= reserve_pct of the limit (that reserve is Ava's calls). One voice per video, never mixed."""
    info = {"line": "", "chars": 0, "credits": 0.0, "cost": 0.0}
    try:
        st = (lib.get("montage_settings", "select=value&key=eq.voice") or [{}])[0].get("value") or {}
    except Exception as e:  # noqa: BLE001
        raise VoiceHeld(f"the voice settings could not be read ({str(e)[:100]})", "down")
    if st.get("provider") == "piper":      # the ONLY way Piper runs now: a person flipped the setting
        info["line"] = "voice: piper (manual switch: montage_settings voice.provider = piper)"
        return None, info
    if st.get("provider") != "elevenlabs":
        raise VoiceHeld(f"montage_settings voice.provider is {st.get('provider') or 'unset'}, not elevenlabs or piper", "down")
    v11 = getattr(brand, "VOICE_11", None)
    if not v11 or not v11.get("voice_id"):
        raise RuntimeError("this brand has no ElevenLabs voice (VOICE_11 in its brand module). Add one, or flip montage_settings "
                           "voice.provider to piper by hand; Montage no longer picks Piper on its own")
    try:
        pol = (lib.get("montage_brand_policy", f"select=ai_voice_ok&client_slug=eq.{client_slug}") or [{}])[0]
    except Exception as e:  # noqa: BLE001
        raise VoiceHeld(f"the client voice policy could not be read ({str(e)[:100]})", "down")
    if not pol.get("ai_voice_ok"):
        raise RuntimeError(f"client policy for '{client_slug}' does not allow an AI voice (montage_brand_policy.ai_voice_ok), so this video cannot be voiced")
    try:
        on = _feature_on(client_slug)
    except Exception as e:  # noqa: BLE001
        raise VoiceHeld(f"the Studio audio switches could not be read ({str(e)[:100]})", "down")
    if on is False:
        raise VoiceHeld(f"the voiceover switch for '{client_slug}' is off in Studio > Settings > Audio (only Jared can turn it on)", "switch")
    model = st.get("model") or "eleven_multilingual_v2"
    rate = 0.5 if model.startswith(("eleven_flash", "eleven_turbo")) else 1.0
    reserve = float(st.get("reserve_pct", 30))
    info.update(voice_id=v11["voice_id"], voice_name=v11.get("name") or v11["voice_id"], model=model)
    key = _el_secret()
    if not key:
        raise VoiceHeld("no ElevenLabs key could be read from Vault (pi_secret elevenlabs_api_key)", "down", voice=info)
    chars = sum(len(t) for t in lines)
    try:
        sub = json.loads(_el_call("GET", "/v1/user/subscription", key, timeout=20))
        limit, used = int(sub["character_limit"]), int(sub["character_count"])
    except Exception as e:  # noqa: BLE001
        raise VoiceHeld(f"the ElevenLabs subscription check failed ({str(e)[:100]})", "down", voice=info)
    left_after = limit - used - chars * rate
    if left_after < limit * reserve / 100:
        try:
            reset = time.strftime("%b %-d, %-I:%M %p", time.localtime(int(sub["next_character_count_reset_unix"])))
        except Exception:  # noqa: BLE001
            reset = "the next reset"
        raise VoiceHeld(f"ElevenLabs plan credits are low: {limit - used:,} of {limit:,} left, this video needs about {int(chars * rate):,}, "
                        f"and the last {reserve:g}% ({int(limit * reserve / 100):,}) is kept for Ava's calls. Credits reset {reset}",
                        "low", voice=info)
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
            m, w, kf = f"{jd}/v{i:02d}.mp3", f"{jd}/v{i:02d}.wav", f"{jd}/v{i:02d}.key"
            ck = hashlib.sha1(json.dumps([v11["voice_id"], body], sort_keys=True).encode()).hexdigest()
            try:
                cached = os.path.exists(m) and open(kf).read() == ck      # a scene already paid for in an earlier try is reused
            except OSError:
                cached = False
            if not cached:
                mp3 = _el_call("POST", f"/v1/text-to-speech/{v11['voice_id']}?output_format=mp3_44100_128", key, body)
                info["chars"] += len(text)
                info["credits"] += len(text) * rate
                with open(m, "wb") as f:
                    f.write(mp3)
                with open(kf, "w") as f:
                    f.write(ck)
            # ElevenLabs pads each clip with ~0.3 s of silence at both ends; trim to the speech (keeps 0.05 s / 0.15 s) so the
            # gaps between scenes match what Piper gave and nothing sounds like a dead pause.
            subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", m, "-af",
                            "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05,areverse,"
                            "silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,areverse",
                            "-ar", "44100", "-ac", "1", w], check=True, timeout=60)
            wavs.append((w, dur(w)))
    except Exception as e:  # noqa: BLE001  (any scene failing holds the whole video; scenes already paid for stay cached)
        raise VoiceHeld(f"ElevenLabs failed on line {len(wavs) + 1} of {len(lines)} ({str(e)[:120]})", "down",
                        cost=info["credits"] * EL_USD_PER_CREDIT, credits=info["credits"], voice=info)
    info["cost"] = info["credits"] * EL_USD_PER_CREDIT
    info["line"] = f"voice: elevenlabs {info['voice_name']} ({chars} chars)"
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


def _level(path, target=-16.0):
    """ElevenLabs speech comes in around -24 LUFS while Piper's sits near -16 (what the final mixes were tuned on): bring the
    narration to -16 LUFS integrated with one static gain, peaks held under -1 dBFS by a limiter. Never raises (a missed level is not a failure)."""
    try:
        r = subprocess.run(["ffmpeg", "-v", "info", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"],
                           capture_output=True, text=True, timeout=120).stderr
        lufs = float(r.rsplit("Integrated loudness:", 1)[1].split("I:")[1].split("LUFS")[0])
        gain = max(-6.0, min(14.0, target - lufs))
        tmp = path + ".lvl.wav"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", path, "-af", f"volume={gain:.2f}dB,alimiter=limit=0.89:level=disabled",
                        "-ac", "2", tmp], check=True, timeout=120)
        os.replace(tmp, path)
    except Exception as e:  # noqa: BLE001
        print("level skipped:", e, flush=True)


def voice(brand, script, jd, job_id, client_slug=None):
    """Read every scene with ElevenLabs (Piper only when montage_settings voice.provider = 'piper'; otherwise a problem raises
    VoiceHeld and the job is held), lay the scenes out to fit the voice, build narration.wav (the music bed is built after, by music.py).
    Returns (total_seconds, info); info["line"] is the voice line for the job log."""
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
        s["voice_end"] = round(t + lead + d, 3)
        t = s["end"]
    d_end = wavs[-1][1]
    script["end"]["start"], script["end"]["end"] = round(t, 3), round(t + max(d_end + lead + 1.6, 4.2), 3)
    script["end"]["voice_at"] = t + lead
    script["end"]["voice_end"] = round(t + lead + d_end, 3)
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
    if info["provider"] == "elevenlabs":
        _level(f"{pub}/narration.wav")
    json.dump({k: info.get(k) for k in ("provider", "line", "chars", "credits", "cost", "voice_id", "voice_name", "model")},
              open(f"{jd}/voice.json", "w"))
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


def hold(job, h):
    """Park a video whose voice cannot be made right now (VoiceHeld). First hold: tell the requester's thread and Spark's alert.
    Every later look (every 30 min) only refreshes the reason and the next check. After 7 days held the job fails + alert."""
    jid, now = job["id"], time.time()
    since = None
    if job.get("held_since"):
        try:
            since = datetime.datetime.fromisoformat(str(job["held_since"]).replace("Z", "+00:00")).timestamp()
        except ValueError:
            since = None
    spent = {}
    if h.cost:
        try:
            cur = float(((lib.get("studio_video_jobs", f"select=cost_usd&id=eq.{jid}") or [{}])[0].get("cost_usd")) or 0)
            spent["cost_usd"] = round(cur + h.cost, 4)
        except Exception as e:  # noqa: BLE001
            print("cost lookup failed:", e, flush=True)
    is_music = h.kind == "music"
    if is_music and job.get("script"):          # the script already carries the voice timings; keep it so the resume does not re-buy the voice
        spent["script"] = job["script"]
    if not is_music:
        audio_log(job, "held", h.voice, held_reason=h.reason, credits=h.credits, cost=h.cost)
    if since and now - since > HOLD_GIVE_UP_DAYS * 86400:
        err = f"held {HOLD_GIVE_UP_DAYS} days without {'a music track' if is_music else 'a voice'}, stopped: {h.reason}"
        report(jid, status="failed", stage="failed", error=err[:2000], note=err[:400], **spent)
        if not is_music:
            audio_log(job, "failed", h.voice, held_reason=err)
        lib.notify("Spark: a video was stopped after a week on hold", f"{job['client_slug']}: {err[:420]} Ask Spark to make it again once "
                   f"{'the music library has a track for this brand' if is_music else 'the voice works'}.",
                   severity="warning", push=False, url="/admin/team", dedupe=f"montage.{'music' if is_music else 'voice'}-giveup-{jid}")
        return f"job {jid} failed after {HOLD_GIVE_UP_DAYS} days held"
    check_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now + HOLD_RECHECK_MIN * 60))
    first = since is None
    same = (job.get("held_reason") or "")[:25] == h.reason[:25]
    p = dict(status="held", stage="held", held_reason=h.reason, held_check_at=check_at, **spent)
    if first or not same:
        p["note"] = f"on hold ({h.kind}): {h.reason}"[:480]
    report(jid, **p)
    if first:
        try:
            if is_music:
                lib.rpc("montage_post", p_id=jid, body=f"I am holding this video: {h.reason}. Every video ships with real music, so I will not file it without. "
                        f"I check again every {HOLD_RECHECK_MIN} minutes and finish it on my own as soon as the library has a track (I stop after {HOLD_GIVE_UP_DAYS} days).")
            else:
                lib.rpc("montage_post", p_id=jid, body=f"I am holding this video: {h.reason}. I did not switch to a cheaper voice. I check again every "
                        f"{HOLD_RECHECK_MIN} minutes and finish it on my own as soon as the voice works (I stop after {HOLD_GIVE_UP_DAYS} days).")
        except Exception as e:  # noqa: BLE001
            print("hold post failed:", e, flush=True)
    why = h.reason
    if is_music:
        brand = getattr(h, "brand", "") or job["client_slug"]
        _music_alert(brand, f"{h.reason}. Every Montage video ships with a real music bed (Jared, 2026-10-12), so this video waits and finishes by itself "
                     "once the brand has a track. Spark can quote the starter library (ElevenLabs Music) for a yes; nothing else is affected.")
        return f"held {jid} (music): {h.reason[:120]}"
    if h.kind == "low":
        why = (f"{h.reason}. Plan credits (Pro, $99 a month) are what Montage and Ava's calls share, and Montage will not go past the plan. "
               "Video voiceovers wait and restart on their own when the credits reset; nothing else is affected.")
    elif h.kind == "switch":
        why = f"{h.reason}. The video resumes by itself once the switch is on."
    else:
        why = f"{h.reason}. Videos wait and try again every {HOLD_RECHECK_MIN} minutes; nothing else is affected."
    _voice_alert(h.kind, why)
    return f"held {jid} ({h.kind}): {h.reason[:120]}"


def _rest_audio(method, query, body=None):
    """PostgREST call on studio_audio_jobs with the service key; returns the rows (or None). Raises RuntimeError with the HTTP code."""
    h = {"apikey": lib.KEY, "Content-Type": "application/json", "Prefer": "return=representation"}
    if lib.KEY.startswith("eyJ"):
        h["Authorization"] = "Bearer " + lib.KEY
    req = urllib.request.Request(f"{lib.URL}/rest/v1/studio_audio_jobs{query}", method=method, headers=h,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode()[:200]}")


def audio_log(job, status, vinfo=None, held_reason=None, credits=None, cost=None):
    """Each video's voiceover is one studio_audio_jobs row (owner_slug = the brand, feature 'voiceover', engine 'elevenlabs',
    requested_by 'montage'), status 'held' while it waits and 'done' / 'failed' at the end, with credits and cost_usd added up across
    tries. Montage is pre-approved daily automation for house brands, so there is no quote / confirm step (billed_usd stays 0, house).
    Never raises; silent until the table exists."""
    try:
        vinfo = vinfo or {}
        if credits is None:
            credits = float(vinfo.get("credits") or 0)
        if cost is None:
            cost = float(vinfo.get("cost") or 0)
        if vinfo.get("provider") == "piper":      # manual Piper switch: nothing was bought from ElevenLabs
            credits = cost = 0.0
        rows = _rest_audio("GET", f"?select=code,actual_credits,cost_usd&requested_by=eq.montage&inputs-%3E%3Emontage_job_id=eq.{job['id']}&limit=1") or []
        now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        meta = {k: v for k, v in {"tool": "montage", "provider": vinfo.get("provider") or "elevenlabs", "model": vinfo.get("model"),
                                  "voice_name": vinfo.get("voice_name"), "montage_job_id": job["id"]}.items() if v}
        patch = {"status": status, "held_reason": held_reason if status == "held" else None,
                 "error": held_reason if status == "failed" else None}
        if vinfo.get("voice_id"):
            patch["voice_id"] = vinfo["voice_id"]
        if status in ("done", "failed"):
            patch["finished_at"] = now
        if rows:
            r = rows[0]
            patch["actual_credits"] = round(float(r.get("actual_credits") or 0) + credits, 1)
            patch["cost_usd"] = round(float(r.get("cost_usd") or 0) + cost, 4)
            patch["meta"] = meta
            _rest_audio("PATCH", f"?code=eq.{r['code']}", patch)
        else:
            sc = job.get("script") or {}
            chars = sum(len(x.get("say", "")) for x in (sc.get("scenes") or [])) + len((sc.get("end") or {}).get("say", ""))
            rate = 0.5 if str(vinfo.get("model") or "").startswith(("eleven_flash", "eleven_turbo")) else 1.0
            _rest_audio("POST", "", {"owner_slug": job["client_slug"], "feature": "voiceover", "requested_by": "montage", "engine": "elevenlabs",
                                     "inputs": {"montage_job_id": job["id"], "pipeline": "montage", "chars": chars or None},
                                     "est_credits": round(chars * rate, 1) or None, "actual_credits": round(credits, 1), "cost_usd": round(cost, 4),
                                     "billed_usd": 0, "confirmed_at": now, "started_at": now, "meta": meta,
                                     "provenance": {"ai_generated": True, "feature": "voiceover", "voice_id": vinfo.get("voice_id"),
                                                    "voice_name": vinfo.get("voice_name"), "model": vinfo.get("model")}, **patch})
    except Exception as e:  # noqa: BLE001  (logging must never fail or hold a video)
        if not any(t in str(e) for t in ("HTTP 404", "PGRST205", "does not exist")):
            print("audio_log failed:", e, flush=True)


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
        # a re-cut of a re-cut still uses the footage ordered on an earlier cut: walk up the chain to the first job that has clips
        # (fixed 2026-10-12: BC05's 3rd cut came back with no b-roll because its parent was itself a re-cut with clips=null)
        pid = job["parent_job_id"]
        for _ in range(12):
            rows = lib.get("studio_video_jobs", f"select=clips,parent_job_id&id=eq.{pid}") or []
            if not rows:
                break
            if rows[0].get("clips"):
                order, src_job = rows[0]["clips"], pid
                break
            pid = rows[0].get("parent_job_id")
            if not pid:
                break
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


def check(out, total, script=None, minfo=None):
    """Our own gate on top of OpenMontage's review. Returns a list of problems. A video with no music bed, a near-silent bed, or a finished mix
    that is silent in the gaps between narration lines FAILS (rule of 2026-10-12: every video ships with a real music bed)."""
    e = music.bed_problems(out, script or {"scenes": [], "end": {}}, minfo)
    pr = probe(out)
    v = [s for s in pr["streams"] if s["codec_type"] == "video"]
    a = [s for s in pr["streams"] if s["codec_type"] == "audio"]
    if not v or (v[0].get("width"), v[0].get("height")) != (1080, 1920):
        e.append(f"video is not 1080x1920 ({v[0].get('width') if v else '?'}x{v[0].get('height') if v else '?'})")
    if v and not is_standard(pr):
        e.append(f"video is not standard ({v[0].get('pix_fmt')}/{v[0].get('color_range')}/{v[0].get('color_space')}): Safari may not play it")
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


def _render(jd, job, jid):
    """One OpenMontage render of the job's props. Returns OpenMontage's result dict; raises RuntimeError when it did not make out.mp4."""
    out = f"{jd}/out.mp4"
    if os.path.exists(out):
        os.remove(out)
    raw = run([OMPY, "/opt/bestly/montage/om_render.py", jd, job["client_slug"]], jid, "rendering", 2400)
    res = json.loads(raw.strip().splitlines()[-1])
    if not res.get("success") or not os.path.exists(out):
        raise RuntimeError(f"OpenMontage render failed: {res.get('error')} {res.get('issues')}")
    return res


def _has_graphics(props):
    return any(s.get("icon") or s.get("card") for s in props["scenes"]) or bool((props.get("end") or {}).get("chips")) or \
        bool((props.get("brand") or {}).get("ambient")) or bool(((props.get("brand") or {}).get("end") or {}).get("heroLogo"))


def _plain(props):
    """The same props without the 2026-10-12 graphics (what the composition drew before)."""
    p = json.loads(json.dumps(props))
    for s in p["scenes"]:
        s.pop("icon", None)
        s.pop("card", None)
    if p.get("end"):
        p["end"].pop("chips", None)
    if p.get("brand"):
        p["brand"].pop("ambient", None)
        (p["brand"].get("end") or {}).pop("heroLogo", None)
        (p["brand"].get("end") or {}).pop("orb", None)
    return p



def _approved_recut_broll(job, jid, shots, note):
    """A re-cut may order b-roll only with an approved dollar amount on the job (budget_usd, set by montage_recut_broll). The whole order is
    priced as ONE batch (ltx_quote of the summed seconds + the idle tail); if that is above the approved amount nothing is ordered."""
    approved = float(job.get("budget_usd") or 0)
    if approved <= 0:
        raise RuntimeError("this re-cut asks for b-roll but no spend was approved on it (budget_usd is 0); nothing was ordered")
    secs = sum(s["seconds"] for s in shots)
    q = lib.rpc("ltx_quote", p_seconds=secs) or {}
    est = float(q.get("est_usd") or 0) + float(q.get("idle_tail_usd") or 0)
    note(f"b-roll quote for the re-cut: {len(shots)} clips, {secs} sec, est. ${est:.2f} (approved up to ${approved:.2f})")
    if est <= 0 or est > approved:
        raise RuntimeError(f"b-roll quote ${est:.2f} for {secs} sec is above the approved ${approved:.2f}; nothing was ordered")


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
        if os.path.exists(f"{jd}/public/narration.wav") and script["end"].get("end"):
            total = script["end"]["end"]
            try:
                vinfo = json.load(open(f"{jd}/voice.json"))
            except (OSError, ValueError):
                pass
        else:  # held for its voice, or voice files lost (reboot, cleanup): read the same script again, never re-order clips
            _music_gate(brand, job["client_slug"])      # before the voice is bought: no track for the brand = held again
            total, vinfo = voice(brand, script, jd, jid, job["client_slug"])
            _voice_report(jid, vinfo)
            audio_log(job, "done", vinfo)
            if job.get("held_since"):
                note("the voice works again; picking the video up")
                try:
                    lib.rpc("montage_post", p_id=jid, body="The voice is available again, so I am finishing this video now.")
                except Exception as e:  # noqa: BLE001
                    print("resume post failed:", e, flush=True)
        if not job.get("held_since"):
            note("b-roll is back from the LTX box; picking the video up again")
    else:
        report(jid, stage="writing", note="re-cutting with the change note" if job.get("parent_job_id") else "writing the script with free AI")
        script = brand.write(job, note)
        job["script"] = script
        report(jid, stage="voicing", script=script, note=(f"script ok ({script['provider']}, passed the claim rules)" if script["provider"] == "hand-written"
                                                          else f"script ok via {script['provider']} (editor {script['score']:g}/10)"))
        _music_gate(brand, job["client_slug"])          # before the voice is bought: no track for the brand = held, nothing spent
        total, vinfo = voice(brand, script, jd, jid, job["client_slug"])
        _voice_report(jid, vinfo)
        audio_log(job, "done", vinfo)
        # A new job with broll=true orders clips (Spark asked after a quote and a yes). A RE-CUT orders fresh clips only when its job says
        # broll=true, and that is set only by montage_recut_broll (it needs an approved dollar amount, stored in budget_usd). The default
        # re-cut (trigger montage_recut) is broll=false and reuses the parent's clips, $0.
        if job.get("broll") and all(s.get("shot") for s in script["scenes"]):
            shots = [{"scene": i, "seconds": max(3, min(10, int(s["end"] - s["start"] + 0.99))),
                      "prompt": f"{s['shot']} {brand.SHOT_STYLE}"} for i, s in enumerate(script["scenes"])]
            if job.get("parent_job_id"):
                _approved_recut_broll(job, jid, shots, note)
            report(jid, script=script)
            r = lib.rpc("montage_clip_request", p_id=jid, p_shots=shots) or {}
            lib.rpc("montage_post", p_id=jid, body=f"Script and voice are done (\"{script['title']}\", {total:.0f} sec). "
                    f"I ordered {len(shots)} b-roll clips from the LTX box (est. ${float(r.get('est_usd') or 0):.2f}); "
                    "I pick the video back up when they land.")
            return f"parked {jid}: waiting on {len(shots)} LTX clips"

    mood = music.mood_for(script, brand)
    minfo = music.stored(jd)
    if not minfo:
        report(jid, stage="music", note=f"picking a {mood} music bed for {job['client_slug']}")
        try:
            minfo = music.build(job["client_slug"], mood, script, total, jd, jid)
        except music.NoMusic as e:
            raise MusicHeld(f"no music: {e}", job["client_slug"])
        note(f"music: '{minfo['name']}' ({minfo['mood']}{', looped' if minfo.get('looped') else ''}), ducked {minfo['duck_db']:g} dB under the voice")
    if job.get("held_since") and (job.get("held_reason") or "").startswith("no music"):
        note("a music track is available now; picking the video up")
        try:
            lib.rpc("montage_post", p_id=jid, body="The music library has a track for this brand now, so I am finishing this video.")
        except Exception as e:  # noqa: BLE001
            print("music resume post failed:", e, flush=True)
    clips = clips_for(job, script, jd, note) if (job.get("clips") or job.get("parent_job_id")) else {}
    props = {"theme": script["theme"],
             "scenes": [{**{k: s[k] for k in ("kicker", "line", "start", "end")}, **({"clip": clips[i]} if i in clips else {}),
                         **({"icon": s["icon"]} if s.get("icon") else {}), **({"card": s["card"]} if s.get("card") else {})}
                        for i, s in enumerate(script["scenes"])],
             "end": {k: v for k, v in script["end"].items() if k != "say"},
             "audio": {"narration": "narration.wav", "music": "music.wav", "musicVolume": 1.0}}   # music.wav is already ducked under the voice (music.py)
    if getattr(brand, "BRAND", None):        # shared composition (comp/brand): palettes, fonts, logo, closing art ride in the props
        props["brand"] = brand.BRAND
    json.dump(props, open(f"{jd}/props.json", "w"))
    json.dump({"composition_id": brand.COMPOSITION, "comp_dir": getattr(brand, "COMP_DIR", None),
               "script_text": " ".join(s["say"] for s in script["scenes"]) + " " + script["end"]["say"]},
              open(f"{jd}/comp.json", "w"))
    report(jid, stage="rendering", script=script, note=f"{total:.1f}s long, {len(clips)} b-roll clip(s); rendering in OpenMontage")

    t0 = time.time()
    out = f"{jd}/out.mp4"
    try:
        res = _render(jd, job, jid)
    except RuntimeError as e:
        # self-heal: the motion graphics (icons, closing-card chips, ambient glow) are extras. If the render breaks with them on, draw the same
        # video as plain cards instead of losing the job, and tell Spark (info, no push) so the graphics get fixed.
        if not _has_graphics(props):
            raise
        note(f"render with graphics failed ({str(e)[:160]}); drawing plain cards")
        props = _plain(props)
        json.dump(props, open(f"{jd}/props.json", "w"))
        res = _render(jd, job, jid)
        lib.notify("Spark: a video was drawn without its graphics", f"{job['client_slug']}: the graphics render failed ({str(e)[:240]}). "
                   "The video was filed as plain cards; the composition in tools/montage/comp/brand needs a look.", severity="info", push=False,
                   url="/admin/team", dedupe=f"montage.graphics-{jid}")
    render_s = int(time.time() - t0)
    report(jid, stage="checking", render_s=render_s,
           note=f"rendered in {render_s}s; OpenMontage review: {res.get('review_status')} {('; '.join(map(str, res.get('issues') or [])))[:300]}")

    if normalize(out, jid):
        note("re-encoded to the standard video format (yuv420p, tv range, bt709) so it plays in Safari")
    problems = check(out, total, script, minfo)
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
        "provenance": {"music": {k: minfo.get(k) for k in ("track_id", "name", "mood", "looped", "duck_db")}, "theme": script["theme"], "provider": script["provider"], "editor_score": script["score"], "broll_clips": len(clips),
                       "render_s": render_s, "length_s": round(total, 1), "openmontage": "9327439",
                       **({"recut_changed": script["recut_changed"]} if script.get("recut_changed") is not None else {}),
                       **({"graphics": True} if _has_graphics(props) else {})},
        "note": ((f"Re-cut with the note: \"{(job.get('revise_note') or '')[:300]}\". " if job.get("parent_job_id") else "")
                 + f"Montage made this from the brief: \"{job['brief'][:300]}\". "
                 + (f"Script hand-written for this ad, passed {getattr(brand, 'NAME', 'HOKU')}'s claim rules and number guard. " if script["provider"] == "hand-written" else
                    f"Script by free AI ({script['provider']}), passed {getattr(brand, 'NAME', 'HOKU')}'s claim rules and fact check (editor {script['score']:g}/10). ")
                 + f"Voice: {'ElevenLabs' if vinfo.get('provider') == 'elevenlabs' else 'Piper'}. "
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
        except VoiceHeld as h:        # not a failure: the video waits for its voice (see hold())
            try:
                msg = hold(job, h)
            except Exception as e:  # noqa: BLE001  (even if the hold bookkeeping breaks, put the job back instead of leaving it 'working')
                print("hold failed:", e, flush=True)
                report(job["id"], status="held", stage="held", held_reason=h.reason[:400])
                msg = f"held {job['id']}: {h.reason[:120]}"
            beat(True, msg)
            print(msg, flush=True)
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"
            print(traceback.format_exc(), flush=True)
            if type(e).__name__ == "RecutUnchanged":      # brands._common: a re-cut that came back the same (twice); not a crash, not an alarm
                err = f"re-cut not filed: {e}"
                report(job["id"], status="failed", stage="failed", error=err[:2000], note=err[:400])
                beat(True, f"re-cut {job['id']} stopped: copy would not change")
                try:
                    lib.notify("Spark: a re-cut was stopped, the new copy matched the old", f"{job['client_slug']}: {str(e)[:380]} "
                               "Try the note again with a sentence on what the new opening should say.", severity="info", push=False,
                               url="https://studio.bestly.tech", dedupe=f"montage.recut-{job['id']}")
                except Exception as e2:  # noqa: BLE001
                    print("recut alert failed:", e2, flush=True)
                last_beat = time.time()
                continue
            report(job["id"], status="failed", stage="failed", error=err[:2000], note=err[:400])
            beat(True, f"job {job['id']} failed: {err[:200]}")
            lib.notify("Montage: a video job failed", f"{job['client_slug']}: {err[:300]}", severity="warning",
                       push=False, url="/admin/team", dedupe=f"montage-jobfail-{job['id']}")
        last_beat = time.time()


if __name__ == "__main__":
    main()
