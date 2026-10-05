-- Turo handoff Live Activity, round 3 (Jared 2026-10-05): a guest who is simply not here yet is NORMAL (people check in hours
-- after pickup). The card only asks for a look when there is a real problem, so the Pi now also gets the key status/error,
-- guest-only key taps / help requests / self-removal (admin visits never count), and the car's current state.
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
          -- guest-only signals (actor = 'guest'): the host's own visits from the admin never count
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
          'heading', (select min(cd.started_at) from car_drives cd
                       where cd.vin is not distinct from t.vin
                         and cd.started_at >= t.ends_at - interval '3 hours'
                         and cd.started_at <= t.ends_at + interval '6 hours'),
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
          'key_removed', k.removed_at
        ) as x
        from turo_trips t
        left join tesla_guest_keys k using (reservation_id)
        left join lax_guest_links g using (reservation_id)
        left join turo_vehicle_state v on v.vin = t.vin
        where t.starts_at < now()
          and t.ends_at between now() - interval '6 hours' and now() + interval '3 hours'
          and coalesce(t.status, '') not ilike '%cancel%'
      ) s), '[]'::jsonb));
end;
$function$;

revoke all on function public.wall_pi_handoff(text) from public;
grant execute on function public.wall_pi_handoff(text) to anon, authenticated, service_role;


create or replace function public.wall_pi_key_resend(p_token text, p_reservation bigint)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare t turo_trips; k tesla_guest_keys;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  select * into t from turo_trips where reservation_id = p_reservation;
  if t.reservation_id is null then raise exception 'no such trip'; end if;
  if not (t.starts_at between now() - interval '12 hours' and now() + interval '6 hours' and t.ends_at > now()) then
    raise exception 'not a trip around pickup time';
  end if;
  if exists (select 1 from car_drivers_seen d where d.reservation_id = p_reservation) then
    raise exception 'the key is already on the car';
  end if;
  select * into k from tesla_guest_keys where reservation_id = p_reservation;
  if coalesce(k.resends, 0) >= 2 then raise exception 'already re-sent twice'; end if;
  return public.tesla_key_admin(p_reservation, 'resend');
end;
$function$;

revoke all on function public.wall_pi_key_resend(text, bigint) from public;
grant execute on function public.wall_pi_key_resend(text, bigint) to anon, authenticated, service_role;
