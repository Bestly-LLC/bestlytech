-- Montage music rule (Jared 2026-10-12, 8:28 PM): "new rule, music, we need music please!"
-- Every Montage/Studio video ships with a real music bed. The old synthesized pad sat at 10 percent volume and read as no music.
--   * studio_music_tracks: the library (one row per track; the file lives in the private storage bucket 'music').
--   * studio_music_uses: which track went under which video, so a brand never gets the track it had last.
--   * montage_music_pick / montage_music_ready: the worker's picker (brand + mood, least recently used, not the last one used for the brand).
--   * montage_settings 'music': mix levels the worker reads on every job. 'music_library': the quote + the one-shot approval for generating tracks.
--   * montage.music alert prefix owned by Spark (info, never a push; one alert a day per brand when a brand has no track).
-- Generating tracks with ElevenLabs costs plan credits: tools/montage/music_library.py does nothing until montage_music_approve() is run
-- after Jared says yes to Spark's quote. Owner: Spark.

create table if not exists public.studio_music_tracks (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  brand_slug    text,                                            -- null = shared, any brand may use it
  mood          text not null check (mood in ('calm','upbeat','confident','warm','playful')),
  bpm           integer,                                         -- the tempo the prompt asked for (a target, not measured)
  duration_s    numeric not null check (duration_s > 0),
  storage_path  text not null,                                   -- path inside the 'music' bucket
  source        text not null,                                   -- 'elevenlabs-music' | 'pi-licensed' | ...
  license       text not null,                                   -- plain words: where it may be used and why
  loudness_lufs numeric,                                         -- integrated loudness of the stored file (normalized to -18)
  prompt        text,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (storage_path)
);
create index if not exists studio_music_tracks_brand_idx on public.studio_music_tracks (brand_slug, mood) where active;
alter table public.studio_music_tracks enable row level security;
revoke all on public.studio_music_tracks from anon, authenticated;
grant all on public.studio_music_tracks to service_role;
comment on table public.studio_music_tracks is 'Montage music beds (service role only). Rule: every Montage video ships with a real music bed (Jared 2026-10-12).';

create table if not exists public.studio_music_uses (
  id        bigint generated always as identity primary key,
  track_id  uuid not null references public.studio_music_tracks(id) on delete cascade,
  brand_slug text not null,
  job_id    uuid,
  mood      text,
  used_at   timestamptz not null default now()
);
create index if not exists studio_music_uses_brand_idx on public.studio_music_uses (brand_slug, used_at desc);
alter table public.studio_music_uses enable row level security;
revoke all on public.studio_music_uses from anon, authenticated;
grant all on public.studio_music_uses to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('music', 'music', false, 52428800, array['audio/flac','audio/x-flac','audio/mpeg','audio/wav','audio/x-wav','audio/mp4'])
on conflict (id) do nothing;

-- Picker. Candidates: active tracks of this brand or shared. Best = mood match, then the brand's own track, then least recently used;
-- the track used last for this brand is skipped when another candidate exists. Records the use. Returns null when the brand has no track.
create or replace function public.montage_music_pick(p_brand text, p_mood text, p_job uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_last uuid; v_n int; r studio_music_tracks;
begin
  select count(*) into v_n from studio_music_tracks where active and (brand_slug = p_brand or brand_slug is null);
  if v_n = 0 then return null; end if;
  select track_id into v_last from studio_music_uses where brand_slug = p_brand order by used_at desc limit 1;
  select t.* into r from studio_music_tracks t
   where t.active and (t.brand_slug = p_brand or t.brand_slug is null) and (v_n = 1 or t.id is distinct from v_last)
   order by (t.mood = p_mood) desc, (t.brand_slug = p_brand) desc,
            coalesce((select max(u.used_at) from studio_music_uses u where u.track_id = t.id and u.brand_slug = p_brand), 'epoch'::timestamptz) asc,
            random()
   limit 1;
  insert into studio_music_uses (track_id, brand_slug, job_id, mood) values (r.id, p_brand, p_job, p_mood);
  return to_jsonb(r);
end $$;

create or replace function public.montage_music_ready(p_brand text) returns integer
language sql security definer set search_path to 'public' as $$
  select count(*)::int from studio_music_tracks where active and (brand_slug = p_brand or brand_slug is null);
$$;

-- The generation script registers each finished track here.
create or replace function public.montage_music_register(p jsonb) returns uuid
language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid;
begin
  insert into studio_music_tracks (name, brand_slug, mood, bpm, duration_s, storage_path, source, license, loudness_lufs, prompt)
  values (p->>'name', nullif(p->>'brand_slug',''), p->>'mood', nullif(p->>'bpm','')::int, (p->>'duration_s')::numeric, p->>'storage_path',
          coalesce(p->>'source','elevenlabs-music'), p->>'license', nullif(p->>'loudness_lufs','')::numeric, p->>'prompt')
  on conflict (storage_path) do update set loudness_lufs = excluded.loudness_lufs, duration_s = excluded.duration_s, active = true
  returning id into v_id;
  return v_id;
end $$;

-- Spark runs this ONLY after Jared said yes to the dollar quote. One use: the generation script switches it off when it finishes.
create or replace function public.montage_music_approve(p_max_credits integer, p_usd numeric, p_by text default 'spark')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if p_max_credits is null or p_max_credits <= 0 or p_max_credits > 60000 then
    raise exception 'montage_music_approve: p_max_credits must be the approved credits, above 0 and at most 60000';
  end if;
  update montage_settings
     set value = value || jsonb_build_object('approved', true, 'approved_max_credits', p_max_credits, 'approved_usd', p_usd,
                                            'approved_by', coalesce(p_by, 'spark'), 'approved_at', now()),
         updated_at = now()
   where key = 'music_library' returning value into v;
  if v is null then raise exception 'montage_music_approve: no quote on file; run music_library.py quote first'; end if;
  return v;
end $$;

-- A quick look for Spark / the admin page: tracks per brand and mood, and the library settings.
create or replace function public.montage_music_status() returns jsonb
language sql security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'tracks', coalesce((select jsonb_agg(jsonb_build_object('brand', coalesce(brand_slug,'shared'), 'mood', mood, 'n', n) order by brand_slug, mood)
                          from (select brand_slug, mood, count(*) n from studio_music_tracks where active group by 1, 2) x), '[]'::jsonb),
    'library', (select value - 'quote_lines' from montage_settings where key = 'music_library'),
    'mix', (select value from montage_settings where key = 'music'));
$$;

revoke all on function public.montage_music_pick(text, text, uuid), public.montage_music_ready(text), public.montage_music_register(jsonb),
  public.montage_music_approve(integer, numeric, text), public.montage_music_status() from public, anon, authenticated;
grant execute on function public.montage_music_pick(text, text, uuid), public.montage_music_ready(text), public.montage_music_register(jsonb),
  public.montage_music_approve(integer, numeric, text), public.montage_music_status() to service_role;

-- Mix levels (the worker falls back to these numbers if the row is unreadable). bed_lufs = the bed's level in the gaps and on the end card;
-- duck_db = how far it drops under the narration; ramps are soft (feathered), never a hard cut.
insert into public.montage_settings (key, value) values
  ('music', '{"required": true, "bed_lufs": -18, "duck_db": 9, "duck_in_s": 0.25, "duck_out_s": 0.45, "fade_in_s": 0.8, "fade_out_s": 2.2}'::jsonb),
  ('music_library', '{"approved": false}'::jsonb)
on conflict (key) do nothing;

-- Spark owns the music alerts (info, no push).
insert into public.notification_owners (prefix, agent_slug, note) values
  ('montage.music', 'spark', 'A video is on hold because its brand has no music track yet, or the music library run finished/failed; info, no push. 2026-10-12')
on conflict (prefix) do nothing;

-- Team card: the music bed is one of Montage's tools (Montage's own card, pulse and montage-watch cron are unchanged). Spark keeps owning the prefix.
do $$ begin
  perform public.team_onboard('[{"slug":"montage-music","name":"Montage Music","role":"Music bed under every video","tool_of":"montage","runs_on":"pi","schedule":"on demand","what_it_does":"Picks a real music track for each video by brand and mood, never the one used last, fits it to length and lowers it under the narration. A video with no music is held, never filed silent. Alerts: montage.music (Spark).","pulse":{"src":"none"},"icon":"bot"}]'::jsonb);
exception when others then
  raise notice 'team card for montage-music skipped: %', sqlerrm;
end $$;
