-- Demo weather reaches Leo (Jared, 2026-10-11): the demo page's Hot / Cold / Nice switch now sets the pretend car's
-- cabin and outside temperature on the server too, so Leo's car_status, greeting and climate offers match the page.
-- leo_demo_weather is called by trip-voice op demo_weather (demo links only). leo_demo_car: cool/warm no longer
-- move the cabin the wrong way (cooling a 71°F "nice" cabin used to jump it to 76°F).
create or replace function public.leo_demo_weather(p_link text, p_weather text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare st jsonb; i int; o int;
begin
  if p_link not in ('d:demo-home','d:demo-lax') then return jsonb_build_object('ok', false, 'error', 'not a demo'); end if;
  case lower(coalesce(p_weather,''))
    when 'hot' then i := 97; o := 84;
    when 'cold' then i := 46; o := 49;
    when 'nice' then i := 71; o := 70;
    else return jsonb_build_object('ok', false, 'error', 'weather must be hot, cold or nice');
  end case;
  select case when updated_at > now() - interval '2 hours' then state end into st from leo_demo_car_state where link = p_link;
  st := coalesce(st, jsonb_build_object('locked', true, 'climate_on', false, 'climate_mode', 'off', 'target_f', 70,
                                        'battery', 78, 'range_mi', 241, 'nav', null));
  st := st || jsonb_build_object('weather', lower(p_weather), 'inside_f', i, 'outside_f', o, 'climate_on', false, 'climate_mode', 'off');
  insert into leo_demo_car_state(link, state, updated_at) values (p_link, st, now())
    on conflict (link) do update set state = excluded.state, updated_at = now();
  return jsonb_build_object('ok', true, 'car', st);
end $$;
revoke all on function public.leo_demo_weather(text,text) from public, anon, authenticated;
grant execute on function public.leo_demo_weather(text,text) to service_role;

create or replace function public.leo_demo_car(p_link text, p_name text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st jsonb; a text; t numeric; dest text; mode text;
begin
  if p_link not in ('d:demo-home','d:demo-lax') then return jsonb_build_object('ok', false, 'error', 'not a demo'); end if;
  select case when updated_at > now() - interval '2 hours' then state end into st from leo_demo_car_state where link = p_link;
  st := coalesce(st, jsonb_build_object('locked', true, 'climate_on', false, 'climate_mode', 'off', 'target_f', 70, 'inside_f', 84,
                                        'outside_f', 79, 'battery', 78, 'range_mi', 241, 'nav', null));
  -- Auto-off after 20 minutes, like the real buttons.
  if coalesce((st->>'climate_on')::boolean, false) and (st->>'climate_until') is not null and (st->>'climate_until')::timestamptz < now() then
    st := st || jsonb_build_object('climate_on', false, 'climate_mode', 'off');
  end if;
  a := lower(coalesce(p_args->>'action', ''));
  if p_name = 'car_climate' then
    t := nullif(p_args->>'target_temp_f','')::numeric;
    mode := case when a in ('cool','start','on') then 'cool' when a = 'warm' then 'warm' when a = 'seat' then 'seat'
                 when a in ('off','stop') then 'off'
                 when a = 'set_temp' then case when coalesce(t, 70) <= 71 then 'cool' else 'warm' end end;
    if mode is null then return jsonb_build_object('ok', false, 'error', 'action must be cool, warm, seat or off'); end if;
    if mode = 'off' then st := st || jsonb_build_object('climate_on', false, 'climate_mode', 'off');
    else st := st || jsonb_build_object('climate_on', true, 'climate_mode', mode,
           'target_f', case mode when 'cool' then to_jsonb(68) when 'warm' then to_jsonb(74) else st->'target_f' end,
           -- Cooling never warms a cabin that is already cool, and heat never cools a warm one (demo weather, 2026-10-11).
           'inside_f', case mode when 'cool' then to_jsonb(least(coalesce((st->>'inside_f')::numeric, 84), 76))
                                 when 'warm' then to_jsonb(greatest(coalesce((st->>'inside_f')::numeric, 46), 70)) else st->'inside_f' end,
           'climate_until', now() + interval '20 minutes');
    end if;
  elsif p_name = 'car_lock' then
    if a not in ('lock','unlock') then return jsonb_build_object('ok', false, 'error', 'action must be lock'); end if;
    st := jsonb_set(st, '{locked}', to_jsonb(a = 'lock'));
  elsif p_name = 'send_to_car_nav' then
    dest := left(btrim(coalesce(p_args->>'destination', '')), 120);
    if length(dest) < 2 then return jsonb_build_object('ok', false, 'error', 'destination needed'); end if;
    st := jsonb_set(st, '{nav}', to_jsonb(dest));
  elsif p_name = 'find_superchargers' then
    return jsonb_build_object('ok', true, 'sites', jsonb_build_array(
      jsonb_build_object('name', 'Los Angeles - Century Blvd', 'miles', 1.2, 'open', 12, 'total', 20, 'lat', 33.9456, 'lon', -118.3712),
      jsonb_build_object('name', 'Hawthorne, CA', 'miles', 3.4, 'open', 8, 'total', 16, 'lat', 33.9167, 'lon', -118.3526),
      jsonb_build_object('name', 'Culver City, CA', 'miles', 5.9, 'open', 4, 'total', 12, 'lat', 34.0029, 'lon', -118.3931)));
  elsif p_name = 'charging_summary' then
    return jsonb_build_object('ok', true, 'charging', jsonb_build_object('total', 28.17, 'count', 2, 'kwh', 61.4, 'final', false,
      'sessions', jsonb_build_array(
        jsonb_build_object('started_at', now() - interval '20 hours', 'site', 'Barstow, CA', 'cost', 18.42),
        jsonb_build_object('started_at', now() - interval '14 hours', 'site', 'Baker, CA', 'cost', 9.75))));
  elsif p_name <> 'car_status' then
    return jsonb_build_object('ok', false, 'error', 'unknown tool');
  end if;
  insert into leo_demo_car_state(link, state, updated_at) values (p_link, st, now())
    on conflict (link) do update set state = excluded.state, updated_at = now();
  return jsonb_build_object('ok', true, 'car', st);
end $$;
revoke all on function public.leo_demo_car(text,text,jsonb) from public, anon, authenticated;
grant execute on function public.leo_demo_car(text,text,jsonb) to service_role;
