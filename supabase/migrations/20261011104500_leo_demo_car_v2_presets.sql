-- Pretend car v2 (demo trips only): same climate presets as the trip page (cool = A/C 68°F, warm = heat 74°F,
-- seat = heated driver seat, off; 20 minute auto-off), plain state out; trip-voice turns it into cards and lines.
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
           'inside_f', case mode when 'cool' then to_jsonb(76) when 'warm' then to_jsonb(70) else st->'inside_f' end,
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
