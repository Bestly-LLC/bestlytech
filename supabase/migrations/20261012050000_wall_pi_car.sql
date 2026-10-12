-- Blue Steel on the sky maps (Jared 2026-10-11, marker A). The wall's Pi asks for the car's last position once
-- every 30 s (/api/car); the wall page draws it only when it falls inside the visible sky. Read only.
-- Same token gate as wall_pi_handoff. The Pi calls with the publishable key, so it is also on security_public_rpcs
-- (otherwise Ares's Auto-Fixer locks it within the hour).
create or replace function public.wall_pi_car(p_token text)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v turo_vehicle_state; fs tesla_fleet_settings;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = fs.vin;
  if v.vin is null or v.latitude is null or v.longitude is null then
    return jsonb_build_object('known', false, 'at', now());
  end if;
  return jsonb_build_object(
    'known', true,
    'at', now(),
    'name', coalesce(v.display_name, 'Blue Steel'),
    'lat', v.latitude,
    'lon', v.longitude,
    'observed_at', v.observed_at,
    'fresh', v.observed_at > now() - interval '30 minutes',
    'shift', v.raw #>> '{fleet_api,shift}',
    'speed_mph', (v.raw #>> '{fleet_api,speed_mph}')::numeric);
end;
$function$;

revoke all on function public.wall_pi_car(text) from public;
grant execute on function public.wall_pi_car(text) to anon, authenticated, service_role;

insert into public.security_public_rpcs (fn, why) values
  ('wall_pi_car', 'The wall Pi reads the car position (publishable key + home-hub agent token) for the Blue Steel marker on the sky map; token-gated, read only')
on conflict (fn) do nothing;

-- Alerts about the car layer belong to the Wall Watchdog (prefix wall.car), same card as the rest of the wall.
insert into public.notification_owners (prefix, agent_slug, note)
values ('wall.car', 'wall-watchdog', 'Blue Steel marker on the wall sky (2026-10-11)')
on conflict (prefix) do update set agent_slug = excluded.agent_slug;
