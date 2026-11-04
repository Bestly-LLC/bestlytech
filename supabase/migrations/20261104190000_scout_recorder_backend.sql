-- Scout Recorder backend (2026-11-04): sessions table, captions column, clip_claim returns captions,
-- watchdog scout_recorder_watch() on pg_cron, notification owner, short link.
-- DOWN (undo):
--   select cron.unschedule('scout-recorder-watch');
--   drop function if exists public.scout_recorder_watch(); drop function if exists public.scout_rec_report(text,text,text,uuid);
--   drop function if exists public.scout_rec_parts_present(text);
--   drop table if exists public.scout_rec_sessions; drop table if exists public.scout_rec_watch_state;
--   update notification_owners set agent_slug = agent_slug where false; -- row 'scout.recorder' can be removed by hand
--   clip_claim: restore the definition saved in bestly_memory house/undo/clip_claim-2026-11-04
--   alter table voice_clips drop column captions;  -- optional, harmless to keep

alter table public.voice_clips add column if not exists captions jsonb;

create table if not exists public.scout_rec_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  roster text,
  is_admin boolean not null default false,
  platform text not null check (platform in ('meet','zoom','teams')),
  meeting_url text,
  meeting_key text,
  event_uid text,
  title text,
  started_at timestamptz not null default now(),
  notice_at timestamptz,
  last_beat_at timestamptz not null default now(),
  last_progress_at timestamptz not null default now(),
  state text not null default 'starting' check (state in ('armed','starting','recording','uploading','uploaded','transcribed','failed','lost')),
  parts_sent int not null default 0,
  bytes bigint not null default 0,
  seconds numeric,
  storage_path text not null,
  clip_id uuid,
  captions_count int not null default 0,
  retry_parts int[] not null default '{}',
  ext_version text,
  error text,
  alerted_lost_at timestamptz,
  retry_marked_at timestamptz,
  stuck_raised_at timestamptz,
  transcribe_alerted_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists scout_rec_sessions_user_idx on public.scout_rec_sessions (user_id, started_at desc);
create index if not exists scout_rec_sessions_state_idx on public.scout_rec_sessions (state) where state in ('starting','recording','uploading','uploaded');
alter table public.scout_rec_sessions enable row level security;
revoke all on public.scout_rec_sessions from public, anon, authenticated;

create table if not exists public.scout_rec_watch_state (
  id int primary key default 1 check (id = 1),
  selftest_req_id bigint,
  selftest_sent_at timestamptz,
  selftest_ok_at timestamptz
);
insert into public.scout_rec_watch_state (id) values (1) on conflict do nothing;
alter table public.scout_rec_watch_state enable row level security;
revoke all on public.scout_rec_watch_state from public, anon, authenticated;

-- parts present in storage for a recording path (<path>.part000 ...)
create or replace function public.scout_rec_parts_present(p_path text)
returns int[] language sql stable security definer set search_path = public, storage as $$
  select coalesce(array_agg(substring(o.name from '\.part(\d{3})$')::int order by o.name), '{}')
    from storage.objects o
   where o.bucket_id = 'voice-clips' and starts_with(o.name, p_path || '.part') and o.name ~ '\.part\d{3}$'
$$;
revoke execute on function public.scout_rec_parts_present(text) from public, anon, authenticated;

-- the extension's "report" action: raise under scout.recorder.<where> + one digest row, once per key per 6 h
create or replace function public.scout_rec_report(p_where text, p_detail text, p_severity text, p_session_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_where text := left(regexp_replace(lower(coalesce(nullif(btrim(p_where), ''), 'general')), '[^a-z0-9._-]+', '-', 'g'), 60);
  v_key text; v_sev text := lower(coalesce(p_severity, 'warning'));
  v_detail text := left(regexp_replace(coalesce(p_detail, ''), '[[:cntrl:]]', ' ', 'g'), 400);
begin
  if v_sev not in ('info','warning','error') then v_sev := 'warning'; end if;
  v_key := 'scout.recorder.' || v_where;
  if p_session_id is not null and v_sev <> 'info' then
    update scout_rec_sessions set error = v_detail, updated_at = now() where id = p_session_id;
  end if;
  if exists (select 1 from monitor_events where key = v_key and created_at > now() - interval '6 hours') then
    return jsonb_build_object('deduped', true);
  end if;
  perform bestly_raise(v_key, 'problem', v_sev, 'Scout Recorder: ' || v_where, v_detail, 'scout-recorder', null, false);
  perform bestly_app_push('scout', 'fyi', 'Scout Recorder: ' || v_where, v_detail, v_key, null, 'meetings', false, null);
  return jsonb_build_object('deduped', false, 'key', v_key);
end $$;
revoke execute on function public.scout_rec_report(text, text, text, uuid) from public, anon, authenticated;

-- clip_claim: unchanged except it also returns captions
create or replace function public.clip_claim(p_key text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare c public.voice_clips;
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  update voice_clips set status = 'new' where status = 'working' and created_at < now() - interval '30 minutes';
  select * into c from voice_clips where status = 'new' order by created_at limit 1 for update skip locked;
  if c.id is null then return null; end if;
  update voice_clips set status = 'working' where id = c.id;
  return jsonb_build_object('id', c.id, 'path', c.path, 'title', c.title, 'source', c.source, 'parts', c.parts,
    'kind', c.kind, 'recorded_at', c.recorded_at, 'created_at', c.created_at, 'meeting_name', c.meeting_name,
    'captions', c.captions);
end $function$;

insert into public.notification_owners (prefix, agent_slug, note)
values ('scout.recorder', 'scout', 'Scout Recorder extension and backend')
on conflict do nothing;

-- Watchdog: owner Scout. Only the lost-mid-call alert pushes; everything else is digest / bestly_raise.
create or replace function public.scout_recorder_watch()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  r record; w scout_rec_watch_state; v_missing int[]; v_resp record; v_ok boolean; v_why text; v_wk text;
  n_lost int := 0; n_retry int := 0; n_stuck int := 0; n_tr int := 0; n_done int := 0;
  v_url constant text := 'https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/scout-recorder';
begin
  -- 1. recording / starting with no heartbeat for 12 min -> lost, one critical alert per session
  for r in select * from scout_rec_sessions
            where state in ('recording','starting') and last_beat_at < now() - interval '12 minutes'
            for update skip locked loop
    update scout_rec_sessions set state = 'lost', updated_at = now(),
           alerted_lost_at = coalesce(alerted_lost_at, now()) where id = r.id;
    if r.alerted_lost_at is null then
      begin
        perform notify_route('Scout: a call recording stopped mid-call',
          coalesce(nullif(r.title, ''), 'A call') || ' stopped recording at '
            || to_char(r.last_beat_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM')
            || '. Scout will upload what was saved when Chrome is back.',
          'critical', 'Scout', 'https://bestly.tech/admin/meetings', 'scout-recorder', 'scout-rec-lost-' || r.id);
        n_lost := n_lost + 1;
      exception when others then null; end;
    end if;
  end loop;

  -- 2. uploading with no progress for 30 min -> mark retry parts + digest; 3 h -> raise
  for r in select * from scout_rec_sessions
            where state = 'uploading' and last_progress_at < now() - interval '30 minutes' and retry_marked_at is null
            for update skip locked loop
    select coalesce(array_agg(g order by g), '{}') into v_missing
      from generate_series(0, greatest(r.parts_sent, 1) - 1) g
     where not (g = any (scout_rec_parts_present(r.storage_path)));
    update scout_rec_sessions set retry_parts = v_missing, retry_marked_at = now(), updated_at = now() where id = r.id;
    begin
      perform bestly_app_push('scout', 'fyi', 'Scout Recorder: an upload is stuck',
        coalesce(nullif(r.title, ''), 'A call') || ' has not uploaded for 30 minutes. Scout asked Chrome to retry.',
        'scout.recorder.upload-retry:' || r.id, null, 'meetings', false, null);
    exception when others then null; end;
    n_retry := n_retry + 1;
  end loop;
  for r in select * from scout_rec_sessions
            where state = 'uploading' and last_progress_at < now() - interval '3 hours' and stuck_raised_at is null
            for update skip locked loop
    update scout_rec_sessions set stuck_raised_at = now(), updated_at = now() where id = r.id;
    begin
      perform bestly_raise('scout.recorder.upload-stuck', 'problem', 'warning', 'Scout Recorder: an upload is stuck',
        coalesce(nullif(r.title, ''), 'A call') || ' has not uploaded for over 3 hours. Chrome may be closed or offline.',
        'scout-recorder', null, false);
    exception when others then null; end;
    n_stuck := n_stuck + 1;
  end loop;
  if not exists (select 1 from scout_rec_sessions where state = 'uploading' and last_progress_at < now() - interval '3 hours') then
    begin perform bestly_raise('scout.recorder.upload-stuck', 'resolved', 'info', 'Scout Recorder uploads are moving again', null, 'scout-recorder', null, true);
    exception when others then null; end;
  end if;

  -- 3. uploaded: clip done -> transcribed; clip error or not done after 6 h -> digest + raise
  update scout_rec_sessions s set state = 'transcribed', updated_at = now()
    from voice_clips c where s.clip_id = c.id and s.state = 'uploaded' and c.status = 'done';
  get diagnostics n_done = row_count;
  for r in select s.id, s.title, c.status as clip_status from scout_rec_sessions s join voice_clips c on c.id = s.clip_id
            where s.state = 'uploaded' and s.transcribe_alerted_at is null
              and (c.status = 'error' or s.finished_at < now() - interval '6 hours')
            for update of s skip locked loop
    update scout_rec_sessions set transcribe_alerted_at = now(), updated_at = now() where id = r.id;
    begin
      perform bestly_app_push('scout', 'fyi', 'Scout Recorder: a call did not transcribe',
        coalesce(nullif(r.title, ''), 'A call') || case when r.clip_status = 'error' then ' failed to transcribe.' else ' is still waiting to be transcribed after 6 hours.' end,
        'scout.recorder.transcribe:' || r.id, null, 'meetings', false, null);
      perform bestly_raise('scout.recorder.transcribe', 'problem', 'warning', 'Scout Recorder: a call did not transcribe',
        coalesce(nullif(r.title, ''), 'A call') || case when r.clip_status = 'error' then ' failed to transcribe.' else ' is still waiting to be transcribed after 6 hours.' end,
        'scout-recorder', null, false);
    exception when others then null; end;
    n_tr := n_tr + 1;
  end loop;
  if not exists (select 1 from scout_rec_sessions s join voice_clips c on c.id = s.clip_id
                  where s.state = 'uploaded' and (c.status = 'error' or s.finished_at < now() - interval '6 hours')) then
    begin perform bestly_raise('scout.recorder.transcribe', 'resolved', 'info', 'Scout Recorder transcripts are flowing again', null, 'scout-recorder', null, true);
    exception when others then null; end;
  end if;

  -- 4. selftest every 6 h through pg_net; read the answer on the next run (a few minutes later)
  select * into w from scout_rec_watch_state where id = 1;
  if w.selftest_req_id is not null then
    select * into v_resp from net._http_response where id = w.selftest_req_id;
    if v_resp.id is not null or w.selftest_sent_at < now() - interval '15 minutes' then
      begin
        v_ok := v_resp.id is not null and v_resp.status_code = 200 and not coalesce(v_resp.timed_out, false)
                and coalesce((case when v_resp.content ~ '^\s*\{' then v_resp.content::jsonb ->> 'ok' end), '') = 'true';
      exception when others then v_ok := false; end;
      v_why := case when v_resp.id is null then 'no answer from the Scout Recorder function within 15 minutes'
                    else 'status ' || coalesce(v_resp.status_code::text, 'none') || ' ' || left(coalesce(v_resp.content, v_resp.error_msg, ''), 200) end;
      if v_ok then
        update scout_rec_watch_state set selftest_req_id = null, selftest_ok_at = now() where id = 1;
        begin perform bestly_raise('scout.recorder.selftest', 'resolved', 'info', 'Scout Recorder self-check passed again', null, 'scout-recorder', null, true);
        exception when others then null; end;
      else
        update scout_rec_watch_state set selftest_req_id = null where id = 1;
        begin perform bestly_raise('scout.recorder.selftest', 'problem', 'warning', 'Scout Recorder self-check failed', v_why, 'scout-recorder', null, false);
        exception when others then null; end;
      end if;
    end if;
    select * into w from scout_rec_watch_state where id = 1;
  end if;
  if w.selftest_req_id is null and (w.selftest_sent_at is null or w.selftest_sent_at < now() - interval '6 hours') then
    select decrypted_secret into v_wk from vault.decrypted_secrets where name = 'partner_ai_worker_key' limit 1;
    if v_wk is not null then
      update scout_rec_watch_state set selftest_sent_at = now(),
        selftest_req_id = net.http_post(url := v_url,
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-worker-key', v_wk),
          body := jsonb_build_object('action', 'selftest'), timeout_milliseconds := 25000)
       where id = 1;
    end if;
  end if;

  return jsonb_build_object('lost', n_lost, 'retry', n_retry, 'stuck', n_stuck, 'transcribe_alerts', n_tr, 'transcribed', n_done);
end $$;
revoke execute on function public.scout_recorder_watch() from public, anon, authenticated;

select cron.schedule('scout-recorder-watch', '*/5 * * * *', 'select public.scout_recorder_watch()');

-- short link bestly.tech/s/scout (site-go reads site_links via site_link_get); the ship step re-points it to the store listing
insert into public.site_links (slug, url) values ('scout', 'https://www.bestly.tech/scout-recorder') on conflict (slug) do nothing;
