-- Car alerts that correct themselves (2026-10-15, Jared).
--  (a) "Car moved with no trip booked ... Marcus still has a key": the key claim came from car_drivers_seen rows with gone_at null.
--      Those only close when a key_check poll runs; the poller went quiet 19:56-23:45 UTC on 10-14, so a window stayed open and
--      the alert named a guest the car had not listed for hours. Also, with an empty driver list the old "list is fresh" test
--      (max(last_seen)) looked stale forever, so "only your key is on the car" could never be reached.
--  (b) "Done charging, move it" stayed unread after the car was unplugged and moved.
-- Fix: car_key_poll_at() = time of the latest driver-list snapshot; car_owner_drive only names a key holder from a FRESH list and
-- says "only your key" when the fresh list has no guest; car_alerts_sweep() (added to the existing car-watch cron) re-applies the
-- latest snapshot to close windows, asks for a new snapshot if the list is old, and marks stale charge/key alerts read.
-- No new cron, no new table, no personal data: no privacy_data_map or team-card change (car-watch is already owned).

create or replace function public.car_key_poll_at()
returns timestamptz language sql stable security definer set search_path to 'public' as $$
  select max(coalesce(done_at, created_at)) from public.tesla_fleet_commands where status = 'done' and result ? 'drivers'
$$;

-- car_owner_drive: name a key holder only from a FRESH driver list (poll within 30 min); fresh list with no guest = only Jared's key.
create or replace function public.car_owner_drive(p_cur_at timestamp with time zone, p_cur_lat double precision, p_cur_lon double precision, p_prev_at timestamp with time zone)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  hs home_pickup_settings; lt record; pres_state text; pres_changed timestamptz; pres_at timestamptz; pres_fresh boolean := false;
  cur_home float8; spot_lat float8; spot_lon float8; spot_home float8; last_at_spot timestamptz; max_home float8;
  last_home_at timestamptz; first_away timestamptz; poll_at timestamptz; list_fresh boolean; who text; sig jsonb;
begin
  select * into hs from home_pickup_settings where id = 1;
  if hs.lat is null or p_cur_lat is null then
    return jsonb_build_object('owner', false, 'reason', 'no home or car location to compare');
  end if;
  cur_home := trip_dist_m(p_cur_lat, p_cur_lon, hs.lat, hs.lon);

  -- Jared's phone, as Home Assistant sees it (Home Hub agent snapshot, refreshed every minute).
  select d->>'state', nullif(d->>'last_changed', '')::timestamptz, s.captured_at into pres_state, pres_changed, pres_at
    from home_hub_snapshots s, jsonb_array_elements(coalesce(s.data->'devices', '[]'::jsonb)) d
   where s.source = 'homeassistant' and d->>'entity_id' = 'person.jared' limit 1;
  pres_fresh := pres_at > now() - interval '15 minutes' and pres_state is not null and pres_state not in ('unknown', 'unavailable');

  poll_at := car_key_poll_at();
  list_fresh := poll_at is not null and poll_at > now() - interval '30 minutes';
  sig := jsonb_build_object('car_home_m', round(cur_home), 'jared', pres_state, 'jared_since', pres_changed, 'presence_fresh', pres_fresh,
                            'driver_list_at', poll_at, 'driver_list_fresh', list_fresh);

  -- 1) Who else holds a key right now? Only trust the car's driver list when it was read in the last 30 min.
  select string_agg(x, ', ') into who from (
    select coalesce(k.driver_name, 'the guest') x from tesla_guest_keys k where k.status = 'accepted' and k.removed_at is null
    union all select coalesce(e.driver_name, e.name, 'an extra driver') from trip_extra_drivers e where e.accepted_at is not null and e.removed_at is null and coalesce(e.status, '') <> 'removed'
    union all select s.name from car_drivers_seen s where list_fresh and s.gone_at is null and s.share_user_id not in (select share_user_id from car_host_drivers)
  ) z;
  if who is not null then
    return jsonb_build_object('owner', false, 'reason', who || ' still has a key to the car', 'signals', sig);
  end if;
  if not list_fresh then
    return jsonb_build_object('owner', false, 'reason', 'can''t confirm who has keys (the car''s driver list is more than 30 minutes old)', 'signals', sig);
  end if;

  -- 2) Contradiction: Jared's phone has been home the whole time, the car is not.
  if pres_fresh and pres_state = 'home' and pres_changed < p_prev_at - interval '5 minutes' and cur_home > 400 then
    return jsonb_build_object('owner', false, 'reason', 'your phone has been home since ' || to_char(pres_changed at time zone 'America/Los_Angeles', 'FMHH12:MI AM')
      || ' but the car is about ' || round((cur_home / 1609.34)::numeric, 1) || ' mi away', 'signals', sig);
  end if;

  -- A) Came home together.
  if cur_home <= 400 and pres_fresh and pres_state = 'home' and pres_changed >= p_prev_at - interval '20 minutes' then
    return jsonb_build_object('owner', true, 'case', 'home_together', 'session', 'home-' || to_char(pres_changed, 'YYYYMMDDHH24MI'),
      'reason', 'The car got home and so did your phone (' || to_char(pres_changed at time zone 'America/Los_Angeles', 'FMHH12:MI AM') || '). Only your key is on the car.', 'signals', sig);
  end if;

  -- B) Trip handoff: driving back from where the last trip ended.
  select tr.reservation_id, tr.guest_first, tr.ends_at, tr.airport_code, tr.pickup_lat, tr.pickup_lon into lt from turo_trips tr
   where tr.ends_at <= now() and tr.ends_at > now() - interval '8 hours' and coalesce(tr.status, '') not in ('test', 'CANCELLED', 'CANCELED')
   order by tr.ends_at desc limit 1;
  if lt.reservation_id is not null then
    if lax_trip_kind(lt.airport_code) = 'lax' then spot_lat := 33.9472637; spot_lon := -118.3826063;
    elsif lt.pickup_lat is not null and trip_dist_m(lt.pickup_lat, lt.pickup_lon, hs.lat, hs.lon) > 1500 then spot_lat := lt.pickup_lat; spot_lon := lt.pickup_lon;
    end if;
    if spot_lat is not null then
      spot_home := trip_dist_m(spot_lat, spot_lon, hs.lat, hs.lon);
      select max(at) into last_at_spot from car_trail where at between lt.ends_at - interval '1 hour' and p_cur_at and trip_dist_m(lat, lon, spot_lat, spot_lon) <= 500;
      select max(trip_dist_m(lat, lon, hs.lat, hs.lon)) into max_home from car_trail where at > last_at_spot and at <= p_cur_at;
      if last_at_spot is not null and p_cur_at - last_at_spot <= interval '3 hours'
         and cur_home < spot_home - 500 and coalesce(max_home, cur_home) <= spot_home + 1500
         and not (pres_fresh and pres_state = 'home' and pres_changed < last_at_spot) then
        return jsonb_build_object('owner', true, 'case', 'trip_handoff', 'session', 'handoff-' || lt.reservation_id,
          'reason', 'Driving back from ' || case when lax_trip_kind(lt.airport_code) = 'lax' then 'the LAX garage' else 'the trip''s return spot' end
            || ' after ' || coalesce(lt.guest_first, 'the guest') || '''s trip ended ' || to_char(lt.ends_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM')
            || '. Their key is removed and only your key is on the car' || case when pres_fresh then ', and your phone isn''t home' else '' end || '.', 'signals', sig);
      end if;
    end if;
  end if;

  -- C) Left home together.
  select max(at) into last_home_at from car_trail where at <= p_cur_at and trip_dist_m(lat, lon, hs.lat, hs.lon) <= 250;
  select min(at) into first_away from car_trail where at > last_home_at and at <= p_cur_at;
  if cur_home > 400 and last_home_at > p_cur_at - interval '4 hours' and pres_fresh and pres_state <> 'home'
     and pres_changed between last_home_at - interval '10 minutes' and coalesce(first_away, p_cur_at) + interval '10 minutes' then
    return jsonb_build_object('owner', true, 'case', 'left_together', 'session', 'left-' || to_char(last_home_at, 'YYYYMMDDHH24MI'),
      'reason', 'Your phone left home with the car (' || to_char(pres_changed at time zone 'America/Los_Angeles', 'FMHH12:MI AM') || '). Only your key is on the car.', 'signals', sig);
  end if;

  -- D) (2026-10-15) The car's own driver list, read in the last 30 min, shows no guest, host driver or extra driver:
  --    Jared's key is the only one on it, so a move with no trip booked was him. Silent info, not an alert.
  return jsonb_build_object('owner', true, 'case', 'only_key', 'session', 'onlykey-' || to_char(p_cur_at at time zone 'America/Los_Angeles', 'YYYYMMDDHH24'),
    'reason', 'No guest holds a key (the car''s driver list was read ' || round(extract(epoch from now() - poll_at) / 60) || ' min ago), so only your key is on the car', 'signals', sig);
end $function$;

-- Sweep: runs inside the existing car-watch cron (every 5 min), so no new schedule and no new team card.
create or replace function public.car_alerts_sweep()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  fs tesla_fleet_settings; v turo_vehicle_state; lp record; cur car_trail; prev car_trail;
  open_before int; open_after int; n_charge int := 0; n_moved int := 0; queued boolean := false; list_fresh boolean; moved boolean := false;
begin
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = fs.vin;

  -- 1) Re-apply the latest driver-list snapshot: anyone the car no longer lists gets their window closed (gone_at).
  select r.id, r.result, coalesce(r.done_at, r.created_at) as at into lp from tesla_fleet_commands r
   where r.status = 'done' and r.result ? 'drivers' and jsonb_typeof(r.result->'drivers') = 'array'
   order by coalesce(r.done_at, r.created_at) desc limit 1;
  select count(*) into open_before from car_drivers_seen where gone_at is null;
  if lp.id is not null then perform car_drivers_sync(lp.result->'drivers', lp.at); end if;
  select count(*) into open_after from car_drivers_seen where gone_at is null;
  list_fresh := lp.at is not null and lp.at > now() - interval '30 minutes';

  -- 2) Done-charging alerts clear themselves once the car is no longer plugged in and complete (unplugged or moved).
  if v.vin is not null and not (coalesce(v.plugged_in, false) and v.charging_state = 'Complete') then
    update admin_notifications set read_at = now()
     where read_at is null and (dedupe_key like 'car-charge\_done:%' or dedupe_key like 'car-charge\_idle:%');
    get diagnostics n_charge = row_count;
  end if;

  -- 3) "Moved with no trip booked ... X still has a key": clear when the fresh list shows nobody but the host on the car.
  if list_fresh and not exists (select 1 from car_drivers_seen s where s.gone_at is null and s.share_user_id not in (select share_user_id from car_host_drivers))
     and not exists (select 1 from tesla_guest_keys k where k.status = 'accepted' and k.removed_at is null) then
    update admin_notifications set read_at = now()
     where read_at is null and dedupe_key like 'carev-moved-%' and body like '%still has a key%';
    get diagnostics n_moved = row_count;
  end if;

  -- 4) Driver list older than 30 min and the car just moved: ask for a fresh read so the next car-protect tick can tell who has keys.
  select * into cur from car_trail order by at desc limit 1;
  select * into prev from car_trail where at < cur.at order by at desc limit 1;
  moved := cur.id is not null and prev.id is not null and cur.at > now() - interval '40 minutes' and trip_dist_m(cur.lat, cur.lon, prev.lat, prev.lon) > 300;
  if moved and not list_fresh and not exists (select 1 from tesla_fleet_commands where action = 'key_check' and created_at > now() - interval '10 minutes') then
    insert into tesla_fleet_commands (action, auto, args) values ('key_check', true, '{"baseline":[],"by":"car-alerts-sweep"}');
    queued := true;
  end if;

  return jsonb_build_object('windows_closed', open_before - open_after, 'charge_alerts_cleared', n_charge, 'moved_alerts_cleared', n_moved,
                            'driver_list_at', lp.at, 'key_check_queued', queued);
end $function$;

revoke all on function public.car_alerts_sweep() from public, anon, authenticated;
revoke all on function public.car_key_poll_at() from public, anon, authenticated;

-- Hook the sweep into the existing car-watch job (same name, same 5-minute schedule).
select cron.alter_job((select jobid from cron.job where jobname = 'car-watch'), command := 'select public.car_watch_tick(), public.car_alerts_sweep()');

-- One-off data fixes (2026-10-15): Marcus Mcknight's driver window is already closed (gone_at 2026-10-14 23:45 UTC, the next poll
-- after the 4-hour gap); the car's latest list is empty. Mark the two alerts Jared flagged as read, the way the bell does (read_at).
update public.car_drivers_seen set gone_at = coalesce(gone_at, now()) where share_user_id = '2534043385192706' and gone_at is null;
update public.admin_notifications set read_at = now()
 where id in ('3f76191c-1fe7-4b32-b3fe-3671b83786b1', '28067361-d655-405b-9920-bd1f09297476') and read_at is null;
