-- Migration: home_hub_pihole_stats
-- Purpose: Stores Pi-hole snapshots pushed by the Raspberry Pi cron script.
--          The Pi POSTs a new row every ~60 seconds using the service_role key.
--          The frontend reads the latest row via the anon key.
--          Rows older than 25 hours are pruned automatically on each insert.

create table public.home_hub_pihole_stats (
  id                   uuid        primary key default gen_random_uuid(),
  captured_at          timestamptz not null default now(),
  status               text        not null default 'enabled',
  total_queries        integer     not null default 0,
  queries_blocked      integer     not null default 0,
  percent_blocked      numeric(6,3) not null default 0,
  domains_on_blocklist integer     not null default 0,
  -- jsonb arrays: [{hour, allowed, blocked}] and [{domain, count}]
  queries_over_time    jsonb       not null default '[]'::jsonb,
  top_blocked          jsonb       not null default '[]'::jsonb,
  top_permitted        jsonb       not null default '[]'::jsonb
);

comment on table public.home_hub_pihole_stats is
  'Pi-hole stats snapshots pushed from Raspberry Pi every ~60s';

-- Index for fast "latest row" lookups
create index home_hub_pihole_stats_captured_at_idx
  on public.home_hub_pihole_stats (captured_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.home_hub_pihole_stats enable row level security;

-- Authenticated admin users (and anon for simplicity within the admin panel)
-- can read stats. Only service_role (the Pi script) can insert — service_role
-- bypasses RLS so no insert policy is needed.
create policy "allow_read_pihole_stats"
  on public.home_hub_pihole_stats
  for select
  to authenticated, anon
  using (true);

-- ── Auto-pruning trigger ──────────────────────────────────────────────────────
-- Delete rows older than 25 hours after every insert so the table stays small.
create or replace function public.prune_pihole_stats()
  returns trigger
  language plpgsql
  security definer
as $$
begin
  delete from public.home_hub_pihole_stats
  where captured_at < now() - interval '25 hours';
  return new;
end;
$$;

create trigger prune_pihole_stats_after_insert
  after insert on public.home_hub_pihole_stats
  for each row execute function public.prune_pihole_stats();
