-- Track V (voice-and-studio-promo-opusplan): Montage speaks with ElevenLabs, Piper is the automatic backup.
-- 1) the Pi may read the ElevenLabs key through pi_secret (same patch pattern as the Fireworks migration)
-- 2) montage_settings: key/value settings the worker reads on every job; key 'voice' picks provider/model/reserve.
do $$
declare
  def text;
  new_def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.proname = 'pi_secret' and p.pronamespace = 'public'::regnamespace;
  if def is null then
    raise exception 'pi_secret not found';
  end if;
  if def like '%''elevenlabs_api_key''%' then
    return;  -- already allowed
  end if;
  new_def := replace(def, '''Scout-FreeLLM'',', '''Scout-FreeLLM'',''elevenlabs_api_key'',');
  if new_def = def then
    raise exception 'could not patch pi_secret allowlist (anchor not found)';
  end if;
  execute new_def;  -- CREATE OR REPLACE keeps the existing grants (service_role only)
end $$;

create table if not exists public.montage_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.montage_settings enable row level security;
revoke all on public.montage_settings from anon, authenticated;
grant all on public.montage_settings to service_role;
comment on table public.montage_settings is 'Montage worker settings (service role only). voice = {"provider":"elevenlabs"|"piper","model":"eleven_multilingual_v2"|"eleven_flash_v2_5","reserve_pct":30}';

insert into public.montage_settings (key, value)
values ('voice', '{"provider":"elevenlabs","model":"eleven_multilingual_v2","reserve_pct":30}'::jsonb)
on conflict (key) do nothing;

-- 3) Team card: ElevenLabs is one of Montage's tools (same slug family; Montage's own card is unchanged)
select public.team_onboard('[{"slug":"elevenlabs-voice","name":"ElevenLabs Voice","role":"Paid narrator (Piper is the backup)","tool_of":"montage","runs_on":"external","schedule":"on demand","what_it_does":"Reads Montage videos aloud, one voice per brand. If credits run low or ElevenLabs is down, Piper reads the whole video instead, so a video never fails over its voice.","pulse":{"src":"none"},"icon":"bot"}]'::jsonb);

-- 4) montage_file used to set cost_usd = LTX spend only, which erased the ElevenLabs voice cost the worker had added
--    (montage_report cost_usd) during the job. Keep both: LTX actuals + whatever the job already carries.
do $$
declare def text; new_def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p where p.proname = 'montage_file' and p.pronamespace = 'public'::regnamespace;
  if def is null then raise exception 'montage_file not found'; end if;
  if def like '%coalesce(j.cost_usd, 0)%' then return; end if;
  new_def := replace(def, 'select coalesce(sum(actual_usd), 0) into v_cost from ltx_jobs where montage_job_id = j.id;',
                          'select coalesce(sum(actual_usd), 0) + coalesce(j.cost_usd, 0) into v_cost from ltx_jobs where montage_job_id = j.id;');
  if new_def = def then raise exception 'could not patch montage_file (anchor not found)'; end if;
  execute new_def;
end $$;
