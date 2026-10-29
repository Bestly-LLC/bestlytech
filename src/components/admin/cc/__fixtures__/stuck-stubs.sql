-- Just enough of the live schema for the stuck-card SQL to run in an in-memory Postgres (PGlite). Test-only; never applied anywhere.
create role anon; create role authenticated; create role service_role;

create schema auth;
create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-0000000000aa'::uuid $$;

create schema cron;
create table cron.job (jobid serial primary key, jobname text, schedule text, command text, active boolean not null default true);

create function public.team_is_admin() returns boolean language sql as $$ select true $$;

create table public.bestly_agents (
  slug text primary key, name text, role text, what_it_does text, dept text, reports_to text, kind text default 'agent',
  status text default 'active', runs_on text, schedule text, admin_url text, pulse jsonb, created_at timestamptz default now());
create table public.agent_beats (slug text primary key, at timestamptz not null default now(), ok boolean, summary text);
create table public.agent_beat_log (id bigserial primary key, slug text, at timestamptz default now(), ok boolean, summary text);
create table public.pi_jobs (job text primary key, enabled boolean not null default true, last_run_at timestamptz, last_ok boolean, last_summary text);
create table public.pi_job_runs (id bigserial primary key, job text, ran_at timestamptz default now(), ok boolean, summary text);
create table public.service_hosts (service text, host text, runner text, unit text, active boolean, present boolean default true, reported_at timestamptz default now());
create table public.monitor_issues (key text primary key, status text);
create table public.admin_chat_threads (id uuid primary key default gen_random_uuid(), user_id uuid, title text, created_at timestamptz default now());
create table public.admin_chat_messages (id uuid primary key default gen_random_uuid(), thread_id uuid, role text, body text, created_at timestamptz default now());
create table public.ava_errands (id uuid primary key default gen_random_uuid());
create table public.notification_owners (prefix text primary key, agent_slug text, note text, created_at timestamptz default now());

create table public.claim_cases (
  id uuid primary key default gen_random_uuid(), status text, history boolean, opened_at timestamptz default now(), guest_first text,
  reservation_id bigint, trip_end timestamptz, outbound_hold boolean, outbound_hold_reason text, outbound_hold_at timestamptz,
  updated_at timestamptz default now(), synced_at timestamptz, needs_work boolean, last_run_at timestamptz, car text, turo_claim_no text,
  work_reason text, next_check_at timestamptz);
create table public.claim_events (id bigserial primary key, case_id uuid, reservation_id bigint, kind text, title text, detail jsonb, mail_id uuid, created_at timestamptz default now());
create table public.turo_trips (reservation_id bigint, ends_at timestamptz);
create table public.lax_guest_links (reservation_id bigint, returned_at timestamptz, settled_at timestamptz, host_completed_at timestamptz);
create table public.turo_reader_state (id int primary key, poke_at timestamptz);

-- what the stubs were asked to do, so tests can look
create table public.test_calls (id bigserial primary key, fn text, args jsonb, at timestamptz default now());
create function public.claims_gate(p uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;
create function public.claims_hold_release(p uuid) returns void language sql as $$ select 1 $$;
create function public.claims_notify(t text, b text, s text, d text) returns void language sql as $$ insert into public.test_calls(fn, args) values ('claims_notify', jsonb_build_object('title', t, 'body', b)) $$;
create function public.invoke_edge_function(function_slug text, payload jsonb default '{}', timeout_ms int default 5000) returns bigint
  language sql as $$ insert into public.test_calls(fn, args) values ('invoke_edge_function', jsonb_build_object('slug', function_slug, 'payload', payload)); select 1::bigint $$;
create function public.notify_route(p_title text, p_body text, p_level text, p_source text, p_url text, p_group text, p_tag text, p_actions jsonb, p_live jsonb, p_clear boolean, p_deliver_at timestamptz) returns void
  language sql as $$ insert into public.test_calls(fn, args) values ('notify_route', jsonb_build_object('title', p_title, 'body', p_body, 'source', p_source, 'tag', p_tag)) $$;
create function public.bestly_raise(p_key text, p_kind text, p_severity text, p_title text, p_body text, p_area text, p_needs_jared text, p_healed boolean) returns void
  language sql as $$ insert into public.test_calls(fn, args) values ('bestly_raise', jsonb_build_object('key', p_key, 'kind', p_kind, 'title', p_title, 'body', p_body)) $$;
create function public.team_beat_bridge() returns jsonb language sql as $$ insert into public.test_calls(fn, args) values ('team_beat_bridge', '{}'); select '{}'::jsonb $$;

-- a stand-in for what pg_cron would run for the Improver's weekly job
create function public.stub_improve() returns void language sql as $$ insert into public.test_calls(fn, args) values ('stub_improve', '{}') $$;
