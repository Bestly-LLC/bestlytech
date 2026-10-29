-- Loaded AFTER stuck-stubs.sql and BEFORE the stuck migrations: the rest of the live schema the Insurance Filer touches, in an in-memory
-- Postgres (PGlite). Test-only; never applied anywhere. Only the columns the SQL reads are here.
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);

create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint
  language sql as $$ insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command); select 1::bigint $$;

create table public.bestly_memory (id bigserial primary key, area text, key text unique, title text, body text, kind text, tags text[], source text, pinned boolean, active boolean, written_by text);
create table public.privacy_data_map (table_name text not null, column_name text not null, match_kind text not null, action text not null, reason text, enabled boolean not null default true, primary key (table_name, column_name));
create table public.security_public_rpcs (fn text primary key, why text);

-- claim_cases / claim_events / turo_trips / ava_errands: the stuck stubs have a few columns; add the rest (live names)
alter table public.claim_cases add column guest_last text, add column vin text, add column insurer jsonb, add column damage_report jsonb, add column guest_response jsonb,
  add column turo_incident_id bigint, add column host_responsibility numeric, add column estimate_amount numeric, add column invoices jsonb not null default '[]'::jsonb,
  add column escalate_by timestamptz;
alter table public.claim_events add column at timestamptz not null default now();
alter table public.turo_trips add column guest_first text, add column guest_last text, add column guest_phone text, add column vin text, add column raw jsonb;
alter table public.ava_errands add column title text, add column who text, add column phone text, add column details text, add column due_by date,
  add column status text not null default 'open' check (status in ('open', 'calling', 'done', 'cancelled')), add column last_call_id text,
  add column created_at timestamptz not null default now(), add column done_at timestamptz;

create table public.bestly_mail (
  id uuid primary key default gen_random_uuid(), mailbox text, folder text, uid bigint, message_id text, from_addr text, from_name text, to_addrs text[],
  subject text, sent_at timestamptz, body_text text, has_attach boolean default false, seen boolean default false, raw_headers jsonb, ingested_at timestamptz not null default now());

-- helpers the live database already has
create function public.admin_require_admin() returns void language sql as $$ select 1 $$;
create function public.db_watchdog_ok(p_token text) returns boolean language sql as $$ select p_token = 'good-mac' $$;
create function public.tesla_worker_ok(p_token text) returns boolean language sql as $$ select p_token = 'good-pi' $$;
create function public.get_home_hub_agent_key() returns text language sql as $$ select 'hub-key' $$;
create function public.agent_beat(p_slug text, p_ok boolean default true, p_summary text default null, p_token text default null) returns jsonb
  language sql as $$ insert into public.test_calls(fn, args) values ('agent_beat', jsonb_build_object('slug', p_slug, 'ok', p_ok, 'summary', p_summary)); select '{}'::jsonb $$;
create function public.claims_open_case(p_res bigint, p_path text, p_mail uuid, p_at timestamptz) returns void language sql as $$ select 1 $$;
create function public.team_onboard(p jsonb) returns integer
  language sql as $$ insert into public.test_calls(fn, args) values ('team_onboard', p); select jsonb_array_length(p) $$;

-- bestly_raise as it is live: defaults on the last arguments, returns jsonb (the stuck stub has 8 required args and returns void)
drop function public.bestly_raise(text, text, text, text, text, text, text, boolean);
create function public.bestly_raise(p_key text, p_kind text, p_severity text default 'warning', p_title text default null, p_body text default null, p_area text default null,
                                    p_needs_jared text default null, p_healed boolean default false) returns jsonb
  language sql as $$ insert into public.test_calls(fn, args) values ('bestly_raise', jsonb_build_object('key', p_key, 'kind', p_kind, 'title', p_title, 'body', p_body)); select '{}'::jsonb $$;
