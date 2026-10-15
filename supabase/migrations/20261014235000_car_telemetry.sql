-- Blue Steel live location: Tesla Fleet Telemetry (2026-10-14, Jared).
-- The car streams Location / VehicleSpeed / GpsHeading / Gear to its own fleet-telemetry receiver on the Pi
-- (tools/car-telemetry). The forwarder posts the latest values here every ~30 s while the car is driving.
-- Parked, the car sends nothing. Owner: Car Guard (alerts car.telemetry.*). Inert until car_telemetry_settings.enabled.
-- Undo record: bestly_memory house/car/telemetry-undo-2026-10-14 (+ -claim).

-- ---------------------------------------------------------------------------------------------------------------
-- 1. New job actions + a 'stream' usage kind
-- ---------------------------------------------------------------------------------------------------------------
alter table public.tesla_fleet_commands drop constraint tesla_fleet_commands_action_check;
alter table public.tesla_fleet_commands add constraint tesla_fleet_commands_action_check check (action = any (array[
  'cool','warm','seat','off','refresh','honk','flash','unlock','unlock_start','lock','windows_close','nav_charger','nav_charger_lax',
  'nav_garage_lax','nav_home','nav_point','key_create','key_check','key_remove','key_list','charges','charge_history','health',
  'nearby_sc','battery_health','caps','drives','cmd','telemetry_check','telemetry_push','telemetry_delete']));

alter table public.tesla_fleet_usage drop constraint tesla_fleet_usage_kind_check;
alter table public.tesla_fleet_usage add constraint tesla_fleet_usage_kind_check check (kind = any (array['command','data','wake','other','stream']));

-- ---------------------------------------------------------------------------------------------------------------
-- 2. Settings (single row). RLS on, no policies: reachable only through the SECURITY DEFINER functions below.
-- ---------------------------------------------------------------------------------------------------------------
create table public.car_telemetry_settings (
  id              int primary key default 1 check (id = 1),
  enabled         boolean not null default false,
  host            text not null default 'bestly-pi.taile42611.ts.net',
  port            int  not null default 8443,
  fields          jsonb not null default '{"Location":{"interval_seconds":30,"minimum_delta":30},"VehicleSpeed":{"interval_seconds":30},"GpsHeading":{"interval_seconds":30},"Gear":{"interval_seconds":5}}'::jsonb,
  exp_at          timestamptz,           -- when the config on the car expires (set by the worker after a push)
  last_push_at    timestamptz,
  last_record_at  timestamptz,           -- last time the forwarder delivered telemetry rows
  last_beat       jsonb,                 -- forwarder heartbeat: up, last record time, cert days left
  fallback_until  timestamptz,           -- while in the future, car_watch_tick / car_protect_tick refresh via TezLab every 5 min
  token_hash      text,                  -- sha256 (hex) of the ingest token; the token itself lives only on the Pi (0600)
  state           jsonb not null default '{}'::jsonb,   -- watchdog bookkeeping + the latest telemetry_check / telemetry_push result
  updated_at      timestamptz not null default now()
);
insert into public.car_telemetry_settings (id) values (1);
alter table public.car_telemetry_settings enable row level security;
revoke all on public.car_telemetry_settings from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. Ingest + beat (called by the forwarder on the Pi with the publishable key + the ingest token)
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.car_telemetry_ingest(p_token text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare
  s car_telemetry_settings; fs tesla_fleet_settings; v turo_vehicle_state; r jsonb;
  ra timestamptz; pa timestamptz; cur_tel timestamptz; lat float8; lon float8; spd numeric; gear text; hd numeric;
  newraw jsonb; tel jsonb; sig int := 0; n int := 0; applied int := 0; res bigint; bucket text;
begin
  select * into s from car_telemetry_settings where id = 1;
  if p_token is null or s.token_hash is null or encode(sha256(convert_to(p_token, 'utf8')), 'hex') <> s.token_hash then
    raise exception 'forbidden';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'p_rows must be a json array'; end if;
  select * into fs from tesla_fleet_settings where id = 1;
  if fs.vin is null then return jsonb_build_object('skip', 'no car'); end if;

  for r in select value from jsonb_array_elements(p_rows) as t(value) order by coalesce((value->>'at')::timestamptz, now()) loop
    n := n + 1;
    ra  := least(coalesce((r->>'at')::timestamptz, now()), now());               -- never in the future
    pa  := least(nullif(r->>'loc_at', '')::timestamptz, now());
    lat := nullif(r->>'lat', '')::float8;  lon := nullif(r->>'lon', '')::float8;
    if lat is null or lon is null or lat not between -90 and 90 or lon not between -180 and 180 or (lat = 0 and lon = 0) then lat := null; lon := null; end if;
    spd := nullif(r->>'speed_mph', '')::numeric;  if spd is not null and (spd < 0 or spd > 250) then spd := null; end if;
    gear := upper(nullif(r->>'gear', ''));         if gear is not null and gear not in ('P','R','N','D') then gear := null; end if;
    hd := nullif(r->>'heading', '')::numeric;      if hd is not null and (hd < 0 or hd > 360) then hd := null; end if;
    sig := sig + least(greatest(coalesce(nullif(r->>'signals', '')::int, 4), 0), 2000);

    select * into v from turo_vehicle_state where vin = fs.vin for update;
    if v.vin is null then continue; end if;
    cur_tel := (v.raw->'telemetry'->>'at')::timestamptz;
    newraw := coalesce(v.raw, '{}'::jsonb);
    if cur_tel is null or ra >= cur_tel then
      tel := coalesce(v.raw->'telemetry', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('at', ra, 'speed_mph', spd, 'gear', gear, 'heading', hd));
      newraw := newraw || jsonb_build_object('telemetry', tel);
      -- Sky.tsx (admin) reads shift + speed from raw.fleet_api and its placement code must not change, so mirror them there.
      if gear is not null or spd is not null then
        newraw := newraw || jsonb_build_object('fleet_api', coalesce(newraw->'fleet_api', '{}'::jsonb)
                    || jsonb_strip_nulls(jsonb_build_object('shift', gear, 'speed_mph', spd)));
      end if;
    end if;

    if lat is not null and pa is not null and pa > coalesce(v.observed_at, '-infinity'::timestamptz) then
      -- A reading newer than what is stored: take the position.
      update turo_vehicle_state set latitude = lat, longitude = lon, observed_at = pa, connection_state = 'online',
        raw = newraw || jsonb_build_object('last_src', 'telemetry'), updated_at = now() where vin = fs.vin;
      applied := applied + 1;
    elsif newraw is distinct from v.raw then
      update turo_vehicle_state set raw = newraw, updated_at = now() where vin = fs.vin;     -- speed / gear only: position kept
    end if;
  end loop;

  if n > 0 then
    update car_telemetry_settings set last_record_at = now(), updated_at = now() where id = 1;
    -- Tesla bills about $1 per 150,000 signals. One 'stream' row per UTC hour (per trip) keeps the monthly total honest.
    select reservation_id into res from turo_trips where now() between starts_at - interval '1 hour' and ends_at + interval '1 hour'
      and coalesce(status, '') not in ('test','CANCELLED','CANCELED') order by starts_at desc limit 1;
    bucket := to_char(now() at time zone 'UTC', 'YYYYMMDDHH24');
    update tesla_fleet_usage set at = now(),
        detail = jsonb_set(detail, '{signals}', to_jsonb(coalesce((detail->>'signals')::int, 0) + sig)),
        cost_usd = round((coalesce((detail->>'signals')::int, 0) + sig) / 150000.0, 4)
      where kind = 'stream' and detail->>'bucket' = bucket and reservation_id is not distinct from res;
    if not found then
      insert into tesla_fleet_usage (kind, cost_usd, reservation_id, detail)
      values ('stream', round(sig / 150000.0, 4), res, jsonb_build_object('via', 'fleet-telemetry', 'bucket', bucket, 'signals', sig));
    end if;
  end if;
  return jsonb_build_object('ok', true, 'rows', n, 'position_applied', applied, 'signals', sig);
end $fn$;

create or replace function public.car_telemetry_beat(p_token text, p_beat jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
declare s car_telemetry_settings;
begin
  select * into s from car_telemetry_settings where id = 1;
  if p_token is null or s.token_hash is null or encode(sha256(convert_to(p_token, 'utf8')), 'hex') <> s.token_hash then
    raise exception 'forbidden';
  end if;
  update car_telemetry_settings set last_beat = coalesce(p_beat, '{}'::jsonb) || jsonb_build_object('at', now()), updated_at = now() where id = 1;
  return jsonb_build_object('ok', true);
end $fn$;

-- Worker side (token = the existing tesla_worker_token): what to push, and where to record what happened.
-- (Replaced in 20261014235500_car_telemetry_start.sql to add the 'enabled' flag.)
create or replace function public.car_telemetry_push_args(p_token text)
returns jsonb language plpgsql security definer set search_path to 'public', 'vault' as $fn$
declare s car_telemetry_settings; fs tesla_fleet_settings; ca text;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  select * into s from car_telemetry_settings where id = 1;
  select * into fs from tesla_fleet_settings where id = 1;
  select decrypted_secret into ca from vault.decrypted_secrets where name = 'tesla_telemetry_ca_crt';
  return jsonb_build_object('hostname', s.host, 'port', s.port, 'fields', s.fields, 'ca', ca, 'vin', fs.vin);
end $fn$;

create or replace function public.car_telemetry_record(p_token text, p_kind text, p_data jsonb)
returns void language plpgsql security definer set search_path to 'public' as $fn$
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  if p_kind = 'push' then
    update car_telemetry_settings set last_push_at = now(), exp_at = nullif(p_data->>'exp_at', '')::timestamptz,
      state = state || jsonb_build_object('push', p_data || jsonb_build_object('at', now())), updated_at = now() where id = 1;
  elsif p_kind = 'check' then
    update car_telemetry_settings set exp_at = coalesce(nullif(p_data->>'exp_at', '')::timestamptz, exp_at),
      state = state || jsonb_build_object('check', p_data || jsonb_build_object('at', now())), updated_at = now() where id = 1;
  elsif p_kind = 'delete' then
    update car_telemetry_settings set exp_at = null, last_push_at = null,
      state = state || jsonb_build_object('deleted_at', now()), updated_at = now() where id = 1;
  else
    raise exception 'unknown kind %', p_kind;
  end if;
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. Patches to existing functions (pg_get_functiondef + exact-match replace; any drift raises instead of guessing)
-- ---------------------------------------------------------------------------------------------------------------
create function pg_temp.patch(d text, old text, new text) returns text language plpgsql as $p$
declare c int;
begin
  c := (length(d) - length(replace(d, old, ''))) / length(old);
  if c <> 1 then raise exception 'telemetry patch: expected 1 match, found % for: %', c, left(old, 80); end if;
  return replace(d, old, new);
end $p$;

do $m$
declare d text;
begin
  -- 4a. tesla_job_done (TezLab path): keep a newer telemetry position; carry raw.telemetry; stamp raw.last_src.
  d := pg_get_functiondef('public.tesla_job_done(bigint,boolean,jsonb,jsonb)'::regprocedure);
  d := pg_temp.patch(d, 'declare s tesla_fleet_settings; seen timestamptz;', 'declare s tesla_fleet_settings; seen timestamptz; cur turo_vehicle_state; keep boolean := false;');
  d := pg_temp.patch(d, E'  insert into turo_vehicle_state as v (',
    E'  -- Telemetry (2026-10-14): a position the car streamed after TezLab''s own reading time is newer; never roll it back.\n'
    '  select * into cur from turo_vehicle_state where vin = s.vin;\n'
    '  keep := cur.vin is not null and coalesce(cur.raw->>''last_src'', ''status'') = ''telemetry'' and cur.observed_at is not null and cur.observed_at > seen;\n'
    '  insert into turo_vehicle_state as v (');
  d := pg_temp.patch(d, 'observed_at = excluded.observed_at,', 'observed_at = case when keep then v.observed_at else excluded.observed_at end,');
  d := pg_temp.patch(d, 'latitude = coalesce((p_state->>''latitude'')::float8, v.latitude),', 'latitude = case when keep then v.latitude else coalesce((p_state->>''latitude'')::float8, v.latitude) end,');
  d := pg_temp.patch(d, 'longitude = coalesce((p_state->>''longitude'')::float8, v.longitude),', 'longitude = case when keep then v.longitude else coalesce((p_state->>''longitude'')::float8, v.longitude) end,');
  d := pg_temp.patch(d, 'raw = coalesce(v.raw, ''{}''::jsonb) || excluded.raw,',
    'raw = coalesce(v.raw, ''{}''::jsonb) || excluded.raw || case when v.raw ? ''telemetry'' then jsonb_build_object(''telemetry'', v.raw->''telemetry'') else ''{}''::jsonb end || jsonb_build_object(''last_src'', case when keep then ''telemetry'' else ''status'' end),');
  execute d;

  -- 4b. tesla_worker_done (paid Fleet path, no position of its own): keep telemetry's reading time, carry raw.telemetry.
  d := pg_get_functiondef('public.tesla_worker_done(text,bigint,boolean,jsonb,jsonb)'::regprocedure);
  d := pg_temp.patch(d, 'observed_at = excluded.observed_at,', 'observed_at = case when coalesce(v.raw->>''last_src'', ''status'') = ''telemetry'' then v.observed_at else excluded.observed_at end,');
  d := pg_temp.patch(d, 'raw = coalesce(v.raw, ''{}''::jsonb) || excluded.raw,',
    'raw = coalesce(v.raw, ''{}''::jsonb) || excluded.raw || case when v.raw ? ''telemetry'' then jsonb_build_object(''telemetry'', v.raw->''telemetry'') else ''{}''::jsonb end,');
  execute d;

  -- 4c. tesla_worker_claim: a worker older than 1.9.0 can never claim a telemetry_* job (it would wake the car on an unknown action).
  d := pg_get_functiondef('public.tesla_worker_claim(text,text)'::regprocedure);
  d := pg_temp.patch(d, 'select * into j from tesla_fleet_commands where status = ''queued'' order by created_at limit 1 for update skip locked;',
    'select * into j from tesla_fleet_commands where status = ''queued'' and (action not like ''telemetry\_%'' or (p_version is not null and semver_key(p_version) >= semver_key(''1.9.0''))) order by created_at limit 1 for update skip locked;');
  execute d;

  -- 4d. car_watch_tick: telemetry fallback (TezLab every 5 min) and no paid Fleet refresh while telemetry is under 2 min old.
  d := pg_get_functiondef('public.car_watch_tick()'::regprocedure);
  d := pg_temp.patch(d, 'moved boolean; night boolean; name text; hr int;', 'moved boolean; night boolean; name text; hr int; tel car_telemetry_settings;');
  d := pg_temp.patch(d, E'  if (t.reservation_id is not null or plugged) and v.observed_at < now() - interval ''4 minutes''\n',
    E'  select * into tel from car_telemetry_settings where id = 1;\n'
    '  if tel.enabled and tel.fallback_until > now() and tezlab_ready() and v.observed_at < now() - interval ''4 minutes''\n'
    '     and not exists (select 1 from tesla_fleet_commands where action = ''refresh'' and status in (''queued'', ''running'') and created_at > now() - interval ''5 minutes'') then\n'
    '    -- Telemetry went quiet while the car is driving: TezLab (free, never wakes the car) every 5 min until it resumes.\n'
    '    insert into tesla_fleet_commands (reservation_id, action, auto, args) values (null, ''refresh'', true, ''{"tezlab_only":true,"by":"telemetry-fallback"}'');\n'
    '    out := out || ''{"refresh":"tezlab"}'';\n'
    '  elsif (t.reservation_id is not null or plugged) and v.observed_at < now() - interval ''4 minutes''\n'
    '     and not (coalesce(tel.enabled, false) and tel.last_record_at > now() - interval ''2 minutes'')\n');
  execute d;

  -- 4e. car_protect_tick: same TezLab fallback, even outside a trip.
  d := pg_get_functiondef('public.car_protect_tick()'::regprocedure);
  d := pg_temp.patch(d, E'  -- 1) Speed: any stored drive over the limit, once per drive.',
    E'  -- 0b) Telemetry fallback (2026-10-14): while car_telemetry_watchdog has fallback_until in the future, refresh via TezLab every 5 min.\n'
    '  if tezlab_ready() and exists (select 1 from car_telemetry_settings where id = 1 and enabled and fallback_until > now())\n'
    '     and v.observed_at < now() - interval ''4 minutes''\n'
    '     and not exists (select 1 from tesla_fleet_commands where action = ''refresh'' and status in (''queued'',''running'') and created_at > now() - interval ''4 minutes'') then\n'
    '    insert into tesla_fleet_commands (action, auto, args) values (''refresh'', true, ''{"tezlab_only":true,"by":"telemetry-fallback"}''); out := out || ''{"refresh_fallback":true}'';\n'
    '  end if;\n\n'
    '  -- 1) Speed: any stored drive over the limit, once per drive.');
  execute d;
end $m$;

-- 4f. car_trail_add: source follows raw.last_src; speed/gear from raw.telemetry first when that reading is the one being trailed.
create or replace function public.car_trail_add() returns trigger language plpgsql security definer set search_path to 'public' as $fn$
declare last car_trail; res bigint; spd numeric; sh text; tel jsonb;
begin
  if new.latitude is null or new.observed_at is null then return new; end if;
  select * into last from car_trail order by at desc limit 1;
  if last.id is not null and (new.observed_at <= last.at or (trip_dist_m(new.latitude, new.longitude, last.lat, last.lon) < 30 and new.observed_at < last.at + interval '15 minutes')) then return new; end if;
  select reservation_id into res from turo_trips where new.observed_at between starts_at - interval '1 hour' and ends_at + interval '1 hour'
    and coalesce(status,'') not in ('test','CANCELLED','CANCELED') order by starts_at desc limit 1;
  spd := nullif(coalesce(new.raw->'tezlab'->>'speed', new.raw->'fleet_api'->>'speed'), '')::numeric;
  sh  := coalesce(new.raw->'tezlab'->>'shift_state', new.raw->'fleet_api'->>'shift_state');
  begin   -- telemetry values only when they belong to this reading (within 2 min); never let a bad value block the state upsert
    tel := new.raw->'telemetry';
    if tel is not null and tel->>'at' is not null and abs(extract(epoch from (tel->>'at')::timestamptz - new.observed_at)) < 120 then
      spd := coalesce(nullif(tel->>'speed_mph', '')::numeric, spd);
      sh  := coalesce(nullif(tel->>'gear', ''), sh);
    end if;
  exception when others then null;
  end;
  insert into car_trail (vin, at, lat, lon, locked, battery, reservation_id, speed_mph, shift, source)
  values (new.vin, new.observed_at, new.latitude, new.longitude, new.locked, new.battery_pct, res, spd, sh, coalesce(new.raw->>'last_src', 'status'));
  return new;
end $fn$;

-- 4g. wall_pi_car: prefer telemetry speed + gear when that reading is the current one.
create or replace function public.wall_pi_car(p_token text) returns jsonb language plpgsql stable security definer set search_path to 'public' as $fn$
declare v turo_vehicle_state; fs tesla_fleet_settings; tel jsonb; use_tel boolean := false; sh text; sp numeric;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = fs.vin;
  if v.vin is null or v.latitude is null or v.longitude is null then
    return jsonb_build_object('known', false, 'at', now());
  end if;
  tel := v.raw->'telemetry';
  begin
    use_tel := tel is not null and tel->>'at' is not null and (tel->>'at')::timestamptz >= v.observed_at - interval '2 minutes';
  exception when others then use_tel := false;
  end;
  sh := case when use_tel and nullif(tel->>'gear', '') is not null then tel->>'gear' else v.raw #>> '{fleet_api,shift}' end;
  sp := case when use_tel and nullif(tel->>'speed_mph', '') is not null then (tel->>'speed_mph')::numeric else (v.raw #>> '{fleet_api,speed_mph}')::numeric end;
  return jsonb_build_object(
    'known', true,
    'at', now(),
    'name', coalesce(v.display_name, 'Blue Steel'),
    'lat', v.latitude,
    'lon', v.longitude,
    'observed_at', v.observed_at,
    'fresh', v.observed_at > now() - interval '30 minutes',
    'shift', sh,
    'speed_mph', sp);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. Watchdog (Car Guard) + daily check. Both do nothing while enabled is false.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.car_telemetry_watchdog() returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  s car_telemetry_settings; fs tesla_fleet_settings; v turo_vehicle_state; out jsonb := '{}'::jsonb;
  month_key text := to_char(now() at time zone 'UTC', 'YYYY-MM'); m_total numeric; stopped boolean;
  worker_ok boolean; beat_at timestamptz; cert_days numeric; fresh boolean; silent boolean := false; driving boolean := false;
  open_drive boolean; shift_d boolean; moved boolean := false; d_new car_trail; d_old car_trail; premium boolean; tr record; chk jsonb; prob text;
  quiet_min int;
begin
  select * into s from car_telemetry_settings where id = 1 for update;
  if not found or not s.enabled then return jsonb_build_object('skip', 'disabled'); end if;
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = fs.vin;
  worker_ok := fs.worker_version is not null and semver_key(fs.worker_version) >= semver_key('1.9.0');

  -- (d) Tesla spend for the month reached the cap ($8): take the config off the car and say so. Fallback to TezLab stays on.
  select coalesce(sum(cost_usd), 0) into m_total from tesla_fleet_usage where at >= date_trunc('month', now() at time zone 'UTC');
  if coalesce(s.state->>'stopped_month', '') not in ('', month_key) then
    s.state := s.state - 'stopped_month';
    update car_telemetry_settings set state = s.state, updated_at = now() where id = 1;
    perform bestly_raise('car.telemetry.spend', 'resolved', 'info', null);
  end if;
  stopped := m_total >= fs.monthly_cap_usd or coalesce(s.state->>'stopped_month', '') = month_key;
  if stopped then
    if coalesce(s.state->>'stopped_month', '') <> month_key then
      if worker_ok and not exists (select 1 from tesla_fleet_commands where action = 'telemetry_delete' and status in ('queued','running')) then
        insert into tesla_fleet_commands (action, auto, args) values ('telemetry_delete', true, jsonb_build_object('why', 'monthly Tesla spend reached the cap'));
      end if;
      update car_telemetry_settings set state = state || jsonb_build_object('stopped_month', month_key), updated_at = now() where id = 1;
    end if;
    update car_telemetry_settings set fallback_until = now() + interval '30 minutes' where id = 1;
    perform bestly_raise('car.telemetry.spend', 'problem', 'warning', 'Live car location turned off: Tesla spend hit the cap',
      format('Tesla charges for this month reached $%s (cap $%s), so I took the streaming settings off the car. Blue Steel''s position is back to the TezLab updates (about every 15 min). Streaming can be turned back on next month.',
             to_char(m_total, 'FM990.00'), to_char(fs.monthly_cap_usd, 'FM990.00')), 'turo', null, false);
    return jsonb_build_object('stopped', 'spend', 'month_total', m_total);
  end if;

  -- (b) the receiver / forwarder on the Pi stopped checking in
  beat_at := (s.last_beat->>'at')::timestamptz;
  if beat_at is null or beat_at < now() - interval '3 minutes' then
    perform bestly_raise('car.telemetry.server', 'problem', 'warning', 'Live car location receiver on the Pi isn''t checking in',
      format('The program on the Pi that receives Blue Steel''s live location stopped reporting (last heard %s). Until it is back, the maps use TezLab updates (about every 15 min). Docker restarts it by itself; if this stays open, tell Claude "telemetry receiver down".',
             coalesce(to_char(beat_at at time zone 'America/Los_Angeles', 'Mon DD, FMHH12:MI AM'), 'never')), 'turo', null, false);
    out := out || '{"server":"down"}';
  else
    perform bestly_raise('car.telemetry.server', 'resolved', 'info', null);
  end if;

  -- (c) certificates: the server certificate is re-signed automatically at 45 days left, so under 21 means that failed;
  --     the config on the car is re-pushed by the daily check at 30 days left, so under 7 means that failed.
  cert_days := nullif(s.last_beat->>'cert_days_left', '')::numeric;
  if (cert_days is not null and cert_days < 21) or (s.exp_at is not null and s.exp_at < now() + interval '7 days') then
    perform bestly_raise('car.telemetry.cert', 'problem', 'warning', 'Live car location certificate is about to expire',
      format('%s%s Renewal runs by itself and it didn''t. Tell Claude "telemetry certificate".',
        case when cert_days is not null and cert_days < 21 then format('The Pi''s telemetry certificate has %s days left. ', round(cert_days)) else '' end,
        case when s.exp_at is not null and s.exp_at < now() + interval '7 days' then format('The streaming settings on the car expire %s. ', to_char(s.exp_at at time zone 'America/Los_Angeles', 'Mon DD')) else '' end),
      'turo', 'Tell Claude "telemetry certificate"', false);
  else
    perform bestly_raise('car.telemetry.cert', 'resolved', 'info', null);
  end if;

  -- latest telemetry_check outcome (the worker writes state.check)
  chk := s.state->'check';
  prob := nullif(chk->>'problem', '');
  if chk is not null and (chk->>'at')::timestamptz > now() - interval '26 hours' and prob is not null then
    perform bestly_raise('car.telemetry.config', 'problem', 'warning', 'Blue Steel isn''t set up for live location',
      case when prob = 'key_missing'
           then 'Tesla says the Bestly virtual key isn''t on the car, so I can''t send the streaming settings. This is the same thing as the Tesla re-pair alert; fixing that fixes this.'
           else 'The daily check found a problem: ' || left(prob, 240) end, 'turo', null, true);
  else
    perform bestly_raise('car.telemetry.config', 'resolved', 'info', null);
  end if;

  -- (a)/(e) TezLab says the car is driving but no telemetry has arrived for 3 min
  fresh := s.last_record_at is not null and s.last_record_at > now() - interval '3 minutes';
  open_drive := exists (select 1 from car_drives where ended_at is null and started_at > now() - interval '12 hours');
  shift_d := v.vin is not null and v.observed_at > now() - interval '20 minutes' and coalesce(v.raw #>> '{fleet_api,shift}', '') = 'D';
  select * into d_new from car_trail where at > now() - interval '10 minutes' order by at desc limit 1;
  select * into d_old from car_trail where at > now() - interval '10 minutes' order by at asc limit 1;
  moved := d_new.id is not null and d_old.id is not null and d_new.id <> d_old.id and trip_dist_m(d_new.lat, d_new.lon, d_old.lat, d_old.lon) > 91.44;   -- 300 ft
  driving := open_drive or shift_d or moved;
  silent := driving and not fresh and s.last_push_at is not null;
  premium := now() >= (timestamp '2026-10-26 00:00:00' at time zone 'America/Los_Angeles');   -- after Oct 25, 2026 (Premium Connectivity ended)

  if silent then
    quiet_min := case when s.last_record_at is null then null else floor(extract(epoch from now() - s.last_record_at) / 60)::int end;
    update car_telemetry_settings set fallback_until = now() + case when premium then interval '12 hours' else interval '30 minutes' end,
      state = state || jsonb_build_object('silent_since', coalesce(s.state->>'silent_since', now()::text)), updated_at = now() where id = 1;
    if worker_ok and not exists (select 1 from tesla_fleet_commands where action = 'telemetry_check' and created_at > now() - interval '20 minutes') then
      insert into tesla_fleet_commands (action, auto, args) values ('telemetry_check', true, jsonb_build_object('why', 'silent while driving'));
    end if;
    perform bestly_raise('car.telemetry.silent', 'problem', 'warning', 'Live location went quiet while driving',
      format('TezLab shows Blue Steel driving but no live location has arrived%s. Using TezLab updates every 5 min until it resumes, and checking the car''s streaming settings.',
             case when quiet_min is null then '' else format(' for %s min', quiet_min) end), 'turo', null, true);
    if premium then
      perform bestly_raise('car.telemetry.premium', 'problem', 'warning', 'Streaming stopped after Premium ended',
        'Blue Steel drove after Tesla Premium Connectivity ended (Oct 25, 2026) and live location did not arrive. It may not stream on Standard Connectivity. The maps keep using TezLab updates (about every 15 min), which is the fallback that stays on.',
        'turo', null, false);
    end if;
    out := out || '{"silent":true}';
  else
    if fresh or not driving then
      perform bestly_raise('car.telemetry.silent', 'resolved', 'info', null);
      if fresh then
        perform bestly_raise('car.telemetry.premium', 'resolved', 'info', null);
        update car_telemetry_settings set fallback_until = null, state = state - 'silent_since', updated_at = now() where id = 1 and (fallback_until is not null or state ? 'silent_since');
      end if;
    end if;
  end if;

  -- 30 min after each trip ends: one telemetry_check
  if worker_ok and s.last_push_at is not null then
    for tr in select reservation_id from turo_trips where ends_at between now() - interval '60 minutes' and now() - interval '30 minutes'
                and coalesce(status, '') not in ('test','CANCELLED','CANCELED') loop
      if not exists (select 1 from tesla_fleet_commands where action = 'telemetry_check' and args->>'trip' = tr.reservation_id::text) then
        insert into tesla_fleet_commands (action, auto, args) values ('telemetry_check', true, jsonb_build_object('trip', tr.reservation_id, 'why', 'trip ended'));
        out := out || '{"trip_check":true}';
      end if;
    end loop;
  end if;
  return out || jsonb_build_object('driving', driving, 'fresh', fresh, 'silent', silent);
end $fn$;

create or replace function public.car_telemetry_daily() returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare s car_telemetry_settings; fs tesla_fleet_settings;
begin
  if extract(hour from now() at time zone 'America/Los_Angeles') <> 3 then return jsonb_build_object('skip', 'not 3 AM PT'); end if;   -- cron fires at both 10:17 and 11:17 UTC
  select * into s from car_telemetry_settings where id = 1;
  if not found or not s.enabled or s.last_push_at is null then return jsonb_build_object('skip', 'disabled or never pushed'); end if;
  if coalesce(s.state->>'stopped_month', '') = to_char(now() at time zone 'UTC', 'YYYY-MM') then return jsonb_build_object('skip', 'stopped for spend'); end if;
  select * into fs from tesla_fleet_settings where id = 1;
  if fs.worker_version is null or semver_key(fs.worker_version) < semver_key('1.9.0') then return jsonb_build_object('skip', 'worker too old'); end if;
  if exists (select 1 from tesla_fleet_commands where action = 'telemetry_check' and created_at > now() - interval '2 hours') then return jsonb_build_object('skip', 'already queued'); end if;
  insert into tesla_fleet_commands (action, auto, args) values ('telemetry_check', true, jsonb_build_object('why', 'daily 3:17 AM PT'));
  return jsonb_build_object('queued', true);
end $fn$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. Grants: the forwarder (anon key) may call ingest + beat; the worker RPCs are token-gated (tesla_worker_ok);
--    the watchdog and daily check are for pg_cron only.
-- ---------------------------------------------------------------------------------------------------------------
revoke all on function public.car_telemetry_ingest(text, jsonb) from public, anon, authenticated;
revoke all on function public.car_telemetry_beat(text, jsonb) from public, anon, authenticated;
revoke all on function public.car_telemetry_push_args(text) from public, anon, authenticated;
revoke all on function public.car_telemetry_record(text, text, jsonb) from public, anon, authenticated;
revoke all on function public.car_telemetry_watchdog() from public, anon, authenticated;
revoke all on function public.car_telemetry_daily() from public, anon, authenticated;
grant execute on function public.car_telemetry_ingest(text, jsonb) to anon, authenticated;
grant execute on function public.car_telemetry_beat(text, jsonb) to anon, authenticated;
grant execute on function public.car_telemetry_push_args(text) to anon, authenticated;
grant execute on function public.car_telemetry_record(text, text, jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. Ownership, card pulse, schedules
-- ---------------------------------------------------------------------------------------------------------------
insert into public.notification_owners (prefix, agent_slug, note)
values ('car.telemetry', 'car-guard', 'Live car location (Fleet Telemetry): receiver, silence, certificate, spend')
on conflict (prefix) do nothing;

update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', coalesce(pulse->'also', '[]'::jsonb) || '["car-telemetry-watchdog","car-telemetry-daily"]'::jsonb), updated_at = now()
 where slug = 'car-guard' and not (coalesce(pulse->'also', '[]'::jsonb) ? 'car-telemetry-watchdog');

select cron.schedule('car-telemetry-watchdog', '1-59/2 * * * *', 'select public.car_telemetry_watchdog()');
select cron.schedule('car-telemetry-daily', '17 10,11 * * *', 'select public.car_telemetry_daily()');
