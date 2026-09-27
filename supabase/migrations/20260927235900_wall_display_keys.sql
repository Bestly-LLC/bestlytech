-- Wall feedback 2026-09-27 (worker A, wall display): new wall_state.state keys the admin can write.
-- airLabelsSmall, airCardPin, leftDate (booleans) and radio {on, name, url, favicon, ts} | null.
-- Applied to project rcqfqhguwpmaarseifqg as migrations wall_feedback_display_keys + wall_feedback_display_keys_fix.
CREATE OR REPLACE FUNCTION public.wall_clean_toggles(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare out jsonb := '{}'::jsonb; k text; r jsonb;
begin
  foreach k in array array['skyStars','skyMoon','skySun','skyPlanets','airLabels','airCard','airCardHeli','airplay','skyStarLabels','skyGrid','presence',
                           'airLabelsSmall','airCardPin','leftDate'] loop
    if jsonb_typeof(p->k) = 'boolean' then out := out || jsonb_build_object(k, p->k); end if;
  end loop;
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
  return out;
end $function$;
