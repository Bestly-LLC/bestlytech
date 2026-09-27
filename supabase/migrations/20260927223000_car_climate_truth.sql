-- C2 (2026-09-27): "Cool it down" said Done while the A/C stayed off.
-- Root cause: the car refuses remote climate (reason low_power_mode_low_soc = Low Power Mode is on) and the
-- Mac mini worker ignored result=false (fixed in worker 1.8.1); TezLab fell back to the worker on the same
-- refusal (fixed in tezlab v15). This migration:
--   1. tesla_job_done: tesla_fleet_state.observed_at = the car's own reading time when the source sends one
--      (TezLab's cache can be hours old; admin "Last reading" used to show now()).
--   2. tesla_admin_command('refresh') goes straight to the Tesla worker = a live read, not TezLab's cache.
--   3. tesla_climate_refusal_watch: a refused climate command raises a Scout incident in plain words
--      (car.climate_blocked), resolved by the next climate command that works.

create or replace function public.tesla_job_done(p_id bigint, p_ok boolean, p_result jsonb, p_state jsonb default null::jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare s tesla_fleet_settings; seen timestamptz;
begin

  update tesla_fleet_commands set status = case when p_ok then 'done' else 'failed' end, done_at = now(), result = p_result where id = p_id;
  update tesla_fleet_settings set last_error = case when p_ok then null else left(p_result->>'error', 300) end where id = 1;
  select * into s from tesla_fleet_settings where id = 1;
  if p_state is null or s.vin is null then return; end if;

  if coalesce(p_state->>'online', '') = 'asleep' then
    -- Nothing new to read; just record that it's asleep (keeps the last real reading).
    update turo_vehicle_state set connection_state = 'asleep', updated_at = now() where vin = s.vin;
    return;
  end if;

  -- The car's own reading time when the source gives one (TezLab: last_updated), never in the future.
  seen := case when coalesce(p_state->>'observed_at', '') ~ '^\d{4}-\d{2}-\d{2}T' then least((p_state->>'observed_at')::timestamptz, now()) else now() end;

  update tesla_fleet_state set observed_at = seen, battery = (p_state->>'battery')::int, range_mi = (p_state->>'range')::numeric,
    inside_f = (p_state->>'inside_f')::numeric, outside_f = (p_state->>'outside_f')::numeric, locked = (p_state->>'locked')::boolean,
    climate_on = (p_state->>'climate_on')::boolean, charging = p_state->>'charging', online = p_state->>'online', raw = p_state
  where id = 1;

  insert into turo_vehicle_state as v (vin, display_name, observed_at, battery_pct, range_epa, range_real, odometer, locked, charging_state,
      plugged_in, inside_temp, outside_temp, connection_state, software_version, raw, updated_at)
  values (s.vin, coalesce(s.vehicle_name, 'Tesla'), now(), (p_state->>'battery')::int, (p_state->>'range')::numeric, (p_state->>'range_real')::numeric,
      (p_state->>'odometer')::numeric::int, (p_state->>'locked')::boolean, p_state->>'charging', (p_state->>'plugged_in')::boolean,
      (p_state->>'inside_f')::numeric, (p_state->>'outside_f')::numeric, coalesce(p_state->>'online', 'online'), p_state->>'software',
      jsonb_build_object('fleet_api', p_state), now())
  on conflict (vin) do update set
    display_name = coalesce(v.display_name, excluded.display_name),
    observed_at = excluded.observed_at,
    battery_pct = coalesce(excluded.battery_pct, v.battery_pct),
    range_epa = coalesce(excluded.range_epa, v.range_epa),
    range_real = excluded.range_real,  -- battery-dependent: an old number from another source would be wrong now
    odometer = coalesce(excluded.odometer, v.odometer),
    locked = coalesce(excluded.locked, v.locked),
    charging_state = coalesce(excluded.charging_state, v.charging_state),
    plugged_in = coalesce(excluded.plugged_in, v.plugged_in),
    inside_temp = coalesce(excluded.inside_temp, v.inside_temp),
    outside_temp = coalesce(excluded.outside_temp, v.outside_temp),
    connection_state = excluded.connection_state,
    software_version = coalesce(excluded.software_version, v.software_version),
    latitude = coalesce((p_state->>'latitude')::float8, v.latitude),
    longitude = coalesce((p_state->>'longitude')::float8, v.longitude),
    raw = coalesce(v.raw, '{}'::jsonb) || excluded.raw,          -- keeps TezLab fields (location etc.), adds fleet_api
    updated_at = now();
end $function$;

create or replace function public.tesla_admin_command(p_action text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare jid bigint;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_action not in ('cool','warm','seat','off','refresh') then raise exception 'unknown action'; end if;
  -- "Read the car" = a live Tesla read by the Mac mini worker (TezLab only has a cached copy). Never wakes the car.
  insert into tesla_fleet_commands (reservation_id, action, via) values (null, p_action, case when p_action = 'refresh' then 'fleet' end) returning id into jid;
  return jsonb_build_object('ok', true, 'id', jid);
end $function$;

create or replace function public.tesla_climate_refusal_watch()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare nx record; body text;
begin
  if new.action not in ('cool','warm','seat') or new.status is not distinct from old.status then return new; end if;
  if new.status = 'failed' and coalesce(new.result->>'error', '') ~* 'low power mode|car said no|won''t run the A/C|didn''t come on' then
    select guest_first, starts_at into nx from turo_trips where starts_at > now() - interval '1 hour'
      and coalesce(status, '') not in ('test','CANCELLED','CANCELED') order by starts_at limit 1;
    body := (new.result->>'error') || case when nx.starts_at is not null then ' Next guest: ' || coalesce(nx.guest_first, 'guest') || ', pickup '
      || to_char(nx.starts_at at time zone 'America/Los_Angeles', 'Dy Mon FMDD, FMHH12:MI AM') || '. Their A/C buttons won''t work until this is fixed.' else '' end;
    begin
      perform bestly_raise('car.climate_blocked', 'problem', 'warning', 'Blue Steel won''t run the A/C remotely', body, 'turo', 'Turn off Low Power Mode in the car', false);
    exception when others then raise warning 'tesla_climate_refusal_watch: %', sqlerrm; end;
  elsif new.status = 'done' then
    begin
      perform bestly_raise('car.climate_blocked', 'resolved', 'info', 'Remote A/C works again', null, 'turo');
    exception when others then null; end;
  end if;
  return new;
end $function$;

drop trigger if exists tesla_climate_refusal_watch on public.tesla_fleet_commands;
create trigger tesla_climate_refusal_watch after update of status on public.tesla_fleet_commands
  for each row execute function public.tesla_climate_refusal_watch();
