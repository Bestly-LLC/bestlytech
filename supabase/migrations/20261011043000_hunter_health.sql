-- Hunter's own health row.
-- The first draft of the watchdog wrote to ava_line_health (source 'hunter'), but that table only allows the phone lines
-- ('ava', 'roofguard', 'maya') through a check constraint and Hunter is not a phone line, so the write was refused.
-- Hunter gets its own one-row table instead, with the same columns, and its team card reads that.

create table if not exists public.hunter_health (
  source     text primary key default 'hunter' check (source = 'hunter'),
  ok         boolean not null,
  problems   jsonb not null default '[]'::jsonb,
  healed     boolean not null default false,
  checked_at timestamptz not null default now(),
  last_ok_at timestamptz
);

alter table public.hunter_health enable row level security;

create policy hunter_health_admin_read on public.hunter_health for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role));

revoke all on public.hunter_health from public, anon;
grant select on public.hunter_health to authenticated;
grant all on public.hunter_health to service_role;

-- the team card now watches this table
update public.bestly_agents
   set pulse = jsonb_set(pulse, '{table}', '"hunter_health"'::jsonb)
 where slug = 'hunter';
