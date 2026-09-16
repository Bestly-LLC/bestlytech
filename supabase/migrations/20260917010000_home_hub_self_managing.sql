-- Home Hub runs itself (agent 1.2.0): issues, events, and ntfy pushes for what needs Jared.
--
-- The agent heals and updates on its own and reports through op "event" → home_hub_raise().
-- The database, not the agent, decides what reaches the phone:
--   * a problem pushes when it opens, again only if it is still open after repush_hours, or when it
--     gets worse (warning → error)
--   * its all-clear pushes only if the problem itself was pushed
--   * non-urgent pushes (priority < 5) raised overnight are delivered by ntfy at quiet_end (8 AM)
--   * automatic fixes that worked, maintenance summaries and other records go to the admin bell only
-- Server-side checks cover what the Pi can't report about itself: the agent going silent, the
-- Pi-hole stats pusher dying (it once failed silently for weeks), and a hung health loop.
-- ntfy is published from the database with pg_net because ntfy rate-limits the shared IPs of edge
-- functions (see 20260915204000_bluesteel_sweep_ack.sql).

-- ── settings ────────────────────────────────────────────────────────────────

create table if not exists public.home_hub_settings (
  id boolean primary key default true check (id),
  push_enabled boolean not null default true,
  ntfy_topic text not null default 'bestly-sysalert-7q2k9mx4',
  quiet_start_hour integer not null default 22 check (quiet_start_hour between 0 and 23),
  quiet_end_hour integer not null default 8 check (quiet_end_hour between 0 and 23),
  repush_hours integer not null default 6 check (repush_hours between 1 and 168),
  updated_at timestamptz not null default now()
);
insert into public.home_hub_settings (id) values (true) on conflict (id) do nothing;
alter table public.home_hub_settings enable row level security;
drop policy if exists home_hub_settings_admin_all on public.home_hub_settings;
create policy home_hub_settings_admin_all on public.home_hub_settings
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
grant select, update on public.home_hub_settings to authenticated;

-- ── issues + events ─────────────────────────────────────────────────────────

create table if not exists public.home_hub_issues (
  key text primary key,
  status text not null check (status in ('open', 'resolved')),
  severity text not null check (severity in ('info', 'success', 'warning', 'error')),
  title text not null,
  body text,
  source text not null default 'agent',
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  last_pushed_at timestamptz,
  push_count integer not null default 0,
  occurrences integer not null default 1
);
create index if not exists home_hub_issues_open_idx on public.home_hub_issues (status, updated_at desc);

create table if not exists public.home_hub_events (
  id bigserial primary key,
  at timestamptz not null default now(),
  occurred_at timestamptz,
  key text not null,
  kind text not null check (kind in ('problem', 'resolved', 'info')),
  severity text not null check (severity in ('info', 'success', 'warning', 'error')),
  title text not null,
  body text,
  pushed boolean not null default false,
  source text not null default 'agent'
);
create index if not exists home_hub_events_at_idx on public.home_hub_events (at desc);
create index if not exists home_hub_events_key_idx on public.home_hub_events (key, at desc);

alter table public.home_hub_issues enable row level security;
alter table public.home_hub_events enable row level security;
drop policy if exists home_hub_issues_admin_read on public.home_hub_issues;
create policy home_hub_issues_admin_read on public.home_hub_issues
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));
drop policy if exists home_hub_events_admin_read on public.home_hub_events;
create policy home_hub_events_admin_read on public.home_hub_events
  for select to authenticated using (public.has_role(auth.uid(), 'admin'::app_role));
grant select on public.home_hub_issues, public.home_hub_events to authenticated;

-- 'agent' commands (update since 1.1.0; test_alert, run_maintenance since 1.2.0) were refused by this
-- check all along, so the admin's "Update agent" button could never queue anything.
alter table public.home_hub_commands drop constraint if exists home_hub_commands_target_check;
alter table public.home_hub_commands add constraint home_hub_commands_target_check
  check (target in ('pihole', 'homeassistant', 'homebridge', 'agent'));

-- The agent's health snapshot joins the other three sources.
alter table public.home_hub_snapshots drop constraint if exists home_hub_snapshots_source_check;
alter table public.home_hub_snapshots add constraint home_hub_snapshots_source_check
  check (source in ('homeassistant', 'homebridge', 'host', 'health'));

-- ── ntfy ────────────────────────────────────────────────────────────────────

create or replace function public.home_hub_ntfy(
  p_title text, p_body text, p_priority integer, p_tags text[] default '{}', p_immediate boolean default false)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.home_hub_settings;
  v_local timestamp := now() at time zone 'America/Los_Angeles';
  v_hour integer := extract(hour from (now() at time zone 'America/Los_Angeles'));
  v_payload jsonb;
  v_deliver timestamp;
begin
  select * into s from home_hub_settings where id;
  if s.id is null or not s.push_enabled then
    return null;
  end if;
  v_payload := jsonb_build_object(
    'topic', s.ntfy_topic,
    'title', left(p_title, 200),
    'message', left(coalesce(nullif(p_body, ''), p_title), 3500),
    'priority', greatest(1, least(5, p_priority)),
    'tags', to_jsonb(coalesce(p_tags, '{}')),
    'click', 'https://bestly.tech/admin/home-hub');
  -- Overnight, only priority 5 (something is down and could not be fixed) rings right away.
  if not p_immediate and p_priority < 5
     and (v_hour >= s.quiet_start_hour or v_hour < s.quiet_end_hour) then
    v_deliver := date_trunc('day', v_local) + make_interval(hours => s.quiet_end_hour)
                 + case when v_hour >= s.quiet_start_hour then interval '1 day' else interval '0' end;
    v_payload := v_payload || jsonb_build_object(
      'delay', extract(epoch from (v_deliver at time zone 'America/Los_Angeles'))::bigint::text);
  end if;
  return net.http_post(url := 'https://ntfy.sh', body := v_payload);
end;
$$;
revoke all on function public.home_hub_ntfy(text, text, integer, text[], boolean) from public, anon, authenticated;
grant execute on function public.home_hub_ntfy(text, text, integer, text[], boolean) to service_role;

-- ── raise ───────────────────────────────────────────────────────────────────

create or replace function public.home_hub_raise(
  p_key text, p_kind text, p_severity text, p_title text, p_body text default null,
  p_push boolean default false, p_source text default 'agent', p_occurred_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.home_hub_settings;
  iss public.home_hub_issues;
  v_kind text := lower(coalesce(p_kind, ''));
  v_sev text := lower(coalesce(p_severity, 'info'));
  v_push boolean := false;
  v_prio integer;
  v_bell_sev text;
begin
  if v_kind not in ('problem', 'resolved', 'info') then
    raise exception 'Unknown event kind: %', p_kind;
  end if;
  if v_sev not in ('info', 'success', 'warning', 'error') then
    v_sev := 'warning';
  end if;
  select * into s from home_hub_settings where id;
  select * into iss from home_hub_issues where key = p_key for update;

  if v_kind = 'problem' then
    if iss.key is null or iss.status = 'resolved' then
      insert into home_hub_issues (key, status, severity, title, body, source)
      values (p_key, 'open', v_sev, p_title, p_body, coalesce(p_source, 'agent'))
      on conflict (key) do update set
        status = 'open', severity = excluded.severity, title = excluded.title, body = excluded.body,
        source = excluded.source, opened_at = now(), updated_at = now(), resolved_at = null,
        last_pushed_at = null, occurrences = home_hub_issues.occurrences + 1;
      v_push := p_push;
    else
      update home_hub_issues set
        title = p_title, body = p_body, updated_at = now(), occurrences = occurrences + 1,
        severity = case when v_sev = 'error' then 'error' else severity end
      where key = p_key;
      v_push := p_push and (
        iss.last_pushed_at is null
        or iss.last_pushed_at < now() - make_interval(hours => coalesce(s.repush_hours, 6))
        or (v_sev = 'error' and iss.severity <> 'error'));
    end if;
    if v_push then
      v_prio := case v_sev when 'error' then 5 when 'warning' then 4 else 3 end;
      perform home_hub_ntfy(p_title, p_body, v_prio,
        array[case v_sev when 'error' then 'rotating_light' else 'warning' end, 'house']);
      update home_hub_issues set last_pushed_at = now(), push_count = push_count + 1 where key = p_key;
    end if;

  elsif v_kind = 'resolved' then
    if iss.key is null or iss.status <> 'open' then
      return jsonb_build_object('ok', true, 'noop', true);   -- nothing was wrong; don't even log it
    end if;
    update home_hub_issues set status = 'resolved', resolved_at = now(), updated_at = now() where key = p_key;
    if iss.last_pushed_at is not null then
      v_push := true;
      -- if we woke him for it, tell him right away that it's fixed
      perform home_hub_ntfy(coalesce(nullif(p_title, ''), 'Fixed: ' || iss.title), p_body, 3,
        array['white_check_mark', 'house'], iss.severity = 'error');
    end if;

  else
    if p_push then
      v_push := true;
      v_prio := case v_sev when 'error' then 5 when 'warning' then 4 else 3 end;
      perform home_hub_ntfy(p_title, p_body, v_prio, array['information_source', 'house'], p_key like 'agent.test%');
    end if;
  end if;

  insert into home_hub_events (occurred_at, key, kind, severity, title, body, pushed, source)
  values (p_occurred_at, p_key, v_kind, v_sev, p_title, p_body, v_push, coalesce(p_source, 'agent'));

  -- The admin bell gets problems, all-clears, and anything that isn't routine chatter.
  if v_kind <> 'info' or v_sev <> 'info' then
    v_bell_sev := case when v_kind = 'resolved' then 'success' when v_sev = 'error' then 'warning' else v_sev end;
    insert into admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key)
    values ('home_hub', left(p_title, 200), left(p_body, 600), '/admin/home-hub', 'home_hub:' || p_key, v_bell_sev,
            'home_hub:' || p_key || ':' || v_kind || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSUS'))
    on conflict (dedupe_key) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'pushed', v_push);
end;
$$;
revoke all on function public.home_hub_raise(text, text, text, text, text, boolean, text, timestamptz) from public, anon, authenticated;
grant execute on function public.home_hub_raise(text, text, text, text, text, boolean, text, timestamptz) to service_role;

-- ── snapshot ingest: the agent owns up/down now; an IP change still needs a human ─────────

create or replace function public.home_hub_ingest_snapshot(p_source text, p_ok boolean, p_error text, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.home_hub_inventory;
  v_lan text;
  v_ts text;
begin
  if auth.role() <> 'service_role' then raise exception 'service role only'; end if;

  -- A failed read keeps the last good data so the page still shows something useful.
  insert into home_hub_snapshots (source, captured_at, ok, error, fails, data)
  values (p_source, now(), p_ok, left(p_error, 1000), case when p_ok then 0 else 1 end, coalesce(p_data, '{}'::jsonb))
  on conflict (source) do update set captured_at = excluded.captured_at, ok = excluded.ok,
    error = excluded.error,
    fails = case when excluded.ok then 0 else home_hub_snapshots.fails + 1 end,
    data = case when excluded.ok then excluded.data else home_hub_snapshots.data end;

  -- Up/down notifications moved to the agent's health loop (1.2.0), which restarts things first
  -- and only raises what it could not fix.

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
        perform home_hub_raise('host.address', 'info', 'warning', 'bestly-pi changed address',
          concat_ws(' · ',
            case when v_lan is distinct from inv.lan_ip then 'LAN ' || coalesce(inv.lan_ip, '?') || ' → ' || v_lan end,
            case when v_ts is distinct from inv.tailscale_ip then 'Tailscale ' || coalesce(inv.tailscale_ip, '?') || ' → ' || v_ts end)
          || '. The Access page is updated. Update the bestly-pi-lan SSH alias on the Mac mini, or give the Pi a DHCP reservation.',
          true, 'server');
      else
        update home_hub_inventory set verified_at = now() where id = inv.id;
      end if;
    end if;
  end if;
end;
$$;
revoke all on function public.home_hub_ingest_snapshot(text, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.home_hub_ingest_snapshot(text, boolean, text, jsonb) to service_role;

-- ── server-side watch (pg_cron, every 5 minutes) ────────────────────────────

create or replace function public.home_hub_check_agent()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  st public.home_hub_agent_state;
  v_stats timestamptz;
  v_health timestamptz;
begin
  select * into st from home_hub_agent_state order by last_seen_at desc nulls last limit 1;
  if st.last_seen_at is null then
    return;
  end if;

  -- 1. The Pi went silent. Nothing on it can fix itself or say so, so this one always pages.
  if st.last_seen_at < now() - interval '10 minutes' then
    perform home_hub_raise('agent.offline', 'problem', 'error', 'Home Hub is offline',
      'bestly-pi last checked in ' || to_char(st.last_seen_at at time zone 'America/Los_Angeles', 'Mon DD, HH12:MI AM')
      || '. The Pi, its power, the internet, or the agent is down. Home Assistant automations may still run locally, '
      || 'but nothing can heal itself or alert you until it is back.',
      true, 'server');
    return;   -- the checks below would only echo this one
  end if;
  perform home_hub_raise('agent.offline', 'resolved', 'success', 'Home Hub is back online',
    'bestly-pi is checking in again.', false, 'server');

  -- 2. The Pi-hole stats pusher (cron on the Pi) stopped. It failed silently for weeks once.
  select max(captured_at) into v_stats from home_hub_pihole_stats;
  if v_stats is null or v_stats < now() - interval '15 minutes' then
    perform home_hub_raise('pihole.stats', 'problem', 'warning', 'Pi-hole stats stopped updating',
      'Nothing from /home/pi/scripts/push_pihole_stats.py since '
      || coalesce(to_char(v_stats at time zone 'America/Los_Angeles', 'Mon DD, HH12:MI AM'), 'ever')
      || '. The Pi is online, so the cron job is failing. Its log is /home/pi/scripts/pihole_push.log.',
      true, 'server');
  else
    perform home_hub_raise('pihole.stats', 'resolved', 'success', 'Pi-hole stats are updating again', null, false, 'server');
  end if;

  -- 3. Agent 1.2.0+ sends a health snapshot every minute. Online but no health = its loop is stuck.
  if coalesce(string_to_array(st.version, '.')::int[], '{0}') >= '{1,2,0}'::int[] then
    select captured_at into v_health from home_hub_snapshots where source = 'health';
    if v_health is null or v_health < now() - interval '10 minutes' then
      perform home_hub_raise('agent.health_loop', 'problem', 'warning', 'Home Hub stopped checking health',
        'The agent is polling but has not sent a health check since '
        || coalesce(to_char(v_health at time zone 'America/Los_Angeles', 'Mon DD, HH12:MI AM'), 'it started')
        || '. Auto-healing is not running. Restart it: sudo systemctl restart bestly-home-hub-agent',
        true, 'server');
    else
      perform home_hub_raise('agent.health_loop', 'resolved', 'success', 'Home Hub health checks are running again', null, false, 'server');
    end if;
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
