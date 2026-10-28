-- Just enough of production for the autonomy migrations to run in PGlite (test-only). Shapes copied from the live database on 2026-10-28.
create schema if not exists auth;
create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
create function public.has_role(u uuid, r text) returns boolean language sql as $$ select true $$;

create table public.privacy_data_map (id serial primary key, table_name text, column_name text, match_kind text, action text, reason text, enabled boolean default true);

create table public.claim_shops (id uuid primary key default gen_random_uuid(), slug text unique, name text not null, address text, phone text, email text, website text, booking_url text,
  lat double precision, lng double precision, distance_mi numeric, rating numeric, rating_count int, tesla_experience boolean not null default false, photo_estimates boolean not null default true,
  oem_capable boolean not null default false, oem_only boolean not null default false, warranty text, notes text, active boolean not null default true, used_before boolean not null default false, contact_name text);

create table public.claim_cases (id uuid primary key default gen_random_uuid(), reservation_id bigint unique, guest_first text, guest_last text, vin text, trip_end timestamptz, path text, status text not null default 'open',
  goal text, opened_at timestamptz not null default now(), estimate_due_at timestamptz, escalate_by timestamptz, estimate_amount numeric, guest_max numeric, insurer jsonb not null default '{}', invoices jsonb not null default '[]',
  facts text, follow_up_at timestamptz, needs_work boolean not null default false, work_reason text, last_run_at timestamptz, last_daily_at date, opened_from_mail uuid, updated_at timestamptz not null default now(),
  turo_claim_no text, turo_incident_id bigint, car text, host_responsibility numeric, recovered_amount numeric, outcome text, history boolean not null default false, closed_at timestamptz, turo_status text,
  turo_next_action text, turo_deadline timestamptz, invoice_max numeric, turo_invoice jsonb, synced_at timestamptz, chosen_shop_id uuid, chosen_estimate_id uuid, estimates_requested_at timestamptz,
  repair_booking jsonb, next_check_at timestamptz, outbound_hold boolean not null default false, outbound_hold_reason text, outbound_hold_at timestamptz, held_for_gate boolean);

create table public.claim_events (id uuid primary key default gen_random_uuid(), case_id uuid, reservation_id bigint, at timestamptz not null default now(), kind text not null, title text not null, detail jsonb, mail_id uuid);
create table public.claim_drafts (id uuid primary key default gen_random_uuid(), case_id uuid, reservation_id bigint, kind text, status text default 'pending', body text, sent_at timestamptz, created_at timestamptz default now());
create table public.claim_questions (id uuid primary key default gen_random_uuid(), case_id uuid, key text, kind text not null, question text not null, options jsonb not null default '[]', answer text,
  asked_at timestamptz not null default now(), answered_at timestamptz, answered_by text, handled_at timestamptz);
create table public.claim_estimates (id uuid primary key default gen_random_uuid(), case_id uuid, shop_id uuid, channel text, ref text, status text, requested_at timestamptz default now(), replied_at timestamptz,
  amount numeric, oem boolean, repair_vs_replace text, line_items jsonb, notes text, chosen boolean default false, mail_id uuid,
  constraint claim_estimates_channel_check check (channel = any (array['email','call','web','walk_in'])),
  constraint claim_estimates_status_check check (status = any (array['requested','replied','received','declined','no_reply','needs_visit'])));

create table public.turo_trips (reservation_id bigint primary key, starts_at timestamptz, ends_at timestamptz, vin text, status text);
create table public.lax_guest_links (reservation_id bigint primary key, token text, returned_at timestamptz, settled_at timestamptz, host_completed_at timestamptz);
create table public.turo_vehicle_state (vin text primary key, display_name text, latitude double precision, longitude double precision, charging_state text, plugged_in boolean, connection_state text, observed_at timestamptz, raw jsonb);
create table public.car_drives (id serial primary key, vin text, started_at timestamptz, ended_at timestamptz);
create table public.car_place (vin text, label text);
create table public.bestly_mail (id uuid primary key default gen_random_uuid(), from_addr text, subject text, body_text text, sent_at timestamptz default now(), has_attach boolean default false);
create table public.turo_reader_state (id int primary key, poke_at timestamptz, signed_in boolean);
insert into public.turo_reader_state values (1, null, true);
create table public.hermes_items (id uuid primary key default gen_random_uuid(), amount_cents int, is_test boolean default false, created_at timestamptz default now(), mail_type text, summary text, sender text, from_domain text, details jsonb, received_at timestamptz default now());

-- observability stubs: every alert lands in test_notices so tests can read what Jared / Scout would be told
create table public.test_notices (id serial primary key, via text, title text, body text, severity text, dedupe text);
create table public.test_calls (id serial primary key, fn text, payload jsonb);
create function public.claims_notify(p_title text, p_body text default null, p_severity text default 'info', p_dedupe text default null) returns text language plpgsql as $$
begin
  if p_dedupe is not null and exists (select 1 from test_notices where dedupe = p_dedupe) then return 'duplicate'; end if;
  insert into test_notices (via, title, body, severity, dedupe) values ('jared', p_title, p_body, p_severity, p_dedupe); return 'ok'; end $$;
create function public.scout_notify(p_title text, p_body text, p_sev text, p_flag boolean, p_url text, p_dedupe text) returns void language plpgsql as $$
begin insert into test_notices (via, title, body, severity, dedupe) values ('scout', p_title, p_body, p_sev, p_dedupe); end $$;
create function public.bestly_raise(p_key text, p_kind text, p_severity text, p_title text, p_body text, p_area text, p_needs_jared text, p_healed boolean) returns void language plpgsql as $$
begin insert into test_notices (via, title, body, severity, dedupe) values ('raise:' || p_kind, p_title, p_body, p_severity, p_key); end $$;
create function public.invoke_edge_function(p_fn text, p_body jsonb, p_timeout int) returns void language plpgsql as $$ begin insert into test_calls (fn, payload) values (p_fn, p_body); end $$;
create function public.agent_beat(p_slug text, p_ok boolean, p_summary text) returns void language plpgsql as $$ begin insert into test_calls (fn, payload) values ('agent_beat', jsonb_build_object('ok', p_ok, 'summary', p_summary)); end $$;
create function public.tesla_worker_ok(p text) returns boolean language sql as $$ select true $$;
create function public.claims_ask(p_case uuid, p_question text, p_options jsonb default '[]', p_key text default null, p_kind text default 'decision') returns uuid language plpgsql as $$
declare v uuid; begin insert into claim_questions (case_id, key, kind, question, options) values (p_case, p_key, p_kind, p_question, p_options) returning id into v; return v; end $$;
create function public.claims_res_from_mail(p_subject text, p_body text) returns bigint language sql as $$ select nullif(substring(coalesce(p_subject,'') || ' ' || coalesce(p_body,'') from '(?:reservation[/ #]*|res )(\d{7,9})'), '')::bigint $$;
create function public.claims_open_case(p_res bigint, p_path text, p_mail uuid, p_at timestamptz) returns uuid language plpgsql as $$
declare v uuid; begin insert into claim_cases (reservation_id, path, opened_at) values (p_res, p_path, p_at) returning id into v; return v; end $$;
-- verbatim from production
create function public.claims_gate(p_case uuid) returns jsonb language plpgsql stable as $$
declare c claim_cases; te timestamptz; hc timestamptz; v_ended boolean; v_live boolean; v_comp boolean; v_done boolean; v_ok boolean;
begin
  select * into c from claim_cases where id = p_case;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'no case'); end if;
  te := greatest((select t.ends_at from turo_trips t where t.reservation_id = c.reservation_id), c.trip_end);
  select g.host_completed_at into hc from lax_guest_links g where g.reservation_id = c.reservation_id;
  v_ended := te is not null and now() >= te;
  v_live := te is not null and now() < te;
  v_comp := hc is not null;
  v_done := v_comp or (te is not null and exists (select 1 from claim_drafts d where d.case_id = c.id and d.status = 'sent' and d.kind <> 'escalation' and d.sent_at >= te));
  v_ok := v_ended and v_done and not coalesce(c.outbound_hold, false);
  return jsonb_build_object('ok', v_ok, 'live', v_live, 'ended', v_ended, 'completed', v_comp, 'first_done', v_done,
    'hold', coalesce(c.outbound_hold, false), 'trip_end', te, 'completed_at', hc,
    'reason', case when te is null then 'trip end unknown' when v_live then 'trip is still live' when coalesce(c.outbound_hold, false) then 'held by the watchdog'
                   when not v_done then 'waiting for Complete trip' else 'open' end);
end $$;
create function public.claims_gate_sweep() returns jsonb language plpgsql as $$ begin return jsonb_build_object(); end $$;

-- roles and allowlist the hardening block touches
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create table if not exists public.security_public_rpcs (fn text primary key, why text);
create table if not exists public.settlement_unmatched_bank (id bigserial primary key, txn_id text unique, amount_cents integer, posted_at timestamptz, counterparty text, description text, why text, resolved boolean not null default false, created_at timestamptz not null default now());
create table if not exists public.claim_turo_actions (id uuid primary key default gen_random_uuid(), case_id uuid, kind text, payload jsonb default '{}', status text default 'queued', attempts int default 0, claimed_at timestamptz, created_at timestamptz default now(), error text, done_at timestamptz);
