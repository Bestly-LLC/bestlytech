"""Montage music bed (Jared 2026-10-12: "new rule, music, we need music please!"). Every Montage video ships with a real music bed.

Used by worker.py:
  ready(slug)                      how many tracks this brand can use (0 = the job is held, see worker.MusicHeld)
  mood_for(script, brand)          the video's mood: the writer's `mood`, else the brand's MOOD default
  build(slug, mood, script, total, jd, job_id)
                                   pick a track (brand + mood, never the one used last for the brand), fit it to the video with soft fades
                                   (crossfaded loop if the track is shorter), lower it under each narration line with soft ramps (louder in the
                                   gaps and after the last line), write public/music.wav. Returns the info dict the worker stores.
  bed_problems(out, script, info)  the gate: the finished mp4 must carry the bed (checked in the gaps between narration lines).

Levels come from montage_settings 'music' (defaults below): bed_lufs = level of the bed in the gaps and on the end card, duck_db = how far it
drops under the voice (narration sits at -16 LUFS). Library: studio_music_tracks + private storage bucket 'music'; filled by music_library.py.
"""
import json
import math
import os
import subprocess
import sys
import urllib.request

sys.path.insert(0, "/opt/bestly/cron")
import lib  # noqa: E402

MOODS = ("calm", "upbeat", "confident", "warm", "playful")
CACHE = "/mnt/ssd/montage/music-cache"
DEFAULTS = {"required": True, "bed_lufs": -18.0, "duck_db": 9.0, "duck_in_s": 0.25, "duck_out_s": 0.45,
            "fade_in_s": 0.8, "fade_out_s": 2.2, "swell_db": 2.0}


class NoMusic(RuntimeError):
    """The brand has no usable track (or the picked file is unreadable). The worker turns this into a hold + a Spark alert."""


def settings():
    s = dict(DEFAULTS)
    try:
        s.update((lib.get("montage_settings", "select=value&key=eq.music") or [{}])[0].get("value") or {})
    except Exception as e:  # noqa: BLE001  (unreadable settings = the defaults above; the rule itself is never skipped)
        print("music settings unreadable, using defaults:", e, flush=True)
    return s


def ready(slug):
    try:
        return int(lib.rpc("montage_music_ready", p_brand=slug) or 0)
    except Exception as e:  # noqa: BLE001
        raise NoMusic(f"the music library could not be read ({str(e)[:120]})")


def mood_for(script, brand):
    m = (script.get("mood") or "").strip().lower()
    return m if m in MOODS else (getattr(brand, "MOOD", None) if getattr(brand, "MOOD", None) in MOODS else "calm")


def _hdr():
    h = {"apikey": lib.KEY}
    if lib.KEY.startswith("eyJ"):
        h["Authorization"] = "Bearer " + lib.KEY
    return h


def fetch(track):
    os.makedirs(CACHE, exist_ok=True)
    dst = f"{CACHE}/{track['id']}{os.path.splitext(track['storage_path'])[1] or '.flac'}"
    if os.path.exists(dst) and os.path.getsize(dst) > 10_000:
        return dst
    req = urllib.request.Request(f"{lib.URL}/storage/v1/object/music/{track['storage_path']}", headers=_hdr())
    with urllib.request.urlopen(req, timeout=120) as r, open(dst + ".part", "wb") as f:
        f.write(r.read())
    os.replace(dst + ".part", dst)
    return dst


def _dur(path):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                                capture_output=True, text=True, check=True).stdout.strip())


def _lufs(path):
    r = subprocess.run(["ffmpeg", "-v", "info", "-nostats", "-i", path, "-af", "ebur128", "-f", "null", "-"],
                       capture_output=True, text=True, timeout=180).stderr
    return float(r.rsplit("Integrated loudness:", 1)[1].split("I:")[1].split("LUFS")[0])


def mean_db(path, start=None, length=None):
    """volumedetect mean_volume (dB) of a file or a window of it; None when it cannot be read."""
    cmd = ["ffmpeg", "-v", "info", "-nostats"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    if length is not None:
        cmd += ["-t", f"{length:.3f}"]
    cmd += ["-i", path, "-vn", "-af", "volumedetect", "-f", "null", "-"]
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=180).stderr
    for line in r.splitlines():
        if "mean_volume" in line:
            try:
                return float(line.split("mean_volume:")[1].split("dB")[0])
            except ValueError:
                return None
    return None


def windows(script):
    """[(voice_start, voice_end)] for every narration line (scenes + closing card). voice_end is saved by worker.voice(); older scripts
    without it get an estimate (about 0.38 s a word)."""
    out = []
    for s in list(script["scenes"]) + [script["end"]]:
        a = s.get("voice_at")
        if a is None:
            continue
        b = s.get("voice_end") or (a + 0.38 * len((s.get("say") or "").split()))
        out.append((float(a), float(b)))
    return out


def _gain_expr(win, total, cfg, end_voice_end):
    """Linear volume expression for ffmpeg's volume filter (eval=frame): 1 in the gaps, the duck level under each line, soft ramps in and
    out (no hard edges), then a small swell once the closing card's line is done."""
    din, dout = float(cfg["duck_in_s"]), float(cfg["duck_out_s"])
    duck = 10 ** (-float(cfg["duck_db"]) / 20)
    envs = [f"min(clip((t-({a:.3f}-{din}))/{din},0,1),clip((({b:.3f}+{dout})-t)/{dout},0,1))" for a, b in win]
    env = envs[0] if envs else "0"
    for e in envs[1:]:
        env = f"max({env},{e})"
    expr = f"(1-{1 - duck:.4f}*{env})"
    swell = 10 ** (float(cfg.get("swell_db", 0)) / 20)
    if swell > 1.001 and end_voice_end:
        expr += f"*(1+{swell - 1:.4f}*clip((t-({end_voice_end:.3f}+0.3))/0.9,0,1))"
    return expr


def build(slug, mood, script, total, jd, job_id=None):
    cfg = settings()
    track = lib.rpc("montage_music_pick", p_brand=slug, p_mood=mood, p_job=job_id)
    if not track:
        raise NoMusic(f"no music track for {slug}")
    try:
        src = fetch(track)
        d = _dur(src)
    except Exception as e:  # noqa: BLE001
        raise NoMusic(f"the track '{track.get('name')}' could not be read ({str(e)[:120]})")
    need = total + 0.3
    xf = 1.5
    copies = 1 if d >= need else int(math.ceil((need - d) / max(d - xf, 1.0))) + 1
    cmd = ["ffmpeg", "-y", "-v", "error"]
    for _ in range(copies):
        cmd += ["-i", src]
    if copies == 1:
        chain, last = "", "[0:a]"
    else:
        parts, last = [], "[0:a]"
        for i in range(1, copies):
            parts.append(f"{last}[{i}:a]acrossfade=d={xf}:c1=tri:c2=tri[x{i}]")
            last = f"[x{i}]"
        chain = ";".join(parts) + ";"
    try:
        have = float(track.get("loudness_lufs")) if track.get("loudness_lufs") is not None else _lufs(src)
    except Exception:  # noqa: BLE001
        have = float(cfg["bed_lufs"])
    gain = max(-10.0, min(10.0, float(cfg["bed_lufs"]) - have))
    e_card = script.get("end") or {}
    end_ve = e_card.get("voice_end") or (e_card.get("voice_at") or total - 3) + 2.0
    expr = _gain_expr(windows(script), total, cfg, end_ve)
    fi, fo = float(cfg["fade_in_s"]), float(cfg["fade_out_s"])
    f = (f"{chain}{last}aresample=44100,aformat=channel_layouts=stereo,atrim=0:{need:.3f},asetpts=PTS-STARTPTS,volume={gain:.2f}dB,"
         f"afade=t=in:st=0:d={fi},afade=t=out:st={max(total - fo, 0):.3f}:d={fo},volume='{expr}':eval=frame,"
         f"alimiter=limit=0.89:level=disabled,apad=whole_dur={total:.3f},atrim=0:{total:.3f}")
    out = f"{jd}/public/music.wav"
    cmd += ["-filter_complex", f, "-ac", "2", out]
    subprocess.run(cmd, check=True, timeout=300)
    info = {"track_id": track["id"], "name": track.get("name"), "mood": mood, "track_mood": track.get("mood"), "source": track.get("source"),
            "looped": copies > 1, "gain_db": round(gain, 1), "duck_db": cfg["duck_db"], "bed_lufs": cfg["bed_lufs"],
            "mean_db": mean_db(out)}
    json.dump(info, open(f"{jd}/music.json", "w"))
    return info


def stored(jd):
    """The info of a bed already built for this job (a resumed job reuses it instead of picking again)."""
    try:
        if os.path.exists(f"{jd}/public/music.wav"):
            return json.load(open(f"{jd}/music.json"))
    except (OSError, ValueError):
        pass
    return None


def bed_problems(out, script, info):
    """The gate (worker.check): a video with no bed, a near-silent bed, or a final mix whose gaps between narration lines are silent fails."""
    if not info:
        return ["no music bed: every video ships with a real music track (rule of 2026-10-12)"]
    e = []
    if info.get("mean_db") is None or info["mean_db"] < -45:
        e.append(f"the music bed is nearly silent ({info.get('mean_db')} dB)")
    try:
        scenes = list(script["scenes"]) + [script["end"]]
        gaps = []
        for cur, nxt in zip(scenes, scenes[1:]):
            if cur.get("voice_end") is None or nxt.get("voice_at") is None:
                continue
            a, b = float(cur["voice_end"]) + 0.2, float(nxt["voice_at"]) - 0.1
            if b - a >= 0.35:
                gaps.append((a, b - a))
        vals = [v for v in (mean_db(out, a, n) for a, n in gaps) if v is not None]
        if vals:
            vals.sort()
            med = vals[len(vals) // 2]
            if med < -48:
                e.append(f"the finished video has no music in the gaps between narration lines (median {med:.0f} dB)")
    except Exception as ex:  # noqa: BLE001  (a measuring problem is not a missing bed)
        print("bed gap check skipped:", ex, flush=True)
    return e
