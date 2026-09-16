-- Home Hub: an access backup that outlives anyone's memory, plus live Home Assistant /
-- Homebridge / host snapshots pushed by the on-prem agent.
--
--   home_hub_inventory       Devices and services: IPs, Tailscale names, ports, URLs, SSH alias
--                            and user, file paths, and WHERE each secret lives. Never a secret value.
--                            The agent keeps the bestly-pi row's IPs current (with history).
--   home_hub_snapshots       Latest read-only snapshot per source (homeassistant, homebridge, host).
--   home_hub_agent_releases  Agent source the Pi can pull through agent.update (sha256-pinned),
--                            so agent upgrades never need an SSH session again.
--   Vault home_hub_*         Secret backups. The agent backs up its own HA token and Homebridge
--                            login; admins can add more. Admins can WRITE and see timestamps, never read.

create table if not exists public.home_hub_inventory (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  kind text not null check (kind in ('device', 'service', 'network')),
  name text not null,
  runs_on text,
  lan_ip text,
  tailscale_name text,
  tailscale_ip text,
  port integer check (port is null or port between 1 and 65535),
  url text,
  ssh_alias text,
  ssh_user text,
  ssh_key text,
  login_user text,
  paths jsonb not null default '{}'::jsonb,
  secret_refs jsonb not null default '{}'::jsonb,
  notes text,
  history jsonb not null default '[]'::jsonb,
  sort integer not null default 100,
  source text not null default 'manual' check (source in ('seed', 'manual', 'agent')),
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by text
);
alter table public.home_hub_inventory enable row level security;
drop policy if exists home_hub_inventory_admin_all on public.home_hub_inventory;
create policy home_hub_inventory_admin_all on public.home_hub_inventory
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
grant select, insert, update, delete on public.home_hub_inventory to authenticated;

create table if not exists public.home_hub_snapshots (
  source text primary key check (source in ('homeassistant', 'homebridge', 'host')),
  captured_at timestamptz not null default now(),
  ok boolean not null,
  error text,
  fails integer not null default 0,
  data jsonb not null default '{}'::jsonb
);
alter table public.home_hub_snapshots enable row level security;
drop policy if exists home_hub_snapshots_admin_read on public.home_hub_snapshots;
create policy home_hub_snapshots_admin_read on public.home_hub_snapshots
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));
grant select on public.home_hub_snapshots to authenticated;

create table if not exists public.home_hub_agent_releases (
  version text primary key check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  source text not null,
  notes text,
  created_at timestamptz not null default now()
);
alter table public.home_hub_agent_releases enable row level security;
drop policy if exists home_hub_agent_releases_admin_read on public.home_hub_agent_releases;
create policy home_hub_agent_releases_admin_read on public.home_hub_agent_releases
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));
grant select (version, sha256, notes, created_at) on public.home_hub_agent_releases to authenticated;

-- ── Vault backups ────────────────────────────────────────────────────────────
-- Names are home_hub_<a-z0-9_>. The agent key itself is off limits.

create or replace function public.home_hub_vault_put(p_name text, p_value text, p_description text default null)
returns timestamptz
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
  v_current text;
begin
  if p_name !~ '^home_hub_[a-z0-9_]{2,60}$' or p_name = 'home_hub_agent_key' then
    raise exception 'Not an allowed secret name: %', p_name;
  end if;
  if coalesce(length(p_value), 0) = 0 or length(p_value) > 8000 then
    raise exception 'Secret value must be 1 to 8000 characters';
  end if;
  if auth.role() <> 'service_role' and not public.has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'Admins only';
  end if;
  select s.id, d.decrypted_secret into v_id, v_current
    from vault.secrets s join vault.decrypted_secrets d on d.id = s.id
   where s.name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name, coalesce(p_description, 'Home Hub backup'));
  elsif v_current is distinct from p_value then
    perform vault.update_secret(v_id, p_value, p_name, coalesce(p_description, 'Home Hub backup'));
  else
    return (select updated_at from vault.secrets where id = v_id);
  end if;
  return now();
end;
$$;
revoke all on function public.home_hub_vault_put(text, text, text) from public, anon;
grant execute on function public.home_hub_vault_put(text, text, text) to authenticated, service_role;

create or replace function public.home_hub_vault_list()
returns table (name text, description text, updated_at timestamptz)
language sql
stable
security definer
set search_path = public, vault
as $$
  select s.name, s.description, s.updated_at
    from vault.secrets s
   where s.name like 'home\_hub\_%' and s.name <> 'home_hub_agent_key'
     and (auth.role() = 'service_role' or public.has_role(auth.uid(), 'admin'::app_role))
   order by s.name;
$$;
revoke all on function public.home_hub_vault_list() from public, anon;
grant execute on function public.home_hub_vault_list() to authenticated, service_role;

-- ── Snapshot ingest (service role, called by the home-hub-agent edge function) ─────────

create or replace function public.home_hub_ingest_snapshot(p_source text, p_ok boolean, p_error text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  prev public.home_hub_snapshots;
  inv public.home_hub_inventory;
  v_lan text;
  v_ts text;
  label text;
begin
  if auth.role() <> 'service_role' then raise exception 'service role only'; end if;
  select * into prev from home_hub_snapshots where source = p_source;

  -- A failed read keeps the last good data so the page still shows something useful.
  insert into home_hub_snapshots (source, captured_at, ok, error, fails, data)
  values (p_source, now(), p_ok, left(p_error, 1000), case when p_ok then 0 else 1 end, coalesce(p_data, '{}'::jsonb))
  on conflict (source) do update set captured_at = excluded.captured_at, ok = excluded.ok,
    error = excluded.error,
    fails = case when excluded.ok then 0 else home_hub_snapshots.fails + 1 end,
    data = case when excluded.ok then excluded.data else home_hub_snapshots.data end;

  label := case p_source when 'homeassistant' then 'Home Assistant' when 'homebridge' then 'Homebridge' else 'bestly-pi' end;

  -- Notify on the third failure in a row (about 3 minutes, so a restart doesn't page) and on recovery.
  if not p_ok and coalesce(prev.fails, 0) + 1 = 3 then
    insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key)
    values ('home_hub', label || ' is not responding', left(p_error, 300),
            '/admin/home-hub/' || case p_source when 'homeassistant' then 'home-assistant' when 'homebridge' then 'homebridge' else 'access' end,
            'home_hub:' || p_source, 'warning', 'home_hub_down:' || p_source || ':' || to_char(now(), 'YYYYMMDDHH24MI'))
    on conflict (dedupe_key) do nothing;
  elsif p_ok and coalesce(prev.fails, 0) >= 3 then
    insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key)
    values ('home_hub', label || ' is back', null,
            '/admin/home-hub/' || case p_source when 'homeassistant' then 'home-assistant' when 'homebridge' then 'homebridge' else 'access' end,
            'home_hub:' || p_source, 'success', 'home_hub_up:' || p_source || ':' || to_char(now(), 'YYYYMMDDHH24MI'))
    on conflict (dedupe_key) do nothing;
  end if;

  -- The host snapshot keeps the backup's IPs honest.
  if p_source = 'host' and p_ok then
    v_lan := nullif(p_data->>'lan_ip', '');
    v_ts := nullif(p_data->>'tailscale_ip', '');
    select * into inv from home_hub_inventory where slug = 'bestly-pi';
    if inv.id is not null then
      if (v_lan is not null and v_lan is distinct from inv.lan_ip) or (v_ts is not null and v_ts is distinct from inv.tailscale_ip) then
        update home_hub_inventory set
          history = history || jsonb_build_array(jsonb_build_object('at', now(), 'lan_ip', inv.lan_ip, 'tailscale_ip', inv.tailscale_ip)),
          lan_ip = coalesce(v_lan, lan_ip),
          tailscale_ip = coalesce(v_ts, tailscale_ip),
          source = 'agent', updated_by = 'home-hub agent', updated_at = now(), verified_at = now()
        where id = inv.id;
        update home_hub_inventory set
          lan_ip = case when lan_ip is not distinct from inv.lan_ip then coalesce(v_lan, lan_ip) else lan_ip end,
          tailscale_ip = case when tailscale_ip is not distinct from inv.tailscale_ip then coalesce(v_ts, tailscale_ip) else tailscale_ip end,
          url = case when url is not null and inv.lan_ip is not null and v_lan is not null then replace(url, inv.lan_ip, v_lan) else url end,
          updated_at = now(), updated_by = 'home-hub agent'
        where runs_on = 'bestly-pi' and kind = 'service';
        insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key)
        values ('home_hub', 'bestly-pi changed address',
                concat_ws(' · ', case when v_lan is distinct from inv.lan_ip then 'LAN ' || coalesce(inv.lan_ip, '?') || ' → ' || v_lan end,
                                 case when v_ts is distinct from inv.tailscale_ip then 'Tailscale ' || coalesce(inv.tailscale_ip, '?') || ' → ' || v_ts end),
                '/admin/home-hub/access', 'home_hub:host', 'warning', 'home_hub_ip:' || coalesce(v_lan, '') || ':' || coalesce(v_ts, ''))
        on conflict (dedupe_key) do nothing;
      else
        update home_hub_inventory set verified_at = now() where id = inv.id;
      end if;
    end if;
  end if;
end;
$$;
revoke all on function public.home_hub_ingest_snapshot(text, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.home_hub_ingest_snapshot(text, boolean, text, jsonb) to service_role;

-- ── Agent offline notification (pg_cron) ─────────────────────────────────────

create or replace function public.home_hub_check_agent()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  seen timestamptz;
begin
  select max(last_seen_at) into seen from home_hub_agent_state;
  if seen is not null and seen < now() - interval '10 minutes' then
    insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key)
    values ('home_hub', 'Home Hub agent went quiet',
            'bestly-pi last checked in ' || to_char(seen at time zone 'America/Los_Angeles', 'Mon DD, HH12:MI AM') || '. The Pi may be off or offline.',
            '/admin/home-hub', 'home_hub:agent', 'warning', 'home_hub_agent_offline:' || to_char(seen, 'YYYYMMDDHH24MI'))
    on conflict (dedupe_key) do nothing;
  end if;
end;
$$;
revoke all on function public.home_hub_check_agent() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'home-hub-agent-offline-check';
    perform cron.schedule('home-hub-agent-offline-check', '*/5 * * * *', 'select public.home_hub_check_agent()');
  end if;
end $$;

-- ── Seed: what is known as of 2026-09-16 ─────────────────────────────────────

insert into public.home_hub_inventory
  (slug, kind, name, runs_on, lan_ip, tailscale_name, tailscale_ip, port, url, ssh_alias, ssh_user, ssh_key, login_user, paths, secret_refs, notes, sort, source, verified_at, updated_by)
values
  ('bestly-pi', 'device', 'bestly-pi (Raspberry Pi)', null, '192.168.1.211', 'bestly-pi-1', '100.79.2.74', 22, null,
   'bestly-pi-lan', 'pi', 'Jared''s Mac mini: ~/.ssh/id_ed25519 (macOS Keychain)', null,
   '{"Scripts": "/home/pi/scripts", "Scripts env (HA_TOKEN, service key)": "/home/pi/scripts/.env", "Docker apps on SSD": "/mnt/ssd/apps"}',
   '{"SSH private key": "Mac mini ~/.ssh/id_ed25519 (Keychain)", "Supabase service key": "Pi /home/pi/scripts/.env"}',
   'aarch64, Python 3.13, passwordless sudo for pi. Use the LAN alias: Tailscale SSH is in check mode and asks for browser re-auth. 192.168.0.211 in old notes and known_hosts is stale.',
   10, 'seed', now(), 'seed'),
  ('home-assistant', 'service', 'Home Assistant', 'bestly-pi', '192.168.1.211', 'bestly-pi-1', '100.79.2.74', 8123, 'http://192.168.1.211:8123',
   null, null, null, null,
   '{"Config": "/mnt/ssd/apps/homeassistant", "Docker container": "homeassistant (ghcr.io/home-assistant/home-assistant:stable, network host)", "Storm automation": "/mnt/ssd/apps/homeassistant/packages/ecoflow_storm.yaml"}',
   '{"Long-lived token": "Vault home_hub_ha_token (agent backup) · Pi /home/pi/scripts/.env HA_TOKEN · agent config"}',
   'Integrations added 2026-09-09: HACS 2.0.5, EcoFlow Cloud 1.7.1, NWS Alerts 6.7.3.',
   20, 'seed', null, 'seed'),
  ('homebridge', 'service', 'Homebridge', 'bestly-pi', '192.168.1.211', 'bestly-pi-1', '100.79.2.74', 8581, 'http://192.168.1.211:8581',
   null, null, null, 'jared',
   '{}',
   '{"UI password": "Vault home_hub_homebridge_password (agent backup) · agent config"}',
   'Runs in Docker on the Pi.', 30, 'seed', null, 'seed'),
  ('pihole', 'service', 'Pi-hole', 'bestly-pi', '192.168.1.211', 'bestly-pi-1', '100.79.2.74', 8080, 'http://192.168.1.211:8080/admin',
   null, null, null, null,
   '{"Stats pusher (cron, every minute)": "/home/pi/scripts/push_pihole_stats.py"}',
   '{}',
   'Pi-hole v6. API is on :8080, not :80. The agent drives the pihole CLI, so no web password is stored anywhere.',
   40, 'seed', now(), 'seed'),
  ('home-hub-agent', 'service', 'Home Hub agent', 'bestly-pi', null, null, null, null, null,
   null, null, null, null,
   '{"Code": "/opt/bestly/home-hub-agent/agent.py", "Config (0600)": "/etc/bestly/home-hub-agent.json", "systemd unit": "bestly-home-hub-agent", "Logs": "journalctl -u bestly-home-hub-agent -f"}',
   '{"Agent key": "Supabase Vault home_hub_agent_key"}',
   'Polls the home-hub-agent edge function every 15s. Commands queue in home_hub_commands.',
   50, 'seed', now(), 'seed'),
  ('nextcloud', 'service', 'Nextcloud (cloud.bestly.tech)', 'bestly-pi', null, null, null, null, 'https://cloud.bestly.tech',
   null, null, null, null, '{}', '{}', 'Docker stack: Nextcloud + proxy + db + redis + signaling. coturn also runs on the Pi.',
   60, 'seed', null, 'seed'),
  ('mac-mini', 'device', 'Jared''s Mac mini', null, null, null, null, null, null,
   null, null, null, null, '{}', '{"SSH key for the Pi": "~/.ssh/id_ed25519 in macOS Keychain"}',
   'The machine that can SSH into bestly-pi.', 70, 'seed', null, 'seed'),
  ('home-router', 'network', 'Verizon router', null, null, null, null, null, null,
   null, null, null, null, '{}', '{}', 'Replaced the previous router. The agent reports the gateway address on the Access page.',
   80, 'seed', null, 'seed')
on conflict (slug) do nothing;
