-- Whisper STT (Track B step 3-4 of docs/elevenlabs-studio-opusplan.md, 2026-10-10): free speech-to-text on the Pi.
-- Cron job `whisper_stt` (every minute, /opt/bestly/cron/run.sh whisper_stt) answers studio_audio_jobs rows with feature 'stt',
-- status 'confirmed' and inputs->>'engine' = 'whisper'. Code: tools/whisper-stt/. Owner: Spark (tool of Spark).

-- 1) the Pi job is watched: pi_jobs_watch alerts Scout if it goes quiet for 10 min (it reports every minute, even idle)
insert into public.pi_jobs (job, description, max_gap_min)
values ('whisper_stt', 'Whisper STT: free speech-to-text on the Pi for Studio audio jobs (every minute, exits fast when idle)', 10)
on conflict (job) do update set description = excluded.description, max_gap_min = excluded.max_gap_min, enabled = true;

-- 2) team card (tool of Spark) + alert prefix audio-stt (the signed owner of its alerts: audio-stt.fail-<code>, audio-stt.disk-<date>)
select public.team_onboard('[
 {"slug":"whisper-stt","name":"Whisper STT","role":"Free speech-to-text on the Pi","tool_of":"spark","runs_on":"pi","icon":"mic","schedule":"every minute",
  "what_it_does":"Turns audio into text for free on the Pi (Whisper, no ElevenLabs credits). When a speech-to-text job is approved for Whisper it picks it up within a minute, writes the transcript and how sure it was, and flags weak ones so Spark can send them to ElevenLabs Scribe instead. If it cannot, Spark tells you once.",
  "pulse":{"src":"pi_job","key":"whisper_stt","gap":10},
  "owns":["audio-stt"]}
]'::jsonb);
