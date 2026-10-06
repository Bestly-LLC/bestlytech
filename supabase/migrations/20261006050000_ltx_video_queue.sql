-- LTX Box video queue (2026-10-05, Jared: "Scout and Spark and Claude here" make videos;
-- cost shown in-line: estimate before, actual after, and today's total).
--
-- Flow: Scout / Spark / Claude call ltx_request() -> row in ltx_jobs (queued).
--   AWS Lambda bestly-ltx-dispatch (EventBridge, every minute) asks edge fn ltx-box ?op=waiting
--   and starts the stopped GPU box. The box worker claims the job through ltx-box (box key,
--   hash in ltx_box.key_hash), renders with the ComfyUI LTX-2.5 template, uploads to bucket
--   ltx-clips with a signed upload URL, then finishes it. ltx_finish() prices it and posts the
--   result into the thread that asked. Link: bestly.tech/v/<code> (Vercel -> ltx-box ?v=).
-- Money: today's total is real box-on minutes (ltx_usage, one per heartbeat) x rate + disk.

create table if not exists public.ltx_jobs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default substr(md5(gen_random_uuid()::text), 1, 7),
  prompt text not null check (length(prompt) between 3 and 2000),
  seconds int not null default 5 check (seconds between 1 and 20),
  source text not null check (source in ('scout', 'spark', 'claude')),
  thread_id uuid,
  status text not null default 'queued' check (status in ('queued', 'rendering', 'done', 'failed', 'cancelled')),
  woke_box boolean not null default false,
  est_minutes numeric(6,1),
  est_usd numeric(8,3),
  requested_at timestamptz not null default now(),
  claimed_at timestamptz,
  done_at timestamptz,
  render_s int,
  gpu_minutes numeric(6,1),
  actual_usd numeric(8,3),
  path text,
  error text,
  attempts int not null default 0
);
alter table public.ltx_jobs enable row level security;
create index if not exists ltx_jobs_status_idx on public.ltx_jobs (status, requested_at);

create table if not exists public.ltx_usage (
  day date primary key,
  minutes int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.ltx_usage enable row level security;

alter table public.ltx_box
  add column if not exists rate_usd_hr numeric(6,3) not null default 1.212,   -- g5.2xlarge on-demand, us-west-2
  add column if not exists disk_usd_day numeric(6,3) not null default 0.395,  -- 150 GB gp3 at $0.08/GB-month
  add column if not exists idle_stop_min int not null default 10,
  add column if not exists key_hash text;

-- number + unit never split across lines (Jared's UI rule): join with a no-break space
create or replace function public.ltx_nb(n text, unit text) returns text
language sql immutable as $$ select n || chr(160) || unit $$;

create or replace function public.ltx_usd(v numeric) returns text
language sql immutable as $$ select '$' || to_char(coalesce(v, 0), 'FM990.00') $$;

create or replace function public.ltx_dur(sec numeric) returns text
language sql immutable as $$
  select case when sec < 60 then ltx_nb(round(sec)::text, 'sec')
              else ltx_nb(floor(sec / 60)::text, 'min') ||
                   case when round(sec)::int % 60 > 0 then ' ' || ltx_nb((round(sec)::int % 60)::text, 'sec') else '' end end
$$;

-- today's real spend: box-on minutes x hourly rate, plus the disk that is billed every day
create or replace function public.ltx_today() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b ltx_box; m int; gpu numeric;
begin
  select * into b from ltx_box where id;
  select coalesce(minutes, 0) into m from ltx_usage where day = (now() at time zone 'America/Los_Angeles')::date;
  m := coalesce(m, 0);
  gpu := round(m / 60.0 * b.rate_usd_hr, 3);
  return jsonb_build_object('minutes', m, 'gpu_usd', gpu, 'disk_usd', b.disk_usd_day,
    'total_usd', gpu + b.disk_usd_day,
    'text', 'Today ' || ltx_usd(gpu + b.disk_usd_day) || ' (' || ltx_nb(m::text, 'min') || ' GPU + ' || ltx_usd(b.disk_usd_day) || ' disk)');
end $$;

create or replace function public.ltx_quote(p_seconds int default 5) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare b ltx_box; awake boolean; per_s numeric; wake_min numeric; render_min numeric; ahead int;
        est_min numeric; est numeric; tail numeric; t jsonb;
begin
  select * into b from ltx_box where id;
  awake := b.last_heartbeat_at > now() - interval '2 minutes';
  -- seconds of GPU per second of video, from the last 5 finished clips (cold first run was 69)
  select avg(render_s::numeric / seconds) into per_s from (
    select render_s, seconds from ltx_jobs where status = 'done' and render_s > 0 order by done_at desc limit 5) x;
  per_s := coalesce(per_s, 69);
  select coalesce(sum(seconds), 0) into ahead from ltx_jobs where status in ('queued', 'rendering');
  wake_min := case when awake then 0 else 3 end;
  render_min := round(per_s * greatest(p_seconds, 1) / 60.0, 1);
  est_min := wake_min + render_min;
  est := round(est_min / 60.0 * b.rate_usd_hr, 3);
  tail := round(b.idle_stop_min / 60.0 * b.rate_usd_hr, 3);
  t := ltx_today();
  return jsonb_build_object('awake', awake, 'est_minutes', est_min, 'est_usd', est, 'idle_tail_usd', tail,
    'queue_ahead_s', ahead, 'today_usd', t->'total_usd',
    'text', 'Est. ~' || ltx_usd(est) || ' (~' || ltx_nb(round(est_min)::text, 'min') || ' GPU: ' ||
      case when awake then 'box is awake, ' else ltx_nb('3', 'min') || ' to wake + ' end ||
      ltx_nb(round(render_min)::text, 'min') || ' render' ||
      case when ahead > 0 then ', after ' || ltx_nb(ahead::text, 'sec') || ' of video already queued' else '' end || ')' ||
      ' + ~' || ltx_usd(tail) || ' idle before the box sleeps · ' || (t->>'text'));
end $$;

create or replace function public.ltx_request(p_prompt text, p_seconds int default 5, p_source text default 'claude', p_thread uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q jsonb; j ltx_jobs;
begin
  q := ltx_quote(p_seconds);
  insert into ltx_jobs (prompt, seconds, source, thread_id, woke_box, est_minutes, est_usd)
  values (trim(p_prompt), greatest(1, least(coalesce(p_seconds, 5), 20)), p_source, p_thread,
          not (q->>'awake')::boolean, (q->>'est_minutes')::numeric, (q->>'est_usd')::numeric)
  returning * into j;
  insert into ltx_box_events (event, detail) values ('job_queued', jsonb_build_object('job', j.id, 'source', p_source, 'seconds', j.seconds));
  return jsonb_build_object('job_id', j.id, 'code', j.code, 'quote', q,
    'text', 'Queued (' || ltx_nb(j.seconds::text, 'sec') || ' clip). ' || (q->>'text') ||
      '. I will post the clip here with the actual cost when it is done.');
end $$;

create or replace function public.ltx_status(p_ref text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare j ltx_jobs;
begin
  select * into j from ltx_jobs where code = p_ref or id::text = p_ref order by requested_at desc limit 1;
  if j.id is null then return jsonb_build_object('ok', false, 'error', 'no such video'); end if;
  return jsonb_build_object('ok', true, 'status', j.status, 'code', j.code, 'seconds', j.seconds,
    'link', case when j.status = 'done' then 'https://bestly.tech/v/' || j.code end,
    'est_usd', j.est_usd, 'actual_usd', j.actual_usd, 'error', j.error,
    'text', case j.status
      when 'done' then 'Ready: https://bestly.tech/v/' || j.code || ' · Actual ' || ltx_usd(j.actual_usd) || ' (' || ltx_dur(j.gpu_minutes * 60) || ' GPU) · ' || (ltx_today()->>'text')
      when 'failed' then 'Failed: ' || coalesce(j.error, 'unknown') || ' · Charged ' || ltx_usd(j.actual_usd) || ' · ' || (ltx_today()->>'text')
      when 'rendering' then 'Rendering for ' || ltx_dur(extract(epoch from now() - j.claimed_at)) || ' (est. ' || ltx_nb(round(j.est_minutes)::text, 'min') || ' total)'
      else 'Waiting for the GPU box (queued ' || ltx_dur(extract(epoch from now() - j.requested_at)) || ' ago)' end);
end $$;

-- box side (called only by edge fn ltx-box with the service role)
create or replace function public.ltx_claim() returns jsonb
language plpgsql security definer set search_path = public as $$
declare j ltx_jobs;
begin
  select * into j from ltx_jobs where status = 'queued' order by requested_at for update skip locked limit 1;
  if j.id is null then return jsonb_build_object('job', null); end if;
  update ltx_jobs set status = 'rendering', claimed_at = now(), attempts = attempts + 1 where id = j.id returning * into j;
  return jsonb_build_object('job', jsonb_build_object('id', j.id, 'code', j.code, 'prompt', j.prompt, 'seconds', j.seconds));
end $$;

create or replace function public.ltx_post(j ltx_jobs, body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if j.thread_id is null then return; end if;
  if j.source = 'scout' then
    insert into admin_chat_messages (thread_id, role, body) values (j.thread_id, 'assistant', body);
    update admin_chat_threads set updated_at = now() where id = j.thread_id;
  elsif j.source = 'spark' then
    insert into studio_request_messages (request_id, role, body) values (j.thread_id, 'claude', body);
    update studio_requests set updated_at = now() where id = j.thread_id;
  end if;
end $$;

create or replace function public.ltx_finish(p_job uuid, p_ok boolean, p_render_s int default null, p_path text default null, p_error text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j ltx_jobs; b ltx_box; mins numeric; msg text;
begin
  select * into b from ltx_box where id;
  select * into j from ltx_jobs where id = p_job for update;
  if j.id is null or j.status <> 'rendering' then return jsonb_build_object('ok', false, 'error', 'not rendering'); end if;
  mins := extract(epoch from now() - j.claimed_at) / 60.0
        + case when j.woke_box then extract(epoch from j.claimed_at - j.requested_at) / 60.0 else 0 end;
  update ltx_jobs set status = case when p_ok then 'done' else 'failed' end, done_at = now(),
    render_s = p_render_s, path = p_path, error = left(p_error, 500),
    gpu_minutes = round(mins, 1), actual_usd = round(mins / 60.0 * b.rate_usd_hr, 3)
  where id = p_job returning * into j;
  msg := case when p_ok
    then 'Your video is ready (' || ltx_nb(j.seconds::text, 'sec') || '): https://bestly.tech/v/' || j.code ||
         E'\nActual ' || ltx_usd(j.actual_usd) || ' (' || ltx_dur(j.gpu_minutes * 60) || ' GPU' ||
         case when j.woke_box then ', incl. waking the box' else '' end || '; est. was ' || ltx_usd(j.est_usd) || ') · ' || (ltx_today()->>'text')
    else 'The video failed: ' || coalesce(j.error, 'unknown error') || E'\nCharged ' || ltx_usd(j.actual_usd) ||
         ' for ' || ltx_dur(j.gpu_minutes * 60) || ' of GPU · ' || (ltx_today()->>'text') end;
  perform ltx_post(j, msg);
  insert into admin_notifications (kind, title, body, url, severity, dedupe_key, agent_slug)
  values ('ltx', case when p_ok then 'Video ready' else 'Video failed' end,
          left(j.prompt, 90) || E'\n' || split_part(msg, E'\n', 2),
          case when p_ok then 'https://bestly.tech/v/' || j.code end,
          case when p_ok then 'success' else 'warning' end, 'ltx.job:' || j.id, 'ltx-box');
  insert into ltx_box_events (event, detail) values (case when p_ok then 'job_done' else 'job_failed' end,
    jsonb_build_object('job', j.id, 'render_s', p_render_s, 'usd', j.actual_usd, 'error', p_error));
  perform agent_beat('ltx-box', p_ok, case when p_ok then 'Rendered ' || j.seconds || ' s clip for ' || j.source || ', ' || ltx_usd(j.actual_usd) else 'Clip failed: ' || left(coalesce(p_error, ''), 120) end);
  return jsonb_build_object('ok', true, 'text', msg);
end $$;

create or replace function public.ltx_waiting() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from ltx_jobs where status in ('queued', 'rendering')
$$;

create or replace function public.ltx_key_ok(p_key text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(length(p_key) >= 32 and encode(extensions.digest(p_key, 'sha256'), 'hex') = (select key_hash from ltx_box where id), false)
$$;

revoke all on function public.ltx_today(), public.ltx_quote(int), public.ltx_request(text, int, text, uuid), public.ltx_status(text),
  public.ltx_claim(), public.ltx_post(ltx_jobs, text), public.ltx_finish(uuid, boolean, int, text, text), public.ltx_waiting(), public.ltx_key_ok(text)
  from public, anon, authenticated;

-- heartbeat (every minute from the box via ltx_report) also counts box-on minutes for today's total.
-- A trigger, so the box-facing RPC ltx_report stays untouched. First heartbeat after a boot adds the boot minutes.
create or replace function public.ltx_count_minutes() returns trigger
language plpgsql security definer set search_path = public as $$
declare add_min int;
begin
  if new.last_heartbeat_at is distinct from old.last_heartbeat_at and new.last_heartbeat_at is not null then
    add_min := case when old.last_heartbeat_at is null or old.last_heartbeat_at < new.last_heartbeat_at - interval '5 minutes'
                    then greatest(1, least(30, ceil(coalesce((new.last_detail->>'uptime_s')::numeric, 60) / 60.0)::int))
                    else 1 end;
    insert into ltx_usage (day, minutes) values ((new.last_heartbeat_at at time zone 'America/Los_Angeles')::date, add_min)
      on conflict (day) do update set minutes = ltx_usage.minutes + excluded.minutes, updated_at = now();
  end if;
  return new;
end $$;
create trigger ltx_box_count_minutes after update of last_heartbeat_at on public.ltx_box
  for each row execute function public.ltx_count_minutes();

-- watchdog: stuck jobs. Rendering with a dead box -> requeue once, then fail. Queued 25+ min
-- with no box -> fail and alert (AWS out of GPU capacity or dispatcher down).
create or replace function public.ltx_watch_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare b ltx_box; alive boolean; j ltx_jobs; n_fail int := 0; n_requeue int := 0;
begin
  select * into b from ltx_box where id;
  alive := b.last_heartbeat_at > now() - interval '4 minutes';
  for j in select * from ltx_jobs where status = 'rendering'
           and (claimed_at < now() - interval '30 minutes' or (not alive and claimed_at < now() - interval '5 minutes')) loop
    if j.attempts < 2 then
      update ltx_jobs set status = 'queued', claimed_at = null where id = j.id;
      n_requeue := n_requeue + 1;
    else
      perform ltx_finish(j.id, false, null, null, 'the GPU box stopped answering twice while rendering');
      n_fail := n_fail + 1;
    end if;
  end loop;
  for j in select * from ltx_jobs where status = 'queued' and requested_at < now() - interval '25 minutes' and not alive loop
    update ltx_jobs set status = 'rendering', claimed_at = now() where id = j.id;
    perform ltx_finish(j.id, false, null, null, 'the GPU box never woke up (AWS may be out of GPU capacity)');
    n_fail := n_fail + 1;
  end loop;
  if n_fail > 0 then
    perform bestly_raise('ltx:job-failed', 'problem', 'warning', 'A video job failed on the GPU box',
      n_fail || ' video job(s) failed. The thread that asked was told and charged only for GPU time used.', 'ltx', null, false);
  elsif not exists (select 1 from ltx_jobs where status = 'failed' and done_at > now() - interval '1 hour') then
    perform bestly_raise('ltx:job-failed', 'resolved');
  end if;
  return jsonb_build_object('requeued', n_requeue, 'failed', n_fail);
end $$;
revoke all on function public.ltx_watch_jobs() from public, anon, authenticated;

select cron.alter_job((select jobid from cron.job where jobname = 'ltx-watch'), command := 'select public.ltx_watch(); select public.ltx_watch_jobs();');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ltx-clips', 'ltx-clips', false, 524288000, array['video/mp4']) on conflict (id) do nothing;
