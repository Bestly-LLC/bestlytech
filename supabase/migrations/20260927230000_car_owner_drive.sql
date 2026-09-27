-- C1 (2026-09-27): "Car moved with no trip booked" fired twice (11:22 AM, 12:02 PM) while Jared drove Blue Steel
-- home from the LAX garage after GianPaula's trip. car_owner_drive() decides whether a movement is Jared driving,
-- conservatively (any doubt = alert, and the alert now says why):
--   hard requirement: nobody but host drivers can drive it (no accepted guest / extra-driver key, no non-host
--                     driver on the car's Tesla driver list) and that driver list is fresh (< 3 h).
--   contradiction:    Jared's phone (Home Assistant person.jared) has been home the whole time but the car is away
--                     -> not Jared, alert.
--   then one of:
--   A came home together: car is at home and Jared's phone got home in the same window.
--   B trip handoff:       within 8 h of a trip ending at an away spot (LAX garage / away pickup), the car left that
--                         spot, is heading home, and Jared's phone is not at home.
--   C left together:      the car left home and Jared's phone left home within 10 min of it.
-- Suppressed movements are logged as car_events kind owner_drive (info; Scout bell line, no push) with the reason.

create or replace function public.car_owner_drive(p_cur_at timestamptz, p_cur_lat float8, p_cur_lon float8, p_prev_at timestamptz)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  hs home_pickup_settings; lt record; pres_state text; pres_changed timestamptz; pres_at timestamptz; pres_fresh boolean := false;
  cur_home float8; spot_lat float8; spot_lon float8; spot_home float8; last_at_spot timestamptz; max_home float8;
  last_home_at timestamptz; first_away timestamptz; drivers_at timestamptz; who text; sig jsonb;
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
  sig := jsonb_build_object('car_home_m', round(cur_home), 'jared', pres_state, 'jared_since', pres_changed, 'presence_fresh', pres_fresh);

  -- 1) Who else could drive it right now?
  select string_agg(x, ', ') into who from (
    select coalesce(k.driver_name, 'the guest') x from tesla_guest_keys k where k.status = 'accepted' and k.removed_at is null
    union all select coalesce(e.driver_name, e.name, 'an extra driver') from trip_extra_drivers e where e.accepted_at is not null and e.removed_at is null and coalesce(e.status, '') <> 'removed'
    union all select s.name from car_drivers_seen s where s.gone_at is null and s.share_user_id not in (select share_user_id from car_host_drivers)
  ) z;
  if who is not null then
    return jsonb_build_object('owner', false, 'reason', who || ' still has a key to the car', 'signals', sig);
  end if;
  select max(last_seen) into drivers_at from car_drivers_seen;
  if drivers_at is null or drivers_at < now() - interval '3 hours' then
    return jsonb_build_object('owner', false, 'reason', 'can''t confirm who has keys (the car''s driver list is more than 3 hours old)', 'signals', sig);
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

  return jsonb_build_object('owner', false, 'reason', case when not pres_fresh then 'your phone''s location isn''t available, so I can''t tell it''s you'
    else 'nothing shows it''s you (your phone is ' || case when pres_state = 'home' then 'home' else 'away from home' end || ')' end, 'signals', sig);
end $function$;
revoke execute on function public.car_owner_drive(timestamptz, float8, float8, timestamptz) from public, anon, authenticated;

-- car_protect_tick: route the "moved with no trip" check through car_owner_drive.
do $mig$
declare src text; old text; new text;
begin
  src := pg_get_functiondef('public.car_protect_tick'::regproc);
  old := $o$    perform car_event('moved_no_trip', 'warning', 'Car moved with no trip booked', 'It moved about ' || round((trip_dist_m(cur.lat, cur.lon, prev.lat, prev.lon) / 1609.34)::numeric, 1) || ' mi since ' ||
      to_char(prev.at at time zone 'America/Los_Angeles', 'FMHH12:MI AM') || '. If that''s you, ignore this.', 'moved-' || to_char(now(), 'YYYYMMDDHH24'), cur.lat, cur.lon, null);$o$;
  new := $n$    declare od jsonb := car_owner_drive(cur.at, cur.lat, cur.lon, prev.at);
    begin
      if coalesce((od->>'owner')::boolean, false) then
        -- Jared driving (C1): log it with the reason, Scout bell line only (info = no push), once per drive.
        perform car_event('owner_drive', 'info', 'Car moved: looks like you, so no alert', od->>'reason',
          'owner-' || coalesce(od->>'session', to_char(now(), 'YYYYMMDDHH24')), cur.lat, cur.lon, null, od);
      else
        perform car_event('moved_no_trip', 'warning', 'Car moved with no trip booked', 'It moved about ' || round((trip_dist_m(cur.lat, cur.lon, prev.lat, prev.lon) / 1609.34)::numeric, 1) || ' mi since ' ||
          to_char(prev.at at time zone 'America/Los_Angeles', 'FMHH12:MI AM') || '. Why I''m alerting: ' || coalesce(od->>'reason', 'no sign it''s you') || '. If that''s you, ignore this.',
          'moved-' || to_char(now(), 'YYYYMMDDHH24'), cur.lat, cur.lon, null, od);
      end if;
    end;$n$;
  if position(old in src) = 0 then raise exception 'car_protect_tick: moved_no_trip block not found'; end if;
  execute replace(src, old, new);
end $mig$;
