-- 2026-10-31 admin cleanup part 2, item 8 (Blue Steel telemetry).
-- Receiver (fleet-telemetry on Hestia) and the reverse-SSH tunnel to the AWS relay were verified healthy end to end;
-- the daily check was re-raising a STALE Tesla error (older than the car's last successful stream) and treating a
-- stream error on Standard Connectivity as a warning. Now: stale errors are ignored; a stream error on Standard
-- Connectivity is an FYI (healed info, no card). Worker side: tesla-worker records check.last_error (scripts/pi/tesla-worker).

CREATE OR REPLACE FUNCTION public.car_telemetry_watchdog()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- 2026-10-31: Tesla keeps old entries in fleet_telemetry_errors. A streaming error that predates the car's last
  -- successful stream (last_record_at) is history, not a problem: the Oct 30 04:35 UTC "context deadline exceeded"
  -- sat in the list while the car streamed for 13 hours afterwards. The worker now records the entry as check.last_error.
  if prob is not null and prob ilike '%stream%' and s.last_record_at is not null
     and nullif(chk->'last_error'->>'created_at', '') is not null
     and (chk->'last_error'->>'created_at')::timestamptz < s.last_record_at then
    prob := null;
  end if;
  if chk is not null and (chk->>'at')::timestamptz > now() - interval '26 hours' and prob is not null then
    -- raise once per daily check result, not every 2 minutes
    if not exists (select 1 from monitor_events e where e.key = 'car.telemetry.config' and e.kind = 'problem' and e.created_at >= (chk->>'at')::timestamptz) then
    if prob <> 'key_missing' and prob ilike '%stream%' and now() >= (timestamp '2026-10-26 00:00:00' at time zone 'America/Los_Angeles') then
      -- Standard Connectivity (Premium ended Oct 25): a stream error is expected off Wi-Fi. FYI only (healed info = no card,
      -- one monitor_event per 6 h), the maps keep using TezLab. car.telemetry.premium already covers the drive-time case.
      perform bestly_raise('car.telemetry.config', 'problem', 'info', 'Blue Steel streaming error (expected on Standard Connectivity)',
        'The daily check saw: ' || left(prob, 240) || ' Premium Connectivity ended Oct 25, so streaming only works on Wi-Fi; the maps keep using TezLab updates. The receiver on Hestia and the relay tunnel are checked separately.', 'turo', null, true);
    else
    perform bestly_raise('car.telemetry.config', 'problem', 'warning', 'Blue Steel isn''t set up for live location',
      case when prob = 'key_missing'
           then 'Tesla says the Bestly virtual key isn''t on the car, so I can''t send the streaming settings. This is the same thing as the Tesla re-pair alert; fixing that fixes this.'
           else 'The daily check found a problem: ' || left(prob, 240) end, 'turo', null, true);
    end if;
    end if;
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
end $function$;
