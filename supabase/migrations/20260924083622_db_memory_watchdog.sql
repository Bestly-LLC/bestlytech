-- DB memory watchdog + load shedding (2026-09-24, after two freezes: Sep 23 ~4-10:35 AM PT and Sep 24 1:05-1:28 AM PT).
-- Cause: Nano compute (~0.43 GB RAM) swapping ~0.4-0.5 GB; under a spike Postgres stalls (IO wait) until restarted.
-- Every 5 min: read the project's Prometheus metrics (MemAvailable, swap, load), keep a history, and
--   * pressure (low free memory + heavy swap, twice in a row) -> pause non-essential cron jobs (never guest-facing ones),
--     tell Scout; resume them after 30 min without pressure.
create table if not exists public.db_metrics (
  at timestamptz primary key default now(), mem_total_mb int, mem_avail_mb int, swap_used_mb int, load1 numeric, backends int);
alter table public.db_metrics enable row level security;
create table if not exists public.db_watch_state (
  id int primary key default 1 check (id = 1), pending_req bigint, pressure_streak int default 0,
  shed_at timestamptz, shed_jobs text[] default '{}', last_ok_at timestamptz, updated_at timestamptz default now());
insert into public.db_watch_state(id) values (1) on conflict do nothing;
alter table public.db_watch_state enable row level security;

-- Non-essential jobs that may pause under memory pressure. Guest/trip, email, Tesla, Stripe, security and watchdogs are NOT here.
create or replace function public.db_shed_candidates() returns text[] language sql immutable as $$
  select array['studio-drift-check','social-autoconnect','social-drain-instagram','shop-sync-pull','shop-notify-sweep',
    'cy-autofix-sweep','validate-ai-patterns','render-missed-banners','ai-generate-patterns','process-dismissal-consensus',
    'pattern-maintenance','scout-reflect','client-feedback-watch','ops-learn','posting-pause-tick','free-llm-watch',
    'todo-check-drain','mac-mail-drain','clips-watch','studio-mail-gap-check']::text[] $$;

create or replace function public.db_memory_watch() returns jsonb
language plpgsql security definer set search_path = public, extensions, vault, cron as $$
declare st db_watch_state; r record; body text; m_total numeric; m_avail numeric; s_total numeric; s_free numeric; l1 numeric; nb numeric;
  pressure boolean := false; k text; paused text[] := '{}';
begin
  select * into st from db_watch_state where id = 1 for update;
  -- 1. read the previous sample
  if st.pending_req is not null then
    select status_code, content into r from net._http_response where id = st.pending_req;
    if r.status_code = 200 then
      body := r.content;
      m_total := substring(body from 'node_memory_MemTotal_bytes\{[^}]*\} ([0-9.e+]+)')::numeric;
      m_avail := substring(body from 'node_memory_MemAvailable_bytes\{[^}]*\} ([0-9.e+]+)')::numeric;
      s_total := substring(body from 'node_memory_SwapTotal_bytes\{[^}]*\} ([0-9.e+]+)')::numeric;
      s_free  := substring(body from 'node_memory_SwapFree_bytes\{[^}]*\} ([0-9.e+]+)')::numeric;
      l1      := substring(body from 'node_load1\{[^}]*\} ([0-9.e+]+)')::numeric;
      nb      := substring(body from 'pg_stat_database_num_backends\{[^}]*\} ([0-9.e+]+)')::numeric;
      if m_total is not null then
        insert into db_metrics(mem_total_mb, mem_avail_mb, swap_used_mb, load1, backends)
        values ((m_total/1048576)::int, (m_avail/1048576)::int, ((s_total - s_free)/1048576)::int, l1, nb::int)
        on conflict (at) do nothing;
        -- pressure: under 12% RAM free AND over 60% of swap in use, or load > 8 on this 2-core box
        pressure := (m_avail < m_total * 0.12 and (s_total - s_free) > s_total * 0.6) or l1 > 8;
      end if;
    end if;
  end if;

  if pressure then
    update db_watch_state set pressure_streak = pressure_streak + 1 where id = 1;
    select * into st from db_watch_state where id = 1;
    if st.pressure_streak >= 2 and st.shed_at is null then
      foreach k in array db_shed_candidates() loop
        if exists (select 1 from cron.job where jobname = k and active) then
          perform cron.alter_job(job_id := (select jobid from cron.job where jobname = k), active := false);
          paused := paused || k;
        end if;
      end loop;
      update db_watch_state set shed_at = now(), shed_jobs = paused where id = 1;
      perform scout_notify(p_title := 'Database low on memory: paused background jobs',
        p_body := format('Free memory %s MB, swap %s MB, load %s. Paused %s non-essential jobs; guest trips, email, Tesla and payments keep running. They resume by themselves after 30 calm minutes.',
          (m_avail/1048576)::int, ((s_total - s_free)/1048576)::int, round(l1,1), coalesce(array_length(paused,1),0)),
        p_severity := 'warning', p_push := true, p_url := '/admin', p_dedupe := 'dbshed.' || to_char(now(),'YYYYMMDDHH24'));
    end if;
  elsif m_total is not null then
    update db_watch_state set pressure_streak = 0, last_ok_at = now() where id = 1;
    select * into st from db_watch_state where id = 1;
    if st.shed_at is not null and st.shed_at < now() - interval '30 minutes' then
      foreach k in array st.shed_jobs loop
        if exists (select 1 from cron.job where jobname = k) then
          perform cron.alter_job(job_id := (select jobid from cron.job where jobname = k), active := true);
        end if;
      end loop;
      update db_watch_state set shed_at = null, shed_jobs = '{}' where id = 1;
      perform scout_notify(p_title := 'Database memory is fine again: background jobs resumed',
        p_severity := 'info', p_push := false, p_url := '/admin', p_dedupe := 'dbunshed.' || to_char(now(),'YYYYMMDDHH24'));
    end if;
  end if;

  -- 2. ask for the next sample
  update db_watch_state set updated_at = now(), pending_req = net.http_get(
    url := 'https://rcqfqhguwpmaarseifqg.supabase.co/customer/v1/privileged/metrics',
    headers := jsonb_build_object('Authorization', 'Basic ' || encode(convert_to('service_role:' ||
      (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'), 'UTF8'), 'base64')),
    timeout_milliseconds := 20000) where id = 1;
  delete from db_metrics where at < now() - interval '14 days';
  return jsonb_build_object('pressure', pressure, 'avail_mb', (m_avail/1048576)::int, 'swap_mb', ((s_total - s_free)/1048576)::int, 'load1', l1, 'paused', paused);
end $$;
revoke all on function public.db_memory_watch() from public, anon, authenticated;
select cron.schedule('db-memory-watch', '*/5 * * * *', 'select public.db_memory_watch()');
select public.db_memory_watch();
