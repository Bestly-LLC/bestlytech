-- Delivery detection + "Next guest" delivery wording (2026-10-13).
-- Undo: bestly_memory key house/turo/delivery-detect-undo-2026-10-13 (original trip_place + admin_car_ready).
--
-- 1. trip_place: Turo tags custom-address deliveries as type STREET with deliveryLocation=false, the same as a home
--    pickup (Marcus 62275681, Los Angeles 90038, was shown the N Kings Rd home page). A STREET pickup is now 'home'
--    only when Turo's pin is within 1,200 m (~3/4 mi) of home_pickup_settings; anything farther is 'delivery'.
-- 2. delivery_settings.web_live = true: the delivery page is on bestly.tech (checked /t/demo-delivery 2026-10-13).
-- 3. admin_car_ready: next.place / next.delivery_* / next.miles, and for deliveries the charge target is what it takes
--    to ARRIVE at 80%+ (Jared's rule): 80 + drive use + 3 buffer, rounded up to 5, at least 90, at most 100.

create or replace function public.trip_place(p_reservation bigint) returns text
language sql stable security definer set search_path to 'public' as $function$
  select case
    when t.reservation_id is null then 'home'
    when coalesce(t.airport_code, '') = 'LAX' then 'lax'
    when t.raw is null or t.raw->'location' is null then 'home'
    when upper(coalesce(t.raw->'location'->>'type', '')) = 'STREET'
         and coalesce((t.raw->'location'->>'deliveryLocation')::boolean, false) = false
         and (hs.lat is null or (t.raw->'location'->>'latitude') is null
              or trip_dist_m((t.raw->'location'->>'latitude')::float8, (t.raw->'location'->>'longitude')::float8, hs.lat, hs.lon) <= 1200)
      then 'home'
    else 'delivery' end
  from (select 1) x
  left join public.turo_trips t on t.reservation_id = p_reservation
  left join public.home_pickup_settings hs on hs.id = 1
$function$;
revoke all on function public.trip_place(bigint) from public, anon, authenticated;

update public.delivery_settings set web_live = true, updated_at = now() where id;

create or replace function public.admin_car_ready()
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare s car_protect_settings; fs tesla_fleet_settings; v turo_vehicle_state; w car_watch; nx record; cur record; l lax_guest_links;
  checks jsonb := '[]'; tires jsonb; low numeric; hi numeric; wo boolean; spot text; last_trip record; wiped car_events; upd text; need int; state text;
  nx_place text; dj jsonb; dmiles numeric; full_range numeric;
begin
  if not has_role(auth.uid(), 'admin') and current_user not in ('postgres','supabase_admin') then raise exception 'admin only'; end if;
  select * into s from car_protect_settings where id = 1;
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = fs.vin;
  select * into w from car_watch where id = 1;
  select reservation_id, guest_first, starts_at, ends_at, airport_code into cur from turo_trips
   where now() between starts_at and ends_at and coalesce(status,'') not in ('test','CANCELLED','CANCELED') order by starts_at desc limit 1;
  select reservation_id, guest_first, starts_at, ends_at, airport_code into nx from turo_trips
   where starts_at > now() and coalesce(status,'') not in ('test','CANCELLED','CANCELED') order by starts_at limit 1;
  select reservation_id, ends_at into last_trip from turo_trips where ends_at < now() and coalesce(status,'') not in ('test','CANCELLED','CANCELED') order by ends_at desc limit 1;
  need := s.ready_charge_pct;
  -- Delivery: he drives it over, so it has to leave with enough to ARRIVE at 80%+.
  if nx.reservation_id is not null then nx_place := trip_place(nx.reservation_id); end if;
  if nx_place = 'delivery' then
    dj := trip_delivery_json(nx.reservation_id);
    if (dj->>'lat') is not null then
      -- Road miles ~ 1.3x straight line, from where the car is now (or home when unknown).
      dmiles := round((trip_dist_m(coalesce(v.latitude, (select lat from home_pickup_settings where id = 1)), coalesce(v.longitude, (select lon from home_pickup_settings where id = 1)),
                      (dj->>'lat')::float8, (dj->>'lon')::float8) * 1.3 / 1609.34)::numeric, 1);
    end if;
    full_range := case when v.range_real is not null and coalesce(v.battery_pct, 0) >= 20 then v.range_real * 100.0 / v.battery_pct else 192 end;
    need := least(100, greatest(90, (ceil((80 + coalesce(dmiles, 10) * 100.0 / full_range + 3) / 5.0) * 5)::int));
  end if;
  -- Charge
  checks := checks || jsonb_build_object('id','charge','label','Charge',
    'state', case when v.battery_pct is null then 'unknown' when v.battery_pct >= need then 'ok' else 'warn' end,
    'value', coalesce(v.battery_pct::text || '%', '—') || case when v.battery_pct < need then ' · needs ' || need || '%' else '' end
      || case when v.charging_state in ('Charging','Starting') then ' · charging' when coalesce(v.plugged_in, false) then ' · plugged in' else '' end,
    'action', case when v.battery_pct < need and coalesce(v.plugged_in, false) and v.charging_state not in ('Charging','Starting') and car_cmd_name('charge_start') is not null then 'charge_start' end,
    'hint', case when v.battery_pct < need and not coalesce(v.plugged_in, false) then 'Plug it in' end);
  -- Tires
  tires := w.health->'tires';
  select min(value::numeric), max(value::numeric) into low, hi from jsonb_each_text(coalesce(tires, '{}')) where value ~ '^[0-9.]+$';
  checks := checks || jsonb_build_object('id','tires','label','Tires',
    'state', case when low is null then 'unknown' when low < s.tire_low_psi or hi - low > s.tire_spread_psi then 'warn' else 'ok' end,
    'value', case when low is null then 'No reading yet' else concat_ws(' · ', round((tires->>'fl')::numeric), round((tires->>'fr')::numeric), round((tires->>'rl')::numeric), round((tires->>'rr')::numeric)) || ' psi' end,
    'at', w.health_at);
  -- Locked + windows
  wo := car_windows_open();
  checks := checks || jsonb_build_object('id','locked','label','Locked',
    'state', case when v.locked is null then 'unknown' when v.locked and coalesce(wo, false) = false then 'ok' else 'warn' end,
    'value', case when v.locked is null then 'No reading yet' when v.locked then 'Locked' else 'Unlocked' end
      || case when wo is true then ' · a window is open' when wo is false then ' · windows closed' else '' end,
    'action', case when v.locked is false then 'lock' when wo is true then 'windows_close' end);
  -- Software
  upd := coalesce(w.health->'update'->>'status', '');
  checks := checks || jsonb_build_object('id','software','label','Software',
    'state', case when w.health is null then 'unknown' when upd in ('available','downloaded','scheduled','installing') then 'warn' else 'ok' end,
    'value', case when w.health is null then 'No reading yet' when upd in ('available','downloaded','scheduled') then 'Update waiting · install between trips' when upd = 'installing' then 'Installing now' else 'No update waiting' end);
  -- Guest Data Wipe (Tesla's full erase is never used: it would also delete Jared's phone key and the TezLab / Bestly keys).
  checks := checks || jsonb_build_object('id','wipe','label','Guest Data Wipe',
    'state', case when last_trip.reservation_id is null then 'ok'
                  when exists (select 1 from tesla_guest_keys g where g.reservation_id = last_trip.reservation_id and g.status not in ('removed','off') and g.accepted_at is not null)
                    or exists (select 1 from trip_extra_drivers e where e.reservation_id = last_trip.reservation_id and e.status in ('ready','accepted')) then 'warn'
                  else 'ok' end,
    'value', case when last_trip.reservation_id is null then 'Nothing to remove yet'
                  when exists (select 1 from tesla_guest_keys g where g.reservation_id = last_trip.reservation_id and g.status not in ('removed','off') and g.accepted_at is not null)
                    or exists (select 1 from trip_extra_drivers e where e.reservation_id = last_trip.reservation_id and e.status in ('ready','accepted')) then 'Last guest still has access'
                  else 'Last guest''s key removed' end,
    'action', null);
  -- Parked at
  spot := car_spot(v.latitude, v.longitude);
  checks := checks || jsonb_build_object('id','spot','label','Parked at',
    'state', case when v.latitude is null then 'unknown' when spot is not null then 'ok' when cur.reservation_id is not null then 'ok' else 'warn' end,
    'value', case when spot = 'home' then 'N Kings Rd' when spot = 'lax' then 'LAX garage' when cur.reservation_id is not null then 'On ' || coalesce(cur.guest_first, 'a guest') || '''s trip'
      when v.latitude is null then 'No location yet' else 'Away from home and LAX' end);
  state := case when exists (select 1 from jsonb_array_elements(checks) c where c->>'state' = 'warn') then 'warn'
    when exists (select 1 from jsonb_array_elements(checks) c where c->>'state' = 'unknown') then 'partial' else 'ready' end;
  return jsonb_build_object('next', case when nx.reservation_id is not null then jsonb_build_object('guest', nx.guest_first, 'starts_at', nx.starts_at,
      'kind', lax_trip_kind(nx.airport_code), 'place', coalesce(nx_place, 'home'),
      'delivery_short', dj->>'short', 'delivery_address', dj->>'address', 'miles', dmiles, 'need_pct', need,
      'battery_pct', v.battery_pct) end,
    'on_trip', case when cur.reservation_id is not null then jsonb_build_object('guest', cur.guest_first, 'ends_at', cur.ends_at) end,
    'eta', (select to_jsonb(e) from car_eta e where e.reservation_id = cur.reservation_id and e.updated_at > now() - interval '20 minutes'),
    'checks', checks, 'state', state, 'checked_at', v.observed_at, 'sentry', s.flags->>'sentry',
    'warn_count', (select count(*) from jsonb_array_elements(checks) c where c->>'state' = 'warn'));
end $function$;
