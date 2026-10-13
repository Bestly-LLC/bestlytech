-- 2026-10-12 Maya sells Bestly Agent on the website, start to finish (docs/maya-sales-opusplan.md, part 6).
-- NOT APPLIED when written: someone applies it after review. Nothing here calls Stripe, places a call or sends a text.
--
--   1. agent_orders: one row per Bestly Agent signup (checkout started -> paid -> setup done). Service role writes it (the
--      agent-checkout, agent-onboard and stripe-webhook edge functions); admins can read it. No public-key RPCs, so nothing goes on
--      security_public_rpcs.
--   2. privacy_data_map rows for its email and phone columns (Vera, the Privacy Clerk, decides per person only from that map).
--   3. agent_order_admin(): the "Agent orders" card on /admin/maya (admin-guarded).
--   4. maya_sales_note(): Maya's good-news notes and money pushes, signed by Maya (bestly_raise can only open or close problems).
--   4b. maya_sales_health: one row, how many hourly payment pings failed in a row (maya-watch needs two before it alerts).
--   5. Team cards: Maya gains the sales sentence and the maya.sales alert prefix; Checkout and Setup Desk are her new tools.
--
-- Not in the map on purpose: agent_orders.setup (jsonb). It holds the buyer's answers (their business phone numbers, the person to
-- transfer calls to). A privacy request that reaches a paid customer is a "review" row anyway, so Jared looks at that order by hand.

-- ------------------------------------------------------------------ 1. the orders
create table if not exists public.agent_orders (
  id                     uuid primary key default gen_random_uuid(),
  token                  text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),  -- 48 hex: the /agent/welcome?o= link
  plan                   text not null check (plan in ('lite', 'starter', 'growth')),
  monthly_cents          integer not null check (monthly_cents >= 0),                                   -- what the plan cost when it was bought
  status                 text not null default 'checkout_started'
                           check (status in ('checkout_started', 'paid', 'setup_done', 'refunded', 'cancelled')),
  name                   text,
  email                  text,
  phone                  text,
  company                text,
  conversation_id        text,                                                                          -- the Maya chat that led here, when there was one
  ip_hash                text,                                                                          -- sha-256 of the visitor IP (rate limit only)
  stripe_session_id      text,
  stripe_customer_id     text,
  stripe_subscription_id text,
  paid_at                timestamptz,
  setup                  jsonb not null default '{}'::jsonb,
  setup_done_at          timestamptz,
  kickoff_at             timestamptz,
  created_at             timestamptz not null default now()
);
comment on table public.agent_orders is 'Bestly Agent signups from bestly.tech/agent (Maya sales plan). Written by agent-checkout, agent-onboard and stripe-webhook with the service role; admins read. token is the secret in the welcome link.';

create index if not exists agent_orders_email_idx   on public.agent_orders (email, created_at desc);
create index if not exists agent_orders_ip_idx      on public.agent_orders (ip_hash, created_at desc);
create index if not exists agent_orders_session_idx on public.agent_orders (stripe_session_id);
create index if not exists agent_orders_sub_idx     on public.agent_orders (stripe_subscription_id);
create index if not exists agent_orders_status_idx  on public.agent_orders (status, paid_at);

alter table public.agent_orders enable row level security;
revoke all on public.agent_orders from anon, authenticated;
grant select on public.agent_orders to authenticated;
drop policy if exists agent_orders_admin_read on public.agent_orders;
create policy agent_orders_admin_read on public.agent_orders for select to authenticated using (public.team_is_admin());

-- ------------------------------------------------------------------ 2. Vera's map
-- 'review' (not 'delete'): a paid order is a billing record Bestly may have to keep for tax, so Jared ticks each request by hand.
insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason) values
  ('agent_orders', 'email', 'email', 'review', 'Tax and billing records for paid Bestly Agent orders'),
  ('agent_orders', 'phone', 'phone', 'review', 'Tax and billing records for paid Bestly Agent orders')
on conflict (table_name, column_name) do nothing;

-- ------------------------------------------------------------------ 3. the admin card
create or replace function public.agent_order_admin(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select o.id, o.plan, o.monthly_cents, o.status, o.company, o.name, o.email, o.created_at, o.paid_at, o.setup_done_at, o.kickoff_at,
             o.stripe_customer_id,
             (o.status = 'paid' and o.paid_at < now() - interval '3 days') as stuck
        from agent_orders o
       order by o.created_at desc
       limit greatest(1, least(coalesce(p_limit, 100), 200))
    ) x), '[]'::jsonb);
end $f$;
revoke all on function public.agent_order_admin(integer) from public, anon;
grant execute on function public.agent_order_admin(integer) to authenticated;

-- ------------------------------------------------------------------ 4. Maya's notes
-- Good news is a "success" bell row (it lands in the 7 PM recap); a push is for money only (a real payment arrived). Signed by Maya.
create or replace function public.maya_sales_note(
  p_title text, p_body text default null, p_url text default '/admin/maya', p_dedupe text default null,
  p_push boolean default false, p_severity text default 'success')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_sev text := case when p_severity in ('info', 'success', 'warning') then p_severity else 'success' end;
begin
  if p_dedupe is not null and exists (select 1 from admin_notifications where dedupe_key = p_dedupe) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key, agent_slug)
  values ('maya.sales', left('Maya: ' || coalesce(p_title, ''), 200), left(coalesce(p_body, ''), 600), p_url,
          'agent-order:' || coalesce(p_dedupe, ''), v_sev, p_dedupe, 'maya')
  on conflict (dedupe_key) do nothing;
  if p_push then
    perform set_config('bestly.from', 'maya', true);
    perform bestly_ntfy(p_title, coalesce(p_body, ''), 4, array['moneybag']);
    perform set_config('bestly.from', '', true);
  end if;
  return jsonb_build_object('ok', true, 'pushed', p_push);
end $$;
revoke all on function public.maya_sales_note(text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.maya_sales_note(text, text, text, text, boolean, text) to service_role;

-- ------------------------------------------------------------------ 4b. the payment ping's memory
create table if not exists public.maya_sales_health (
  id                   boolean primary key default true check (id),
  consecutive_failures integer not null default 0,
  last_checked_at      timestamptz,
  last_ok_at           timestamptz,
  last_reason          text
);
comment on table public.maya_sales_health is 'One row. maya-watch pings agent-checkout hourly and counts failures in a row here; two in a row raise the maya.sales alert. Service role only.';
insert into public.maya_sales_health (id) values (true) on conflict (id) do nothing;
alter table public.maya_sales_health enable row level security;
revoke all on public.maya_sales_health from anon, authenticated;

-- ------------------------------------------------------------------ 5. team cards
-- team_onboard replaces dept / reports_to / kind / status, and replaces name, role, what_it_does, schedule, runs_on, icon and admin_url
-- with whatever is sent (it keeps the old value only when the field is left out). So Maya's card is re-sent complete: every existing
-- field exactly as 20261011020000_maya_billing_team_cards.sql set it, with the sales sentence added and maya.sales added to "owns".
-- Her pulse is restated unchanged. "welcome": false, so nobody gets a second welcome email.
select public.team_onboard($j$[
 {"slug":"maya","name":"Maya","role":"Sales & Support Rep","dept":"sales","reports_to":"jared","runs_on":"cloud","icon":"phone-call","sort":63,
  "admin_url":"/admin/maya","schedule":"answers (213) 641-0074 any time; inbound only","welcome":false,
  "what_it_does":"Answers (213) 641-0074 for every Bestly product. Support comes first: she walks callers through fixes from each product's knowledge base and never pitches while a problem is open. Anything she can't fix becomes a ticket with a code she reads to the caller (like M-4821): support and billing due in 1 business day, call-backs in 4 hours, privacy requests in 45 days per CCPA. Every ticket pushes to Jared signed by Maya. Also sells the Bestly Agent and files demo requests as leads. On inbound calls she can verify a caller by an emailed code, read their billing, email a card-update link, cancel or pause a subscription, and refund up to the cap you set (default $25, one per customer per 30 days, $100 a day); anything over a limit becomes a billing ticket. On bestly.tech she sells Bestly Agent start to finish: finds the right plan from the visitor's calls, opens the checkout card and types their details in (the visitor taps Pay securely, she never takes a card), then walks the setup questions after payment and offers the kickoff call.",
  "pulse":{"ok":"ok","col":"checked_at","gap":30,"src":"at","sum":"case when ok then 'Line OK' else 'Line problem' end","also":["maya-watch"],"alert":true,"table":"ava_line_health","where":"source = 'maya'"},
  "owns":["maya","maya-ticket","maya-billing","maya.sales"]},
 {"slug":"agent-checkout","name":"Checkout","role":"Bestly Agent signup and payment page","tool_of":"maya","dept":"sales","runs_on":"cloud","icon":"credit-card","sort":52,"schedule":"on demand, when a visitor taps Pay securely","welcome":false,
  "what_it_does":"Turns the plan a visitor picked on bestly.tech/agent into a secure Stripe payment page. The price always comes from the plans file, never from the browser. Limits 5 tries per email and 20 per network address an hour. Never sees a card. Its hourly ping (run by Maya's Line Check) checks the Stripe key and the three prices, and tells Jared if payments stop working.",
  "pulse":{"gap":75,"job":"maya-watch","src":"cron"}},
 {"slug":"agent-onboard","name":"Setup Desk","role":"Bestly Agent setup questions after payment","tool_of":"maya","dept":"sales","runs_on":"cloud","icon":"clipboard-check","sort":53,"schedule":"on demand, from the link in the welcome email","welcome":false,
  "what_it_does":"Holds the setup questions a new Bestly Agent customer answers on bestly.tech/agent/welcome after paying: business, phone number, hours, what calls should end in, who to transfer to, apps, common questions and what she must never say. Saves as they type, locks when they send, and tells Jared (through Maya) when the answers are in. Orders paid for 3 days with no answers show up in the recap.",
  "pulse":{"gap":75,"job":"maya-watch","src":"cron"}}
]$j$::jsonb);
