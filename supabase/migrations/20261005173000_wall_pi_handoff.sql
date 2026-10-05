-- Turo handoff progress for the iPhone Live Activity (Jared 2026-10-05).
-- One row per trip starting within the next 6 hours (or started in the last 6 hours and not yet ended),
-- with the timestamp of every guest step the trip page and the car know about. The Pi (server.py
-- _la_turo) turns this into a stepper: License -> Check-in -> Key sent -> Key on car -> Drove off.
create or replace function public.wall_pi_handoff(p_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  return jsonb_build_object('at', now(), 'trips', coalesce((
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
      where t.starts_at between now() - interval '6 hours' and now() + interval '6 hours'
        and t.ends_at > now()
        and coalesce(t.status, '') not ilike '%cancel%'
    ) s), '[]'::jsonb));
end;
$function$;

revoke all on function public.wall_pi_handoff(text) from public;
grant execute on function public.wall_pi_handoff(text) to anon, authenticated, service_role;
