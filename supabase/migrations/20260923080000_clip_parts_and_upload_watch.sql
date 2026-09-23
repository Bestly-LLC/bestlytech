-- Clip uploads over ~50MB failed every time, silently.
--
-- Why: the project's global storage upload cap (50MB) sits under the voice-clips bucket's own
-- 200MB limit, so an 81MB meeting recording got "413 EntityTooLarge" (Chrome) or a dropped
-- connection (Safari "Load failed"). Nothing server-side saw it: storage 4xx never reaches a table,
-- so the fix ladder and Scout had nothing to pick up.
--
-- Fix:
-- 1. A clip can be stored as parts (<path>.part000, .part001, ...). voice_clips.parts says how many;
--    null = one object at <path> like before. The browser and the Mac both split big files; the Mac
--    worker stitches them back (plain byte concatenation, identical to the original).
-- 2. admin_report: the admin reports its own failures (and later successes) as monitor incidents,
--    so they climb the fix ladder and Scout sees them. Used by clip uploads first.
-- 3. clips_watch (cron): a clip that sits "new" while the Mac is alive, or ends in "error", opens an
--    incident; it closes itself once clips flow again.

alter table public.voice_clips add column if not exists parts int check (parts is null or parts between 1 and 200);

create or replace function public.clip_claim(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.voice_clips;
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  update voice_clips set status = 'new' where status = 'working' and created_at < now() - interval '30 minutes';
  select * into c from voice_clips where status = 'new' order by created_at limit 1 for update skip locked;
  if c.id is null then return null; end if;
  update voice_clips set status = 'working' where id = c.id;
  return jsonb_build_object('id', c.id, 'path', c.path, 'title', c.title, 'source', c.source, 'parts', c.parts);
end $$;

drop function if exists public.clip_new(text, text, text, bigint, text, timestamptz);
create or replace function public.clip_new(p_key text, p_path text, p_title text, p_bytes bigint,
  p_source text default 'airdrop', p_recorded_at timestamptz default null, p_parts int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  insert into voice_clips (title, path, bytes, source, recorded_at, parts)
  values (nullif(p_title,''), p_path, coalesce(p_bytes,0), coalesce(p_source,'airdrop'), p_recorded_at, p_parts)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.clip_new(text, text, text, bigint, text, timestamptz, int) from public, anon, authenticated;
grant execute on function public.clip_new(text, text, text, bigint, text, timestamptz, int) to service_role;

-- 2. The admin reports its own failures to Scout (and clears them when the same thing works).
create or replace function public.admin_report(p_where text, p_detail text default null, p_ok boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_where text := left(regexp_replace(lower(coalesce(p_where,'unknown')), '[^a-z0-9_.-]+', '-', 'g'), 60);
  v_key text;
begin
  if not public.has_role(auth.uid(), 'admin') then
    return jsonb_build_object('ok', false, 'error', 'not_allowed');
  end if;
  v_key := 'admin.' || v_where;
  if p_ok then
    if exists (select 1 from monitor_issues where key = v_key and status = 'open') then
      perform public.bestly_raise(v_key, 'resolved', 'info', null,
        left(coalesce(p_detail, 'It worked the next time.'), 800), 'admin');
    end if;
  else
    perform public.bestly_raise(v_key, 'problem', 'warning',
      'Admin: ' || replace(v_where, '.', ' › ') || ' failed',
      left(coalesce(p_detail, 'No detail'), 1500), 'admin');
  end if;
  return jsonb_build_object('ok', true, 'key', v_key);
end $$;
revoke all on function public.admin_report(text, text, boolean) from public, anon;
grant execute on function public.admin_report(text, text, boolean) to authenticated;

-- 3. Clips that stall or fail open an incident on their own.
create or replace function public.clips_watch()
returns void language plpgsql security definer set search_path = public as $$
declare
  mac_alive boolean;
  n_stuck int; n_err int; last_err text;
begin
  select coalesce(max(seen_at) > now() - interval '10 minutes', false) into mac_alive from partner_ai_status;
  select count(*) into n_stuck from voice_clips where status = 'new' and created_at < now() - interval '45 minutes';
  if mac_alive and n_stuck > 0 then
    perform bestly_raise('clips.stuck', 'problem', 'warning',
      n_stuck || ' voice clip' || case when n_stuck = 1 then '' else 's' end || ' not transcribed',
      'The Mac mini is online but has not picked these up for 45+ minutes. Check ~/BestlyClips/clips.log '
      || 'and that launchd job tech.bestly.clips is running (launchctl kickstart -k gui/$(id -u)/tech.bestly.clips).', 'clips');
  elsif n_stuck = 0 then
    perform bestly_raise('clips.stuck', 'resolved', 'info', null, 'Clips are being transcribed again.', 'clips');
  end if;

  select count(*), max(error) into n_err, last_err from voice_clips
   where status = 'error' and done_at > now() - interval '24 hours';
  if n_err > 0 then
    perform bestly_raise('clips.failed', 'problem', 'warning',
      n_err || ' voice clip' || case when n_err = 1 then '' else 's' end || ' failed to transcribe',
      'Last error: ' || coalesce(last_err, 'none given'), 'clips');
  else
    perform bestly_raise('clips.failed', 'resolved', 'info', null, 'No failed clips in the last day.', 'clips');
  end if;
end $$;
revoke all on function public.clips_watch() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('clips-watch');
exception when others then null; end $$;
select cron.schedule('clips-watch', '11-59/15 * * * *', $$select public.clips_watch()$$);
