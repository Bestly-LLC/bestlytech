-- Turo return card, 2026-10-05 (Jared: "Henok's live activity says headed back when I don't think he is").
-- Before: "Heading back" meant ANY drive that started in the last 3 hours of the trip. A guest out driving looked like a guest returning.
-- Now: trip_return_phase() estimates it from where the car is and which way it is moving:
--   away         not at the spot, not getting closer
--   heading_home getting closer over the last hour of readings (or a fresh moving ETA)  -> an ESTIMATE, labelled as one
--   home         at the spot (home or LAX), battery fine
--   home_low     at the spot, battery MORE THAN 10 points under what it was at pickup (Jared's rule)
-- plus Supercharger stops and cost for the trip (trip_charges where supercharger).
-- Also: lax_guest_links.host_completed_at + host_trip_panel / host_trip_complete for the host-only "Complete trip" button
-- on the trip page (needs the host pass, the same one the demo page uses), which ends the Home Assistant Live Activity.

alter table public.lax_guest_links add column if not exists host_completed_at timestamptz;
comment on column public.lax_guest_links.host_completed_at is
  'Set when the host taps Complete trip on the trip page. Also sets returned_at / settled_at; the Pi return Live Activity then ends.';

create or replace function public.trip_return_phase(p_res bigint) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare
  t turo_trips; v turo_vehicle_state; g lax_guest_links; e car_eta; rs jsonb;
  dlat float8; dlon float8; d_now float8; d_old float8; n_pts int;
  lat0 float8; lon0 float8; lat1 float8; lon1 float8;
  phase text; pick int; batt int; short boolean; fresh boolean; efresh boolean;
  sc_n int := 0; sc_cost numeric := 0;
begin
  select * into t from turo_trips where reservation_id = p_res;
  if t.reservation_id is null then return null; end if;
  select * into g from lax_guest_links where reservation_id = p_res;
  select * into v from turo_vehicle_state where vin = t.vin;
  select * into e from car_eta where reservation_id = p_res;
  rs := public.car_return_state();

  if t.airport_code is not null then dlat := 33.9472637; dlon := -118.3826063;
  else dlat := 34.084241; dlon := -118.371793; end if;

  select count(*), (array_agg(lat order by at))[1], (array_agg(lon order by at))[1],
         (array_agg(lat order by at desc))[1], (array_agg(lon order by at desc))[1]
    into n_pts, lat0, lon0, lat1, lon1
    from car_trail where vin = t.vin and at > now() - interval '60 minutes';
  if v.latitude is not null and (lat1 is null or v.observed_at > now() - interval '30 minutes') then lat1 := v.latitude; lon1 := v.longitude; end if;

  d_now := case when lat1 is null then null else sqrt(power((lat1 - dlat) * 111.0, 2) + power((lon1 - dlon) * 111.0 * cos(radians(dlat)), 2)) end;
  d_old := case when lat0 is null then null else sqrt(power((lat0 - dlat) * 111.0, 2) + power((lon0 - dlon) * 111.0 * cos(radians(dlat)), 2)) end;

  pick := g.pickup_battery; batt := v.battery_pct;
  short := (pick is not null and batt is not null and batt < pick - 10);
  fresh := v.observed_at > now() - interval '30 minutes';
  efresh := e.updated_at is not null and e.updated_at > now() - interval '15 minutes';

  if (rs->>'spot') is not null and coalesce(fresh, false) then
    phase := case when short then 'home_low' else 'home' end;
  elsif (n_pts >= 2 and d_old is not null and d_now is not null and d_old - d_now > 0.5)
     or (efresh and coalesce(e.moving, false) and e.minutes <= 60) then
    phase := 'heading_home';
  else
    phase := 'away';
  end if;

  select count(*), coalesce(sum(coalesce(c.cost, 0) + coalesce(c.idle_fee, 0)), 0)
    into sc_n, sc_cost from trip_charges c where c.reservation_id = p_res and coalesce(c.supercharger, false);

  return jsonb_build_object(
    'phase', phase, 'pickup', pick, 'battery', batt, 'short', short,
    'delta', case when pick is not null and batt is not null then batt - pick end,
    'eta_min', case when efresh then e.minutes end, 'eta_at', case when efresh then e.eta_at end,
    'dist_mi', case when d_now is null then null else round((d_now / 1.609)::numeric, 1) end,
    'sc_stops', sc_n, 'sc_cost', round(sc_cost, 2));
end $$;
revoke all on function public.trip_return_phase(bigint) from public, anon, authenticated;
grant execute on function public.trip_return_phase(bigint) to service_role;

create or replace function public.host_trip_panel(p_pass text, p_token text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare g lax_guest_links; t turo_trips; k tesla_guest_keys; drove timestamptz;
begin
  if p_pass is null or not public.lax_pass_host_ok(p_pass) then return null; end if;
  select * into g from lax_guest_links where token = p_token;
  if g.reservation_id is null then return null; end if;
  select * into t from turo_trips where reservation_id = g.reservation_id;
  select * into k from tesla_guest_keys where reservation_id = g.reservation_id;
  select min(cd.started_at) into drove from car_drives cd
   where cd.vin is not distinct from t.vin
     and cd.started_at >= greatest(t.starts_at - interval '90 minutes', coalesce(k.checkin_ok_at, k.accepted_at, t.starts_at - interval '90 minutes'))
     and cd.started_at <= t.ends_at;
  return jsonb_build_object('ok', true, 'guest', t.guest_first, 'starts_at', t.starts_at, 'ends_at', t.ends_at,
    'drove', drove, 'completed', g.host_completed_at, 'phase', public.trip_return_phase(g.reservation_id));
end $$;
grant execute on function public.host_trip_panel(text, text) to anon, authenticated;

create or replace function public.host_trip_complete(p_pass text, p_token text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  if p_pass is null or not public.lax_pass_host_ok(p_pass) then return jsonb_build_object('ok', false, 'error', 'not allowed'); end if;
  update lax_guest_links
     set returned_at = coalesce(returned_at, now()), settled_at = coalesce(settled_at, now()), host_completed_at = coalesce(host_completed_at, now())
   where token = p_token;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', false, 'error', 'no such trip'); end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.host_trip_complete(text, text) to anon, authenticated;

-- wall_pi_handoff: same as before, except returns[].heading (the any-drive guess) is replaced by returns[].phase, and
-- returns[].host_completed / the top-level host_pass are added (the Pi puts the pass in the tap link so the page shows the host panel).
create or replace function public.wall_pi_handoff(p_token text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
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
          and t.ends_at between now() - interval '6 hours' and now() + interval '3 hours'
          and coalesce(t.status, '') not ilike '%cancel%'
      ) s), '[]'::jsonb));
end;
$$;
