-- Street sweeping, per block (2026-09-29).
-- Jared: N Kings Rd has different sweep days per block. The 700 block (Melrose to Waring, home at 733) is
-- west curb Monday / east curb Tuesday; the 800 block (Waring to Willoughby) is west curb Thursday / east
-- curb Friday, 8-10 AM. The old check treated Melrose-Willoughby as one Mon/Tue block, so a car on the
-- 800 block would never be warned on Thursday.
--
-- Now:
--   bluesteel_sweep_zones      one row per block: bounds, curb split, sweep day per curb, calibration points
--   bluesteel_sweep_locate()   (lat, lon) -> block + curb + that curb's sweep day
--   bluesteel_sweep_car()      newest position from our own car data (turo_vehicle_state / car_trail)
--   bluesteel_sweep_tick()     pg_cron every 5 min; on sweep mornings 6:55-9:59 AM it pushes MOVE BLUE STEEL
--                              (every ~30 min), logs checks, and clears the alert when the car moves.
--                              Replaces the two Claude scheduled tasks (they cost a session each run and
--                              depended on the TezLab connector, which failed on Sep 28).
--   bluesteel_sweep_watch()    Scout watchdog: re-runs the tick and raises car.sweep_check if checks stop.
--   wall_pi_snapshot()         the wall + iPhone Live Activity "Move the car" card follows any block's day.

-- ---------------------------------------------------------------- blocks
create table if not exists public.bluesteel_sweep_zones (
  id text primary key,
  name text not null,                 -- "800 block"
  between_streets text not null,      -- "Waring to Willoughby"
  street text not null default 'N Kings Rd',
  lat_min double precision not null,
  lat_max double precision not null,
  lon_min double precision not null,
  lon_max double precision not null,
  split_lon double precision not null, -- east of this = east curb
  west_dow smallint check (west_dow between 0 and 6),  -- 0 = Sunday
  east_dow smallint check (east_dow between 0 and 6),
  start_min smallint not null default 480,  -- 8:00 AM
  end_min smallint not null default 600,    -- 10:00 AM
  fine_usd smallint not null default 75,
  calibration jsonb not null default '[]'::jsonb,  -- [{lat, lon, side, at, note}]
  sort smallint not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.bluesteel_sweep_zones enable row level security;
revoke all on public.bluesteel_sweep_zones from anon, authenticated;

-- Bounds from OpenStreetMap (Kings Rd centerline -118.37174; Melrose 34.08367, Waring 34.08538,
-- Willoughby 34.08706); curbs sit ~15 ft either side of the centerline.
insert into public.bluesteel_sweep_zones
  (id, name, between_streets, lat_min, lat_max, lon_min, lon_max, split_lon, west_dow, east_dow, sort, calibration)
values
  ('kings-700', '700 block', 'Melrose to Waring', 34.08375, 34.08532, -118.37195, -118.37160, -118.37175, 1, 2, 1,
   jsonb_build_array(jsonb_build_object('lat', 34.0847, 'lon', -118.3718, 'side', 'west', 'at', '2026-09-15',
     'note', 'Parked west curb in front of home; curb split confirmed by Jared'))),
  ('kings-800', '800 block', 'Waring to Willoughby', 34.08545, 34.08700, -118.37195, -118.37160, -118.37175, 4, 5, 2,
   jsonb_build_array(jsonb_build_object('lat', 34.085595, 'lon', -118.371809, 'side', 'west', 'at', '2026-09-29',
     'note', 'Jared: parked just north of home, west curb, swept Thursdays 8-10 AM; east curb Fridays')))
on conflict (id) do nothing;

alter table public.bluesteel_sweep_runs add column if not exists zone text;

create or replace function public.bluesteel_dow_name(p_dow int)
returns text language sql immutable as $$
  select (array['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'])[p_dow + 1]
$$;

create or replace function public.bluesteel_min12(p_min int)
returns text language sql immutable as $$
  select ((p_min / 60 + 11) % 12 + 1)::text
         || case when p_min % 60 = 0 then '' else ':' || lpad((p_min % 60)::text, 2, '0') end
         || case when p_min < 720 then ' AM' else ' PM' end
$$;

-- (lat, lon) -> which block and curb, and when that curb is swept. Null when not on a known block.
create or replace function public.bluesteel_sweep_locate(p_lat double precision, p_lon double precision)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object(
    'zone', z.id, 'name', z.name, 'between', z.between_streets, 'street', z.street,
    'side', s.side,
    'dow', case s.side when 'west' then z.west_dow else z.east_dow end,
    'day', bluesteel_dow_name(case s.side when 'west' then z.west_dow else z.east_dow end),
    'start_min', z.start_min, 'end_min', z.end_min, 'fine_usd', z.fine_usd)
  from bluesteel_sweep_zones z
  cross join lateral (select case when p_lon > z.split_lon then 'east' else 'west' end as side) s
  where z.active and p_lat between z.lat_min and z.lat_max and p_lon between z.lon_min and z.lon_max
  order by z.sort limit 1
$$;

-- Newest known position of Blue Steel from our own feeds (the Tesla worker writes both every ~20 min).
create or replace function public.bluesteel_sweep_car()
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select to_jsonb(p) from (
    select latitude as lat, longitude as lon, observed_at as at, 'vehicle_state' as source
      from turo_vehicle_state
     where vin = '5YJ3E1EAXLF658422' and latitude is not null and observed_at is not null
    union all
    select * from (select lat, lon, at, 'car_trail' from car_trail
                    where vin = '5YJ3E1EAXLF658422' and lat is not null order by at desc limit 1) t
    order by 3 desc limit 1) p
$$;

-- ---------------------------------------------------------------- the check
create or replace function public.bluesteel_sweep_tick(p_force boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_la    timestamp := now() at time zone 'America/Los_Angeles';
  v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_dow   int := extract(dow from now() at time zone 'America/Los_Angeles');
  v_min   int := extract(hour from now() at time zone 'America/Los_Angeles')::int * 60
                 + extract(minute from now() at time zone 'America/Los_Angeles')::int;
  v_day_start timestamptz := (date_trunc('day', now() at time zone 'America/Los_Angeles')) at time zone 'America/Los_Angeles';
  c       record;
  v_car   jsonb; v_loc jsonb;
  v_lat   double precision; v_lon double precision; v_age_min int;
  v_out   text; v_side text; v_zone text; v_title text; v_body text; v_note text;
  v_last  record; v_last_push timestamptz;
  v_push  boolean := false; v_log boolean;
  v_req   bigint;
  v_today_curbs text;
begin
  -- Only on a morning when some block is swept, from 6:55 AM until the window closes.
  select string_agg(format('%s curb of the %s', s.side, z.name), ' and ' order by z.sort, s.side) into v_today_curbs
    from bluesteel_sweep_zones z
    cross join lateral (values ('west', z.west_dow), ('east', z.east_dow)) s(side, dow)
   where z.active and s.dow = v_dow;
  if v_today_curbs is null then return jsonb_build_object('skip', 'no block is swept today'); end if;
  if not p_force and (v_min < 415 or v_min >= 600) then return jsonb_build_object('skip', 'outside the 6:55-10 AM window'); end if;

  select * into c from bluesteel_sweep_config where id = 1;
  select * into v_last from bluesteel_sweep_runs
   where ran_at >= v_day_start and outcome <> 'test' order by ran_at desc limit 1;
  select max(ran_at) into v_last_push from bluesteel_sweep_runs
   where ran_at >= v_day_start and outcome in ('alerted', 'location_error') and ntfy_request_id is not null;

  if not c.alerts_enabled then
    v_out := 'disabled';
  elsif v_today = any(c.skip_dates) then
    v_out := 'skipped';
  elsif exists (select 1 from bluesteel_sweep_acks a where a.acked_at >= v_day_start and coalesce(a.via, '') not like 'test%') then
    v_out := 'acknowledged';
  else
    v_car := bluesteel_sweep_car();
    v_lat := (v_car->>'lat')::double precision;
    v_lon := (v_car->>'lon')::double precision;
    v_age_min := (extract(epoch from now() - (v_car->>'at')::timestamptz) / 60)::int;
    if v_car is null or v_age_min > 12 * 60 then
      v_out := 'location_error';
      v_title := 'CHECK BLUE STEEL';
      v_body := 'Couldn''t read the car''s location. Check it yourself: today the ' || v_today_curbs
                || ' of N Kings Rd are swept, 8-10 AM. $75 ticket.';
    else
      v_loc := bluesteel_sweep_locate(v_lat, v_lon);
      if v_loc is null then
        v_out := 'not_on_street';
      else
        v_side := v_loc->>'side'; v_zone := v_loc->>'zone';
        if (v_loc->>'dow')::int = v_dow and v_min < (v_loc->>'end_min')::int then
          v_out := 'alerted';
          v_title := 'MOVE BLUE STEEL';
          v_body := format('Parked on the %s side of N Kings Rd (%s, %s). ', upper(v_side), v_loc->>'name', v_loc->>'between')
            || case when v_min < (v_loc->>'start_min')::int
                    then format('Sweeping starts %s (%s min). ', bluesteel_min12((v_loc->>'start_min')::int), (v_loc->>'start_min')::int - v_min)
                    else format('Sweeping NOW until %s (%s min left). ', bluesteel_min12((v_loc->>'end_min')::int), (v_loc->>'end_min')::int - v_min) end
            || format('$%s ticket.', v_loc->>'fine_usd')
            || case when v_age_min > 120 then format(' Last seen %s h ago.', round(v_age_min / 60.0)) else '' end;
        else
          v_out := 'safe_side';
          v_note := format('%s curb, %s (%s): swept %ss', initcap(v_side), v_loc->>'name', v_loc->>'between', v_loc->>'day');
        end if;
      end if;
    end if;
  end if;

  -- Push MOVE / CHECK about every 30 min (and at once when it starts or the curb changes).
  if v_out in ('alerted', 'location_error') then
    v_push := v_last_push is null or v_last_push < now() - interval '28 minutes'
              or v_last.outcome is distinct from v_out or v_last.side is distinct from v_side
              or v_last.zone is distinct from v_zone;
  end if;
  if v_push then
    v_req := bluesteel_sweep_send_alert(v_title, v_body);
  end if;

  -- The car moved off a swept curb after an alert: take the alert down and say so.
  if v_last.outcome = 'alerted' and v_out in ('safe_side', 'not_on_street') then
    perform ha_push('Blue Steel', null, 'passive', 'Blue Steel', null, 'bluesteel', 'bluesteel-sweep', null, null, true);
    perform ha_push('Blue Steel moved', 'It''s off the swept curb now. No more sweeping alerts this morning.',
      'passive', 'Blue Steel', 'https://bestly.tech/admin/street-sweeping', 'bluesteel', 'bluesteel-moved');
  end if;

  -- Log on every push, on any change, and at least every 30 min.
  v_log := v_push or v_last.id is null
           or v_last.outcome is distinct from v_out or v_last.side is distinct from v_side
           or v_last.zone is distinct from v_zone or v_last.ran_at < now() - interval '28 minutes';
  if v_log then
    insert into bluesteel_sweep_runs (ran_at, outcome, side, latitude, longitude, alert_title, alert_body, ntfy_request_id, note, zone)
    values (now(), v_out, v_side, v_lat, v_lon, case when v_push then v_title end, case when v_out in ('alerted','location_error') then v_body end,
            v_req, coalesce(v_note, case when v_out = 'alerted' and not v_push then 'still there; next push within 30 min' end), v_zone);
  end if;

  return jsonb_build_object('outcome', v_out, 'zone', v_zone, 'side', v_side, 'pushed', v_push, 'logged', v_log,
                            'car_age_min', v_age_min, 'la', to_char(v_la, 'Dy FMHH12:MI AM'));
end $$;
revoke all on function public.bluesteel_sweep_tick(boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- Scout watchdog
create or replace function public.bluesteel_sweep_watch()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_dow int := extract(dow from now() at time zone 'America/Los_Angeles');
  v_min int := extract(hour from now() at time zone 'America/Los_Angeles')::int * 60
               + extract(minute from now() at time zone 'America/Los_Angeles')::int;
  v_last timestamptz; v_heal jsonb; v_car jsonb; v_age int; v_bad text[] := '{}';
begin
  if not exists (select 1 from bluesteel_sweep_zones where active and v_dow in (west_dow, east_dow))
     or v_min < 425 or v_min >= 600 then
    return jsonb_build_object('skip', true);
  end if;
  select max(ran_at) into v_last from bluesteel_sweep_runs where outcome <> 'test';
  if v_last is null or v_last < now() - interval '35 minutes' then
    v_heal := bluesteel_sweep_tick();
    select max(ran_at) into v_last from bluesteel_sweep_runs where outcome <> 'test';
    if v_last is null or v_last < now() - interval '35 minutes' then
      v_bad := v_bad || 'the street-sweeping check has not logged anything this morning';
    end if;
  end if;
  v_car := bluesteel_sweep_car();
  v_age := (extract(epoch from now() - (v_car->>'at')::timestamptz) / 60)::int;
  if v_car is null or v_age > 180 then
    v_bad := v_bad || format('the car''s position is %s old (the Tesla worker on the Mac mini feeds it)',
                             case when v_car is null then 'missing' else round(v_age / 60.0) || ' h' end);
  end if;
  if array_length(v_bad, 1) > 0 then
    perform bestly_raise('car.sweep_check', 'problem', 'warning', 'Street-sweeping check needs a look',
      'Sweep morning: ' || array_to_string(v_bad, '; ') || '. Check which curb Blue Steel is on yourself.',
      'car', 'Check the car''s curb yourself this morning', v_heal is not null);
  else
    perform bestly_raise('car.sweep_check', 'resolved', 'info', 'Street-sweeping check is running',
      'Checks are logging and the car''s position is current.', 'car', null, false);
  end if;
  return jsonb_build_object('last_run', v_last, 'car_age_min', v_age, 'healed', v_heal, 'bad', v_bad);
end $$;
revoke all on function public.bluesteel_sweep_watch() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname in ('bluesteel-sweep-tick', 'bluesteel-sweep-watch');
select cron.schedule('bluesteel-sweep-tick', '*/5 * * * *', $$select public.bluesteel_sweep_tick()$$);
select cron.schedule('bluesteel-sweep-watch', '3-59/15 * * * *', $$select public.bluesteel_sweep_watch()$$);

-- ---------------------------------------------------------------- wall + iPhone card
-- Same card as before ({side, live}); it now follows whichever block the car is on, any sweep day.
create or replace function public.wall_pi_snapshot(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_trip   record;
  v_car    record;
  v_turo   jsonb;
  v_sweep  jsonb := null;
  v_run    record;
  v_zone   record;
  v_la     timestamp := (now() at time zone 'America/Los_Angeles');
  v_mins   int := extract(hour from v_la)::int * 60 + extract(minute from v_la)::int;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;

  -- Turo: the trip in progress (next event = its return), else the next booking (next event = pickup)
  select * into v_trip from turo_trips
   where ends_at > now() and coalesce(status,'') not ilike '%cancel%'
   order by (in_progress is true) desc, starts_at asc limit 1;
  select display_name, battery_pct, observed_at into v_car from turo_vehicle_state
   order by observed_at desc nulls last limit 1;
  v_turo := jsonb_build_object(
    'car', coalesce(v_car.display_name, 'Blue Steel'),
    'battery_pct', v_car.battery_pct,
    'battery_at', v_car.observed_at,
    'trip', case when v_trip.reservation_id is null then null else jsonb_build_object(
      'kind', case when v_trip.in_progress or v_trip.starts_at <= now() then 'return' else 'pickup' end,
      'at',   case when v_trip.in_progress or v_trip.starts_at <= now() then v_trip.ends_at else v_trip.starts_at end,
      'guest', v_trip.guest_first,
      'place', case when v_trip.airport_code is not null then v_trip.airport_code else 'Home' end) end);

  -- Street sweeping: today's latest check found the car on a curb being swept today, and it isn't acknowledged.
  if v_mins between 415 and 599 then
    select * into v_run from bluesteel_sweep_runs
     where ran_at >= date_trunc('day', v_la) at time zone 'America/Los_Angeles' and outcome <> 'test'
     order by ran_at desc limit 1;
    if v_run.outcome = 'alerted' and v_run.side is not null
       and not exists (select 1 from bluesteel_sweep_acks a where a.acked_at >= v_run.ran_at and coalesce(a.via, '') not like 'test%') then
      select * into v_zone from bluesteel_sweep_zones where id = v_run.zone;
      v_sweep := jsonb_build_object('side', v_run.side, 'live', v_mins >= coalesce(v_zone.start_min, 480),
                                    'block', v_zone.name, 'between', v_zone.between_streets);
    end if;
  end if;

  return jsonb_build_object(
    'at', now(),
    'turo', v_turo,
    'sweep', v_sweep,
    'today', wall_today(),
    'scout', jsonb_build_object(
      'open', (select count(*) from monitor_issues where status = 'open' and key not like 'wall.test%'),
      'needs_you', (select count(*) from monitor_issues where status = 'open' and needs_jared is not null),
      'top', (select title from monitor_issues where status = 'open'
               order by (severity = 'error') desc, (needs_jared is not null) desc, opened_at desc limit 1),
      'top_error', exists (select 1 from monitor_issues where status = 'open' and severity = 'error')),
    'home', jsonb_build_object(
      'hub_issues', (select count(*) from home_hub_issues where status = 'open'),
      'lights_on', (select count(*) from home_hub_snapshots s, jsonb_array_elements(s.data->'devices') d
                     where s.source = 'homeassistant' and d->>'domain' = 'light' and d->>'state' = 'on'),
      'pi_seen', (select last_seen_at from home_hub_agent_state where agent = 'home-hub')));
end $function$;

-- ---------------------------------------------------------------- admin
create or replace function public.admin_bluesteel_sweep_state()
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_car jsonb := bluesteel_sweep_car();
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'config', (select to_jsonb(c) from bluesteel_sweep_config c where id = 1),
    'la_today', bluesteel_la_today(),
    'acked_today', exists(
      select 1 from bluesteel_sweep_acks a
      where (a.acked_at at time zone 'America/Los_Angeles')::date = bluesteel_la_today()
        and coalesce(a.via, '') not like 'test%'),
    'car', case when v_car is null then null
                else v_car || jsonb_build_object('where', bluesteel_sweep_locate((v_car->>'lat')::float8, (v_car->>'lon')::float8)) end,
    'zones', coalesce((select jsonb_agg(to_jsonb(z) order by z.sort) from bluesteel_sweep_zones z where z.active), '[]'::jsonb),
    'last_location', (
      select to_jsonb(r) from (
        select ran_at, side, latitude, longitude, outcome, zone
        from bluesteel_sweep_runs where latitude is not null
        order by ran_at desc limit 1) r),
    'runs', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.ran_at desc) from (
        select id, ran_at, outcome, side, latitude, longitude, alert_title, alert_body, note, zone
        from bluesteel_sweep_runs order by ran_at desc limit 40) r), '[]'::jsonb),
    'acks', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.acked_at desc) from (
        select id, acked_at, via from bluesteel_sweep_acks order by acked_at desc limit 20) a), '[]'::jsonb)
  );
end $function$;

-- Admin: add a calibration point ("the car is here right now, and it's on the <side> curb").
create or replace function public.admin_bluesteel_sweep_calibrate(p_zone text, p_side text, p_note text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_car jsonb := bluesteel_sweep_car(); v_z bluesteel_sweep_zones;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only' using errcode = '42501'; end if;
  if p_side not in ('west', 'east') then raise exception 'side must be west or east'; end if;
  if v_car is null then raise exception 'No car position to calibrate from'; end if;
  update bluesteel_sweep_zones
     set calibration = calibration || jsonb_build_array(jsonb_build_object(
           'lat', (v_car->>'lat')::float8, 'lon', (v_car->>'lon')::float8, 'side', p_side,
           'at', to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'), 'note', coalesce(p_note, 'Marked from admin'))),
         -- widen the block to include the point, and keep the curb split on the right side of it
         lat_min = least(lat_min, (v_car->>'lat')::float8 - 0.00003),
         lat_max = greatest(lat_max, (v_car->>'lat')::float8 + 0.00003),
         split_lon = case
           when p_side = 'west' and (v_car->>'lon')::float8 > split_lon then (v_car->>'lon')::float8 + 0.00002
           when p_side = 'east' and (v_car->>'lon')::float8 <= split_lon then (v_car->>'lon')::float8 - 0.00002
           else split_lon end,
         updated_at = now()
   where id = p_zone
   returning * into v_z;
  if v_z.id is null then raise exception 'Unknown block'; end if;
  return to_jsonb(v_z);
end $$;
revoke all on function public.admin_bluesteel_sweep_calibrate(text, text, text) from public, anon;
grant execute on function public.admin_bluesteel_sweep_calibrate(text, text, text) to authenticated;
