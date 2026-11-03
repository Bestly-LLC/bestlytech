-- Claims Closer autonomy build, part 1 of 2: tables, columns, settings. Additive only. NOT APPLIED (branch claims-closer-autonomy-2026-10-28).
-- Approved by Jared Wed 2026-10-28 1:42 PM PT ("build, auto-complete on"); scope extended 1:43 PM and 1:45 PM PT (items 9 to 12 and defaults).
-- Undo: supabase/undo/claims-closer-autonomy-2026-10-28.undo.sql

-- ---------------------------------------------------------------------------------------------------------------- settings
-- One row. Every switch Jared answered lives here so a setting, not a deploy, changes behaviour.
create table if not exists public.claims_autonomy_settings (
  id boolean primary key default true check (id),
  insurer_contact_mode text not null default 'full' check (insurer_contact_mode in ('draft_only', 'full')),  -- Jared 1:45 PM: full
  booking_mode text not null default 'auto' check (booking_mode in ('auto', 'confirm')),                     -- Jared 1:45 PM: auto
  min_accept_pct numeric not null default 100 check (min_accept_pct between 1 and 100),                      -- Jared 1:45 PM: 100, anything lower is his call
  auto_complete boolean not null default true,                                                               -- Jared 1:42 PM: ON
  auto_complete_fresh_min integer not null default 30 check (auto_complete_fresh_min between 5 and 240),    -- car reading must be this fresh
  home_lat double precision not null default 34.084241,    -- 733 N Kings Rd, West Hollywood (home_pickup_settings)
  home_lng double precision not null default -118.371793,
  home_radius_m integer not null default 250,
  lax_lat double precision not null default 33.94159,      -- LAX Park My Share garage (the LAX pickup point on turo_trips)
  lax_lng double precision not null default -118.40853,
  lax_radius_m integer not null default 600,
  hold_autorelease boolean not null default true,
  nudge_hours integer not null default 24,
  scout_hours integer not null default 48,
  stuck_hours integer not null default 48,
  booking_buffer_hours integer not null default 4,         -- gap kept between a repair and any booked Turo trip
  deadline_lead_hours integer not null default 72,         -- act this far ahead of a Turo window
  updated_at timestamptz not null default now()
);
insert into public.claims_autonomy_settings (id) values (true) on conflict (id) do nothing;
alter table public.claims_autonomy_settings enable row level security;

-- admin-guarded setter (the pattern from CLAUDE.md: numbers get a bounded *_set RPC, not hand-written SQL)
create or replace function public.claims_autonomy_set(p_key text, p_value text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_key = 'insurer_contact_mode' and p_value in ('draft_only', 'full') then update claims_autonomy_settings set insurer_contact_mode = p_value, updated_at = now() where id;
  elsif p_key = 'booking_mode' and p_value in ('auto', 'confirm') then update claims_autonomy_settings set booking_mode = p_value, updated_at = now() where id;
  elsif p_key = 'min_accept_pct' and p_value::numeric between 1 and 100 then update claims_autonomy_settings set min_accept_pct = p_value::numeric, updated_at = now() where id;
  elsif p_key = 'auto_complete' and p_value in ('true', 'false') then update claims_autonomy_settings set auto_complete = p_value::boolean, updated_at = now() where id;
  elsif p_key = 'hold_autorelease' and p_value in ('true', 'false') then update claims_autonomy_settings set hold_autorelease = p_value::boolean, updated_at = now() where id;
  elsif p_key = 'booking_buffer_hours' and p_value::int between 0 and 72 then update claims_autonomy_settings set booking_buffer_hours = p_value::int, updated_at = now() where id;
  else return jsonb_build_object('ok', false, 'error', 'unknown key or value out of range'); end if;
  return jsonb_build_object('ok', true, 'key', p_key, 'value', p_value);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- columns
alter table public.claim_questions add column if not exists nudged_at timestamptz;      -- the one 24 h nudge, signed Claims Closer
alter table public.claim_questions add column if not exists scout_at timestamptz;       -- handed to Scout after 48 h
alter table public.claim_questions add column if not exists self_answered boolean not null default false;
alter table public.claim_questions add column if not exists meta jsonb not null default '{}'::jsonb;   -- {estimate_id, shop_id, asks_for}: what a shop question was about
alter table public.claim_questions add column if not exists retired_at timestamptz;                      -- stale (over 7 days, the world moved on): retired, never acted on
alter table public.claim_questions add column if not exists retired_reason text;
alter table public.claim_questions add column if not exists snoozed_until timestamptz;                   -- Jared answered "Wait": ask again then
alter table public.claim_cases add column if not exists last_progress_at timestamptz;   -- stuck alert clock (kept by the triggers below)
alter table public.claim_cases add column if not exists stuck_alert_at timestamptz;
alter table public.lax_guest_links add column if not exists host_completed_source text;  -- 'auto' when Claims Closer tapped Complete trip itself
alter table public.lax_guest_links add column if not exists host_completed_evidence jsonb;

-- a shop whose thread Claims Closer closed on Jared's instruction ("Drop this shop")
alter table public.claim_estimates drop constraint if exists claim_estimates_status_check;
alter table public.claim_estimates add constraint claim_estimates_status_check
  check (status = any (array['requested','replied','received','declined','no_reply','needs_visit','closed']));

-- ---------------------------------------------------------------------------------------------------------------- the send chokepoint log (2026-10-28)
-- Every outbound path (email, Ava call, Turo action, insurer) asks canSend() first (supabase/functions/claims-closer/send.ts); every decision lands here.
-- (claim_block_log is another system's marketing-claims gate for client copy; it is not used for Claims Closer.)
create table if not exists public.claims_send_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  case_id uuid references public.claim_cases(id) on delete set null,
  reservation_id bigint,
  channel text not null,
  recipient text,
  purpose text not null,
  decision text not null check (decision in ('allowed', 'blocked', 'sent', 'failed')),
  code text,
  reason text,
  excerpt text,
  key text,
  result jsonb
);
create index if not exists claims_send_log_case_idx on public.claims_send_log (case_id, at desc);
create index if not exists claims_send_log_blocked_idx on public.claims_send_log (at desc) where decision = 'blocked';
alter table public.claims_send_log enable row level security;

-- ---------------------------------------------------------------------------------------------------------------- deadline store (item 2)
create table if not exists public.claim_windows (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.claim_cases(id) on delete cascade,
  kind text not null check (kind in ('estimate_share', 'resolve_directly', 'invoice_expiry', 'turo_claim_filing', 'turo_next_action', 'insurer_exception')),
  due_at timestamptz not null,
  source text not null,                       -- which Turo mail / sync field / rule this came from
  note text,
  status text not null default 'open' check (status in ('open', 'met', 'lapsed', 'moot')),
  acted_at timestamptz,                       -- when the engine last acted on this window
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (case_id, kind)
);
create index if not exists claim_windows_due_idx on public.claim_windows (due_at) where status = 'open';
alter table public.claim_windows enable row level security;

-- the path choice log (item 12): what it chose and why
create table if not exists public.claim_decisions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.claim_cases(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null default 'path',
  chosen text not null,
  why text not null,
  options jsonb not null default '[]'::jsonb,
  inputs jsonb not null default '{}'::jsonb
);
create index if not exists claim_decisions_case_idx on public.claim_decisions (case_id, at desc);
alter table public.claim_decisions enable row level security;

-- ---------------------------------------------------------------------------------------------------------------- money in (item 11)
create table if not exists public.claim_payments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid references public.claim_cases(id) on delete set null,
  source text not null check (source in ('turo_payout', 'insurer_check', 'mercury_deposit', 'guest_invoice', 'manual')),
  amount numeric not null check (amount > 0),
  received_at timestamptz not null default now(),
  reference text,                              -- Turo receipt id, check number, Mercury transaction id
  evidence jsonb not null default '{}'::jsonb,
  matched boolean not null default false,
  counted boolean not null default false,      -- true once it was added to claim_cases.recovered_amount
  created_at timestamptz not null default now(),
  unique (source, reference)
);
alter table public.claim_payments enable row level security;

-- ---------------------------------------------------------------------------------------------------------------- guest-insurer track (item 9)
create table if not exists public.claim_insurer_track (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null unique references public.claim_cases(id) on delete cascade,
  insurer_name text,
  policy_no text,
  policy_holder text,
  claim_no text,
  adjuster_name text,
  adjuster_email text,
  adjuster_phone text,
  state text not null default 'identified' check (state in ('identified', 'claim_opening', 'claim_open', 'estimate_sent', 'awaiting_payment', 'paid', 'denied', 'stalled')),
  last_contact_at timestamptz,
  last_inbound_at timestamptz,
  next_chase_at timestamptz,
  chase_count integer not null default 0,
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.claim_insurer_track enable row level security;

-- outside claims (Kemper-style): a claim against someone else's insurer on a loss that is not a Turo damage case.
create table if not exists public.claim_outside_claims (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  insurer_name text not null,
  claim_no text not null,
  adjuster_name text,
  adjuster_email text,
  adjuster_phone text,
  amount_expected numeric,
  reply_due_at timestamptz,
  state text not null default 'open' check (state in ('open', 'awaiting_payment', 'paid', 'closed')),
  next_chase_at timestamptz,
  chase_count integer not null default 0,
  last_contact_at timestamptz,
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (insurer_name, claim_no)
);
alter table public.claim_outside_claims enable row level security;

-- the audit trail for the auto Complete trip (item 8)
create table if not exists public.claim_trip_complete_log (
  id bigserial primary key,
  reservation_id bigint not null,
  case_id uuid,
  at timestamptz not null default now(),
  source text not null default 'auto',
  evidence jsonb not null default '{}'::jsonb
);
alter table public.claim_trip_complete_log enable row level security;

-- Vera (Privacy Clerk) deletes or blanks personal data only from this map (CLAUDE.md rule)
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason, enabled) values
  ('claim_insurer_track', 'adjuster_email', 'email', 'review', 'Your call', true),
  ('claim_insurer_track', 'adjuster_phone', 'phone', 'review', 'Your call', true),
  ('claim_outside_claims', 'adjuster_email', 'email', 'review', 'Your call', true),
  ('claim_outside_claims', 'adjuster_phone', 'phone', 'review', 'Your call', true),
  ('claims_send_log', 'recipient', 'email', 'review', 'Your call', true)
on conflict do nothing;

-- ---------------------------------------------------------------------------------------------------------------- progress clock (item 7)
-- "Forward progress" = a new estimate, a sent message, a Turo change, a state change, a booking, a payment. Everything else is noise.
create or replace function public.claims_event_is_progress(p_kind text, p_title text, p_detail jsonb)
returns boolean language sql immutable as $$
  select p_kind in ('sent', 'estimate_chosen', 'booking', 'payment', 'state', 'insurer', 'turo', 'closed', 'third_party')
      or (p_kind = 'estimate' and coalesce(p_title, '') ~* ' quoted ')
      or coalesce(p_detail ->> 'progress', '') = 'true'
$$;

create or replace function public.claims_progress_event_trg() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.case_id is not null and claims_event_is_progress(new.kind, new.title, new.detail) then
    update claim_cases set last_progress_at = greatest(coalesce(last_progress_at, 'epoch'), new.at) where id = new.case_id;
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists claims_progress_event on public.claim_events;
create trigger claims_progress_event after insert on public.claim_events for each row execute function public.claims_progress_event_trg();

create or replace function public.claims_progress_case_trg() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status is distinct from old.status or new.turo_status is distinct from old.turo_status or new.turo_next_action is distinct from old.turo_next_action
     or new.estimate_amount is distinct from old.estimate_amount or new.chosen_estimate_id is distinct from old.chosen_estimate_id
     or new.recovered_amount is distinct from old.recovered_amount or new.path is distinct from old.path
     or new.repair_booking ->> 'state' is distinct from old.repair_booking ->> 'state' then
    new.last_progress_at := now();
  end if;
  return new;
end $$;
drop trigger if exists claims_progress_case on public.claim_cases;
create trigger claims_progress_case before update on public.claim_cases for each row execute function public.claims_progress_case_trg();

-- seed the clock from history so nothing looks brand new or ancient
update public.claim_cases c set last_progress_at = coalesce(
  (select max(e.at) from public.claim_events e where e.case_id = c.id and public.claims_event_is_progress(e.kind, e.title, e.detail)), c.opened_at)
where c.last_progress_at is null;
