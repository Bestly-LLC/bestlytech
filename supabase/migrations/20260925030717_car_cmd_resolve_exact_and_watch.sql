-- car_cmd_name() matched a candidate by looking for "<name>" as a substring of the whole caps
-- blob. TezLab calls Sentry tesla_sentry_mode_on/off, and the quoted substring "sentry_mode_on"
-- does not occur in "tesla_sentry_mode_on", so Sentry resolved to null — and car_cmd() returns
-- null without queueing anything, so auto Sentry has been doing nothing, silently, with no event
-- and no error. Match names exactly against the parsed list instead, and know TezLab's spelling.
create or replace function public.car_cmd_name(p_kind text)
returns text language plpgsql stable security definer set search_path to 'public'
as $$
declare s car_protect_settings; cand text; names text[];
begin
  select * into s from car_protect_settings where id = 1;
  if s.cmd_map ? p_kind then return s.cmd_map->>p_kind; end if;
  if s.caps is null then return null; end if;

  select array_agg(c->>'name') into names
    from jsonb_array_elements(s.caps->'available_commands') c;
  if names is null then return null; end if;

  foreach cand in array case p_kind
    when 'sentry_on'    then array['tesla_sentry_mode_on','sentry_mode_on','set_sentry_mode','sentry_on']
    when 'sentry_off'   then array['tesla_sentry_mode_off','sentry_mode_off','set_sentry_mode','sentry_off']
    when 'charge_start' then array['charge_start','start_charging','charging_start']
    when 'erase'        then array['erase_user_data','erase_data','wipe_user_data','reset_valet_pin']
    else array[p_kind] end loop
    if cand = any (names) then return cand; end if;
  end loop;
  return null;
end $$;

-- A protection that cannot send its command is the worst kind of broken: the dashboard says the
-- feature is on, the log stays empty, and empty reads as "nothing happened" rather than "nothing
-- works". Check every command the engine relies on, hourly.
create or replace function public.car_cmd_watchdog()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare s car_protect_settings; k text; missing text[] := '{}'; needed text[];
begin
  select * into s from car_protect_settings where id = 1;
  if s.caps is null then
    perform public.bestly_raise('car.cmdmap', 'problem', 'warning',
      'Turo Watch: the car has not told us what it can do',
      'car_protect_settings.caps is empty, so every automatic command resolves to nothing. Refresh the car capabilities.', 'turo');
    return jsonb_build_object('ok', false, 'caps', false);
  end if;

  needed := array['sentry_on','sentry_off','charge_start'];
  if s.wipe_auto then needed := needed || 'erase'; end if;

  foreach k in array needed loop
    if public.car_cmd_name(k) is null then missing := missing || k; end if;
  end loop;

  if array_length(missing, 1) > 0 then
    perform public.bestly_raise('car.cmdmap', 'problem', 'warning',
      'Turo Watch: a protection has no command to send',
      format('The car does not accept: %s. Those actions are being skipped silently. Map them in car_protect_settings.cmd_map, or turn the feature off so the log stops implying it ran.',
             array_to_string(missing, ', ')), 'turo');
  else
    perform public.bestly_raise('car.cmdmap', 'resolved', 'info', null);
  end if;

  return jsonb_build_object('ok', array_length(missing, 1) is null, 'missing', missing);
end $$;

select cron.schedule('car-cmd-watchdog', '41 * * * *', $$select public.car_cmd_watchdog()$$);
