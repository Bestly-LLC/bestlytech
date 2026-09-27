-- C1 watchdog: car_owner_drive needs Home Assistant's person.jared (Home Hub agent snapshot). If that goes stale the
-- check fails safe (car-moved alerts still fire), but Scout should say why "it's me" stopped being recognised.
do $mig$
declare src text; old text; new text;
begin
  src := pg_get_functiondef('public.car_protect_watchdog'::regproc);
  old := $o$  if coalesce(array_length(problems, 1), 0) > 0 then$o$;
  new := $n$  if not exists (select 1 from home_hub_snapshots s, jsonb_array_elements(coalesce(s.data->'devices', '[]'::jsonb)) d
                 where s.source = 'homeassistant' and s.captured_at > now() - interval '30 minutes' and d->>'entity_id' = 'person.jared') then
    problems := array_append(problems, 'your phone''s location from Home Assistant is over 30 min old, so "that''s me driving" can''t be recognised (car-moved alerts still fire)');
  end if;
  if coalesce(array_length(problems, 1), 0) > 0 then$n$;
  if position(old in src) = 0 then raise exception 'car_protect_watchdog anchor not found'; end if;
  execute replace(src, old, new);
end $mig$;
