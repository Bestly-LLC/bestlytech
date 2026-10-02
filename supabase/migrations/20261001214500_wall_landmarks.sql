-- Wall landmarks overlay (Jared's item 1, 2026-10-01): admin toggle for the sky-map
--   skyLandmarks (bool)  downtown/skyline glyph + city labels + LAX runway shape at true bearings
--                        on the wall's sky map; out-of-band points ray-clamp to the strip edge with an arrow.
--                        Default on (missing key = on, see wall.html geoLand()).
-- Everything else is the live definition as of the previous migration (20260928060000), re-read right before applying.
CREATE OR REPLACE FUNCTION public.wall_clean_toggles(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare out jsonb := '{}'::jsonb; k text; r jsonb;
begin
  foreach k in array array['skyStars','skyMoon','skySun','skyPlanets','airLabels','airCard','airCardHeli','airplay','skyStarLabels','skyGrid','presence',
                           'airLabelsSmall','airCardPin','leftDate',
                           'issTag','skyHome','atc','skyLandmarks'] loop
    if jsonb_typeof(p->k) = 'boolean' then out := out || jsonb_build_object(k, p->k); end if;
  end loop;
  -- sky radius in whole miles, 2-25 (W1 round 3)
  if jsonb_typeof(p->'airRadiusMi') = 'number' and (p->>'airRadiusMi')::numeric between 2 and 25 then
    out := out || jsonb_build_object('airRadiusMi', round((p->>'airRadiusMi')::numeric)::int);
  end if;
  -- radio (2026-09-27): admin picks a station; the Pi plays it on the Desk HomePod through Home Assistant
  if p ? 'radio' then
    r := p->'radio';
    if jsonb_typeof(r) = 'null' then out := out || '{"radio": null}'::jsonb;
    elsif jsonb_typeof(r) = 'object' and coalesce(r->>'url', '') ~ '^https?://[^\s"<>]{3,}$' and length(r->>'url') <= 500 then
      out := out || jsonb_build_object('radio', jsonb_build_object(
        'on', coalesce(case when jsonb_typeof(r->'on') = 'boolean' then (r->>'on')::boolean end, true),
        'name', left(coalesce(r->>'name', 'Radio'), 60),
        'url', r->>'url',
        'favicon', case when coalesce(r->>'favicon', '') ~ '^https?://[^\s"<>]{3,}$' and length(r->>'favicon') <= 500 then r->>'favicon' end,
        'ts', case when jsonb_typeof(r->'ts') = 'number' then r->'ts' else to_jsonb((extract(epoch from now()) * 1000)::bigint) end));
    elsif jsonb_typeof(r) = 'object' and jsonb_typeof(r->'on') = 'boolean' and not (r->>'on')::boolean then
      out := out || jsonb_build_object('radio', jsonb_build_object('on', false, 'name', left(coalesce(r->>'name', ''), 60), 'url', null, 'favicon', null,
        'ts', case when jsonb_typeof(r->'ts') = 'number' then r->'ts' else to_jsonb((extract(epoch from now()) * 1000)::bigint) end));
    end if;
  end if;
  -- radio and ATC are exclusive on the Desk HomePod (W1 round 3)
  if (out->'radio'->>'on') = 'true' then
    out := out || '{"atc": false}'::jsonb;
  elsif (out->>'atc') = 'true' and not (out ? 'radio') then
    out := out || jsonb_build_object('radio', jsonb_build_object('on', false, 'name', '', 'url', null, 'favicon', null,
      'ts', to_jsonb((extract(epoch from now()) * 1000)::bigint)));
  end if;
  return out;
end $function$;
