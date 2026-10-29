-- Claims Closer return gate (2026-10-26), part 1: hold columns, claims_gate, claims_send_ok, claims_sent_violation.
-- Applied from chat on 2026-10-26 as version 20261026160535; this file is the recorded statement.
alter table public.claim_cases
  add column if not exists outbound_hold boolean not null default false,
  add column if not exists outbound_hold_reason text,
  add column if not exists outbound_hold_at timestamptz,
  add column if not exists held_for_gate boolean not null default false;
alter table public.claims_settings add column if not exists gate_effective_at timestamptz not null default now();

create or replace function public.claims_gate(p_case uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $fn$
declare c claim_cases; te timestamptz; hc timestamptz; v_ended boolean; v_live boolean; v_comp boolean; v_done boolean; v_ok boolean;
begin
  select * into c from claim_cases where id = p_case;
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'no case'); end if;
  te := greatest((select t.ends_at from turo_trips t where t.reservation_id = c.reservation_id), c.trip_end);
  select g.host_completed_at into hc from lax_guest_links g where g.reservation_id = c.reservation_id;
  v_ended := te is not null and now() >= te;
  v_live := te is not null and now() < te;
  v_comp := hc is not null;
  -- "first message done": Jared tapped Complete trip, or a compliant message already went out after the trip ended
  v_done := v_comp or (te is not null and exists (select 1 from claim_drafts d where d.case_id = c.id and d.status = 'sent' and d.kind <> 'escalation' and d.sent_at >= te));
  v_ok := v_ended and v_done and not coalesce(c.outbound_hold, false);
  return jsonb_build_object('ok', v_ok, 'live', v_live, 'ended', v_ended, 'completed', v_comp, 'first_done', v_done,
    'hold', coalesce(c.outbound_hold, false), 'trip_end', te, 'completed_at', hc,
    'reason', case when te is null then 'trip end unknown' when v_live then 'trip is still live' when coalesce(c.outbound_hold, false) then 'held by the watchdog'
                   when not v_done then 'waiting for Complete trip' else 'open' end);
end $fn$;

create or replace function public.claims_send_ok(p_case uuid) returns boolean
language sql stable security definer set search_path = public as $fn$
  select coalesce((public.claims_gate(p_case)->>'ok')::boolean, false)
$fn$;

create or replace function public.claims_sent_violation(p_case uuid, p_ts timestamptz, p_self uuid) returns text
language plpgsql stable security definer set search_path = public as $fn$
declare c claim_cases; te timestamptz; hc timestamptz;
begin
  select * into c from claim_cases where id = p_case;
  if c.id is null then return null; end if;
  te := greatest((select t.ends_at from turo_trips t where t.reservation_id = c.reservation_id), c.trip_end);
  select g.host_completed_at into hc from lax_guest_links g where g.reservation_id = c.reservation_id;
  if te is null or p_ts < te then return 'a message reached the guest while the trip was still live'; end if;
  if (hc is null or p_ts < hc) and not exists (select 1 from claim_drafts d2 where d2.case_id = p_case and d2.id <> p_self and d2.status = 'sent'
        and d2.kind <> 'escalation' and d2.sent_at >= te and d2.sent_at < p_ts) then
    return 'the first message reached the guest before you tapped Complete trip';
  end if;
  return null;
end $fn$;
