-- Turo pick-up card tap opens the host confirm page (/g/<gate>) again; confirm page links on to the trip page. Jared 2026-10-11.
-- wall_pi_handoff: trips[] now carry the confirm-page token ('gate'). host_gate_state: now returns 'trip_token'.
-- Undo: bestly_memory key house/turo/checkin-card-link-undo-2026-10-11 holds the original definitions.

CREATE OR REPLACE FUNCTION public.wall_pi_handoff(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          'drove', (
            select min(cd.started_at) from car_drives cd
            where cd.vin is not distinct from t.vin
              and cd.started_at >= greatest(t.starts_at - interval '90 minutes',
                                            coalesce(k.checkin_ok_at, k.accepted_at, t.starts_at - interval '90 minutes'))
              and cd.started_at <= t.ends_at)
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

CREATE OR REPLACE FUNCTION public.host_gate_state(p_g text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('reservation_id', t.reservation_id, 'first', t.guest_first, 'starts_at', t.starts_at, 'ends_at', t.ends_at,
    'kind', lax_trip_kind(t.airport_code), 'license_ok', k.license_ok_at is not null, 'checkin_ok', k.checkin_ok_at is not null,
    'released', k.release_override or (k.license_ok_at is not null and k.checkin_ok_at is not null), 'key_status', k.status,
    'trip_token', g.token)
  from tesla_guest_keys k join turo_trips t using (reservation_id)
  left join lax_guest_links g using (reservation_id) where k.gate_token = p_g $function$;
