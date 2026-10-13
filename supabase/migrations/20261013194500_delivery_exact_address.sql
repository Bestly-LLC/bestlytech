-- Delivery trip pages said "Bring it back to Los Angeles" for custom-address deliveries.
-- Cause: Turo's raw->'location' for a custom delivery is only the APPROXIMATE area ("Los Angeles, CA 90038");
-- the exact delivery address is the top-level raw->>'address' ("6135 Eleanor Avenue, Los Angeles, CA 90038").
-- Fix: custom deliveries use the exact address (short = street line). When Turo's pin is APPROXIMATE and we have
-- the exact street address, the pin is dropped so Directions go to the address, not the fuzzy pin.
-- Watchdog (owned by Leo, prefix leo.delivery): any upcoming/live delivery still showing no street address raises
-- one alert to Jared; it resolves itself once Turo shares the address.
-- Undo: bestly_memory house/turo/delivery-exact-address-undo-2026-10-13, then
--   select cron.unschedule('delivery-address-watch'); drop function public.trip_delivery_address_watch();

CREATE OR REPLACE FUNCTION public.trip_delivery_json(p_reservation bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t turo_trips; d delivery_locations; i trip_delivery_info; v_addr text; v_exact boolean; v_fuzzy boolean;
begin
  select * into t from turo_trips where reservation_id = p_reservation;
  if t.reservation_id is null then return null; end if;
  select * into d from delivery_locations where id = trip_delivery_location(p_reservation);
  select * into i from trip_delivery_info where reservation_id = p_reservation;
  -- Exact street address from Turo (top-level), falling back to the approximate location text.
  v_addr := coalesce(nullif(btrim(t.raw->>'address'), ''), t.pickup_address);
  v_exact := v_addr ~ '^\s*\d';
  v_fuzzy := upper(coalesce(t.raw->'location'->'precision'->>'level', '')) = 'APPROXIMATE';
  return trip_delivery_build(d, t.raw->'location'->>'name', v_addr,
    case when v_exact and v_fuzzy then null else t.pickup_lat end,
    case when v_exact and v_fuzzy then null else t.pickup_lon end,
    t.raw->'location'->'pickupAndReturn'->>'deliveryInstructions',
    jsonb_build_object('room', i.room, 'front_desk', i.front_desk, 'parking', i.parking, 'eta', i.eta,
      'reported_at', i.reported_at, 'via', i.via));
end $function$;

-- Watchdog: a delivery trip page must name a real place (a known spot, or a street address).
CREATE OR REPLACE FUNCTION public.trip_delivery_address_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r record; dj jsonb; k text; bad int := 0; ok int := 0;
begin
  for r in
    select t.reservation_id, t.guest_first, t.starts_at from turo_trips t
     where t.ends_at > now() and t.starts_at < now() + interval '72 hours'
       and trip_place(t.reservation_id) = 'delivery'
  loop
    dj := trip_delivery_json(r.reservation_id);
    k := 'leo.delivery.address.' || r.reservation_id;
    if dj->>'location_id' = 'custom' and coalesce(dj->>'address', '') !~ '^\s*\d' then
      bad := bad + 1;
      perform bestly_raise(k, 'problem', 'warning',
        'Leo: no street address for ' || coalesce(nullif(initcap(btrim(r.guest_first)), ''), 'a guest') || '''s delivery',
        'Res ' || r.reservation_id || ' (' || to_char(r.starts_at at time zone 'America/Los_Angeles', 'Dy Mon FMDD, FMHH12:MI AM')
          || '). Turo only shared "' || coalesce(dj->>'address', '?') || '", so the trip page can''t say where to return the car.',
        'turo', 'Open the trip in Turo and check the delivery address.');
    else
      ok := ok + 1;
      if exists (select 1 from monitor_issues where key = k and status <> 'resolved') then
        perform bestly_raise(k, 'resolved', 'info', 'Leo: delivery address found', null, 'turo');
      end if;
    end if;
  end loop;
  -- Close alerts for trips that ended or stopped being deliveries.
  for k in select m.key from monitor_issues m where m.key like 'leo.delivery.address.%' and m.status <> 'resolved'
     and not exists (select 1 from turo_trips t where 'leo.delivery.address.' || t.reservation_id = m.key
                      and t.ends_at > now() and trip_place(t.reservation_id) = 'delivery')
  loop
    perform bestly_raise(k, 'resolved', 'info', 'Leo: delivery trip closed', null, 'turo');
  end loop;
  return jsonb_build_object('ok', ok, 'missing_address', bad);
end $function$;

revoke execute on function public.trip_delivery_address_watch() from public, anon, authenticated;

select cron.schedule('delivery-address-watch', '7-59/15 * * * *', 'select public.trip_delivery_address_watch()');

select public.team_onboard($j$[
 {"slug":"delivery-address-watch","name":"Delivery Address Check","role":"Makes sure delivery trip pages name the real drop-off spot","tool_of":"leo","runs_on":"cloud","icon":"map-pin",
  "schedule":"every 15 min",
  "what_it_does":"For every delivery trip starting in the next 3 days or under way, checks the guest's trip page shows the exact street address (not just the city). If Turo only shared an area, Leo tells Jared once; the alert clears itself when the address shows up or the trip ends.",
  "pulse":{"src":"cron","job":"delivery-address-watch","gap":30},
  "owns":["leo.delivery.address"]}
]$j$::jsonb);
