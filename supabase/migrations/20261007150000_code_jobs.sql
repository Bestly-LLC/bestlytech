-- 2026-10-07 Scout chief of staff, step 5: code jobs (docs/scout-chief-of-staff-opusplan.md).
-- Scout writes a job; the Code Worker on the Mac mini does it (opencode on free AI, 3 tries, build must pass).
-- Mac side talks to the database only through _t RPCs gated by the Mac watchdog token (Keychain bestly-db-watchdog).

create table if not exists public.code_jobs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  thread_id uuid,
  repo text not null,                    -- Bestly-LLC/<name> (bestlytech, or an existing site) or new site name
  goal text not null,
  new_site jsonb,                        -- {name, domain?} when this builds a brand new site
  status text not null default 'queued' check (status in ('queued','running','needs_yes','done','failed')),
  paid_ok boolean not null default false, -- Jared tapped "Use paid AI for this one"
  attempts int not null default 0,
  note text,                             -- what it is doing right now, 5-8 words
  result jsonb,                          -- {summary, commit_sha, live_url, short_url, build_ok}
  log_tail text,
  started_at timestamptz,
  finished_at timestamptz,
  reported_at timestamptz
);
create index if not exists code_jobs_status on public.code_jobs (status, created_at);
alter table public.code_jobs enable row level security;   -- no policies: service role + RPCs only

create table if not exists public.code_worker_status (
  id boolean primary key default true check (id),
  beat_at timestamptz,
  info jsonb
);
alter table public.code_worker_status enable row level security;
insert into public.code_worker_status (id) values (true) on conflict do nothing;

create table if not exists public.site_links (
  slug text primary key check (slug ~ '^[a-z0-9][a-z0-9-]{1,60}$'),
  url text not null check (url ~ '^https://'),
  job_id uuid,
  created_at timestamptz not null default now()
);
alter table public.site_links enable row level security;

-- Admin view (browser): last 25 jobs.
create or replace function public.code_jobs_admin() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'beat_at', (select beat_at from code_worker_status where id),
    'jobs', coalesce((select jsonb_agg(to_jsonb(j) - 'log_tail' order by j.created_at desc)
                        from (select * from code_jobs order by created_at desc limit 25) j), '[]'::jsonb));
end $$;
revoke all on function public.code_jobs_admin() from public, anon;
grant execute on function public.code_jobs_admin() to authenticated, service_role;

-- Mac: take the next job (queued, or a running one that went quiet for 30 minutes).
create or replace function public.code_job_claim_t(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j code_jobs;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  select * into j from code_jobs
   where status = 'queued' or (status = 'running' and started_at < now() - interval '30 minutes')
   order by created_at limit 1 for update skip locked;
  if not found then return null; end if;
  update code_jobs set status = 'running', started_at = now(), note = 'Starting' where id = j.id returning * into j;
  return to_jsonb(j);
end $$;

create or replace function public.code_job_update_t(p_token text, p_id uuid, p_note text default null, p_attempts int default null, p_log text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  update code_jobs set note = coalesce(left(p_note, 120), note), attempts = coalesce(p_attempts, attempts),
         log_tail = coalesce(right(p_log, 6000), log_tail), started_at = case when status = 'running' then now() else started_at end
   where id = p_id;
end $$;

create or replace function public.code_job_finish_t(p_token text, p_id uuid, p_status text, p_result jsonb default null, p_log text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  if p_status not in ('done','failed','needs_yes') then raise exception 'bad status'; end if;
  update code_jobs set status = p_status, result = p_result, log_tail = coalesce(right(p_log, 6000), log_tail),
         finished_at = now(), note = null where id = p_id;
end $$;

-- Mac heartbeat. Returns whether the Paid AI switch is on (the worker never reads the switch any other way).
create or replace function public.code_worker_beat_t(p_token text, p_info jsonb default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_paid boolean;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  update code_worker_status set beat_at = now(), info = p_info where id;
  select coalesce(paid_ai_ok, false) into v_paid from scout_settings where id;
  return jsonb_build_object('paid_ai_ok', coalesce(v_paid, false));
end $$;

-- Mac: register the short link bestly.tech/s/<slug> for a deployed site.
create or replace function public.site_link_put_t(p_token text, p_slug text, p_url text, p_job uuid default null) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  insert into site_links (slug, url, job_id) values (p_slug, p_url, p_job)
  on conflict (slug) do update set url = excluded.url, job_id = excluded.job_id;
  return 'https://bestly.tech/s/' || p_slug;
end $$;

-- site-go edge function (service role): slug -> url.
create or replace function public.site_link_get(p_slug text) returns text
language sql security definer set search_path = public as $$
  select url from site_links where slug = lower(p_slug)
$$;
revoke all on function public.site_link_get(text) from public, anon, authenticated;
grant execute on function public.site_link_get(text) to service_role;

revoke all on function public.code_job_claim_t(text), public.code_job_update_t(text,uuid,text,int,text),
  public.code_job_finish_t(text,uuid,text,jsonb,text), public.code_worker_beat_t(text,jsonb),
  public.site_link_put_t(text,text,text,uuid) from public;
grant execute on function public.code_job_claim_t(text), public.code_job_update_t(text,uuid,text,int,text),
  public.code_job_finish_t(text,uuid,text,jsonb,text), public.code_worker_beat_t(text,jsonb),
  public.site_link_put_t(text,text,text,uuid) to anon, authenticated, service_role;

-- Public-key RPCs the Mac calls with the publishable key (token-gated inside): keep the Auto-Fixer off them.
insert into public.security_public_rpcs (fn, why) values
  ('code_job_claim_t', 'Mac Code Worker, gated by db_watchdog_ok'),
  ('code_job_update_t', 'Mac Code Worker, gated by db_watchdog_ok'),
  ('code_job_finish_t', 'Mac Code Worker, gated by db_watchdog_ok'),
  ('code_worker_beat_t', 'Mac Code Worker, gated by db_watchdog_ok'),
  ('site_link_put_t', 'Mac Code Worker, gated by db_watchdog_ok')
on conflict do nothing;
