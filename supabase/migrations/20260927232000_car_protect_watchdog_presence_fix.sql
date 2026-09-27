-- Fix for 20260927231500: the watchdog has a variable named s (car_protect_settings) that shadowed the table alias.
do $mig$
declare src text;
begin
  src := pg_get_functiondef('public.car_protect_watchdog'::regproc);
  if position('from home_hub_snapshots s, jsonb_array_elements(coalesce(s.data' in src) = 0 then raise exception 'anchor not found'; end if;
  src := replace(src, 'from home_hub_snapshots s, jsonb_array_elements(coalesce(s.data->''devices'', ''[]''::jsonb)) d', 'from home_hub_snapshots hh, jsonb_array_elements(coalesce(hh.data->''devices'', ''[]''::jsonb)) d');
  src := replace(src, 'where s.source = ''homeassistant'' and s.captured_at > now() - interval ''30 minutes'' and d->>''entity_id'' = ''person.jared''', 'where hh.source = ''homeassistant'' and hh.captured_at > now() - interval ''30 minutes'' and d->>''entity_id'' = ''person.jared''');
  execute src;
end $mig$;
