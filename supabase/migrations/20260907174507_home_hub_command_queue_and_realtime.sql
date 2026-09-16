-- Home Hub: real control path.
-- The Pi has no inbound route (it pushes stats outbound to ingest-pihole-stats).
-- So control is a queue: the admin enqueues a command, the on-prem agent polls,
-- executes locally, and posts the result back. Nothing in the browser touches the LAN.

create table if not exists public.home_hub_commands (
  id uuid primary key default gen_random_uuid(),
  target text not null check (target in ('pihole','homeassistant','homebridge')),
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending','running','done','failed','expired')),
  requested_by text,
  result jsonb,
  error text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz
);

create index if not exists home_hub_commands_pending_idx
  on public.home_hub_commands (status, created_at)
  where status = 'pending';
create index if not exists home_hub_commands_created_idx
  on public.home_hub_commands (created_at desc);

-- Heartbeat, so the UI can say "agent not connected" instead of faking success.
create table if not exists public.home_hub_agent_state (
  agent text primary key,
  last_seen_at timestamptz not null default now(),
  version text,
  info jsonb
);

alter table public.home_hub_commands enable row level security;
alter table public.home_hub_agent_state enable row level security;

drop policy if exists home_hub_commands_admin_all on public.home_hub_commands;
create policy home_hub_commands_admin_all on public.home_hub_commands
  for all to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));

drop policy if exists home_hub_commands_service on public.home_hub_commands;
create policy home_hub_commands_service on public.home_hub_commands
  for all using (auth.role() = 'service_role');

drop policy if exists home_hub_agent_state_admin_read on public.home_hub_agent_state;
create policy home_hub_agent_state_admin_read on public.home_hub_agent_state
  for select to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));

drop policy if exists home_hub_agent_state_service on public.home_hub_agent_state;
create policy home_hub_agent_state_service on public.home_hub_agent_state
  for all using (auth.role() = 'service_role');

-- Commands older than 10 minutes that were never claimed are dead, not pending.
create or replace function public.expire_stale_home_hub_commands()
returns void language sql security definer set search_path to 'public' as $$
  update public.home_hub_commands
     set status = 'expired',
         error = 'No agent claimed this command within 10 minutes',
         completed_at = now()
   where status = 'pending'
     and created_at < now() - interval '10 minutes';
$$;
