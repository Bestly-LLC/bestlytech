-- Scout runs shell jobs on the Mac mini, one tap at a time.
--
-- Scout (admin-chat, service role) can only PROPOSE a job. Only Jared, signed in
-- as admin in the browser, can approve it, through mac_job_decide(). The trigger
-- enforces that at the row level, so no service-role path (Scout's db_write,
-- an edge function bug) can approve a job or change its script afterwards.
-- The agent (~/MeetingRec/agent.py) runs approved jobs and streams output back.

create table public.mac_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null check (length(title) between 1 and 120),
  why text check (length(why) <= 1000),
  script text not null check (length(script) between 1 and 20000),
  cwd text check (length(cwd) <= 500),
  timeout_s int not null default 300 check (timeout_s between 5 and 3600),
  status text not null default 'proposed'
    check (status in ('proposed','approved','running','done','failed','cancelled','expired')),
  thread_id uuid,
  proposed_by text not null default 'scout',
  approved_by uuid,
  approved_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  exit_code int,
  output text not null default '' check (length(output) <= 300000)
);
create index mac_jobs_status_idx on public.mac_jobs (status, created_at);
create index mac_jobs_thread_idx on public.mac_jobs (thread_id, created_at desc);

alter table public.mac_jobs enable row level security;
create policy "admins read mac jobs" on public.mac_jobs
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));
revoke all on public.mac_jobs from anon, authenticated;
grant select on public.mac_jobs to authenticated;

create or replace function public.mac_jobs_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'proposed' or new.approved_by is not null or new.approved_at is not null then
      raise exception 'a Mac job starts as proposed';
    end if;
    return new;
  end if;
  if new.script is distinct from old.script or new.cwd is distinct from old.cwd
     or new.timeout_s is distinct from old.timeout_s or new.title is distinct from old.title
     or new.created_at is distinct from old.created_at then
    raise exception 'a Mac job cannot be changed after it is proposed';
  end if;
  if new.status = 'approved' and old.status <> 'approved' then
    if old.status <> 'proposed' or auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
      raise exception 'only Jared can approve a Mac job';
    end if;
  end if;
  if new.approved_by is distinct from old.approved_by and (auth.uid() is null or new.approved_by <> auth.uid()) then
    raise exception 'approved_by is set by the approval itself';
  end if;
  if old.status in ('done','failed','cancelled','expired') and new.status <> old.status then
    raise exception 'that job is finished';
  end if;
  if new.status = 'running' and old.status <> 'approved' and old.status <> 'running' then
    raise exception 'only an approved job can run';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger mac_jobs_guard before insert or update on public.mac_jobs
  for each row execute function public.mac_jobs_guard();

-- Called from the browser with Jared's own session: Run or Cancel.
create or replace function public.mac_job_decide(p_id uuid, p_run boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare j public.mac_jobs;
begin
  if auth.uid() is null or not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin only';
  end if;
  select * into j from public.mac_jobs where id = p_id for update;
  if not found then raise exception 'no such job'; end if;
  if p_run then
    if j.status <> 'proposed' then raise exception 'that job is already %', j.status; end if;
    if j.created_at < now() - interval '1 hour' then
      update public.mac_jobs set status = 'expired', finished_at = now() where id = p_id;
      raise exception 'that proposal is over an hour old; ask Scout again';
    end if;
    update public.mac_jobs set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
  else
    if j.status not in ('proposed','approved','running') then raise exception 'that job is already %', j.status; end if;
    update public.mac_jobs set status = 'cancelled', finished_at = case when j.status = 'running' then null else now() end where id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'id', p_id, 'run', p_run);
end $$;
revoke all on function public.mac_job_decide(uuid, boolean) from public, anon;
grant execute on function public.mac_job_decide(uuid, boolean) to authenticated;
