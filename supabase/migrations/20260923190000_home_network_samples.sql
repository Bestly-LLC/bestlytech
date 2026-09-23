-- Home network history for the Home Hub page and Scout (agent >= 1.5.0 posts one row every 5 minutes).
create table if not exists public.home_hub_network_samples (
  id bigserial primary key,
  captured_at timestamptz not null default now(),
  gateway text,
  gw_loss_pct real, gw_avg_ms real, gw_max_ms real,
  inet_loss_pct real, inet_avg_ms real, inet_max_ms real,
  dns_ms real, dns_ok boolean,
  wan_status text, wan_uptime_s bigint, external_ip text
);
create index if not exists home_hub_network_samples_at on public.home_hub_network_samples (captured_at desc);
alter table public.home_hub_network_samples enable row level security;
drop policy if exists home_hub_network_samples_admin_read on public.home_hub_network_samples;
create policy home_hub_network_samples_admin_read on public.home_hub_network_samples
  for select to authenticated using (has_role(auth.uid(), 'admin'::app_role));
grant select on public.home_hub_network_samples to authenticated;

-- The Pi agent's network and router commands.
alter table public.home_hub_commands drop constraint if exists home_hub_commands_target_check;
alter table public.home_hub_commands add constraint home_hub_commands_target_check
  check (target = any (array['pihole','homeassistant','homebridge','agent','nextcloud','network','router']));
