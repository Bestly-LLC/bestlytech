-- C3 (2026-09-27): wall_pi_trips trips gain extras[] (add-ons the guest bought) and flags[] (what sets the
-- reservation apart). Source: the Turo upcoming-trips feed item already stored in turo_trips.raw by turo-ingest
-- (raw.extras [{label,value}], raw.location.deliveryLocation / pickupAndReturn, raw.hasPendingChangeRequest,
-- raw.actor.id), plus miles_included / miles_unlimited and trip_extra_drivers. No new ingest needed: every sync
-- rewrites raw, so new bookings carry it automatically. Labels are short (<= 22 chars) and keep a number glued
-- to its unit with a no-break space (U+00A0). Not in any Turo data we get: young driver, business trip, guest notes.

create or replace function public.turo_trip_tags(p_res bigint)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  t turo_trips; ex text[] := '{}'; fl text[] := '{}'; e jsonb; v text; lbl text; days int; n int; hr int;
  nb constant text := chr(160);
begin
  select * into t from turo_trips where reservation_id = p_res;
  if t.reservation_id is null then return jsonb_build_object('extras', '[]'::jsonb, 'flags', '[]'::jsonb); end if;

  -- Extras the guest bought (Turo's own list). Known codes get a short label, anything new keeps Turo's label.
  for e in select * from jsonb_array_elements(case when jsonb_typeof(t.raw->'extras') = 'array' then t.raw->'extras' else '[]'::jsonb end) loop
    v := upper(coalesce(e->>'value', ''));
    if v ~ 'PET' then
      fl := array_append(fl, 'Bringing a pet'); continue;
    end if;
    lbl := case
      when v ~ 'EV_RECHARGE|EV_CHARG' then 'EV recharge'
      when v ~ 'REFUEL|FUEL' then 'Prepaid refuel'
      when v ~ 'UNLIMITED' then 'Unlimited miles'
      when v ~ 'PHONE' then 'Phone mount'
      when v ~ 'CHILD|CAR_SEAT|BOOSTER|INFANT' then 'Child seat'
      when v ~ 'COOLER' then 'Cooler'
      when v ~ 'CLEAN' then 'Post-trip cleaning'
      when v ~ 'TOLL' then 'Prepaid tolls'
      when v ~ 'BEACH' then 'Beach gear'
      when v ~ 'CAMP' then 'Camping gear'
      when v ~ 'STROLLER' then 'Stroller'
      when v ~ 'SKI|SNOW' then 'Ski rack'
      when v ~ 'BIKE' then 'Bike rack'
      when v ~ 'GPS' then 'GPS'
      when v ~ 'EARLY' then 'Early pickup'
      when v ~ 'LATE' then 'Late return'
      else left(coalesce(nullif(e->>'label', ''), initcap(replace(lower(v), '_', ' '))), 22) end;
    if lbl is not null and lbl <> '' and not lbl = any (ex) then ex := array_append(ex, lbl); end if;
  end loop;

  days := greatest(1, ceil(extract(epoch from (t.ends_at - t.starts_at)) / 86400.0))::int;

  -- Mileage limit, per day like Turo shows it.
  if not coalesce(t.miles_unlimited, false) and coalesce(t.miles_included, 0) > 0 then
    fl := array_append(fl, round(t.miles_included::numeric / days)::int || nb || 'mi/day limit');
  end if;
  -- Delivery (Jared brings the car somewhere).
  if coalesce((t.raw->'location'->>'deliveryLocation')::boolean, false)
     or coalesce(t.raw->'location'->'pickupAndReturn'->>'value', '') ~* 'DELIVER' then
    fl := array_append(fl, 'Delivery');
  end if;
  -- Extra drivers (from Turo's "added another driver" emails).
  select count(*) into n from trip_extra_drivers d where d.reservation_id = p_res and coalesce(d.status, '') not in ('declined', 'rejected', 'cancelled');
  if n = 1 then fl := array_append(fl, 'Extra driver'); elsif n > 1 then fl := array_append(fl, n || nb || 'extra drivers'); end if;
  -- Long trip.
  if days > 7 then fl := array_append(fl, 'Long trip · ' || days || nb || 'days'); end if;
  -- Guest has booked with us before (history only goes back to 2026-09-23, so "first trip" is never claimed).
  if t.raw->'actor'->>'id' is not null and exists (select 1 from turo_trips o where o.reservation_id <> p_res and o.starts_at < t.starts_at
       and o.raw->'actor'->>'id' = t.raw->'actor'->>'id' and coalesce(o.status, '') !~* 'cancel') then
    fl := array_append(fl, 'Returning guest');
  end if;
  -- Change request waiting on Jared in Turo.
  if coalesce((t.raw->>'hasPendingChangeRequest')::boolean, false) then fl := array_append(fl, 'Change requested'); end if;
  -- Handoffs at odd hours (11 PM to 6 AM, LA time).
  hr := extract(hour from t.starts_at at time zone 'America/Los_Angeles');
  if hr >= 23 or hr < 6 then fl := array_append(fl, 'Late-night pickup'); end if;
  hr := extract(hour from t.ends_at at time zone 'America/Los_Angeles');
  if hr >= 23 or hr < 6 then fl := array_append(fl, 'Late-night return'); end if;

  return jsonb_build_object('extras', to_jsonb(ex), 'flags', to_jsonb(fl));
end $function$;
revoke execute on function public.turo_trip_tags(bigint) from public, anon, authenticated;

create or replace function public.wall_pi_trips(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'at', now(),
    'trips', coalesce((select jsonb_agg(jsonb_build_object(
        'id', t.reservation_id, 'vin', t.vin, 'guest', t.guest_first,
        'start', t.starts_at, 'end', t.ends_at, 'in_progress', t.in_progress, 'checked_out', t.checked_out,
        'status', t.status, 'airport', t.airport_code, 'address', t.pickup_address, 'city', t.pickup_city,
        'lat', t.pickup_lat, 'lon', t.pickup_lon,
        'extras', coalesce(g.tags->'extras', '[]'::jsonb), 'flags', coalesce(g.tags->'flags', '[]'::jsonb)) order by t.starts_at)
      from turo_trips t
      cross join lateral (select turo_trip_tags(t.reservation_id) as tags) g
      where t.ends_at > now() - interval '4 hours' and t.starts_at < now() + interval '36 hours'
        and coalesce(t.status, '') not ilike '%cancel%'), '[]'::jsonb),
    'cars', coalesce((select jsonb_agg(jsonb_build_object(
        'vin', v.vin, 'name', v.display_name, 'lat', v.latitude, 'lon', v.longitude, 'locked', v.locked,
        'online', v.connection_state, 'at', v.observed_at,
        'shift', coalesce(v.raw->'fleet_api'->>'shift_state', v.raw->>'shift_state'),
        'speed', coalesce(v.raw->'fleet_api'->>'speed', v.raw->>'speed')))
      from turo_vehicle_state v), '[]'::jsonb),
    'tesla', (select jsonb_build_object('lat', (raw->>'latitude')::float8, 'lon', (raw->>'longitude')::float8,
        'locked', locked, 'online', online, 'at', observed_at, 'shift', raw->>'shift_state', 'speed', raw->>'speed')
      from tesla_fleet_state where id = 1));
end $function$;
