-- Wall round 4 follow-up (2026-09-28): "Devices" card on the wall strip (Dyson purifier tile after Batteries).
-- Adds the widget switch widgets.devices to wall_clean_widgets (everything else unchanged from 20260928230000_wall_r4_w2_strip.sql).
create or replace function public.wall_clean_widgets(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $function$
declare out jsonb := '{}'::jsonb; w jsonb := '{}'::jsonb; k text;
begin
  if jsonb_typeof(p->'widgets') = 'object' then
    foreach k in array array['news','mail','turo$','air','energy','habits','leo','appstore','turoCal','claude','devices'] loop
      if jsonb_typeof(p->'widgets'->k) = 'boolean' then w := w || jsonb_build_object(k, p->'widgets'->k); end if;
    end loop;
    out := out || jsonb_build_object('widgets', w);
  elsif p ? 'widgets' and jsonb_typeof(p->'widgets') = 'null' then
    out := out || '{"widgets": null}'::jsonb;
  end if;
  if jsonb_typeof(p->'bookingDemo') = 'number' then
    out := out || jsonb_build_object('bookingDemo', p->'bookingDemo');
  end if;
  return out;
end $function$;
