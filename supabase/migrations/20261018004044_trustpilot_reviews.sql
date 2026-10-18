-- trustpilot_reviews — Jared's free Trustpilot review badge + button in his email signature.
-- Pi reads Trustpilot's "new review" notification emails (jared@bestly.tech, direct IMAP to
-- PrivateEmail) and upserts rows here. trustpilot-badge (Supabase edge function) renders
-- bestly.tech/r/badge.png from trustpilot_stats; trustpilot-review redirects bestly.tech/review
-- to the Trustpilot write-review page. Owner: Maya (notification_owners prefix 'trustpilot').
-- See bestly_memory area/trustpilot-reviews.md for the full plan.

create table if not exists public.trustpilot_reviews (
  id uuid primary key default gen_random_uuid(),
  msg_id text not null unique,
  stars smallint not null check (stars between 1 and 5),
  title text,
  snippet text,
  reviewer_first_name text,
  received_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.trustpilot_invites (
  id uuid primary key default gen_random_uuid(),
  customer_email text not null,
  source text not null,
  sent_at timestamptz not null default now()
);
create index if not exists trustpilot_invites_email_sent_idx on public.trustpilot_invites (customer_email, sent_at desc);

alter table public.trustpilot_reviews enable row level security;
alter table public.trustpilot_invites enable row level security;
-- No policies: service-role (the Pi job + edge functions) only. Nothing here is readable
-- with the anon/publishable key.

create or replace view public.trustpilot_stats as
select
  round(avg(stars)::numeric, 1) as avg_rating,
  count(*)::int as review_count,
  max(received_at) as last_review_at
from public.trustpilot_reviews;

insert into public.privacy_data_map (table_name, column_name, match_kind, action, reason, enabled) values
 ('trustpilot_invites', 'customer_email', 'email', 'keep', 'Log of Trustpilot review-invite BCCs to paying customers; kept to enforce the 90-day per-customer cap, same customer email already held by Stripe', true)
on conflict (table_name, column_name) do nothing;

insert into public.notification_owners (prefix, agent_slug, note) values
 ('trustpilot', 'maya', 'New Trustpilot review landed, or the review badge/link is unhealthy')
on conflict (prefix) do update set agent_slug = excluded.agent_slug, note = excluded.note;

-- Fold the new watch into Maya's existing pulse (her primary pulse stays her phone line;
-- this just adds the badge/stats freshness check alongside it) and note the new duty.
update public.bestly_agents
set pulse = jsonb_set(
      pulse,
      '{also}',
      (coalesce(pulse->'also', '[]'::jsonb) - 'trustpilot-badge-watch') || '["trustpilot-badge-watch"]'::jsonb
    ),
    what_it_does = what_it_does || ' Also owns the Trustpilot review badge in Jared''s email signature: tells him about every new review, and keeps the badge, the bestly.tech/review link, and the review-invite BCCs running.',
    updated_at = now()
where slug = 'maya';
