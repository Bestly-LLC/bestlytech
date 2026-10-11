"""Whisper STT (Spark's tool, 2026-10-10): free speech-to-text on the Pi. Cron job, every minute: /opt/bestly/cron/run.sh whisper_stt

Picks the oldest studio_audio_jobs row with feature='stt', status='confirmed' and engine 'whisper' (inputs->>'engine'), claims it
(status confirmed -> running, one atomic PATCH), downloads the audio, runs faster-whisper (small, int8, CPU) in its venv, and writes the
transcript + avg_logprob back on the row with status 'done' (cost 0: it is free). Idle = one cheap REST read, then exit.

Audio comes from inputs.audio_url (https) or inputs.bucket + inputs.path (Supabase Storage, read with the service key).
Optional inputs: language (default auto), model (default small).
Result (provenance.whisper): {text-in-output, language, avg_logprob, duration_s, elapsed_s, model, needs_scribe}. The full text and the
segments (for captions) are uploaded to storage as studio-audio/<owner>/<code>.stt.json and the row's output_path points at it; the plain
transcript is also in provenance.whisper.text (first 20,000 characters).
needs_scribe = true when avg_logprob is under WEAK_LOGPROB: audio-core's router may then re-run the job on ElevenLabs Scribe.

Safety: off switch /opt/bestly/cron/state/whisper_stt.OFF; refuses audio over 2 hours or files over 500 MB; a row stuck in 'running'
for 45 min is put back once, then failed; the heartbeat (pi_job_report) is sent every minute while it transcribes so the Team card
never shows a long transcription as a silent job. Failures set status 'failed' with the reason and tell Jared once (Spark, info).
"""
import json
import os
import shutil
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

import lib

VENV_PY = "/mnt/ssd/whisper-stt/venv/bin/python"
TRANSCRIBE = "/mnt/ssd/whisper-stt/transcribe.py"
WORK = "/mnt/ssd/whisper-stt/work"
OFF = "/opt/bestly/cron/state/whisper_stt.OFF"
MAX_AUDIO_S = 7200
MAX_BYTES = 500 * 1024 * 1024
STALE_MIN = 45
WEAK_LOGPROB = -0.8
MIN_FREE_GB = 5
JOB = "whisper_stt"


def _rest(method, path, body=None, prefer=None, timeout=60):
    h = {"apikey": lib.KEY, "Content-Type": "application/json"}
    if lib.KEY.startswith("eyJ"):
        h["Authorization"] = "Bearer " + lib.KEY
    if prefer:
        h["Prefer"] = prefer
    req = urllib.request.Request(lib.URL + path, method=method, headers=h, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path.split('?')[0]} -> HTTP {e.code}: {e.read().decode()[:300]}")


def _is_whisper(row):
    return str((row.get("inputs") or {}).get("engine") or row.get("engine") or "").lower() == "whisper"


def _heartbeat(summary):
    try:
        lib.rpc("pi_job_report", p_job=JOB, p_ok=True, p_summary=summary, p_duration_ms=None)
    except Exception as e:  # noqa: BLE001
        print("heartbeat failed:", e, flush=True)


def _download(row, dst):
    inp = row.get("inputs") or {}
    if inp.get("audio_url"):
        req = urllib.request.Request(inp["audio_url"])
    elif inp.get("bucket") and inp.get("path"):
        h = {"apikey": lib.KEY}
        if lib.KEY.startswith("eyJ"):
            h["Authorization"] = "Bearer " + lib.KEY
        req = urllib.request.Request(f"{lib.URL}/storage/v1/object/{inp['bucket']}/{urllib.parse.quote(inp['path'])}", headers=h)
    else:
        raise RuntimeError("inputs has neither audio_url nor bucket + path")
    got = 0
    with urllib.request.urlopen(req, timeout=120) as r, open(dst, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            got += len(chunk)
            if got > MAX_BYTES:
                raise RuntimeError("audio file is over 500 MB")
            f.write(chunk)
    if got == 0:
        raise RuntimeError("downloaded audio is empty")


def _upload_json(owner, code, data):
    h = {"apikey": lib.KEY, "Content-Type": "application/json", "x-upsert": "true"}
    if lib.KEY.startswith("eyJ"):
        h["Authorization"] = "Bearer " + lib.KEY
    path = f"{owner}/{code}.stt.json"
    urllib.request.urlopen(urllib.request.Request(f"{lib.URL}/storage/v1/object/studio-audio/{path}", method="POST", headers=h,
                                                  data=json.dumps(data).encode()), timeout=120).read()
    return "studio-audio/" + path


def _fail(row, why):
    prov = dict(row.get("provenance") or {})
    prov["whisper"] = {"error": why[:400], "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    _rest("PATCH", f"/rest/v1/studio_audio_jobs?code=eq.{row['code']}", {"status": "failed", "held_reason": why[:400],
          "provenance": prov, "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    lib.notify("Spark: a speech-to-text job failed", f"{row.get('owner_slug')}: job {row['code']} could not be transcribed on the Pi ({why[:300]}).",
               severity="info", push=False, url="/admin/team", dedupe=f"audio-stt.fail-{row['code']}")


def _requeue_stale():
    """A job 'running' for 45+ min lost its worker: back to confirmed once, failed the second time."""
    n = 0
    cut = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - STALE_MIN * 60))
    rows = _rest("GET", "/rest/v1/studio_audio_jobs?select=*&feature=eq.stt&status=eq.running&order=created_at.asc&limit=20") or []
    for r in rows:
        w = (r.get("provenance") or {}).get("whisper") or {}
        if not _is_whisper(r) or (w.get("started_at") or "9") > cut:
            continue
        if w.get("requeued"):
            _fail(r, f"stuck in running for {STALE_MIN}+ min twice")
        else:
            prov = dict(r.get("provenance") or {})
            prov["whisper"] = {**w, "requeued": True}
            _rest("PATCH", f"/rest/v1/studio_audio_jobs?code=eq.{r['code']}&status=eq.running", {"status": "confirmed", "provenance": prov})
        n += 1
    return n


def main(argv):
    if os.path.exists(OFF):
        return "skip: off switch (whisper_stt.OFF)"
    if not (os.path.exists(VENV_PY) and os.path.exists(TRANSCRIBE)):
        raise RuntimeError("whisper venv or transcribe.py missing under /mnt/ssd/whisper-stt")
    try:
        requeued = _requeue_stale()
        rows = _rest("GET", "/rest/v1/studio_audio_jobs?select=*&feature=eq.stt&status=eq.confirmed&order=created_at.asc&limit=20") or []
    except RuntimeError as e:
        if any(t in str(e) for t in ("HTTP 404", "PGRST205", "does not exist")):
            return "skip: studio_audio_jobs is not created yet (audio-core's migration)"
        raise
    rows = [r for r in rows if _is_whisper(r)]
    if not rows:
        return "nothing to transcribe" + (f" ({requeued} stale requeued)" if requeued else "")
    free_gb = shutil.disk_usage("/mnt/ssd").free / 1e9
    if free_gb < MIN_FREE_GB:
        lib.notify("Spark: the speech-to-text Pi is low on disk", f"/mnt/ssd has {free_gb:.1f} GB free; Whisper needs a few GB for audio. Jobs wait until space is freed.",
                   severity="info", push=False, url="/admin/team", dedupe=f"audio-stt.disk-{time.strftime('%Y-%m-%d')}")
        return f"skip: only {free_gb:.1f} GB free on /mnt/ssd"
    row = rows[0]
    code = row["code"]
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    prov = dict(row.get("provenance") or {})
    prov["whisper"] = {"started_at": started, **({"requeued": True} if (prov.get("whisper") or {}).get("requeued") else {})}
    got = _rest("PATCH", f"/rest/v1/studio_audio_jobs?code=eq.{code}&status=eq.confirmed", {"status": "running", "provenance": prov},
                prefer="return=representation")
    if not got:
        return f"skip: {code} was taken by another run"
    os.makedirs(WORK, exist_ok=True)
    audio, out = f"{WORK}/{code}.audio", f"{WORK}/{code}.json"
    try:
        _download(row, audio)
        inp = row.get("inputs") or {}
        cmd = [VENV_PY, TRANSCRIBE, audio, out]
        if inp.get("language"):
            cmd += ["--language", str(inp["language"])]
        if inp.get("model") in ("tiny", "base", "small", "medium"):
            cmd += ["--model", inp["model"]]
        t0 = last = time.time()
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        while proc.poll() is None:
            time.sleep(5)
            if time.time() - last > 55:
                _heartbeat(f"ok transcribing {code} ({int(time.time() - t0)}s so far)")
                last = time.time()
            if time.time() - t0 > 3600:
                proc.kill()
                raise RuntimeError("transcription took over an hour")
        if proc.returncode != 0:
            raise RuntimeError("faster-whisper failed: " + (proc.stderr.read() or "")[-300:])
        res = json.load(open(out))
        if res["duration_s"] > MAX_AUDIO_S:
            raise RuntimeError(f"audio is {res['duration_s'] / 60:.0f} min, over the 2 hour limit")
        path = _upload_json(row.get("owner_slug") or "unknown", code, res)
        lp = res.get("avg_logprob")
        prov["whisper"] = {"model": res["model"], "compute_type": res["compute_type"], "language": res["language"],
                           "language_probability": res["language_probability"], "avg_logprob": lp, "duration_s": res["duration_s"],
                           "elapsed_s": res["elapsed_s"], "needs_scribe": lp is None or lp < WEAK_LOGPROB,
                           "text": res["text"][:20000], "engine": "whisper", "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        _rest("PATCH", f"/rest/v1/studio_audio_jobs?code=eq.{code}", {
            "status": "done", "actual_credits": 0, "cost_usd": 0, "output_path": path, "provenance": prov,
            "finished_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
        return f"ok {code}: {res['duration_s']:.0f}s of audio in {res['elapsed_s']:.0f}s, logprob {lp}, {res['language']}"
    except Exception as e:  # noqa: BLE001
        _fail(row, f"{type(e).__name__}: {e}")
        return f"failed {code}: {str(e)[:200]}"
    finally:
        for p in (audio, out):
            try:
                os.remove(p)
            except OSError:
                pass
