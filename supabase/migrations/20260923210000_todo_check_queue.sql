-- To-do checks keep going after Jared leaves the page (2026-09-23).
-- Every check (one to-do or "Check them all") is a row in todo_check_jobs under a todo_check_runs row.
-- todo-check works the queue in the background (EdgeRuntime.waitUntil) and returns at once; the page
-- shows progress from these tables, so it survives a reload or a closed tab. todo_check_drain() runs
-- every minute: requeues jobs stuck in "running" (up to 3 tries) and wakes todo-check if work is left.
-- When a run finishes, Scout sends a notification (web push) with what it found.

create table if not exists public.todo_check_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'sweep' check (trigger in ('button', 'sweep', 'nightly')),
  total int not null default 0,
  finished int not null default 0,
  looks_done int not null default 0,
  closed int not null default 0,
  errors int not null default 0,
  started_by uuid,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  notified boolean not null default false
);
create index if not exists todo_check_runs_recent on public.todo_check_runs (created_at desc);

create table if not exists public.todo_check_jobs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.todo_check_runs(id) on delete cascade,
  todo_id uuid not null references public.scout_daily(id) on delete cascade,
  trigger text not null default 'button' check (trigger in ('button', 'sweep', 'nightly')),
  allow_close boolean not null default false,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  attempts int not null default 0,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create unique index if not exists todo_check_jobs_one_live on public.todo_check_jobs (todo_id) where status in ('queued', 'running');
create index if not exists todo_check_jobs_queue on public.todo_check_jobs (status, created_at);

alter table public.todo_check_runs enable row level security;
alter table public.todo_check_jobs enable row level security;
drop policy if exists "Admins read todo check runs" on public.todo_check_runs;
create policy "Admins read todo check runs" on public.todo_check_runs for select to authenticated using (has_role(auth.uid(), 'admin'));
drop policy if exists "Admins read todo check jobs" on public.todo_check_jobs;
create policy "Admins read todo check jobs" on public.todo_check_jobs for select to authenticated using (has_role(auth.uid(), 'admin'));

-- Take the next n queued jobs (safe with several workers).
create or replace function public.todo_check_claim(p_n int) returns setof public.todo_check_jobs
language sql security definer set search_path = public as $$
  update todo_check_jobs j set status = 'running', started_at = now(), attempts = attempts + 1
   where j.id in (select id from todo_check_jobs where status = 'queued' order by created_at for update skip locked limit greatest(1, least(p_n, 10)))
  returning j.*;
$$;
revoke all on function public.todo_check_claim(int) from public, anon, authenticated;
grant execute on function public.todo_check_claim(int) to service_role;

-- Finish a job; returns the run when this job completed it (so the caller notifies once).
create or replace function public.todo_check_job_done(p_job uuid, p_ok boolean, p_result jsonb, p_error text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j todo_check_jobs; r todo_check_runs;
begin
  update todo_check_jobs set status = case when p_ok then 'done' else 'error' end, result = p_result, error = left(p_error, 500), finished_at = now()
   where id = p_job and status = 'running' returning * into j;
  if j.id is null or j.run_id is null then return null; end if;
  update todo_check_runs set
      finished = finished + 1,
      looks_done = looks_done + case when p_ok and p_result->>'verdict' = 'done' then 1 else 0 end,
      closed = closed + case when p_ok and (p_result->>'auto_closed')::boolean then 1 else 0 end,
      errors = errors + case when p_ok then 0 else 1 end
   where id = j.run_id returning * into r;
  if r.finished >= r.total and r.finished_at is null then
    update todo_check_runs set finished_at = now(), notified = true where id = r.id and not notified returning * into r;
    if r.id is not null then return to_jsonb(r); end if;
  end if;
  return null;
end $$;
revoke all on function public.todo_check_job_done(uuid, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.todo_check_job_done(uuid, boolean, jsonb, text) to service_role;

-- Every minute: heal stuck jobs, and wake the worker only when there is work.
create or replace function public.todo_check_drain() returns jsonb
language plpgsql security definer set search_path = public as $$
declare requeued int; failed int := 0; waiting int; jid uuid;
begin
  for jid in select id from todo_check_jobs where status = 'running' and started_at < now() - interval '4 minutes' and attempts >= 3 loop
    perform todo_check_job_done(jid, false, null, 'gave up after 3 tries');
    failed := failed + 1;
  end loop;
  with s as (
    update todo_check_jobs set status = 'queued', started_at = null
     where status = 'running' and started_at < now() - interval '4 minutes' and attempts < 3 returning 1)
  select count(*) into requeued from s;
  select count(*) into waiting from todo_check_jobs where status = 'queued';
  -- one worker at a time is enough; skip if one started in the last 2 minutes and is still busy
  if waiting > 0 and not exists (select 1 from todo_check_jobs where status = 'running' and started_at > now() - interval '2 minutes') then
    perform invoke_edge_function('todo-check', '{"op":"drain"}'::jsonb, 150000);
  end if;
  return jsonb_build_object('requeued', requeued, 'failed', failed, 'waiting', waiting);
end $$;
revoke all on function public.todo_check_drain() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'todo-check-drain';
select cron.schedule('todo-check-drain', '* * * * *', $c$select public.todo_check_drain()$c$);

-- keep 30 days of history
select cron.unschedule(jobid) from cron.job where jobname = 'todo-check-prune';
select cron.schedule('todo-check-prune', '55 3 * * *', $c$delete from public.todo_check_runs where created_at < now() - interval '30 days'; delete from public.todo_check_jobs where created_at < now() - interval '30 days'$c$);
