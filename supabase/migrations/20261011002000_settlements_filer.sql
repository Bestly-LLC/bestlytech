-- Nickel's Claim Filer (Mac mini, launchd tech.bestly.settlement-filer), 2026-10-10.
-- Adds: Jared's saved claim details (settlement_profile), the profile RPCs, the filer's heartbeat wrapper, and the team card.
-- No DROP / UPDATE / DELETE at top level (they auto-cancel from chat); the one seed row goes in through a function.
--
-- SWORN STATEMENT RULE: the filer only ever touches claims in status 'approved' (settlement_take_approved_t). Jared's saved
-- details must be CONFIRMED by him (confirmed_at) and complete (street, city, state, zip) before it files anything.
-- Never stored here: bank account/routing numbers, card numbers, SSN or any government ID. Payouts are PayPal, Venmo or check.

create table if not exists public.settlement_profile (
  id boolean primary key default true check (id),
  full_name text,
  email text,
  phone text,
  street text,
  unit text,
  city text,
  state text,
  zip text,
  payout_pref text check (payout_pref in ('paypal', 'venmo', 'check')),
  paypal_email text,
  venmo_handle text,
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.settlement_profile enable row level security;
-- No policies: the Settlements page reads and writes through the admin RPCs; the Mac filer reads through settlement_profile_t.

-- One-time seed (idempotent). Only what Jared already told us; address stays empty and confirmed_at stays NULL
-- until he fills it in and confirms on /admin/settlements.
create or replace function public.settlement_profile_seed() returns void
language sql security definer set search_path = public as $$
  insert into settlement_profile (id, full_name, phone, email, payout_pref, paypal_email, confirmed_at)
  values (true, 'Jared Best', '+1 816-500-7236', 'jaredbest@icloud.com', 'paypal', null, null)
  on conflict (id) do nothing;
$$;
revoke all on function public.settlement_profile_seed() from public, anon, authenticated;
select public.settlement_profile_seed();

-- Admin: read the saved details ({} when none).
create or replace function public.settlement_profile_get() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  select to_jsonb(p) - 'id' into v from settlement_profile p where id;
  return coalesce(v, '{}'::jsonb);
end $$;

-- Admin: upsert only the fields present in p (empty string clears a field). {"confirm": true} stamps confirmed_at = now();
-- {"confirm": false} clears it. Returns the saved row.
create or replace function public.settlement_profile_set(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb; v_pref text;
begin
  if not team_is_admin() then raise exception 'admin only'; end if;
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'send an object'; end if;
  if p ? 'payout_pref' then
    v_pref := nullif(lower(trim(p->>'payout_pref')), '');
    if v_pref is not null and v_pref not in ('paypal', 'venmo', 'check') then raise exception 'payout_pref must be paypal, venmo or check'; end if;
  end if;
  insert into settlement_profile (id) values (true) on conflict (id) do nothing;
  update settlement_profile s set
    full_name    = case when p ? 'full_name'    then nullif(trim(p->>'full_name'), '')    else s.full_name end,
    email        = case when p ? 'email'        then nullif(trim(p->>'email'), '')        else s.email end,
    phone        = case when p ? 'phone'        then nullif(trim(p->>'phone'), '')        else s.phone end,
    street       = case when p ? 'street'       then nullif(trim(p->>'street'), '')       else s.street end,
    unit         = case when p ? 'unit'         then nullif(trim(p->>'unit'), '')         else s.unit end,
    city         = case when p ? 'city'         then nullif(trim(p->>'city'), '')         else s.city end,
    state        = case when p ? 'state'        then nullif(upper(trim(p->>'state')), '') else s.state end,
    zip          = case when p ? 'zip'          then nullif(trim(p->>'zip'), '')          else s.zip end,
    payout_pref  = case when p ? 'payout_pref'  then v_pref                               else s.payout_pref end,
    paypal_email = case when p ? 'paypal_email' then nullif(trim(p->>'paypal_email'), '') else s.paypal_email end,
    venmo_handle = case when p ? 'venmo_handle' then nullif(trim(p->>'venmo_handle'), '') else s.venmo_handle end,
    confirmed_at = case when p ? 'confirm' and lower(p->>'confirm') in ('true', 't', '1') then now()
                        when p ? 'confirm' and lower(p->>'confirm') in ('false', 'f', '0') then null
                        else s.confirmed_at end,
    updated_at   = now()
  where s.id;
  select to_jsonb(x) - 'id' into v from settlement_profile x where id;
  return v;
end $$;

-- Mac filer: read the details with the house watchdog token.
create or replace function public.settlement_profile_t(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  select to_jsonb(p) - 'id' into v from settlement_profile p where id;
  return coalesce(v, '{}'::jsonb);
end $$;

-- Mac filer heartbeat -> Team page (agent_beat only takes an admin or the home-hub key, so the token wrapper makes the call).
create or replace function public.settlement_filer_beat_t(p_token text, p_ok boolean default true, p_summary text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not db_watchdog_ok(p_token) then raise exception 'not allowed'; end if;
  return agent_beat('settlement-filer', coalesce(p_ok, true), left(p_summary, 500), get_home_hub_agent_key());
end $$;

revoke all on function public.settlement_profile_get() from public, anon;
revoke all on function public.settlement_profile_set(jsonb) from public, anon;
grant execute on function public.settlement_profile_get() to authenticated, service_role;
grant execute on function public.settlement_profile_set(jsonb) to authenticated, service_role;

revoke all on function public.settlement_profile_t(text), public.settlement_filer_beat_t(text, boolean, text) from public;
grant execute on function public.settlement_profile_t(text), public.settlement_filer_beat_t(text, boolean, text) to anon, authenticated, service_role;

-- Public-key RPCs the Mac calls with the publishable key (token-gated inside): keep the Auto-Fixer off them.
insert into public.security_public_rpcs (fn, why) values
  ('settlement_profile_t', 'Mac mini settlement filer (watchdog token)'),
  ('settlement_filer_beat_t', 'Mac mini settlement filer heartbeat (watchdog token)')
on conflict (fn) do nothing;

-- House rule: every bot gets a team card the day it goes live. Beat gap 90 min (the run is every 30 min, so 3 missed runs alert Scout).
select public.team_onboard($j$[
 {"slug":"settlement-filer","name":"Claim Filer","role":"Files the claims you approve","tool_of":"settlements","runs_on":"mac-mini","icon":"file-check","schedule":"Every 30 min",
  "what_it_does":"Fills in and submits the class action claims you said yes to, using your saved claim details. Picks PayPal or Venmo payouts so Nickel can see the money land. Stops and hands you the form whenever a site asks for a claim code, a document, a login or a CAPTCHA.",
  "pulse":{"src":"beat","gap":5400},
  "owns":["settle.filer."]}
]$j$::jsonb);
