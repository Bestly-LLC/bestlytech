-- Migration: home_hub_pihole_stats
-- Stores Pi-hole snapshots pushed by the Raspberry Pi cron script.
-- The Pi POSTs a new row every ~60s using the service_role key.
-- The frontend reads the latest row via the anon key.
-- Rows older than 25 hours are auto-pruned on each insert.

create table public.home_hub_pihole_stats (
  id                   uuid         primary key default gen_random_uuid(),
  captured_at          timestamptz  not null default now(),
  status               text         not null,
  total_queries        integer      not null default 0,
  queries_blocked      integer      not null default 0,
  percent_blocked      numeric(6,3) not null default 0,
  domains_on_blocklist integer      not null default 0,
  active_clients       integer      not null default 0,
  -- [{domain, hits}]
  top_permitted        jsonb,
  -- [{domain, hits}]
  top_blocked          jsonb,
  -- {A: n, AAAA: n, ...}
  query_types          jsonb,
  -- [{hour, permitted, blocked}]
  hourly_chart         jsonb
);

comment on table public.home_hub_pihole_stats is
  'Pi-hole stats snapshots pushed from Raspberry Pi every ~60s';

create index home_hub_pihole_stats_captured_at_idx
  on public.home_hub_pihole_stats (captured_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.home_hub_pihole_stats enable row level security;

-- anon + authenticated can read; service_role bypasses RLS and can INSERT
create policy "allow_read_pihole_stats"
  on public.home_hub_pihole_stats
  for select
  to authenticated, anon
  using (true);

-- ── Auto-pruning trigger ──────────────────────────────────────────────────────
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
