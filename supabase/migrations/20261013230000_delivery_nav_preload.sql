-- Delivery route didn't reach the car before Jared left (2026-10-13, trip 62275681, Marcus, 8:00 PM, 2.7 mi away).
--
-- Why: the automatic send only fired while parked at leave-by minus 20 min (6:25 PM that day). Jared left at 3:40 PM.
-- The "heading there early" backup needs a 1.5 mi drop toward the guest and car_trail points every few minutes, but the
-- trail only logs every 15 min and the trip was 2.7 mi, so it could never fire. Result: nothing until he tapped Send now.
--
-- Fix: as soon as the send window opens (lead_hours before the trip, 5 h by default) and the car is parked, pre-load
-- the route ('preload'). At leave-by it sends once more ('leave_by') so the route is fresh even if the car slept.
-- That is 2 of the 3 sends; the third is left for a re-park. If the car's position is stale inside the window and
-- nothing has been sent yet, nudge a TezLab refresh so the pre-load can happen (same 4-min rate limit as before).
-- Watchdog/late alert (delivery_nav_watchdog, Car Guard) unchanged.

alter table public.delivery_nav_sends drop constraint if exists delivery_nav_sends_trigger_check;
alter table public.delivery_nav_sends add constraint delivery_nav_sends_trigger_check
  check (trigger in ('parked', 'heading', 'manual', 'preload', 'leave_by'));

CREATE OR REPLACE FUNCTION public.delivery_nav_decide(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  parked boolean := false; moving boolean := false; a_ready boolean; a_near boolean; want_fresh boolean;
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
  -- Inside the window with nothing sent yet, keep the car's position fresh so the pre-load can go out.
  want_fresh := a_near or last_send is null;

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

    if parked then
      if last_send is not null and last_send >= parked_since then
        if a_ready and send_at is not null and last_send < send_at then
          sd := true; trg := 'leave_by'; st := 'sending'; rs := 'delivery-nav: leave-by, refreshing the pre-loaded route'; exit chk;
        end if;
        st := 'sent'; rs := 'delivery-nav: already sent since the car last parked'; exit chk;
      end if;
      sd := true; st := 'sending';
      if a_ready then trg := 'parked'; rs := 'delivery-nav: parked, route sent at leave-by';
      else trg := 'preload'; rs := 'delivery-nav: send window open, route pre-loaded so it is there whenever you leave'; end if;
      exit chk;
    end if;

    if moving then
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
    nudge := want_fresh and fresh_min > 10;
    exit chk;
  end loop;

  return jsonb_build_object('send', sd, 'trigger', trg, 'state', st, 'reason', rs, 'send_at', send_at,
    'dist_m', round(dd::numeric), 'miles', case when dd is not null then round((dd / 1609.34)::numeric, 1) end,
    'parked', parked, 'unmoved_min', round(unmoved_min::numeric, 1), 'moving', moving, 'fresh_min', round(fresh_min::numeric, 1),
    'nudge', nudge and st in ('waiting', 'stale', 'settling', 'in_use'),
    'drop_m', round(b_drop::numeric), 'a_ready', a_ready);
end $function$;
