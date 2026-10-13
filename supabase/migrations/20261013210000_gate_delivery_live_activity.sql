-- Gate + delivery trips (Claude 2026-10-13).
-- 1) wall_pi_handoff: trips get place_kind / place_label (delivery shows "Delivery · <short>"); 'place' is unchanged.
--    A drive on a delivery trip only counts as the guest driving off once the key was added AND check-in is done
--    (Jared drives the car to the delivery spot himself).
-- 2) host_gate_apply: retire the orange pick-up card tick.
-- 3) host_gate_state: additive fields for the restyled /g/<token> page (old keys kept).
-- Undo: bestly_memory key house/turo/gate-delivery-undo-2026-10-13 holds the previous function bodies.

create or replace function public.wall_pi_handoff(p_token text)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare rs jsonb;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  rs := public.car_return_state();
  return jsonb_build_object('at', now(), 'car', rs,
    'host_pass', (select host_token from lax_pass_settings where id = 1),
    'trips', coalesce((
      select jsonb_agg(x order by x->>'start') from (
        select jsonb_build_object(
          'id', t.reservation_id,
          'guest', t.guest_first,
          'car', coalesce((select v.display_name from turo_vehicle_state v where v.vin = t.vin), 'the Tesla'),
          'start', t.starts_at,
          'end', t.ends_at,
          'place', case when t.airport_code is not null then t.airport_code else 'Home' end,
          'place_kind', public.trip_place(t.reservation_id),
          'place_label', case public.trip_place(t.reservation_id) when 'lax' then 'LAX' when 'delivery' then 'Delivery · ' || coalesce(public.trip_delivery_json(t.reservation_id)->>'short', 'address') else 'Home' end,
          'token', g.token,
          'gate', k.gate_token,
          'link_sent', (select min(e.at) from lax_guest_events e where e.reservation_id = t.reservation_id and e.kind = 'link_sent'),
          'license', k.license_ok_at,
          'checkin', k.checkin_ok_at,
          'key_sent', k.ready_at,
          'key_added', k.accepted_at,
          'key_on_car', (select min(d.first_seen) from car_drivers_seen d where d.reservation_id = t.reservation_id),
          'key_removed', k.removed_at,
          'resends', coalesce(k.resends, 0),
          'key_status', k.status,
          'key_error', k.last_error,
          'key_tap', (select max(e.at) from lax_guest_events e where e.reservation_id = t.reservation_id and e.kind = 'key_tap' and e.actor = 'guest'),
          'asked', (select max(e.at) from lax_guest_events e where e.reservation_id = t.reservation_id and e.kind in ('ask','call') and e.actor = 'guest'),
          'self_removed', (select max(e.at) from lax_guest_events e where e.reservation_id = t.reservation_id and e.kind = 'key_self_removed' and e.actor = 'guest'),
          'battery', (select v.battery_pct from turo_vehicle_state v where v.vin = t.vin),
          'drove', coalesce((
            select min(cd.started_at) from car_drives cd
            where cd.vin is not distinct from t.vin
              and cd.started_at >= greatest(t.starts_at - interval '90 minutes',
                                            coalesce(k.checkin_ok_at, k.accepted_at, t.starts_at - interval '90 minutes'))
              and cd.started_at <= t.ends_at
              and (public.trip_place(t.reservation_id) <> 'delivery' or (k.accepted_at is not null and cd.started_at >= greatest(k.accepted_at, coalesce(k.checkin_ok_at, k.accepted_at))))), g.handed_at),
          'handed_how', case when (
            select min(cd.started_at) from car_drives cd
            where cd.vin is not distinct from t.vin
              and cd.started_at >= greatest(t.starts_at - interval '90 minutes',
                                            coalesce(k.checkin_ok_at, k.accepted_at, t.starts_at - interval '90 minutes'))
              and cd.started_at <= t.ends_at
              and (public.trip_place(t.reservation_id) <> 'delivery' or (k.accepted_at is not null and cd.started_at >= greatest(k.accepted_at, coalesce(k.checkin_ok_at, k.accepted_at))))) is not null then 'drove' else g.handed_how end
        ) as x
        from turo_trips t
        left join tesla_guest_keys k using (reservation_id)
        left join lax_guest_links g using (reservation_id)
        where t.starts_at between now() - interval '12 hours' and now() + interval '6 hours'
          and t.ends_at > now()
          and coalesce(t.status, '') not ilike '%cancel%'
      ) s), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(x order by x->>'end') from (
        select jsonb_build_object(
          'id', t.reservation_id,
          'guest', t.guest_first,
          'car', coalesce(v.display_name, 'the Tesla'),
          'start', t.starts_at,
          'end', t.ends_at,
          'token', g.token,
          'phase', public.trip_return_phase(t.reservation_id),
          'parked', (select max(cd.ended_at) from car_drives cd
                      where cd.vin is not distinct from t.vin
                        and cd.started_at >= t.ends_at - interval '3 hours'
                        and cd.ended_at is not null),
          'at_spot', rs->>'spot',
          'battery', v.battery_pct,
          'charging', v.charging_state,
          'plugged', v.plugged_in,
          'observed', v.observed_at,
          'checked_out', coalesce(t.checked_out, false),
          'returned', g.returned_at,
          'settled', g.settled_at,
          'host_completed', g.host_completed_at,
          'key_removed', k.removed_at
        ) as x
        from turo_trips t
        left join tesla_guest_keys k using (reservation_id)
        left join lax_guest_links g using (reservation_id)
        left join turo_vehicle_state v on v.vin = t.vin
        where t.starts_at < now()
          and (t.ends_at between now() - interval '6 hours' and now() + interval '3 hours'
               -- early return (Claude 2026-10-11, Stone back 6 h early): car home and quiet before the end
               or (t.ends_at > now() and coalesce(g.done_using_at, g.quiet_since) > now() - interval '2 hours'))
          and coalesce(t.status, '') not ilike '%cancel%'
      ) s), '[]'::jsonb));
end;
$function$;

create or replace function public.host_gate_apply(p_g text, p_do text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_res bigint;
begin
  select reservation_id into v_res from tesla_guest_keys where gate_token = p_g;
  if v_res is null then return null; end if;
  update tesla_guest_keys set
    license_ok_at = case p_do when 'license' then coalesce(license_ok_at, now()) when 'undo_license' then null else license_ok_at end,
    checkin_ok_at = case p_do when 'checkin' then coalesce(checkin_ok_at, now()) when 'undo_checkin' then null else checkin_ok_at end,
    updated_at = now()
  where reservation_id = v_res;
  insert into lax_guest_events (reservation_id, kind, detail, actor) values (v_res, 'gate.' || p_do, null, 'host');
  return public.host_gate_state(p_g);
end $function$;

create or replace function public.host_gate_state(p_g text) returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('reservation_id', t.reservation_id, 'first', t.guest_first, 'starts_at', t.starts_at, 'ends_at', t.ends_at,
    'kind', lax_trip_kind(t.airport_code), 'license_ok', k.license_ok_at is not null, 'checkin_ok', k.checkin_ok_at is not null,
    'released', k.release_override or (k.license_ok_at is not null and k.checkin_ok_at is not null), 'key_status', k.status,
    'trip_token', g.token,
    'place', trip_place(t.reservation_id),
    'delivery', case when trip_place(t.reservation_id) = 'delivery' then trip_delivery_json(t.reservation_id) end,
    'home_address', case when trip_place(t.reservation_id) = 'home' then (select address from home_pickup_settings where id = 1) end,
    'car', coalesce((select v.display_name from turo_vehicle_state v where v.vin = t.vin), 'the Tesla'),
    'override', coalesce(k.release_override, false),
    'license_at', k.license_ok_at, 'checkin_at', k.checkin_ok_at, 'key_sent_at', k.ready_at, 'key_added_at', k.accepted_at,
    'key_on_car_at', (select min(d.first_seen) from car_drivers_seen d where d.reservation_id = t.reservation_id),
    'key_removed_at', k.removed_at, 'key_error', k.last_error)
  from tesla_guest_keys k join turo_trips t using (reservation_id)
  left join lax_guest_links g using (reservation_id) where k.gate_token = p_g $$;
