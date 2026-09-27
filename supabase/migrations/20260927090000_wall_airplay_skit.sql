-- 2026-09-27: AirPlay receiver switch (state.airplay) + the cartoon skit (tour cmd "skit").
create or replace function public.wall_clean_toggles(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare out jsonb := '{}'::jsonb; k text;
begin
  foreach k in array array['skyStars','skyMoon','skySun','skyPlanets','airLabels','airCard','airCardHeli','airplay'] loop
    if jsonb_typeof(p->k) = 'boolean' then out := out || jsonb_build_object(k, p->k); end if;
  end loop;
  return out;
end $$;
create or replace function public.wall_clean_tour(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare out jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p->'tour') = 'object' and p->'tour'->>'cmd' in ('play','party','stop','skit') and jsonb_typeof(p->'tour'->'at') = 'number' then
    out := out || jsonb_build_object('tour', jsonb_build_object('cmd', p->'tour'->>'cmd', 'at', p->'tour'->'at'));
  end if;
  if jsonb_typeof(p->'volume') = 'number' and (p->>'volume')::numeric between 0 and 100 then
    out := out || jsonb_build_object('volume', round((p->>'volume')::numeric));
  end if;
  return out;
end $$;
