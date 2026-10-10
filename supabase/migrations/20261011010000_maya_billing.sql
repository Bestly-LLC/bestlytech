-- Maya Phase 3 "Hands": billing tools for the phone line.
-- Every limit lives here or in the maya-billing edge function, never in the prompt.
-- Owner decisions (Jared, 2026-10-10): refunds capped at $25.00 each, 1 per customer per 30 days,
-- $100.00 a day across everyone, anything over a limit becomes a ticket for Jared.

-- 1. Settings (single row, editable by an admin through the RPCs below).
create table if not exists public.maya_billing_settings (
  id boolean primary key default true check (id),
  refund_cap_cents int not null default 2500 check (refund_cap_cents between 0 and 50000),
  daily_refund_ceiling_cents int not null default 10000 check (daily_refund_ceiling_cents between 0 and 500000),
  refund_cooldown_days int not null default 30 check (refund_cooldown_days between 0 and 365),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.maya_billing_settings enable row level security;
insert into public.maya_billing_settings (id) values (true) on conflict do nothing;

-- 2. One-time email codes that prove a caller owns the account they are asking about.
create table if not exists public.maya_verifications (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null,
  email text not null,
  stripe_customer_id text not null,
  code_hash text not null,            -- sha256, the plain code is never stored
  expires_at timestamptz not null,
  attempts int not null default 0,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists maya_verifications_conv_idx on public.maya_verifications (conversation_id, created_at desc);
create index if not exists maya_verifications_email_idx on public.maya_verifications (lower(email), created_at desc);
alter table public.maya_verifications enable row level security;

-- 3. Audit log of every billing action Maya takes or refuses. Emails are masked here.
create table if not exists public.maya_billing_actions (
  id uuid primary key default gen_random_uuid(),
  conversation_id text,
  stripe_customer_id text,
  email text,
  action text not null check (action in
    ('status','pay_link','cancel','pause','refund','refund_blocked','verify_sent','verify_ok','verify_fail','blocked','health')),
  amount_cents int,
  stripe_object_id text,
  result text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists maya_billing_actions_conv_idx on public.maya_billing_actions (conversation_id, created_at desc);
create index if not exists maya_billing_actions_cust_idx on public.maya_billing_actions (stripe_customer_id, action, created_at desc);
create index if not exists maya_billing_actions_day_idx on public.maya_billing_actions (action, created_at desc);
alter table public.maya_billing_actions enable row level security;
create policy maya_billing_actions_admin_read on public.maya_billing_actions
  for select to authenticated using (public.team_is_admin());

-- 4. Short pay links. The Stripe portal session is created when the link is opened, so it never goes stale.
create table if not exists public.maya_pay_links (
  token text primary key check (token ~ '^[a-z0-9]{10,32}$'),
  stripe_customer_id text not null,
  email_masked text,
  conversation_id text,
  uses int not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.maya_pay_links enable row level security;

-- 5. Admin RPCs for the settings row.
create or replace function public.maya_billing_settings_get() returns jsonb
language plpgsql security definer set search_path = public as $$
declare s maya_billing_settings;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  select * into s from maya_billing_settings where id;
  return jsonb_build_object('refund_cap_cents', s.refund_cap_cents,
    'daily_refund_ceiling_cents', s.daily_refund_ceiling_cents,
    'refund_cooldown_days', s.refund_cooldown_days, 'enabled', s.enabled, 'updated_at', s.updated_at);
end $$;

create or replace function public.maya_billing_settings_set(
  p_refund_cap_cents int default null, p_daily_refund_ceiling_cents int default null,
  p_refund_cooldown_days int default null, p_enabled boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_refund_cap_cents is not null and p_refund_cap_cents not between 0 and 50000 then raise exception 'refund cap must be 0 to 50000 cents'; end if;
  if p_daily_refund_ceiling_cents is not null and p_daily_refund_ceiling_cents not between 0 and 500000 then raise exception 'daily ceiling must be 0 to 500000 cents'; end if;
  if p_refund_cooldown_days is not null and p_refund_cooldown_days not between 0 and 365 then raise exception 'cooldown must be 0 to 365 days'; end if;
  update maya_billing_settings set
    refund_cap_cents = coalesce(p_refund_cap_cents, refund_cap_cents),
    daily_refund_ceiling_cents = coalesce(p_daily_refund_ceiling_cents, daily_refund_ceiling_cents),
    refund_cooldown_days = coalesce(p_refund_cooldown_days, refund_cooldown_days),
    enabled = coalesce(p_enabled, enabled),
    updated_at = now()
  where id;
  return maya_billing_settings_get();
end $$;

-- 6. Atomic refund gate. Takes a lock so two calls at once cannot both squeeze under the daily ceiling.
--    A reservation counts against the limits straight away; the edge function marks it ok or failed after Stripe answers.
create or replace function public.maya_refund_reserve(
  p_conv text, p_customer text, p_email_masked text, p_charge text, p_amount int, p_dry boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s maya_billing_settings; v_day_start timestamptz; v_today int; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('maya_refund_gate'));
  select * into s from maya_billing_settings where id;
  if not s.enabled then return jsonb_build_object('ok', false, 'reason', 'refunds_disabled'); end if;
  if p_amount is null or p_amount <= 0 then return jsonb_build_object('ok', false, 'reason', 'bad_amount'); end if;
  if p_amount > s.refund_cap_cents then
    return jsonb_build_object('ok', false, 'reason', 'over_cap', 'cap_cents', s.refund_cap_cents);
  end if;
  if exists (select 1 from maya_billing_actions
              where action = 'refund' and result in ('reserved','ok') and stripe_customer_id = p_customer
                and created_at > now() - make_interval(days => s.refund_cooldown_days)) then
    return jsonb_build_object('ok', false, 'reason', 'cooldown', 'cooldown_days', s.refund_cooldown_days);
  end if;
  v_day_start := date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles';
  select coalesce(sum(amount_cents), 0) into v_today from maya_billing_actions
   where action = 'refund' and result in ('reserved','ok') and created_at >= v_day_start;
  if v_today + p_amount > s.daily_refund_ceiling_cents then
    return jsonb_build_object('ok', false, 'reason', 'daily_ceiling');
  end if;
  if p_dry then return jsonb_build_object('ok', true, 'dry_run', true); end if;
  insert into maya_billing_actions (conversation_id, stripe_customer_id, email, action, amount_cents, stripe_object_id, result, detail)
  values (p_conv, p_customer, p_email_masked, 'refund', p_amount, p_charge, 'reserved', '{}'::jsonb)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.maya_refund_finish(p_id uuid, p_ok boolean, p_refund_id text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = public as $$
  update maya_billing_actions
     set result = case when p_ok then 'ok' else 'failed' end,
         stripe_object_id = coalesce(p_refund_id, stripe_object_id),
         detail = coalesce(p_detail, '{}'::jsonb)
   where id = p_id and action = 'refund' and result = 'reserved';
$$;

-- 7. Scout alert for money Maya moved. Signed by the employee. Money wording makes it interrupt (autonomy rule: money).
create or replace function public.maya_billing_alert(p_title text, p_body text, p_dedupe text) returns jsonb
language sql security definer set search_path = public as $$
  select scout_notify(p_title => left('Maya: ' || p_title, 200), p_body => left(coalesce(p_body, ''), 500),
                      p_severity => 'info', p_push => true, p_url => '/admin/maya', p_dedupe => p_dedupe);
$$;

-- Only the server side (service role) may touch the gate; admins use the settings RPCs.
revoke all on function public.maya_refund_reserve(text, text, text, text, int, boolean) from public, anon, authenticated;
revoke all on function public.maya_refund_finish(uuid, boolean, text, jsonb) from public, anon, authenticated;
revoke all on function public.maya_billing_alert(text, text, text) from public, anon, authenticated;
grant execute on function public.maya_refund_reserve(text, text, text, text, int, boolean) to service_role;
grant execute on function public.maya_refund_finish(uuid, boolean, text, jsonb) to service_role;
grant execute on function public.maya_billing_alert(text, text, text) to service_role;
revoke all on function public.maya_billing_settings_get() from public, anon;
revoke all on function public.maya_billing_settings_set(int, int, int, boolean) from public, anon;
grant execute on function public.maya_billing_settings_get() to authenticated;
grant execute on function public.maya_billing_settings_set(int, int, int, boolean) to authenticated;
