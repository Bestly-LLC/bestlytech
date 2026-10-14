-- Host gate: "Send to car" (navigate_to_point) + nav status in host_gate_state.
-- Undo: bestly_memory home / house/turo/gate-nav-undo-2026-10-13.

create or replace function public.car_cmd_nav(p_lat float8, p_lon float8, p_by text, p_res bigint default null, p_label text default null, p_dry boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c text; jid bigint; a jsonb;
begin
  if p_lat is null or p_lon is null or abs(p_lat) > 90 or abs(p_lon) > 180 then return jsonb_build_object('ok', false, 'error', 'bad coordinates'); end if;
  c := car_cmd_name('navigate_to_point');
  if c is null then return jsonb_build_object('ok', false, 'error', 'The car does not list navigate_to_point'); end if;
  a := jsonb_build_object('command', c, 'params', jsonb_build_object('latitude', p_lat, 'longitude', p_lon), 'kind', 'nav', 'by', p_by, 'reservation', p_res, 'label', p_label);
  if p_dry then return jsonb_build_object('ok', true, 'dry_run', true, 'action', 'cmd', 'args', a); end if;
  if not tezlab_up() then return jsonb_build_object('ok', false, 'error', 'tezlab_down'); end if;
  insert into tesla_fleet_commands (action, auto, args) values ('cmd', false, a) returning id into jid;
  return jsonb_build_object('ok', true, 'id', jid);
end $$;
revoke all on function public.car_cmd_nav(float8, float8, text, bigint, text, boolean) from public, anon, authenticated;
grant execute on function public.car_cmd_nav(float8, float8, text, bigint, text, boolean) to service_role;

create or replace function public.host_gate_nav_target(p_res bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare place text; d jsonb; g jsonb; fs tesla_fleet_settings; v turo_vehicle_state; dist float8; lbl text;
begin
  place := trip_place(p_res);
  if place not in ('delivery', 'lax') then return null; end if;
  d := delivery_nav_dest(p_res);
  if d is null then return null; end if;
  lbl := coalesce(d->>'label', d->>'address');
  if place = 'lax' then
    select guide into g from lax_pass_settings order by id limit 1;
    lbl := 'Park My Share garage' || coalesce(', ' || nullif(g->>'garage', ''), '');
  end if;
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = fs.vin;
  if v.latitude is not null and nullif(d->>'lat', '') is not null and v.observed_at > now() - interval '60 minutes' then
    dist := trip_dist_m(v.latitude, v.longitude, (d->>'lat')::float8, (d->>'lon')::float8);
  end if;
  return jsonb_build_object('place', place, 'label', lbl, 'ready', nullif(d->>'lat', '') is not null, 'state', d->>'state', 'car_there', coalesce(dist <= 400, false), 'miles', case when dist is not null then round((dist / 1609.34)::numeric, 1) end);
end $$;
revoke all on function public.host_gate_nav_target(bigint) from public, anon, authenticated;
grant execute on function public.host_gate_nav_target(bigint) to service_role;

create or replace function public.host_gate_nav_last(p_res bigint)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object('id', c.id,
    'status', case when c.status in ('queued', 'running') and c.created_at > now() - interval '3 minutes' then 'sending' when c.status = 'done' then 'sent' else 'failed' end,
    'at', coalesce(c.done_at, c.created_at), 'stage', c.stage, 'auto', c.action = 'nav_point',
    'error', case when c.status = 'done' then null
                  when c.status in ('queued', 'running') and c.created_at > now() - interval '3 minutes' then null
                  when c.status in ('queued', 'running') then 'No answer from the car in 3 minutes. Tap Send again.'
                  when coalesce(c.result->>'error', '') ~* 'asleep' then 'The car was asleep and missed it. Tap Send again.'
                  when coalesce(c.result->>'error', '') ~* 'TezLabDown|temporarily unavailable|servers are down' then 'TezLab is down right now. Try again in a few minutes.'
                  when c.result ? 'car_reason' then c.result->>'error'
                  else 'The car didn''t take it. Tap Send again.' end)
  from tesla_fleet_commands c
  where c.created_at > now() - interval '2 days'
    and ((c.action = 'cmd' and c.args->>'kind' = 'nav' and c.args->>'reservation' = p_res::text)
      or (c.action = 'nav_point' and c.reservation_id = p_res and coalesce(c.args->>'reason', '') like 'delivery-nav:%'))
  order by c.id desc limit 1
$$;
revoke all on function public.host_gate_nav_last(bigint) from public, anon, authenticated;
grant execute on function public.host_gate_nav_last(bigint) to service_role;

CREATE OR REPLACE FUNCTION public.host_gate_state(p_g text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'key_removed_at', k.removed_at, 'key_error', k.last_error, 'nav_target', host_gate_nav_target(t.reservation_id), 'nav', host_gate_nav_last(t.reservation_id))
  from tesla_guest_keys k join turo_trips t using (reservation_id)
  left join lax_guest_links g using (reservation_id) where k.gate_token = p_g $function$;

CREATE OR REPLACE FUNCTION public.host_gate_apply(p_g text, p_do text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_res bigint; t turo_trips; tgt jsonb; d jsonb; r jsonb; msg text; dry boolean := p_do = 'send_nav_dry';
begin
  select reservation_id into v_res from tesla_guest_keys where gate_token = p_g;
  if v_res is null then return null; end if;
  if p_do in ('send_nav', 'send_nav_dry') then
    select * into t from turo_trips where reservation_id = v_res;
    tgt := host_gate_nav_target(v_res);
    d := delivery_nav_dest(v_res);
    if not dry then
      update tesla_fleet_commands set status = 'failed', done_at = now(), stage = null, result = jsonb_build_object('ok', false, 'error', 'No answer in 3 minutes')
      where action = 'cmd' and args->>'kind' = 'nav' and args->>'reservation' = v_res::text and status in ('queued', 'running') and created_at < now() - interval '3 minutes';
    end if;
    msg := case
      when tgt is null then 'Home pick-up. The car is already here.'
      when upper(coalesce(t.status, '')) in ('CANCELLED', 'CANCELED') then 'This trip was cancelled.'
      when now() > t.starts_at + interval '3 hours' then 'This trip already started.'
      when exists (select 1 from car_drivers_seen x where x.reservation_id = v_res) then 'The guest has the car now.'
      when exists (select 1 from turo_trips o where o.reservation_id <> v_res and now() between o.starts_at and o.ends_at and coalesce(o.status, '') not in ('test', 'CANCELLED', 'CANCELED', 'OWNER_TRIP_END') and not coalesce(o.checked_out, false)) then 'Another guest has the car right now.'
      when not coalesce((tgt->>'ready')::boolean, false) then 'Still finding the address on the map.'
      when coalesce((tgt->>'car_there')::boolean, false) then 'The car is already there.'
      when exists (select 1 from tesla_fleet_commands where action = 'cmd' and args->>'kind' = 'nav' and args->>'reservation' = v_res::text and status in ('queued', 'running')) then 'Still sending. Give it a minute.'
      when (select count(*) from tesla_fleet_commands where action = 'cmd' and args->>'kind' = 'nav' and args->>'reservation' = v_res::text and created_at > now() - interval '1 day') >= 6 then 'That''s 6 sends today. Type it into the car instead.'
      when not tezlab_up() then 'TezLab is down right now. Try again in a few minutes.'
    end;
    if msg is null then
      r := car_cmd_nav((d->>'lat')::float8, (d->>'lon')::float8, 'host-gate', v_res, tgt->>'label', dry);
      if not coalesce((r->>'ok')::boolean, false) then msg := 'Couldn''t send. Try again.';
      elsif dry then msg := 'Dry run: would send ' || (tgt->>'label') || ' (' || (d->>'lat') || ', ' || (d->>'lon') || ')';
      end if;
    end if;
    if not dry then
      insert into lax_guest_events (reservation_id, kind, detail, actor) values (v_res, 'gate.send_nav', jsonb_build_object('job', r->'id', 'msg', msg), 'host');
    end if;
    return public.host_gate_state(p_g) || jsonb_build_object('nav_msg', msg);
  end if;
  update tesla_guest_keys set
    license_ok_at = case p_do when 'license' then coalesce(license_ok_at, now()) when 'undo_license' then null else license_ok_at end,
    checkin_ok_at = case p_do when 'checkin' then coalesce(checkin_ok_at, now()) when 'undo_checkin' then null else checkin_ok_at end,
    updated_at = now()
  where reservation_id = v_res;
  insert into lax_guest_events (reservation_id, kind, detail, actor) values (v_res, 'gate.' || p_do, null, 'host');
  return public.host_gate_state(p_g);
end $function$;
