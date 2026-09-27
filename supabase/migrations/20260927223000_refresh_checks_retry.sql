-- Refresh checks, round 2 (2026-09-27, after the first live run).
-- Live run: 5 closed by rules, 11 judged, but the free AI was out (Groq per-minute limit, Cloudflare daily
-- quota used up), so most judged items got a no-AI read and were marked done anyway.
--   * not_before: when the free AI is out, todo-check puts the item back in the queue with a wait instead
--     of settling for a no-AI read (up to 3 tries); claim and the minute drain respect the wait.
--   * duplicate rule: an older copy of an alert goes when ANY newer copy exists (read or not). A newer copy
--     Jared already cleared left the older one stuck on the list ("Scout learned 3 things" vs a read "8 things").

alter table public.admin_needs_checks add column if not exists not_before timestamptz;

create or replace function public.admin_needs_claim(p_n int)
returns setof public.admin_needs_checks
language sql
security definer
set search_path to 'public'
as $$
  update public.admin_needs_checks c set status = 'running', started_at = now(), attempts = attempts + 1
   where c.id in (select id from public.admin_needs_checks
                   where status = 'queued' and (not_before is null or not_before <= now())
                   order by created_at for update skip locked limit greatest(1, least(p_n, 10)))
  returning c.*;
$$;
revoke all on function public.admin_needs_claim(int) from public, anon, authenticated;
grant execute on function public.admin_needs_claim(int) to service_role;

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
      if r.entity_key like 'monitor:%' then
        select 'The monitor marked it fixed at ' || la_time12(m.resolved_at) || '.'
          into why
          from public.monitor_issues m
         where m.key = substr(r.entity_key, 9) and m.status = 'resolved' and m.resolved_at > r.raised;
        if why is not null then rule := 'monitor'; end if;
      end if;

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

      -- duplicate: any newer copy of the same alert (still listed, or already cleared) replaces this one
      if why is null then
        select case when n2.read_at is null
                    then 'A newer copy of this alert (' || la_time12(n2.created_at) || ') is still on the list.'
                    else 'A newer copy of this alert (' || la_time12(n2.created_at) || ') was already cleared.' end
          into why
          from public.admin_notifications n2
         where n2.id <> r.nid
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
       + (select count(*) from admin_needs_checks where status = 'queued' and (not_before is null or not_before <= now())) into waiting;
  if waiting > 0
     and not exists (select 1 from todo_check_jobs where status = 'running' and started_at > now() - interval '2 minutes')
     and not exists (select 1 from admin_needs_checks where status = 'running' and started_at > now() - interval '2 minutes') then
    perform invoke_edge_function('todo-check', '{"op":"drain"}'::jsonb, 150000);
  end if;
  return jsonb_build_object('requeued', requeued + n_req, 'failed', failed + n_fail, 'waiting', waiting);
end $$;
