-- Recipes tab: the "Cooking lights scene" and "Open cook mode when you walk into the kitchen" toggles stop being hardcoded off.
-- They now follow what Home Assistant really has, read from ha_entity_catalog (the Pi's device list, refreshed about every 30 minutes),
-- so they enable themselves when the scene / sensor exist and fall back to the honest "Not available yet: ..." label when one goes away.
--
--   Home Assistant package bestly_auto_cooking (installed 2026-10-29 through home_hub_commands.package_put) defines scene.cooking:
--   light.kitchen (the Hue Kitchen zone: bar, south, north) + light.kitchen_bar at 100% and 4000 K. Nothing else is touched.
--
--   recipe_settings 'ha'            gains "lights" (default on): Start Cooking turns the scene on
--   recipe_settings 'cooking_scene' the package YAML, so Basil's watchdog can put the scene back if it ever disappears
--   recipes_ha_status()             live availability (also keeps the catalog warm: it is only refreshed on demand) for the page: scene, room sensor, Kitchen presence ESP, catalog age, the two settings
--   recipe_cook_lights()            Start Cooking -> homeassistant.call scene.turn_on scene.cooking (same command queue as timers' announce)
--   basil_ha_watchdog()             scene.cooking / sensor.jared_room missing -> heal or raise (kitchen.scene, kitchen.room), signed Basil;
--                                   hooked into basil_recipes_watchdog() (check 6 of the hourly basil-watchdog). No new cron.

-- 1. settings: add "lights"
update public.recipe_settings set value = '{"lights": true}'::jsonb || value, updated_at = now() where key = 'ha' and not (value ? 'lights');

create or replace function public.recipes_settings_get()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return '{"speaker": true, "timer_push": true, "kitchen_auto": true, "voice": true, "lights": true}'::jsonb
         || coalesce((select value from public.recipe_settings where key = 'ha'), '{}'::jsonb);
end $$;

create or replace function public.recipes_settings_set(p_key text, p_value boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_key not in ('speaker', 'timer_push', 'kitchen_auto', 'voice', 'lights') then raise exception 'unknown setting'; end if;
  insert into public.recipe_settings (key, value) values ('ha', jsonb_build_object(p_key, p_value))
  on conflict (key) do update set value = public.recipe_settings.value || jsonb_build_object(p_key, p_value), updated_at = now();
  return public.recipes_settings_get();
end $$;

-- 2. the package YAML, kept so the watchdog can reinstall it
insert into public.recipe_settings (key, value)
values ('cooking_scene', jsonb_build_object(
  'package', 'bestly_auto_cooking',
  'installed_at', '2026-10-29T13:34:00Z',
  'yaml', E'# Cooking lights: Basil''s Recipes tab turns this on when you tap Start Cooking.\n# Owner: Basil. Only the kitchen lights are listed, so nothing else in the home changes.\nscene:\n  - id: bestly_cooking\n    name: Cooking\n    icon: mdi:chef-hat\n    entities:\n      light.kitchen:\n        state: "on"\n        brightness: 255\n        color_temp_kelvin: 4000\n      light.kitchen_bar:\n        state: "on"\n        brightness: 255\n        color_temp_kelvin: 4000\n'))
on conflict (key) do nothing;

-- 3. what Home Assistant has right now (read-only, from the catalog)
create or replace function public.recipes_ha_status()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cat record; s jsonb; age int;
  v_scene text; v_room text; v_kit text; v_fresh boolean;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  s := public.recipes_settings_get();
  select captured_at, data into cat from public.ha_entity_catalog where id;
  if cat.captured_at is null then
    return jsonb_build_object('catalog', false, 'fresh', false, 'scene_cooking', false, 'room_sensor', false, 'kitchen_sensor', false,
                              'settings', jsonb_build_object('lights', s -> 'lights', 'kitchen_auto', s -> 'kitchen_auto'));
  end if;
  age := floor(extract(epoch from now() - cat.captured_at) / 60);
  v_fresh := age <= 180;
  -- The catalog is only refreshed on demand (ha_automator_on_command stores the ones requested_by 'ha-automator'), so a page
  -- that is open keeps it warm: ask the Pi for a new list when ours is over 30 minutes old (one ask per 30 minutes, read-only).
  if age > 30 and not exists (select 1 from public.home_hub_commands where target = 'homeassistant' and action = 'catalog'
                                 and requested_by = 'ha-automator' and created_at > now() - interval '30 minutes') then
    insert into public.home_hub_commands (target, action, payload, requested_by) values ('homeassistant', 'catalog', '{}'::jsonb, 'ha-automator');
  end if;
  select e ->> 2 into v_scene from jsonb_array_elements(cat.data -> 'entities') e where e ->> 0 = 'scene.cooking' limit 1;
  select e ->> 2 into v_room  from jsonb_array_elements(cat.data -> 'entities') e where e ->> 0 = 'sensor.jared_room' limit 1;
  select e ->> 2 into v_kit   from jsonb_array_elements(cat.data -> 'entities') e where e ->> 0 = 'binary_sensor.kitchen_kitchen_presence_status' limit 1;
  return jsonb_build_object(
    'catalog', true, 'catalog_age_min', age, 'fresh', v_fresh,
    'scene_cooking', v_fresh and v_scene is not null and v_scene <> 'unavailable',
    'room_exists', v_room is not null and v_room <> 'unavailable',
    'kitchen_sensor_exists', v_kit is not null,
    'kitchen_sensor_online', v_kit = 'on',
    -- walk-in needs the sensor to exist AND the Kitchen presence ESP to be connected, or the room would read "unknown" forever
    'room_sensor', v_fresh and v_room is not null and v_room <> 'unavailable' and v_kit = 'on',
    'kitchen_sensor', v_fresh and v_kit = 'on',
    'settings', jsonb_build_object('lights', s -> 'lights', 'kitchen_auto', s -> 'kitchen_auto'));
end $$;

-- 4. Start Cooking -> the scene (same queue the timers use to announce on the HomePods)
create or replace function public.recipe_cook_lights()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare st jsonb;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  st := public.recipes_ha_status();
  if not coalesce((st -> 'settings' ->> 'lights')::boolean, false) then return jsonb_build_object('sent', false, 'why', 'off'); end if;
  if not coalesce((st ->> 'scene_cooking')::boolean, false) then return jsonb_build_object('sent', false, 'why', 'no scene'); end if;
  if exists (select 1 from public.home_hub_commands
              where requested_by = 'basil-recipes' and action = 'call' and payload ->> 'entity_id' = 'scene.cooking'
                and created_at > now() - interval '45 seconds') then
    return jsonb_build_object('sent', false, 'why', 'just sent');
  end if;
  insert into public.home_hub_commands (target, action, payload, requested_by)
  values ('homeassistant', 'call', jsonb_build_object('service', 'scene.turn_on', 'entity_id', 'scene.cooking'), 'basil-recipes');
  return jsonb_build_object('sent', true);
end $$;

-- 5. Basil's watchdog for the two Home Assistant things this tab depends on
create or replace function public.basil_ha_watchdog()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  healed text[] := '{}'; problems text[] := '{}';
  cat record; age int; v_scene text; v_room text; v_auto boolean; v_pkg jsonb; v_inst timestamptz;
begin
  select captured_at, data into cat from public.ha_entity_catalog where id;
  if cat.captured_at is null then
    return jsonb_build_object('healed', to_jsonb(healed), 'problems', to_jsonb(problems));
  end if;
  age := floor(extract(epoch from now() - cat.captured_at) / 60);

  -- Home Assistant's device list is old: ask the Pi for a fresh one (at most every 30 minutes) and judge next hour
  if age > 50 then
    if not exists (select 1 from public.home_hub_commands where target = 'homeassistant' and action = 'catalog' and requested_by = 'ha-automator' and created_at > now() - interval '30 minutes') then
      insert into public.home_hub_commands (target, action, payload, requested_by) values ('homeassistant', 'catalog', '{}'::jsonb, 'ha-automator');
      healed := healed || 'asked Home Assistant for a new device list'::text;
    end if;
    if age > 360 then problems := problems || ('the Home Assistant device list is ' || (age / 60) || ' hours old, so the Cooking scene and room sensor could not be checked'); end if;
    return jsonb_build_object('healed', to_jsonb(healed), 'problems', to_jsonb(problems));
  end if;

  v_auto := coalesce((select (value ->> 'kitchen_auto')::boolean from public.recipe_settings where key = 'ha'), true);
  select e ->> 2 into v_scene from jsonb_array_elements(cat.data -> 'entities') e where e ->> 0 = 'scene.cooking' limit 1;
  select e ->> 2 into v_room  from jsonb_array_elements(cat.data -> 'entities') e where e ->> 0 = 'sensor.jared_room' limit 1;

  -- scene.cooking: put the package back once if it is gone, then raise if it still is not there
  begin
    select value into v_pkg from public.recipe_settings where key = 'cooking_scene';
    v_inst := coalesce((v_pkg ->> 'installed_at')::timestamptz, '-infinity');
    if v_scene is null and cat.captured_at > v_inst + interval '2 minutes' then
      if v_pkg ->> 'yaml' is not null
         and not exists (select 1 from public.home_hub_commands where target = 'homeassistant' and action = 'package_put'
                            and requested_by = 'basil-watchdog' and created_at > now() - interval '2 hours') then
        insert into public.home_hub_commands (target, action, payload, requested_by)
        values ('homeassistant', 'package_put', jsonb_build_object('name', coalesce(v_pkg ->> 'package', 'bestly_auto_cooking'), 'yaml', v_pkg ->> 'yaml'), 'basil-watchdog');
        insert into public.home_hub_commands (target, action, payload, requested_by) values ('homeassistant', 'catalog', '{}'::jsonb, 'ha-automator');
        healed := healed || 'put the Cooking lights scene back on Home Assistant'::text;
      else
        problems := problems || 'the Cooking lights scene (scene.cooking) is missing from Home Assistant and putting it back did not work'::text;
        perform public.bestly_raise('kitchen.scene', 'problem', 'warning', 'Basil lost the Cooking lights scene',
          'scene.cooking is missing from Home Assistant, so the Cooking lights toggle in Recipes is off. Basil already tried to put it back once.', 'home', null, false);
      end if;
    elsif v_scene = 'unavailable' then
      problems := problems || 'the Cooking lights scene (scene.cooking) is unavailable in Home Assistant'::text;
      perform public.bestly_raise('kitchen.scene', 'problem', 'warning', 'Basil lost the Cooking lights scene',
        'scene.cooking is unavailable in Home Assistant, so the Cooking lights toggle in Recipes is off.', 'home', null, false);
    else
      perform public.bestly_raise('kitchen.scene', 'resolved');
    end if;
  exception when others then problems := problems || ('cooking scene check: ' || sqlerrm);
  end;

  -- sensor.jared_room: only matters while the walk-in toggle is on. "unknown" (phone out of range) is normal; missing or unavailable is not.
  begin
    if v_auto and (v_room is null or v_room = 'unavailable') then
      problems := problems || ('the room sensor (sensor.jared_room) is ' || case when v_room is null then 'missing from' else 'unavailable in' end || ' Home Assistant')::text;
      perform public.bestly_raise('kitchen.room', 'problem', 'warning', 'Basil lost the room sensor',
        'sensor.jared_room is ' || case when v_room is null then 'missing from' else 'unavailable in' end ||
        ' Home Assistant, so cook mode cannot open when you walk into the kitchen. The toggle in Recipes shows why.', 'home', null, false);
    else
      perform public.bestly_raise('kitchen.room', 'resolved');
    end if;
  exception when others then problems := problems || ('room sensor check: ' || sqlerrm);
  end;

  return jsonb_build_object('healed', to_jsonb(healed), 'problems', to_jsonb(problems));
end $$;
revoke all on function public.basil_ha_watchdog() from public, anon, authenticated;
grant execute on function public.basil_ha_watchdog() to service_role;

-- Hook it into basil_recipes_watchdog() (anchored, idempotent, fails loudly if the anchor moved).
do $$
declare d text;
begin
  d := pg_get_functiondef('public.basil_recipes_watchdog()'::regprocedure);
  if position('basil_ha_watchdog' in d) = 0 then
    d := replace(d, $a$return jsonb_build_object('healed', to_jsonb(healed), 'problems', to_jsonb(problems));$a$,
$b$-- 6. Home Assistant things this tab needs: scene.cooking and sensor.jared_room (basil_ha_watchdog)
  declare hw jsonb;
  begin
    hw := public.basil_ha_watchdog();
    healed := healed || coalesce((select array_agg(x) from jsonb_array_elements_text(hw -> 'healed') x), '{}'::text[]);
    problems := problems || coalesce((select array_agg(x) from jsonb_array_elements_text(hw -> 'problems') x), '{}'::text[]);
  exception when others then problems := problems || ('home assistant check: ' || sqlerrm);
  end;

  return jsonb_build_object('healed', to_jsonb(healed), 'problems', to_jsonb(problems));$b$);
    if position('basil_ha_watchdog' in d) = 0 then raise exception 'basil_recipes_watchdog anchor not found'; end if;
    execute d;
  end if;
end $$;

-- 6. grants: the page calls these as an authenticated admin (guards are inside)
do $$
declare f text;
begin
  foreach f in array array['recipes_ha_status()', 'recipe_cook_lights()', 'recipes_settings_get()', 'recipes_settings_set(text,boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;
