# whisper-stt: free speech-to-text on the Pi

Built 2026-10-10 for the ElevenLabs-in-Studio plan (`docs/elevenlabs-studio-opusplan.md`, Track B step 3; Jared's answer 16:
"Free Whisper first (Pi), ElevenLabs Scribe only when quality matters"). Owner: Spark (team card `whisper-stt`, tool of Spark).

## What it does
Every minute cron runs `/opt/bestly/cron/run.sh whisper_stt` (= `whisper_stt.py` in `/opt/bestly/cron/jobs/`). It reads
`studio_audio_jobs` for the oldest row with `feature='stt'`, `status='confirmed'` and `inputs->>'engine' = 'whisper'`, claims it
(`confirmed -> running`, one atomic PATCH), downloads the audio, runs faster-whisper, and writes the result back with `status='done'`,
`actual_credits=0`, `cost_usd=0`. Idle = one cheap REST read, then it exits (no model load).

Inputs (`studio_audio_jobs.inputs`): `engine: "whisper"`, and the audio as `audio_url` (https) or `bucket` + `path` (Supabase Storage,
read with the service key). Optional `language` (default auto-detect) and `model` (`tiny|base|small|medium`, default `small`).

Result:
- `provenance.whisper`: `text` (first 20,000 characters), `language`, `language_probability`, `avg_logprob`, `duration_s`, `elapsed_s`,
  `model`, `needs_scribe` (true when `avg_logprob` is under -0.8, so audio-core's router can re-run it on ElevenLabs Scribe).
- `output_path`: `studio-audio/<owner>/<code>.stt.json` in Storage, with the full text and timed segments (for captions).
- On failure: `status='failed'`, `held_reason` = why, and one Spark info alert (`audio-stt.fail-<code>`, no push).

## Pieces on the Pi
| What | Where |
|---|---|
| venv (faster-whisper 1.2.1, ctranslate2 4.8.2, **av pinned to 15.1.0**: av 19 breaks faster-whisper's `metadata_errors`) | `/mnt/ssd/whisper-stt/venv` |
| model `small`, int8, ~460 MB | `/mnt/ssd/whisper-stt/models` (SSD, not the SD card) |
| scratch audio (deleted after each job) | `/mnt/ssd/whisper-stt/work` |
| `transcribe.py` (runs in the venv) | `/mnt/ssd/whisper-stt/transcribe.py` |
| cron job module (system python, stdlib) | `/opt/bestly/cron/jobs/whisper_stt.py` |
| crontab line | `* * * * * /opt/bestly/cron/run.sh whisper_stt` |
| log | `/home/pi/scripts/cron-logs/whisper_stt.log` |
| off switch | `touch /opt/bestly/cron/state/whisper_stt.OFF` |

## Watchdog
- Reports to `pi_jobs` as `whisper_stt` every minute (max gap 10 min); `pi_jobs_watch` alerts Scout if it goes quiet and `pi_job_report`
  alerts on failures. A long transcription sends its own heartbeat every minute, so it never looks silent.
- Team card `whisper-stt` (tool of Spark) with pulse `{src: pi_job, key: whisper_stt}`; it owns alert prefix `audio-stt`
  (`notification_owners`), so its alerts are signed by the employee that owns it.
- A row stuck in `running` for 45 min is put back to `confirmed` once, then failed.
- Under 5 GB free on `/mnt/ssd`: it skips, and tells Spark once a day. Limits: 2 hours of audio, 500 MB per file, 1 hour of compute.

## Deploy / redo
```
# repo -> Pi (from a machine with ssh bestly-pi-lan)
scp tools/whisper-stt/transcribe.py bestly-pi-lan:/mnt/ssd/whisper-stt/transcribe.py
scp tools/whisper-stt/whisper_stt.py bestly-pi-lan:/opt/bestly/cron/jobs/whisper_stt.py   # back up first: .bak_elevenlabs_<stamp>
ssh bestly-pi-lan "python3 -m py_compile /opt/bestly/cron/jobs/whisper_stt.py"
```
First-time install (already done): `sudo mkdir /mnt/ssd/whisper-stt && sudo chown pi:pi` it, `python3 -m venv venv`,
`pip install faster-whisper "av==15.1.0"`, then load the model once with `WhisperModel("small", device="cpu", compute_type="int8",
download_root="/mnt/ssd/whisper-stt/models")`.

Speed: the Pi transcribes roughly in real time or a little faster on 3 threads (`WHISPER_THREADS`). Quality: `small` is good for clean
speech; noisy or music-heavy audio shows up as a low `avg_logprob` and `needs_scribe`.
