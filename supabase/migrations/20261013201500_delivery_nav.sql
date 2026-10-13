-- Delivery route to the car (Car Guard). Docs: docs/delivery-nav-opusplan.md
-- Before Jared drives Blue Steel to a delivery address, a named spot (hotel, Union Station) or the LAX Park My Share garage,
-- the car's navigation already shows that destination. Errands he runs first never get the delivery route pushed onto them.
-- Commands go through tesla_fleet_commands (action nav_point) and are routed to TezLab by the tesla_cmd_route trigger. Never the paid Tesla API.
-- Nothing existing is replaced by this migration (no undo copy of old functions needed). Undo: see bestly_memory house/turo/delivery-nav-2026-10-13.

-- 1) Tables -----------------------------------------------------------------------------------------------------------------
create table if not exists public.trip_delivery_geo(
  reservation_id bigint primary key,
  address text,
  lat float8, lon float8,
  source text,                       -- census | nominatim
  geocoded_at timestamptz,
  error text,                        -- not_exact | no_address | failed: <why>
  req_id bigint, req_source text, req_at timestamptz,
  tries int not null default 0,
  pin_miles numeric,                 -- distance from Turo's approximate pin (sanity check, must be within 3 mi)
  guest_phone text,                  -- only so the Privacy Clerk can find and remove this row with the guest
  updated_at timestamptz not null default now()
);
alter table public.trip_delivery_geo enable row level security;

create table if not exists public.delivery_nav_settings(
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  lead_hours numeric not null default 5 check (lead_hours between 1 and 12),
  max_sends int not null default 3 check (max_sends between 1 and 5),
  last_decision jsonb,
  last_tick_at timestamptz,
  last_watchdog_at timestamptz,
  last_nudge_at timestamptz,
  alerted jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.delivery_nav_settings enable row level security;
insert into public.delivery_nav_settings(id) values (1) on conflict do nothing;

create table if not exists public.delivery_nav_sends(
  id bigint generated always as identity primary key,
  reservation_id bigint not null,
  at timestamptz not null default now(),
  trigger text not null check (trigger in ('parked', 'heading', 'manual')),
  dest_lat float8, dest_lon float8, label text,
  car_lat float8, car_lon float8,
  cmd_id bigint,
  status text not null default 'queued' check (status in ('queued', 'done', 'failed')),
  error text,
  noted boolean not null default false,
  guest_phone text                   -- only so the Privacy Clerk can find and remove this row with the guest
);
create index if not exists delivery_nav_sends_res_idx on public.delivery_nav_sends(reservation_id, at desc);
alter table public.delivery_nav_sends enable row level security;

-- 2) Privacy map (Vera): address text is personal, so both tables go with the guest's phone number; the watchdog also blanks them 14 days after the trip.
insert into public.privacy_data_map(table_name, column_name, match_kind, action, reason, enabled) values
 ('trip_delivery_geo', 'guest_phone', 'phone', 'delete', 'Map lookup of a delivery address; removed with the guest''s phone number', true),
 ('delivery_nav_sends', 'guest_phone', 'phone', 'delete', 'Log of the delivery route sent to the car (address and car position); removed with the guest''s phone number', true)
on conflict (table_name, column_name) do nothing;

-- 3) Alerts are signed Car Guard (prefix car.delivery_nav)
insert into public.notification_owners(prefix, agent_slug, note) values ('car.delivery_nav', 'car-guard', 'Delivery route sent to the car')
on conflict do nothing;

-- 4) Destination: LAX garage pin, a saved spot's own pin, or the geocoded street address ----------------------------------------
create or replace function public.delivery_nav_dest(p_res bigint)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t turo_trips; place text; lid text; d delivery_locations; g trip_delivery_geo; dj jsonb; addr text;
begin
  select * into t from turo_trips where reservation_id = p_res;
  if t.reservation_id is null then return null; end if;
  place := trip_place(p_res);
  if place = 'home' then return jsonb_build_object('place', 'home', 'state', 'ok'); end if;
  if place = 'lax' then
    return jsonb_build_object('place', 'lax', 'label', 'LAX Park My Share', 'address', 'LAX Park My Share garage',
      'lat', 33.9472637, 'lon', -118.3826063, 'state', 'ok', 'source', 'garage pin');
  end if;
  dj := trip_delivery_json(p_res);
  lid := trip_delivery_location(p_res);
  select * into d from delivery_locations where id = lid;
  addr := nullif(btrim(dj->>'address'), '');
  if lid <> 'custom' and d.lat is not null and d.lon is not null then
    return jsonb_build_object('place', 'delivery', 'label', coalesce(dj->>'short', d.short), 'address', addr,
      'lat', d.lat, 'lon', d.lon, 'state', 'ok', 'source', 'saved spot');
  end if;
  select * into g from trip_delivery_geo where reservation_id = p_res;
  if g.lat is not null and g.lon is not null and g.address is not distinct from addr then
    return jsonb_build_object('place', 'delivery', 'label', coalesce(dj->>'short', addr), 'address', addr,
      'lat', g.lat, 'lon', g.lon, 'state', 'ok', 'source', g.source);
  end if;
  return jsonb_build_object('place', 'delivery', 'label', coalesce(dj->>'short', addr), 'address', addr, 'lat', null, 'lon', null,
    'state', case when g.error is not null and g.error not in ('not_exact', 'no_address') then 'error' else 'pending' end,
    'error', g.error);
end $$;

-- 5) Geocoder (free): US Census first, OpenStreetMap Nominatim second. Async through pg_net: one step fires a request, the next tick reads the answer.
create or replace function public.delivery_nav_geocode()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record; t turo_trips; lid text; d delivery_locations; dj jsonb; addr text; g trip_delivery_geo;
  v_found boolean; v_code int; v_body text; j jsonb; clat float8; clon float8; pin_m float8; why text; rid bigint;
  fired int := 0; found_ int := 0; failed_ int := 0;
begin
  for r in select tr.reservation_id from turo_trips tr
            where tr.starts_at > now() and tr.starts_at < now() + interval '48 hours'
              and coalesce(tr.status, '') not in ('test', 'CANCELLED', 'CANCELED') order by tr.starts_at
  loop
    begin
      if trip_place(r.reservation_id) is distinct from 'delivery' then continue; end if;
      select * into t from turo_trips where reservation_id = r.reservation_id;
      lid := trip_delivery_location(r.reservation_id);
      select * into d from delivery_locations where id = lid;
      if lid <> 'custom' and d.lat is not null and d.lon is not null then continue; end if;   -- saved spot with its own pin
      dj := trip_delivery_json(r.reservation_id);
      addr := nullif(btrim(dj->>'address'), '');
      select * into g from trip_delivery_geo where reservation_id = r.reservation_id;

      -- Turo sometimes shares only the area ("Los Angeles, CA 90038"). Wait for a real street address; never send an approximate pin.
      if addr is null or addr !~ '^\s*\d' then
        insert into trip_delivery_geo(reservation_id, address, error, guest_phone)
        values (r.reservation_id, addr, case when addr is null then 'no_address' else 'not_exact' end, t.guest_phone)
        on conflict (reservation_id) do update set address = excluded.address, lat = null, lon = null, source = null, geocoded_at = null,
          error = excluded.error, req_id = null, req_source = null, req_at = null, pin_miles = null, updated_at = now(),
          guest_phone = coalesce(excluded.guest_phone, trip_delivery_geo.guest_phone);
        continue;
      end if;

      if g.reservation_id is null or g.address is distinct from addr then          -- new trip, or the address text changed: start over
        insert into trip_delivery_geo(reservation_id, address, guest_phone) values (r.reservation_id, addr, t.guest_phone)
        on conflict (reservation_id) do update set address = excluded.address, lat = null, lon = null, source = null, geocoded_at = null,
          error = null, req_id = null, req_source = null, req_at = null, tries = 0, pin_miles = null, updated_at = now(),
          guest_phone = coalesce(excluded.guest_phone, trip_delivery_geo.guest_phone);
        select * into g from trip_delivery_geo where reservation_id = r.reservation_id;
      elsif g.guest_phone is null and t.guest_phone is not null then
        update trip_delivery_geo set guest_phone = t.guest_phone where reservation_id = r.reservation_id;
      end if;
      if g.lat is not null then continue; end if;

      if g.error in ('not_exact', 'no_address') then                                -- the address is exact now
        update trip_delivery_geo set error = null, req_id = null, req_source = null, req_at = null, updated_at = now() where reservation_id = r.reservation_id;
        g.error := null; g.req_id := null;
      end if;
      if g.error is not null then                                                  -- a real failure: try again every 15 min, up to 8 times
        if g.tries >= 8 or g.updated_at > now() - interval '15 minutes' then continue; end if;
        update trip_delivery_geo set error = null, req_id = null, req_source = null, req_at = null where reservation_id = r.reservation_id;
        g.req_id := null;
      end if;

      if g.req_id is null then                                                     -- step 1: ask the Census
        rid := net.http_get(url := 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress',
          params := jsonb_build_object('address', addr, 'benchmark', 'Public_AR_Current', 'format', 'json'),
          timeout_milliseconds := 15000);
        update trip_delivery_geo set req_id = rid, req_source = 'census', req_at = now(), tries = tries + 1, updated_at = now() where reservation_id = r.reservation_id;
        fired := fired + 1;
        continue;
      end if;

      -- step 2: read the answer that came back
      select s.status_code, s.content into v_code, v_body from net._http_response s where s.id = g.req_id;
      v_found := found;
      if not v_found and g.req_at > now() - interval '3 minutes' then continue; end if;   -- still in flight
      clat := null; clon := null; why := null;
      if v_found and v_code = 200 then
        begin
          j := v_body::jsonb;
          if g.req_source = 'census' then
            clon := (j #>> '{result,addressMatches,0,coordinates,x}')::float8;
            clat := (j #>> '{result,addressMatches,0,coordinates,y}')::float8;
          else
            clat := (j #>> '{0,lat}')::float8;
            clon := (j #>> '{0,lon}')::float8;
          end if;
        exception when others then clat := null; clon := null;
        end;
      end if;
      pin_m := null;
      if clat is null or clon is null then
        why := case when not v_found then g.req_source || ' did not answer'
                    when v_code is distinct from 200 then g.req_source || ' error ' || coalesce(v_code::text, 'none')
                    else g.req_source || ' found no match' end;
        clat := null; clon := null;
      elsif t.pickup_lat is not null and t.pickup_lon is not null then
        pin_m := trip_dist_m(clat, clon, t.pickup_lat, t.pickup_lon);
        if pin_m > 4828 then                                                        -- more than 3 mi from Turo's approximate pin: reject
          why := g.req_source || ' result was ' || round((pin_m / 1609.34)::numeric, 1) || ' mi from the Turo pin';
          clat := null; clon := null;
        end if;
      end if;

      if clat is not null then
        update trip_delivery_geo set lat = clat, lon = clon, source = g.req_source, geocoded_at = now(), error = null, req_id = null,
          pin_miles = round((pin_m / 1609.34)::numeric, 1), updated_at = now() where reservation_id = r.reservation_id;
        found_ := found_ + 1;
      elsif g.req_source = 'census' then                                             -- fallback: OpenStreetMap
        rid := net.http_get(url := 'https://nominatim.openstreetmap.org/search',
          params := jsonb_build_object('format', 'json', 'limit', '1', 'countrycodes', 'us', 'q', addr),
          headers := jsonb_build_object('User-Agent', 'bestly.tech delivery-nav'),
          timeout_milliseconds := 15000);
        update trip_delivery_geo set req_id = rid, req_source = 'nominatim', req_at = now(), updated_at = now() where reservation_id = r.reservation_id;
        fired := fired + 1;
      else
        update trip_delivery_geo set error = 'failed: ' || why, req_id = null, updated_at = now() where reservation_id = r.reservation_id;
        failed_ := failed_ + 1;
      end if;
    exception when others then
      update trip_delivery_geo set error = 'failed: ' || left(sqlerrm, 120), req_id = null, updated_at = now() where reservation_id = r.reservation_id;
      failed_ := failed_ + 1;
    end;
  end loop;
  return jsonb_build_object('fired', fired, 'found', found_, 'failed', failed_);
end $$;

-- 6) The brain: pure rules, no I/O. Everything it needs is in p, so it can be tested with SQL fixtures.
-- Output: send (bool), trigger (parked | heading | manual), state, reason ("delivery-nav: ..."), send_at (leave-by minus 20 min), plus the numbers it used.
create or replace function public.delivery_nav_decide(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  now_ timestamptz := (p->>'now')::timestamptz;
  starts timestamptz := nullif(p->>'starts_at', '')::timestamptz;
  lead numeric := coalesce((p->>'lead_hours')::numeric, 5);
  maxs int := coalesce((p->>'max_sends')::int, 3);
  enabled boolean := coalesce((p->>'enabled')::boolean, true);
  force boolean := coalesce((p->>'force')::boolean, false);
  cancelled boolean := coalesce((p->>'cancelled')::boolean, false);
  other boolean := coalesce((p->>'other_active')::boolean, false);
  geo text := coalesce(p->>'geo_state', 'ok');
  dlat float8 := nullif(p->>'dest_lat', '')::float8;
  dlon float8 := nullif(p->>'dest_lon', '')::float8;
  clat float8 := nullif(p->>'car_lat', '')::float8;
  clon float8 := nullif(p->>'car_lon', '')::float8;
  obs timestamptz := nullif(p->>'car_at', '')::timestamptz;
  hlat float8 := nullif(p->>'home_lat', '')::float8;
  hlon float8 := nullif(p->>'home_lon', '')::float8;
  leave_by timestamptz := nullif(p->>'leave_by', '')::timestamptz;
  sends_ok int := coalesce((p->>'sends_ok')::int, 0);
  fails int := coalesce((p->>'fails')::int, 0);
  last_send timestamptz := nullif(p->>'last_send_at', '')::timestamptz;
  open_send boolean := coalesce((p->>'open_send')::boolean, false);
  pts jsonb := coalesce(p->'pts', '[]'::jsonb);
  send_at timestamptz; dd float8; fresh_min float8; unmoved_min float8; last_far timestamptz; parked_since timestamptz;
  parked boolean := false; moving boolean := false; a_ready boolean; a_near boolean;
  b_n int; b_t0 timestamptz; b_t1 timestamptz; b_d0 float8; b_d1 float8; b_step float8; b_from_home float8; b_drop float8;
  st text := 'waiting'; rs text := ''; sd boolean := false; trg text; nudge boolean := false;
begin
  send_at := case when leave_by is not null then leave_by - interval '20 minutes' end;
  if clat is not null and clon is not null and obs is not null then
    select max(x.t) filter (where trip_dist_m(clat, clon, x.lat, x.lon) > 60) into last_far
      from jsonb_to_recordset(pts) as x(t timestamptz, lat float8, lon float8);
    select min(x.t) filter (where last_far is null or x.t > last_far) into parked_since
      from jsonb_to_recordset(pts) as x(t timestamptz, lat float8, lon float8);
    parked_since := least(coalesce(parked_since, obs), obs);
    unmoved_min := extract(epoch from (obs - parked_since)) / 60;
    fresh_min := extract(epoch from (now_ - obs)) / 60;
    parked := fresh_min <= 45 and unmoved_min >= 5;
    moving := fresh_min <= 12 and last_far is not null and last_far >= obs - interval '10 minutes';
  end if;
  if clat is not null and dlat is not null then dd := trip_dist_m(clat, clon, dlat, dlon); end if;
  a_ready := leave_by is null or now_ >= leave_by - interval '20 minutes';
  a_near := leave_by is null or now_ >= leave_by - interval '35 minutes';

  <<chk>> loop
    if not force and not enabled then st := 'off'; rs := 'delivery-nav: switched off'; exit chk; end if;
    if cancelled then st := 'cancelled'; rs := 'delivery-nav: trip cancelled'; exit chk; end if;
    if starts is null or now_ >= starts then st := 'started'; rs := 'delivery-nav: trip already started'; exit chk; end if;
    if other then st := 'guest_active'; rs := 'delivery-nav: a guest has the car'; exit chk; end if;
    if dlat is null or dlon is null then
      st := case geo when 'error' then 'address_error' else 'finding_address' end;
      rs := 'delivery-nav: destination has no coordinates yet'; exit chk;
    end if;
    if not force and now_ < starts - make_interval(secs => (lead * 3600)::int) then
      st := 'early'; rs := 'delivery-nav: before the send window'; exit chk;
    end if;
    if clat is null or clon is null or obs is null then st := 'no_car'; rs := 'delivery-nav: no car position yet'; exit chk; end if;
    if dd <= 400 then st := 'at_destination'; rs := 'delivery-nav: the car is already there'; exit chk; end if;
    if force then sd := true; trg := 'manual'; st := 'sending'; rs := 'delivery-nav: manual send'; exit chk; end if;
    if open_send then st := 'sending'; rs := 'delivery-nav: a send is already on its way'; exit chk; end if;
    if fails >= 3 then st := 'gave_up'; rs := 'delivery-nav: three sends failed, stopped trying'; exit chk; end if;
    if sends_ok >= maxs then st := 'cap'; rs := 'delivery-nav: reached the send limit for this trip'; exit chk; end if;

    if parked then                                                                 -- A: parked pre-load at leave-by
      if last_send is not null and last_send >= parked_since then
        st := 'sent'; rs := 'delivery-nav: already sent since the car last parked'; exit chk;
      end if;
      if a_ready then sd := true; trg := 'parked'; st := 'sending'; rs := 'delivery-nav: parked, route pre-loaded at leave-by'; exit chk; end if;
      st := 'waiting'; rs := 'delivery-nav: parked, waiting for leave-by';
      nudge := a_near and fresh_min > 10;
      exit chk;
    end if;

    if moving then                                                                 -- B: heading there early
      select count(*), min(o.t), max(o.t), (array_agg(o.dd order by o.t))[1], (array_agg(o.dd order by o.t desc))[1], coalesce(max(o.dd - o.pd), 0)
        into b_n, b_t0, b_t1, b_d0, b_d1, b_step
        from (select x.t, trip_dist_m(x.lat, x.lon, dlat, dlon) as dd, lag(trip_dist_m(x.lat, x.lon, dlat, dlon)) over (order by x.t) as pd
                from jsonb_to_recordset(pts) as x(t timestamptz, lat float8, lon float8)
               where x.t >= obs - interval '15 minutes') o;
      b_from_home := case when hlat is not null then trip_dist_m(clat, clon, hlat, hlon) else 0 end;
      b_drop := coalesce(b_d0 - b_d1, 0);
      if b_n >= 3 and extract(epoch from (b_t1 - b_t0)) / 60 >= 4 and b_drop >= 2414 and b_from_home >= 1609 and b_step <= 400
         and (last_send is null or now_ - last_send >= interval '45 minutes') then
        sd := true; trg := 'heading'; st := 'sending'; rs := 'delivery-nav: heading there early'; exit chk;
      end if;
      st := 'in_use'; rs := 'delivery-nav: the car is moving, not clearly heading there';
      nudge := fresh_min >= 2;
      exit chk;
    end if;

    st := case when fresh_min > 45 then 'stale' else 'settling' end;
    rs := case when fresh_min > 45 then 'delivery-nav: car position is old' else 'delivery-nav: car just stopped, waiting 5 minutes' end;
    nudge := a_near and fresh_min > 10;
    exit chk;
  end loop;

  return jsonb_build_object('send', sd, 'trigger', trg, 'state', st, 'reason', rs, 'send_at', send_at,
    'dist_m', round(dd::numeric), 'miles', case when dd is not null then round((dd / 1609.34)::numeric, 1) end,
    'parked', parked, 'unmoved_min', round(unmoved_min::numeric, 1), 'moving', moving, 'fresh_min', round(fresh_min::numeric, 1),
    'nudge', nudge and st in ('waiting', 'stale', 'settling', 'in_use'),
    'drop_m', round(b_drop::numeric), 'a_ready', a_ready);
end $$;

-- 7) Reconcile logged sends with their TezLab command, write the recap line, and raise the one passive alert after the 3rd failure
create or replace function public.delivery_nav_reconcile()
returns int language plpgsql security definer set search_path = public as $$
declare s record; cmd tesla_fleet_commands; n int := 0; gname text; at_txt text; c delivery_nav_settings;
begin
  select * into c from delivery_nav_settings where id = 1;
  for s in select * from delivery_nav_sends where status = 'queued' order by id loop
    select * into cmd from tesla_fleet_commands where id = s.cmd_id;
    if not found then
      update delivery_nav_sends set status = 'failed', error = 'command missing' where id = s.id; n := n + 1;
    elsif cmd.status = 'done' then
      update delivery_nav_sends set status = 'done', error = null where id = s.id; n := n + 1;
    elsif cmd.status = 'failed' then
      update delivery_nav_sends set status = 'failed', error = left(coalesce(cmd.result->>'error', 'failed'), 200) where id = s.id; n := n + 1;
    elsif cmd.created_at < now() - interval '10 minutes' then
      update tesla_fleet_commands set status = 'failed', done_at = now(),
        result = jsonb_build_object('ok', false, 'error', 'No answer in 10 minutes') where id = cmd.id and status in ('queued', 'running');
      update delivery_nav_sends set status = 'failed', error = 'No answer in 10 minutes' where id = s.id; n := n + 1;
    end if;
  end loop;

  for s in select * from delivery_nav_sends where status = 'done' and not noted order by id loop
    select coalesce(nullif(initcap(trim(guest_first)), ''), 'the guest') into gname from turo_trips where reservation_id = s.reservation_id;
    at_txt := to_char(s.at at time zone 'America/Los_Angeles', 'FMHH12:MI AM');
    perform notify_route(p_title := 'Car Guard: route is on the car for ' || coalesce(gname, 'the guest') || '''s delivery',
      p_body := 'Sent ' || at_txt || ': ' || coalesce(s.label, 'the delivery address') || ' is on the car''s screen. -- Car Guard',
      p_level := 'success', p_source := 'Car Guard', p_url := 'https://bestly.tech/admin/turo',
      p_tag := 'delivery-nav-ok-' || s.id);
    update delivery_nav_sends set noted = true where id = s.id;
  end loop;

  -- After the 3rd failed send for a trip: one passive alert (held for the recap, never an interruption)
  for s in select d.reservation_id, max(d.label) as label from delivery_nav_sends d
            where d.status = 'failed' and coalesce(d.error, '') not like 'TezLabDown%' group by d.reservation_id having count(*) >= 3 loop
    if not (c.alerted ? ('fail-' || s.reservation_id)) then
      select coalesce(nullif(initcap(trim(guest_first)), ''), 'the guest') into gname from turo_trips where reservation_id = s.reservation_id;
      perform notify_route(p_title := 'Car Guard: couldn''t send the route for ' || coalesce(gname, 'the guest') || '''s delivery',
        p_body := 'Three tries to put ' || coalesce(s.label, 'the delivery address') || ' on the car failed. Type it into the car by hand, or tap Send now in Ready for next guest. -- Car Guard',
        p_level := 'passive', p_source := 'Car Guard', p_url := 'https://bestly.tech/admin/turo', p_tag := 'delivery-nav-fail-' || s.reservation_id);
      update delivery_nav_settings set alerted = alerted || jsonb_build_object('fail-' || s.reservation_id, now()) where id = 1;
    end if;
  end loop;
  return n;
end $$;

-- 8) The tick (cron every 2 min). p_dry: decide and report, send nothing. p_force: manual send (skips timing only).
create or replace function public.delivery_nav_tick(p_dry boolean default false, p_force boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c delivery_nav_settings; fs tesla_fleet_settings; v turo_vehicle_state; hs home_pickup_settings; t turo_trips;
  dest jsonb; p jsonb; dec jsonb; pts jsonb; other boolean; sok int := 0; lsend timestamptz; fails int := 0; opn boolean := false;
  miles numeric; dmin int; lb timestamptz; jid bigint; sid bigint; out jsonb := '{}'; tz_up boolean := tezlab_up();
  label text; guest text; dlat float8; dlon float8; place text; lastlabel text; store jsonb; late_key text; at_txt text;
begin
  select * into c from delivery_nav_settings where id = 1;
  if not exists (select 1 from cron.job where jobname = 'delivery-nav-watchdog' and active) then
    perform cron.schedule('delivery-nav-watchdog', '9-59/15 * * * *', 'select public.delivery_nav_watchdog()');
  end if;
  if not p_dry then update delivery_nav_settings set last_tick_at = now() where id = 1; end if;
  if c.enabled or p_dry or p_force then
    begin out := out || jsonb_build_object('geocode', delivery_nav_geocode());
    exception when others then out := out || jsonb_build_object('geocode_error', sqlerrm); end;
  end if;
  if not p_dry then
    begin perform delivery_nav_reconcile();
    exception when others then out := out || jsonb_build_object('reconcile_error', sqlerrm); end;
  end if;

  select * into t from turo_trips where starts_at > now() and coalesce(status, '') not in ('test', 'CANCELLED', 'CANCELED') order by starts_at limit 1;
  if t.reservation_id is null then
    dec := jsonb_build_object('send', false, 'state', 'none', 'reason', 'delivery-nav: no trip coming up');
  else
    dest := delivery_nav_dest(t.reservation_id);
    place := dest->>'place';
    guest := coalesce(nullif(initcap(trim(t.guest_first)), ''), 'the guest');
    label := dest->>'label';
    if place = 'home' then
      dec := jsonb_build_object('send', false, 'state', 'home', 'reason', 'delivery-nav: next trip is a home pickup, nothing to send');
    else
      select * into fs from tesla_fleet_settings where id = 1;
      select * into v from turo_vehicle_state where vin = fs.vin;
      select * into hs from home_pickup_settings where id = 1;
      dlat := nullif(dest->>'lat', '')::float8; dlon := nullif(dest->>'lon', '')::float8;
      miles := case when dlat is not null then
        round((trip_dist_m(coalesce(v.latitude, hs.lat::float8), coalesce(v.longitude, hs.lon::float8), dlat, dlon) * 1.3 / 1609.34)::numeric, 1) end;
      dmin := greatest(10, round(coalesce(miles, 5) / 14 * 60)::int);            -- same formula as the Ready widget: start - 1 hr - drive at about 14 mph
      lb := t.starts_at - make_interval(mins => 60 + dmin);
      select coalesce(jsonb_agg(jsonb_build_object('t', x.t, 'lat', x.lat, 'lon', x.lon) order by x.t), '[]'::jsonb) into pts from (
        select ct.at as t, ct.lat, ct.lon from car_trail ct where ct.vin = fs.vin and ct.at > now() - interval '90 minutes'
        union all
        select v.observed_at, v.latitude, v.longitude where v.latitude is not null and v.observed_at > now() - interval '90 minutes'
           and not exists (select 1 from car_trail ct2 where ct2.vin = fs.vin and ct2.at >= v.observed_at)) x;
      select exists (select 1 from turo_trips o where o.reservation_id <> t.reservation_id and now() between o.starts_at and o.ends_at
          and coalesce(o.status, '') not in ('test', 'CANCELLED', 'CANCELED', 'OWNER_TRIP_END') and not coalesce(o.checked_out, false)) into other;
      select count(*) filter (where status <> 'failed'), max(at) filter (where status <> 'failed'),
             count(*) filter (where status = 'failed' and coalesce(error, '') not like 'TezLabDown%'), coalesce(bool_or(status = 'queued'), false)
        into sok, lsend, fails, opn from delivery_nav_sends where reservation_id = t.reservation_id;
      p := jsonb_build_object('now', now(), 'starts_at', t.starts_at, 'lead_hours', c.lead_hours, 'max_sends', c.max_sends,
        'enabled', c.enabled, 'force', p_force, 'cancelled', false, 'other_active', other, 'geo_state', dest->>'state',
        'dest_lat', dlat, 'dest_lon', dlon, 'car_lat', v.latitude, 'car_lon', v.longitude, 'car_at', v.observed_at,
        'home_lat', hs.lat, 'home_lon', hs.lon, 'leave_by', lb, 'sends_ok', sok, 'fails', fails, 'last_send_at', lsend,
        'open_send', opn, 'pts', pts);
      dec := delivery_nav_decide(p);
      if p_force and exists (select 1 from delivery_nav_sends where reservation_id = t.reservation_id and at > now() - interval '1 minute' and status <> 'failed') then
        dec := dec || jsonb_build_object('send', false, 'state', 'sending', 'reason', 'delivery-nav: just sent, give it a minute');
      end if;

      -- read-only refresh so a fresher car reading arrives sooner (TezLab only, not the paid API)
      if (dec->>'nudge')::boolean and not p_dry and tz_up and coalesce(c.last_nudge_at, 'epoch') < now() - interval '4 minutes'
         and not exists (select 1 from tesla_fleet_commands where action = 'refresh' and status in ('queued', 'running') and created_at > now() - interval '5 minutes') then
        insert into tesla_fleet_commands(action, auto, args) values ('refresh', true, '{"tezlab_only":true,"by":"delivery-nav"}');
        update delivery_nav_settings set last_nudge_at = now() where id = 1;
        out := out || '{"nudge":true}';
      end if;

      if (dec->>'send')::boolean then
        if p_dry then
          out := out || jsonb_build_object('dry_run_would_send', dec->>'trigger', 'label', label, 'lat', dlat, 'lon', dlon);
        elsif not tz_up then
          dec := dec || jsonb_build_object('send', false, 'state', 'tezlab_down', 'reason', 'delivery-nav: TezLab is down, will retry');
          out := out || '{"blocked":"TezLab is down"}';
        else
          insert into tesla_fleet_commands(action, auto, reservation_id, args)
          values ('nav_point', true, t.reservation_id,
                  jsonb_build_object('lat', dlat, 'lon', dlon, 'label', label, 'tezlab_only', true, 'reason', 'delivery-nav: ' || (dec->>'trigger')))
          returning id into jid;
          insert into delivery_nav_sends(reservation_id, trigger, dest_lat, dest_lon, label, car_lat, car_lon, cmd_id, status, guest_phone)
          values (t.reservation_id, dec->>'trigger', dlat, dlon, label, v.latitude, v.longitude, jid, 'queued', t.guest_phone)
          returning id into sid;
          perform car_event('delivery_nav', 'info', 'Route sent to the car: ' || coalesce(label, 'delivery'),
            'Sent ' || to_char(now() at time zone 'America/Los_Angeles', 'FMHH12:MI AM') || ' (' || (dec->>'trigger') || ').',
            'deliverynav-' || sid, v.latitude, v.longitude, t.reservation_id, jsonb_build_object('job', jid, 'trigger', dec->>'trigger'), false);
          out := out || jsonb_build_object('sent', dec->>'trigger', 'job', jid, 'label', label);
        end if;
      end if;

      -- one passive alert if nothing has reached the car by leave-by while it sits parked at home
      late_key := 'late-' || t.reservation_id;
      if not p_dry and not p_force and c.enabled and now() >= lb and now() < t.starts_at and sok = 0 and not coalesce(opn, false)
         and not (c.alerted ? late_key) and coalesce((dec->>'parked')::boolean, false) and car_spot(v.latitude, v.longitude) = 'home'
         and dec->>'state' not in ('guest_active', 'off', 'cancelled', 'started', 'at_destination', 'sending') then
        at_txt := to_char(t.starts_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM');
        perform notify_route(p_title := 'Car Guard: couldn''t send the route for ' || guest || '''s delivery',
          p_body := 'It is time to leave for ' || coalesce(dest->>'address', label, 'the delivery') || ' (' || at_txt || '), but the route is not on the car. Why: '
                    || coalesce(nullif(replace(dec->>'reason', 'delivery-nav: ', ''), ''), dec->>'state') || '. Tap Send now in Ready for next guest, or type it into the car. -- Car Guard',
          p_level := 'passive', p_source := 'Car Guard', p_url := 'https://bestly.tech/admin/turo', p_tag := 'delivery-nav-late-' || t.reservation_id);
        update delivery_nav_settings set alerted = alerted || jsonb_build_object(late_key, now()) where id = 1;
      end if;
    end if;
  end if;

  select count(*) filter (where status <> 'failed'), max(at) filter (where status <> 'failed'),
         (select z.label from delivery_nav_sends z where z.reservation_id = t.reservation_id and z.status <> 'failed' order by z.at desc limit 1)
    into sok, lsend, lastlabel from delivery_nav_sends where reservation_id = t.reservation_id;
  store := dec || jsonb_build_object('reservation_id', t.reservation_id, 'guest', guest, 'label', label, 'address', dest->>'address', 'place', place,
    'starts_at', t.starts_at, 'leave_by', lb, 'sends_ok', coalesce(sok, 0), 'last_send_at', lsend, 'last_send_label', lastlabel,
    'geo_state', dest->>'state', 'tezlab_up', tz_up, 'at', now(), 'forced', p_force);
  if not p_dry then update delivery_nav_settings set last_decision = store, updated_at = now() where id = 1; end if;
  return out || jsonb_build_object('decision', store);
end $$;

-- 8b) Purge: 14 days after the trip, the address, coordinates and phone are blanked from both tables
create or replace function public.delivery_nav_purge()
returns void language sql security definer set search_path = public as $$
  update trip_delivery_geo x set address = null, lat = null, lon = null, guest_phone = null, req_id = null, error = null
   where (x.address is not null or x.lat is not null or x.guest_phone is not null)
     and not exists (select 1 from turo_trips t where t.reservation_id = x.reservation_id and t.ends_at > now() - interval '14 days');
  update delivery_nav_sends x set label = null, dest_lat = null, dest_lon = null, car_lat = null, car_lon = null, guest_phone = null
   where (x.label is not null or x.dest_lat is not null or x.car_lat is not null or x.guest_phone is not null)
     and not exists (select 1 from turo_trips t where t.reservation_id = x.reservation_id and t.ends_at > now() - interval '14 days');
$$;

-- 9) Watchdog (cron every 15 min): restarts a stalled tick, restores the schedule, un-sticks commands, flags geocode failures, purges old rows
create or replace function public.delivery_nav_watchdog()
returns jsonb language plpgsql security definer set search_path = public as $$
declare c delivery_nav_settings; healed text[] := '{}'; bad text[] := '{}'; g record; i record; n int;
begin
  select * into c from delivery_nav_settings where id = 1;
  -- addresses are personal: blank them 14 days after the trip
  begin perform delivery_nav_purge(); exception when undefined_function then null; end;
  if not c.enabled then
    update delivery_nav_settings set last_watchdog_at = now() where id = 1;
    return jsonb_build_object('skip', 'disabled');
  end if;
  if c.last_tick_at is null or c.last_tick_at < now() - interval '10 minutes' then
    perform delivery_nav_tick();
    healed := array_append(healed, 'the route check had stalled (restarted)');
  end if;
  if not exists (select 1 from cron.job where jobname = 'delivery-nav' and active) then
    perform cron.schedule('delivery-nav', '*/2 * * * *', 'select public.delivery_nav_tick()');
    healed := array_append(healed, 'its 2-minute schedule was missing (restored)');
  end if;
  -- a route command stuck for 10 minutes is marked failed so the next tick can try again (it must never fall through to the paid API)
  update tesla_fleet_commands set status = 'failed', done_at = now(),
         result = jsonb_build_object('ok', false, 'error', 'No answer in 10 minutes (delivery-nav watchdog)')
   where action = 'nav_point' and status in ('queued', 'running') and created_at < now() - interval '10 minutes'
     and coalesce(args->>'reason', '') like 'delivery-nav:%';
  get diagnostics n = row_count;
  if n > 0 then healed := array_append(healed, n || ' stuck route command(s) cleared; it will retry'); end if;
  -- geocode failures for trips in the next 24 hours
  for g in select x.reservation_id, x.address, x.error, t.guest_first from trip_delivery_geo x join turo_trips t on t.reservation_id = x.reservation_id
            where x.error is not null and x.error not in ('not_exact', 'no_address') and t.starts_at > now() and t.starts_at < now() + interval '24 hours'
              and coalesce(t.status, '') not in ('test', 'CANCELLED', 'CANCELED') loop
    perform bestly_raise('car.delivery_nav.geocode.' || g.reservation_id, 'problem', 'info', 'Car Guard can''t place a delivery address on the map',
      'Could not find ' || coalesce(g.address, 'the address') || ' for ' || coalesce(nullif(initcap(trim(g.guest_first)), ''), 'the guest') || '''s delivery (' || g.error
      || '). It tries again every 15 minutes. If it stays like this, type the address into the car by hand.', 'turo', null, true);
    bad := array_append(bad, 'address for reservation ' || g.reservation_id || ' not found');
  end loop;
  for i in select key from monitor_issues where key like 'car.delivery_nav.geocode.%' and status = 'open' loop
    if not exists (select 1 from trip_delivery_geo x join turo_trips t on t.reservation_id = x.reservation_id
                    where x.reservation_id = substring(i.key from '\d+$')::bigint and x.error is not null and x.error not in ('not_exact', 'no_address')
                      and t.starts_at > now() and t.starts_at < now() + interval '24 hours') then
      perform bestly_raise(i.key, 'resolved', 'info', 'Delivery address found', 'Car Guard placed the delivery address on the map.');
    end if;
  end loop;
  if coalesce(array_length(healed, 1), 0) > 0 then
    perform bestly_raise('car.delivery_nav.watch', 'problem', 'info', 'The delivery route check fixed itself', array_to_string(healed, '; ') || '.', 'turo', null, true);
  else
    perform bestly_raise('car.delivery_nav.watch', 'resolved', 'info', 'The delivery route check is healthy', 'Checks are passing.');
  end if;
  update delivery_nav_settings set last_watchdog_at = now() where id = 1;
  return jsonb_build_object('problems', bad, 'healed', healed);
end $$;

-- 10) Admin RPCs for the Ready widget (admin only)
create or replace function public.delivery_nav_admin()
returns jsonb language plpgsql security definer set search_path = public as $$
declare c delivery_nav_settings;
begin
  if not has_role(auth.uid(), 'admin') and session_user not in ('postgres', 'supabase_admin') then raise exception 'admin only'; end if;
  select * into c from delivery_nav_settings where id = 1;
  return jsonb_build_object('enabled', c.enabled, 'lead_hours', c.lead_hours, 'max_sends', c.max_sends, 'tezlab_up', tezlab_up(),
    'last_tick_at', c.last_tick_at, 'decision', c.last_decision,
    'problem', exists (select 1 from monitor_issues where key like 'car.delivery_nav.geocode.%' and status = 'open'));
end $$;

create or replace function public.delivery_nav_admin_set(p_enabled boolean default null, p_lead_hours numeric default null, p_max_sends int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not has_role(auth.uid(), 'admin') and session_user not in ('postgres', 'supabase_admin') then raise exception 'admin only'; end if;
  if p_lead_hours is not null and (p_lead_hours < 1 or p_lead_hours > 12) then raise exception 'Start checking between 1 and 12 hours before'; end if;
  if p_max_sends is not null and (p_max_sends < 1 or p_max_sends > 5) then raise exception 'Send limit is 1 to 5'; end if;
  update delivery_nav_settings set enabled = coalesce(p_enabled, enabled), lead_hours = coalesce(p_lead_hours, lead_hours),
         max_sends = coalesce(p_max_sends, max_sends), updated_at = now() where id = 1;
  perform delivery_nav_tick();
  return delivery_nav_admin();
end $$;

create or replace function public.delivery_nav_send_now()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb; d jsonb; msg text;
begin
  if not has_role(auth.uid(), 'admin') and session_user not in ('postgres', 'supabase_admin') then raise exception 'admin only'; end if;
  r := delivery_nav_tick(false, true);
  d := r->'decision';
  msg := case when r ? 'sent' then 'Sent to the car'
    else case d->>'state'
      when 'guest_active' then 'A guest has the car right now'
      when 'finding_address' then 'Still finding the address'
      when 'address_error' then 'Could not find the address on the map'
      when 'at_destination' then 'The car is already there'
      when 'home' then 'The next trip is a home pickup, nothing to send'
      when 'none' then 'No trip coming up'
      when 'no_car' then 'No car position yet'
      when 'started' then 'That trip already started'
      when 'sending' then 'Just sent, give it a minute'
      when 'tezlab_down' then 'TezLab is down, try again soon'
      else 'Not sent' end end;
  return jsonb_build_object('ok', r ? 'sent', 'message', msg, 'admin', delivery_nav_admin());
end $$;

-- 11) Grants: the admin RPCs for signed-in admins; everything else is internal (cron / definer only)
revoke all on function public.delivery_nav_admin() from public, anon;
revoke all on function public.delivery_nav_admin_set(boolean, numeric, int) from public, anon;
revoke all on function public.delivery_nav_send_now() from public, anon;
grant execute on function public.delivery_nav_admin() to authenticated;
grant execute on function public.delivery_nav_admin_set(boolean, numeric, int) to authenticated;
grant execute on function public.delivery_nav_send_now() to authenticated;
revoke all on function public.delivery_nav_dest(bigint) from public, anon, authenticated;
revoke all on function public.delivery_nav_geocode() from public, anon, authenticated;
revoke all on function public.delivery_nav_decide(jsonb) from public, anon, authenticated;
revoke all on function public.delivery_nav_reconcile() from public, anon, authenticated;
revoke all on function public.delivery_nav_tick(boolean, boolean) from public, anon, authenticated;
revoke all on function public.delivery_nav_purge() from public, anon, authenticated;
revoke all on function public.delivery_nav_watchdog() from public, anon, authenticated;

-- 12) Team card (Car Guard's tool), so the roster scanner sees the jobs have an owner
select public.team_onboard($j$[
 {"slug":"delivery-nav","name":"Delivery Route","role":"Puts the delivery address on the car's screen before Jared drives it out","tool_of":"car-guard","runs_on":"cloud","icon":"navigation",
  "schedule":"every 2 min",
  "what_it_does":"For the next delivery or LAX trip, sends the address to the car's navigation about 20 minutes before Jared needs to leave, or sooner if he starts driving there. Skips it when he uses the car for something else first, when a guest has the car, or when the car is already there. Finds exact street addresses on a free map lookup. Signed Car Guard.",
  "pulse":{"src":"cron","job":"delivery-nav","gap":8,"also":["delivery-nav-watchdog"]},
  "owns":["car.delivery_nav"]}
]$j$::jsonb);

-- Car Guard's roster line also lists the Sentry-at-home jobs that had no owner entry
update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', coalesce(pulse->'also', '[]'::jsonb) || '["car-sentry-home","car-sentry-home-watchdog"]'::jsonb)
 where slug = 'car-guard' and not (coalesce(pulse->'also', '[]'::jsonb) ? 'car-sentry-home');

-- 13) Schedules
select cron.schedule('delivery-nav', '*/2 * * * *', 'select public.delivery_nav_tick()');
select cron.schedule('delivery-nav-watchdog', '9-59/15 * * * *', 'select public.delivery_nav_watchdog()');
