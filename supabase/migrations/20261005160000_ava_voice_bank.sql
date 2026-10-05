-- Ava's voice bank (2026-10-05): Jared's Pro voice clone, fed from his own mic track in every recorded meeting.
-- Jared asked for Ava to self-improve his cloned voice from his meetings with Eli, and picked the Pro clone.
--
-- Flow: the Mac mini (scripts/meetingrec/voicebank.py, run by the recorder agent when idle) cuts only Jared's clean
-- speech from <meeting>-mic.m4a (far end silent, no clipping, wideband mic), uploads it to the private ava-voice bucket
-- and hands it to the ava-voicebank edge function, which adds it to the Pro clone in ElevenLabs, trains it, and switches
-- Ava's "Use my voice" over once the trained voice actually speaks on her phone model. Eli's voice never leaves the Mac.
-- The quick clone stays live until then, and stays as the fallback (jared_ivc_voice_id).

create table if not exists public.ava_voice_bank (
  id           uuid primary key default gen_random_uuid(),
  meeting      text not null,
  part         int  not null default 1,
  seconds      numeric not null,
  score        numeric,                 -- mean signal-to-noise of the kept speech, dB
  xi_sample_id text,
  added_at     timestamptz not null default now(),
  unique (meeting, part)
);
alter table public.ava_voice_bank enable row level security;
create policy "admin read ava_voice_bank" on public.ava_voice_bank for select using (public.has_role(auth.uid(), 'admin'));
grant select on public.ava_voice_bank to authenticated;

-- meetings the Mac looked at and skipped (no mic track, too little clean speech): so it doesn't re-cut them every hour
create table if not exists public.ava_voice_bank_skips (
  meeting  text primary key,
  why      text,
  at       timestamptz not null default now()
);
alter table public.ava_voice_bank_skips enable row level security;
create policy "admin read ava_voice_bank_skips" on public.ava_voice_bank_skips for select using (public.has_role(auth.uid(), 'admin'));
grant select on public.ava_voice_bank_skips to authenticated;

alter table public.ava_settings add column if not exists jared_pvc_voice_id text;          -- the Pro clone in ElevenLabs
alter table public.ava_settings add column if not exists jared_ivc_voice_id text;          -- the quick clone, kept as fallback after the switch
alter table public.ava_settings add column if not exists pvc_state text not null default 'collecting';
  -- collecting | needs_verify | training | live | no_plan | paused
alter table public.ava_settings add column if not exists pvc_trained_seconds numeric not null default 0;  -- bank size at the last training
alter table public.ava_settings add column if not exists pvc_last_train_at timestamptz;
alter table public.ava_settings add column if not exists pvc_live_at timestamptz;
alter table public.ava_settings add column if not exists pvc_note text;                    -- last thing that happened, for the admin card
alter table public.ava_settings add column if not exists pvc_checked_at timestamptz;       -- last tick from the Mac (watchdog)
alter table public.ava_settings add column if not exists pvc_guard_at timestamptz;         -- stamped by an ava-assistant build that protects the Pro clone

-- Team card: the Voice Coach is a tool of Ava (it works for her; her alerts are signed "Ava (assistant)").
-- Heartbeat: the Mac ticks ava-voicebank about hourly; quiet for 3 hours = alert. Failures on the Mac: recorder.voicebank.
select public.team_onboard($j$[
 {"slug":"ava-voice-coach","name":"Voice Coach","role":"Voice trainer","tool_of":"ava","runs_on":"mac_mini","icon":"audio-waveform",
  "schedule":"hourly while the Mac mini is idle","admin_url":"/admin/ava","sort":6,
  "what_it_does":"Keeps your cloned voice getting better. After each recorded meeting it takes only your own mic, only while the other side is quiet (so Eli's voice is never used), keeps your clearest 20 minutes, and adds them to your Pro voice in ElevenLabs. It retrains when 30+ new minutes are in, at most weekly, and switches Ava's \"Use my voice\" over only once the new voice really works on her calls. Your quick clone stays as the backup.",
  "pulse":{"src":"at","table":"ava_settings","col":"pvc_checked_at","gap":180,"alert":true,"ok":"pvc_state <> 'no_plan'","sum":"coalesce(pvc_note, pvc_state)","where":"id","issues":["recorder.voicebank"]},
  "owns":["recorder.voicebank","ava-pvc"]}
]$j$::jsonb);
