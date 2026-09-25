-- Two fixes and one honest label.
--
-- 1) array || 'the doors (unlocked)' made Postgres read the string as an array literal, because of
--    the parentheses, and threw. It had never run: the branch only fires when the car is actually
--    unlocked. Appends are array_append() now.
create or replace function public.car_return_state()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v turo_vehicle_state; fs tesla_fleet_settings; d_km float8; spot text;
        v_trunk boolean; v_frunk boolean; v_win boolean; v_open text[] := '{}'; v_fresh boolean;
begin
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = fs.vin;
  if v.vin is null or v.latitude is null then
    return jsonb_build_object('known', false, 'why', 'no reading from the car');
  end if;

  v_fresh := v.observed_at > now() - interval '30 minutes';

  d_km := sqrt(power((v.latitude - 34.084241) * 111.0, 2) + power((v.longitude + 118.371793) * 111.0 * cos(radians(34.084241)), 2));
  if d_km < 0.35 then spot := 'home'; end if;
  if spot is null then
    d_km := sqrt(power((v.latitude - 33.9472637) * 111.0, 2) + power((v.longitude + 118.3826063) * 111.0 * cos(radians(33.9472637)), 2));
    if d_km < 0.35 then spot := 'lax'; end if;
  end if;

  v_trunk := (v.raw #>> '{fleet_api,doors,rear_trunk_open}')::boolean;
  v_frunk := (v.raw #>> '{fleet_api,doors,front_trunk_open}')::boolean;
  v_win   := car_windows_open();

  if coalesce(v_trunk, false) then v_open := array_append(v_open, 'the boot'); end if;
  if coalesce(v_frunk, false) then v_open := array_append(v_open, 'the frunk'); end if;
  if coalesce(v_win,   false) then v_open := array_append(v_open, 'a window'); end if;
  if v.locked is false        then v_open := array_append(v_open, 'the doors (unlocked)'); end if;

  return jsonb_build_object(
    'known', true, 'at', v.observed_at, 'fresh', v_fresh, 'spot', spot, 'locked', v.locked,
    'trunk_open', v_trunk, 'frunk_open', v_frunk, 'windows_open', v_win, 'open', to_jsonb(v_open),
    'settled', (v_fresh and spot is not null and coalesce(v.locked, false) and array_length(v_open, 1) is null));
end $$;

-- 2) The missing window field does not only weaken the key gate. car_protect_tick's "close the
--    windows when parked" auto-fix calls the same car_windows_open(), which returns null, and null
--    is not true — so that protection has never fired once. The car accepts a close-windows
--    command; nothing can ever tell it to send one. One cause, one fix, so say both in one alert.
create or replace function public.window_signal_note()
returns text language sql stable set search_path to 'public' as $$
  select format(
    'The car reports %s things about itself and none of them is a window. Doors, boot and frunk come through; window position does not. Two consequences: a window left down will not hold a guest key back, and the "close the windows when parked" auto-fix has never fired (%s times to date) because it waits on a signal that never arrives. The car accepts the close-windows command — nothing can tell it when. The fix is upstream: the status feed has to carry window state.',
    (select count(*) from public.car_raw_find('.')),
    (select count(*) from public.car_events where kind = 'autofix_windows'));
$$;

-- 3) Fifteen minutes, not ten.
update public.tesla_key_settings set settle_minutes = 15, updated_at = now() where id = 1;
