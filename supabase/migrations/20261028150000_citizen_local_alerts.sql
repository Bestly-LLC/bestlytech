-- Citizen local alerts (Sky Sync), 2026-10-28. Private/internal use only: feeds the home projector wall + /admin Sky map.
-- Already applied to project rcqfqhguwpmaarseifqg through the Supabase MCP; this file is the repo record.
-- Tables are locked (RLS on, no policies). Everything goes through SECURITY DEFINER functions gated like wall_pi_*:
--   citizen_ingest(token, ...)       writer, called by the collector on Hestia (token = home-hub agent key)
--   wall_citizen_snapshot(token)     reader for the wall server
--   wall_admin_citizen()             reader for /admin Sky (admin role only)
--   citizen_status(token)            reader for Sky Sync's watchdog
-- Home = 34.0835, -118.3698 (733 N Kings Rd; same as server.py HOME_LAT/HOME_LON).

create table if not exists public.citizen_incidents (
  key        text primary key,
  title      text not null,
  short      text,
  lat        double precision not null,
  lng        double precision not null,
  address    text,
  level      text not null default 'low' check (level in ('low','moderate','high','critical')),
  severity   smallint not null default 0,
  first_seen timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  updates    jsonb not null default '[]'::jsonb,
  source     text not null check (source in ('citizen','nws','chp')),
  dist_ft    integer not null,
  ping_id    bigint,
  pinged_at  timestamptz,
  closed_at  timestamptz
);
create index if not exists citizen_incidents_open_idx on public.citizen_incidents (last_seen desc) where closed_at is null;
alter table public.citizen_incidents enable row level security;
revoke all on public.citizen_incidents from anon, authenticated;

create table if not exists public.citizen_feed_state (
  source      text primary key,
  status      text not null default 'unknown',
  fail_count  integer not null default 0,
  ok_at       timestamptz,
  last_try_at timestamptz,
  next_try_at timestamptz,
  last_error  text,
  updated_at  timestamptz not null default now()
);
alter table public.citizen_feed_state enable row level security;
revoke all on public.citizen_feed_state from anon, authenticated;

create sequence if not exists public.citizen_ping_seq;
revoke all on sequence public.citizen_ping_seq from anon, authenticated;

create or replace function public.citizen_dist_ft(p_lat double precision, p_lng double precision)
returns integer language sql immutable set search_path = public as $$
  select round(3958.8 * 5280 * 2 * asin(least(1, sqrt(
    power(sin(radians(p_lat - 34.0835) / 2), 2) +
    cos(radians(34.0835)) * cos(radians(p_lat)) * power(sin(radians(p_lng + 118.3698) / 2), 2)))))::int $$;

-- "820 ft" under 1,000 ft, otherwise "0.4 mi"; a no-break space keeps the number with its unit.
create or replace function public.citizen_dist_text(p_ft integer)
returns text language sql immutable set search_path = public as $$
  select case when p_ft < 1000 then (round(p_ft / 10.0) * 10)::int::text || chr(160) || 'ft'
              else to_char(round(p_ft / 528.0) / 10.0, 'FM0.0') || chr(160) || 'mi' end $$;

create or replace function public.citizen_ingest(
  p_token text, p_source text, p_ok boolean, p_error text default null,
  p_items jsonb default '[]'::jsonb, p_next_try timestamptz default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  it jsonb; v_key text; v_lat double precision; v_lng double precision; v_ft int; v_level text; v_sev smallint;
  v_occ timestamptz; v_ins boolean; v_area boolean; v_title text; v_short text; v_addr text; v_ups jsonb;
  v_new text[] := '{}'; v_pinged text[] := '{}'; v_pid bigint; v_txt text; v_sevtxt text;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  if p_source not in ('citizen','nws','chp','collector') then raise exception 'bad source'; end if;
  insert into citizen_feed_state(source) values (p_source) on conflict do nothing;
  if not p_ok then
    update citizen_feed_state set
      fail_count = fail_count + 1, last_try_at = now(), next_try_at = p_next_try, last_error = left(coalesce(p_error, 'failed'), 200),
      status = case when coalesce(p_error, '') like 'gone%' then 'gone' when fail_count + 1 >= 3 then 'failing' else 'degraded' end,
      updated_at = now()
     where source = p_source;
    return jsonb_build_object('ok', true, 'recorded', 'failure');
  end if;
  update citizen_feed_state set status = 'ok', fail_count = 0, ok_at = now(), last_try_at = now(), next_try_at = p_next_try,
    last_error = null, updated_at = now() where source = p_source;
  if p_source = 'collector' then return jsonb_build_object('ok', true); end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'items must be an array'; end if;
  if jsonb_array_length(p_items) > 300 then raise exception 'too many items'; end if;

  for it in select value from jsonb_array_elements(p_items) loop
    begin
      v_key := p_source || ':' || left(regexp_replace(coalesce(it->>'key', ''), '[^A-Za-z0-9_.:-]', '', 'g'), 80);
      if v_key = p_source || ':' then continue; end if;
      v_area := coalesce((it->>'area')::boolean, false) and p_source = 'nws';
      v_lat := (it->>'lat')::double precision; v_lng := (it->>'lng')::double precision;
      if v_lat not between 33.5 and 34.7 or v_lng not between -119.0 and -117.8 then continue; end if;
      v_ft := case when v_area then 0 else citizen_dist_ft(v_lat, v_lng) end;
      if v_ft > 7000 then continue; end if;
      v_level := case when it->>'level' in ('low','moderate','high','critical') then it->>'level' else 'low' end;
      v_sev := case v_level when 'critical' then 3 when 'high' then 2 when 'moderate' then 1 else 0 end;
      v_occ := case when (it->>'occurred_ms') ~ '^[0-9]{10,14}$' then to_timestamp((it->>'occurred_ms')::double precision / 1000) else now() end;
      if v_occ > now() + interval '5 minutes' then v_occ := now(); end if;
      if not v_area and v_occ < now() - interval '2 hours' then continue; end if;
      v_title := left(coalesce(nullif(it->>'title', ''), 'Incident'), 90);
      v_short := left(coalesce(nullif(it->>'short', ''), v_title), 34);
      v_addr  := left(coalesce(it->>'address', ''), 120);
      v_ups   := case when jsonb_typeof(it->'updates') = 'array' then
                   (select coalesce(jsonb_agg(jsonb_build_object('t', u->'t', 'text', left(coalesce(u->>'text', ''), 160))), '[]'::jsonb)
                      from (select u from jsonb_array_elements(it->'updates') u limit 12) q)
                 else '[]'::jsonb end;
      insert into citizen_incidents(key, title, short, lat, lng, address, level, severity, first_seen, updated_at, last_seen, updates, source, dist_ft)
      values (v_key, v_title, v_short, v_lat, v_lng, v_addr, v_level, v_sev, v_occ, now(), now(), v_ups, p_source, v_ft)
      on conflict (key) do update set
        title = excluded.title, short = excluded.short, address = excluded.address, level = excluded.level, severity = excluded.severity,
        updated_at = case when excluded.updates is distinct from citizen_incidents.updates or excluded.level <> citizen_incidents.level
                          then now() else citizen_incidents.updated_at end,
        last_seen = now(), updates = excluded.updates, dist_ft = excluded.dist_ft, closed_at = null
      returning (xmax = 0), ping_id into v_ins, v_pid;
      if v_ins then
        v_new := v_new || v_key;
        -- Ping only a NEW incident within 0.25 mi (1,320 ft), once. Updates to a known incident never ping again.
        if v_ft <= 1320 and coalesce((it->>'ping')::boolean, true) and (v_area or v_occ > now() - interval '20 minutes') then
          v_pid := nextval('citizen_ping_seq');
          update citizen_incidents set ping_id = v_pid, pinged_at = now() where key = v_key;
          v_pinged := v_pinged || v_key;
          v_txt := citizen_dist_text(v_ft) || ' away' ||
                   case when v_addr <> '' then ' · ' || v_addr else '' end ||
                   ' · ' || to_char(v_occ at time zone 'America/Los_Angeles', 'FMHH12:MI AM');
          v_sevtxt := case v_level when 'critical' then 'critical' when 'high' then 'warning' else 'info' end;
          begin
            perform admin_notify('skysync', 'Sky Sync: ' || v_short, v_txt, '/admin/sky', 'sky-sync', v_sevtxt, 'citizen:' || v_key);
          exception when others then raise warning 'citizen bell failed: %', sqlerrm; end;
          begin
            perform push_web_send('Sky Sync: ' || v_short, v_txt, v_sevtxt, '/admin/sky', 'sky-sync-' || left(v_key, 60));
          exception when others then raise warning 'citizen push failed: %', sqlerrm; end;
        end if;
      end if;
    exception when others then
      raise warning 'citizen_ingest skipped one item: %', sqlerrm;
    end;
  end loop;

  -- anything this source no longer lists (and hasn't been seen for 7 min) has ended
  update citizen_incidents set closed_at = now()
   where source = p_source and closed_at is null and last_seen < now() - interval '7 minutes';
  return jsonb_build_object('ok', true, 'new', to_jsonb(v_new), 'pinged', to_jsonb(v_pinged));
end $$;

create or replace function public.citizen_snapshot_json()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'at', (extract(epoch from now()) * 1000)::bigint,
    'home', jsonb_build_array(34.0835, -118.3698),
    'paused', coalesce((select status <> 'ok' from citizen_feed_state where source = 'citizen'), true),
    'citizen', coalesce((select jsonb_build_object('status', status, 'fail_count', fail_count) from citizen_feed_state where source = 'citizen'),
                        jsonb_build_object('status', 'unknown', 'fail_count', 0)),
    'sources', coalesce((select jsonb_object_agg(source, jsonb_build_object('status', status, 'ok_s', round(extract(epoch from now() - ok_at))::int))
                           from citizen_feed_state where source in ('citizen','nws','chp')), '{}'::jsonb),
    'ping_max', coalesce((select max(ping_id) from citizen_incidents), 0),
    'incidents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', key, 'title', title, 'short', short, 'lat', lat, 'lng', lng, 'address', address, 'level', level, 'severity', severity,
        'source', source, 'dist_ft', dist_ft,
        'first_seen', (extract(epoch from first_seen) * 1000)::bigint, 'updated_at', (extract(epoch from updated_at) * 1000)::bigint,
        'ping_id', ping_id, 'pinged_at', case when pinged_at is null then null else (extract(epoch from pinged_at) * 1000)::bigint end,
        'n_updates', jsonb_array_length(updates),
        'last_update', case when jsonb_array_length(updates) > 0 then updates->(jsonb_array_length(updates) - 1)->>'text' end)
        order by dist_ft, first_seen desc)
      from citizen_incidents
      where closed_at is null and last_seen > now() - interval '12 minutes'
        and (source = 'nws' or first_seen > now() - interval '2 hours') and dist_ft <= 5280), '[]'::jsonb)) $$;
revoke all on function public.citizen_snapshot_json() from public, anon, authenticated;

create or replace function public.wall_citizen_snapshot(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  return citizen_snapshot_json();
end $$;

create or replace function public.wall_admin_citizen()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return citizen_snapshot_json();
end $$;
revoke all on function public.wall_admin_citizen() from public, anon;
grant execute on function public.wall_admin_citizen() to authenticated;

create or replace function public.citizen_status(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'at', (extract(epoch from now()) * 1000)::bigint,
    'sources', coalesce((select jsonb_object_agg(source, jsonb_build_object(
        'status', status, 'fail_count', fail_count, 'last_error', last_error,
        'ok_age_s', case when ok_at is null then null else round(extract(epoch from now() - ok_at))::int end,
        'try_age_s', case when last_try_at is null then null else round(extract(epoch from now() - last_try_at))::int end,
        'next_try_in_s', case when next_try_at is null then null else round(extract(epoch from next_try_at - now()))::int end)) from citizen_feed_state), '{}'::jsonb),
    'open_incidents', (select count(*) from citizen_incidents where closed_at is null and last_seen > now() - interval '12 minutes'));
end $$;

grant execute on function public.citizen_ingest(text, text, boolean, text, jsonb, timestamptz) to anon, authenticated;
grant execute on function public.wall_citizen_snapshot(text) to anon, authenticated;
grant execute on function public.citizen_status(text) to anon, authenticated;
