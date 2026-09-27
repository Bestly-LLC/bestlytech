-- Refresh = Scout checks whether anything on "Needs you" and the to-dos is already done (2026-09-27).
--
-- Jared: "make the refresh button make Scout see if items in the to-do or Needs you have been completed".
--
-- How it works (todo-check op "refresh"):
--   1. admin_needs_rules(run) closes Needs-you alerts that are PROVABLY finished, no AI:
--        monitor   - the monitor that raised the alert has marked its issue resolved since
--        mac_job   - a later run of the same failed Mac job finished OK
--        duplicate - a newer copy of the same alert is still on the list (the old one goes)
--      and queues the rest of the one-off alerts (bell:*) and Cookie Yeti asks (cy:*) for the AI judge.
--      Every other Needs-you row is a live condition (studio preview, client clip, uptime, stock...)
--      that leaves the list by itself the moment the source changes, so there is nothing to judge.
--   2. The judge (free AI only, same evidence as the to-do checker) closes an alert only under the
--      same bar as to-dos: todo_check_settings.auto_close on, verdict done, confidence >= threshold,
--      proof from >= 2 kinds of source. Cookie Yeti asks are judged but never auto-closed (closing one
--      erases its text, so it could not be put back).
--   3. Open to-dos not checked in the last 30 min go through the existing sweep.
-- Every close is one tap to undo (admin_today_undo now reopens alerts too), and an undone close is
-- not re-closed by the next refresh for 7 days.
-- Self-healing: todo_check_drain (every minute) now also works and requeues this queue; the
-- watchdog raises Scout if needs checks keep erroring.

create table if not exists public.admin_needs_checks (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null,
  key         text not null,
  title       text,
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  attempts    int  not null default 0,
  rule        text,              -- set when a rule (no AI) decided it
  verdict     text,              -- done | partly | not_done | unknown | cleared
  confidence  numeric,
  summary     text,
  evidence    jsonb,
  model       text,
  closed      boolean not null default false,
  undone_at   timestamptz,
  error       text,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
create index if not exists admin_needs_checks_run_idx on public.admin_needs_checks (run_id);
create index if not exists admin_needs_checks_key_idx on public.admin_needs_checks (key, created_at desc);
create index if not exists admin_needs_checks_live_idx on public.admin_needs_checks (status) where status in ('queued', 'running');

alter table public.admin_needs_checks enable row level security;
drop policy if exists "Admins read needs checks" on public.admin_needs_checks;
create policy "Admins read needs checks" on public.admin_needs_checks
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

-- 12-hour Los Angeles time for the plain-English reasons.
create or replace function public.la_time12(p timestamptz)
returns text language sql stable as $$
  select to_char(p at time zone 'America/Los_Angeles', 'Mon FMDD, FMHH12:MI AM')
$$;

create or replace function public.admin_needs_rules(p_run uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  why text;
  rule text;
  closed jsonb := '[]'::jsonb;
  queued int := 0;
begin
  if auth.uid() is not null then
    perform public.admin_require_admin();
  end if;

  for r in
    select t.key, t.title, t.detail, t.since, n.id as nid, n.entity_key, n.dedupe_key, n.created_at as raised
      from public.admin_today_rows() t
      left join public.admin_notifications n
        on t.key like 'bell:%' and n.id::text = substr(t.key, 6)
     where t.key like 'bell:%' or t.key like 'cy:%'
     order by t.since
  loop
    why := null; rule := null;

    -- Jared put this back after an earlier auto-close: leave it alone for a week.
    if exists (select 1 from public.admin_needs_checks c
                where c.key = r.key and c.closed and c.undone_at > now() - interval '7 days') then
      continue;
    end if;

    if r.nid is not null then
      -- monitor: the issue that raised it has been resolved since
      if r.entity_key like 'monitor:%' then
        select 'The monitor marked it fixed at ' || la_time12(m.resolved_at) || '.'
          into why
          from public.monitor_issues m
         where m.key = substr(r.entity_key, 9) and m.status = 'resolved' and m.resolved_at > r.raised;
        if why is not null then rule := 'monitor'; end if;
      end if;

      -- mac_job: a later run of the same job succeeded
      if why is null and r.dedupe_key like 'mac_job.finished.%' then
        select 'A later run of the same Mac job finished OK at ' || la_time12(j2.finished_at) || '.'
          into why
          from public.mac_jobs j1
          join public.mac_jobs j2
            on regexp_replace(j2.title, '\s*\(retry\)\s*$', '') = regexp_replace(j1.title, '\s*\(retry\)\s*$', '')
           and j2.created_at > j1.created_at and j2.status = 'done' and coalesce(j2.exit_code, 0) = 0
         where j1.id::text = substr(r.dedupe_key, 18)
         order by j2.finished_at desc limit 1;
        if why is not null then rule := 'mac_job'; end if;
      end if;

      -- duplicate: a newer copy of the same alert is still unread
      if why is null then
        select 'A newer copy of this alert (' || la_time12(n2.created_at) || ') is still on the list.'
          into why
          from public.admin_notifications n2
         where n2.read_at is null and n2.id <> r.nid
           and (n2.created_at > r.raised or (n2.created_at = r.raised and n2.id::text > r.nid::text))
           and coalesce(n2.silent, false) = false
           and regexp_replace(lower(n2.title), '[0-9]+', '#', 'g') = regexp_replace(lower(r.title), '[0-9]+', '#', 'g')
         order by n2.created_at desc limit 1;
        if why is not null then rule := 'duplicate'; end if;
      end if;
    end if;

    if rule is not null then
      update public.admin_notifications set read_at = now() where id = r.nid and read_at is null;
      insert into public.admin_needs_checks (run_id, key, title, status, rule, verdict, confidence, summary, closed, finished_at)
      values (p_run, r.key, r.title, 'done', rule, 'done', 1, why, true, now());
      closed := closed || jsonb_build_object('key', r.key, 'title', r.title, 'why', why);
    elsif not exists (select 1 from public.admin_needs_checks c
                       where c.key = r.key and (c.status in ('queued', 'running') or c.created_at > now() - interval '20 minutes')) then
      if queued < 15 then
        insert into public.admin_needs_checks (run_id, key, title) values (p_run, r.key, r.title);
        queued := queued + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('closed', closed, 'queued', queued);
end
$$;
revoke all on function public.admin_needs_rules(uuid) from public, anon;
grant execute on function public.admin_needs_rules(uuid) to authenticated, service_role;

create or replace function public.admin_needs_claim(p_n int)
returns setof public.admin_needs_checks
language sql
security definer
set search_path to 'public'
as $$
  update public.admin_needs_checks c set status = 'running', started_at = now(), attempts = attempts + 1
   where c.id in (select id from public.admin_needs_checks where status = 'queued'
                   order by created_at for update skip locked limit greatest(1, least(p_n, 10)))
  returning c.*;
$$;
revoke all on function public.admin_needs_claim(int) from public, anon, authenticated;
grant execute on function public.admin_needs_claim(int) to service_role;

-- Undo now works for alerts too: before this it only cleared a dismissal, so "Undo" on a
-- ticked alert said "Back on the list" and the alert stayed read.
create or replace function public.admin_today_undo(p_key text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare did boolean := false;
begin
  perform public.admin_require_admin();
  delete from public.admin_today_dismissed where key = p_key;
  did := found;
  if split_part(p_key, ':', 1) = 'bell' then
    update public.admin_notifications set read_at = null
     where id::text = substr(p_key, 6) and read_at is not null;
    did := did or found;
  end if;
  update public.admin_needs_checks set undone_at = now()
   where id = (select id from public.admin_needs_checks where key = p_key and closed and undone_at is null
                order by created_at desc limit 1);
  return did;
end $$;

-- The drain now works both queues (the minute cron already calls it).
create or replace function public.todo_check_drain()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare requeued int; failed int := 0; waiting int; jid uuid; n_req int; n_fail int;
begin
  for jid in select id from todo_check_jobs where status = 'running' and started_at < now() - interval '4 minutes' and attempts >= 3 loop
    perform todo_check_job_done(jid, false, null, 'gave up after 3 tries');
    failed := failed + 1;
  end loop;
  with s as (
    update todo_check_jobs set status = 'queued', started_at = null
     where status = 'running' and started_at < now() - interval '4 minutes' and attempts < 3 returning 1)
  select count(*) into requeued from s;

  with s as (
    update admin_needs_checks set status = 'error', error = 'gave up after 3 tries', finished_at = now()
     where status = 'running' and started_at < now() - interval '4 minutes' and attempts >= 3 returning 1)
  select count(*) into n_fail from s;
  with s as (
    update admin_needs_checks set status = 'queued', started_at = null
     where status = 'running' and started_at < now() - interval '4 minutes' and attempts < 3 returning 1)
  select count(*) into n_req from s;

  select (select count(*) from todo_check_jobs where status = 'queued')
       + (select count(*) from admin_needs_checks where status = 'queued') into waiting;
  if waiting > 0
     and not exists (select 1 from todo_check_jobs where status = 'running' and started_at > now() - interval '2 minutes')
     and not exists (select 1 from admin_needs_checks where status = 'running' and started_at > now() - interval '2 minutes') then
    perform invoke_edge_function('todo-check', '{"op":"drain"}'::jsonb, 150000);
  end if;
  return jsonb_build_object('requeued', requeued + n_req, 'failed', failed + n_fail, 'waiting', waiting);
end $$;

-- Watchdog: same function, one more check.
create or replace function public.todo_check_watchdog()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  la_now timestamp := now() at time zone 'America/Los_Angeles';
  last_night timestamptz;
  errs int; stuck int; needs_errs int; healed text[] := '{}';
begin
  select max(ran_at) into last_night from scout_daily_runs where job = 'todo-check';
  if extract(hour from la_now) >= 23 and (last_night is null or (last_night at time zone 'America/Los_Angeles')::date < la_now::date) then
    perform invoke_edge_function('todo-check', '{"op":"nightly","force":true}'::jsonb, 150000);
    healed := healed || 'reran nightly pass';
  end if;
  if last_night is not null and last_night < now() - interval '50 hours' then
    perform scout_notify('To-do checker has not run in 2 days',
      'The nightly check of your to-dos keeps missing. Scout already tried to rerun it. Open Monitor.',
      'warning', true, '/admin/monitor', 'todo-check.missed.' || to_char(la_now, 'YYYY-MM-DD'));
  end if;
  select count(*) into stuck from todo_checks where feedback in ('down', 'undo') and not learned and feedback_at < now() - interval '10 minutes' and feedback_at > now() - interval '3 days';
  if stuck > 0 then
    perform invoke_edge_function('todo-check', '{"op":"learn_backlog"}'::jsonb, 120000);
    healed := healed || format('retried %s lessons', stuck);
  end if;
  select count(*) into errs from todo_checks where created_at > now() - interval '24 hours' and error is not null;
  if errs >= 5 then
    perform scout_notify('To-do checker is erroring',
      format('%s checks failed in the last day. Latest: %s', errs,
        (select left(error, 200) from todo_checks where error is not null order by created_at desc limit 1)),
      'warning', false, '/admin', 'todo-check.errors.' || to_char(la_now, 'YYYY-MM-DD'));
  end if;
  select count(*) into needs_errs from admin_needs_checks where created_at > now() - interval '24 hours' and status = 'error';
  if needs_errs >= 5 then
    perform scout_notify('Refresh check is erroring',
      format('%s Needs-you checks failed in the last day. Latest: %s', needs_errs,
        (select left(error, 200) from admin_needs_checks where status = 'error' order by created_at desc limit 1)),
      'warning', false, '/admin', 'needs-check.errors.' || to_char(la_now, 'YYYY-MM-DD'));
  end if;
  return jsonb_build_object('ok', true, 'healed', healed, 'errors_24h', errs, 'needs_errors_24h', needs_errs, 'last_nightly', last_night);
end $$;
