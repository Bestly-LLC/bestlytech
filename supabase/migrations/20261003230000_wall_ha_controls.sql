-- P2 of the Home Assistant revamp (2026-10-03): every admin wall control, from Home Assistant.
-- One write path for both: wall_apply_patch runs the same cleaning chain the admin always used, so HA can set exactly
-- what the admin can set and nothing else. The control list lives in src/config/wall-controls.json (admin + HA follow it).
--
-- HA calls (gated by the Home Hub agent key, same as wall_quick_set / wall_pi_*):
--   wall_ha_get(token)                       -> {wall (the state, minus geometry), power, version, updated_at, pi, issues}
--   wall_ha_patch(token, patch, inputs)      -> dotted keys ("dnd.override", "widgets.news") merge into the current parent
--                                               object; values may use "$now", "$now+<ms>", "$inc:<path>",
--                                               "$nextLA:<path>", "$nextLA:<to>:after:<from>", "$input:<id>", "$toggle:<default>"
--   wall_ha_power(token, on), wall_ha_command(token, cmd)

-- 1. the shared write path
create or replace function public.wall_apply_patch(p_patch jsonb)
returns public.wall_state
language plpgsql
security definer
set search_path to 'public'
as $function$
declare w public.wall_state; p jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  update wall_state
     set state = state || wall_clean_patch(p) || wall_clean_toggles(p) || wall_clean_r4voice(p) || wall_clean_tour(p)
                       || wall_clean_wake(p) || wall_clean_widgets(p) || wall_clean_r4sky(p) || wall_clean_r4admin(p)
                       || wall_clean_ledsign(p),
         version = version + 1, updated_at = now()
   where id = 1 returning * into w;
  return w;
end $function$;
revoke all on function public.wall_apply_patch(jsonb) from public, anon, authenticated;

-- the admin goes through it too (same behavior as before)
create or replace function public.wall_admin_set(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare w public.wall_state;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  w := wall_apply_patch(p_patch);
  return jsonb_build_object('state', w.state, 'version', w.version);
end $function$;

-- 2. "next time the LA clock reads HH:MM" (after p_after), as ms since epoch
create or replace function public.wall_next_la_ms(p_hm text, p_after timestamptz default now())
returns bigint
language plpgsql
stable
set search_path to 'public'
as $function$
declare t timestamptz;
begin
  if coalesce(p_hm, '') !~ '^\d{1,2}:\d{2}$' then return null; end if;
  t := (((p_after at time zone 'America/Los_Angeles')::date + p_hm::time) at time zone 'America/Los_Angeles');
  if t <= p_after then t := t + interval '1 day'; end if;
  return (extract(epoch from t) * 1000)::bigint;
end $function$;

-- 3. resolve "$now"-style tokens anywhere in a value
create or replace function public.wall_ha_resolve(v jsonb, s jsonb, inputs jsonb)
returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare t text; o jsonb := '{}'::jsonb; a jsonb := '[]'::jsonb; k text; x jsonb; nowms bigint := (extract(epoch from now()) * 1000)::bigint;
        parts text[]; cur jsonb;
begin
  if v is null then return null; end if;
  if jsonb_typeof(v) = 'object' then
    for k, x in select * from jsonb_each(v) loop o := o || jsonb_build_object(k, wall_ha_resolve(x, s, inputs)); end loop;
    return o;
  elsif jsonb_typeof(v) = 'array' then
    for x in select * from jsonb_array_elements(v) loop a := a || jsonb_build_array(wall_ha_resolve(x, s, inputs)); end loop;
    return a;
  elsif jsonb_typeof(v) <> 'string' then
    return v;
  end if;
  t := v #>> '{}';
  if t = '$now' then return to_jsonb(nowms); end if;
  if t ~ '^\$now\+\d+$' then return to_jsonb(nowms + substring(t from 6)::bigint); end if;
  if t ~ '^\$inc:' then
    cur := s #> string_to_array(substring(t from 6), '.');
    return to_jsonb(coalesce(case when jsonb_typeof(cur) = 'number' then (cur #>> '{}')::numeric end, 0) + 1);
  end if;
  if t ~ '^\$input:' then return inputs -> substring(t from 8); end if;
  if t ~ '^\$nextLA:[^:]+:after:' then
    parts := regexp_match(t, '^\$nextLA:([^:]+):after:(.+)$');
    return to_jsonb(wall_next_la_ms(s #>> string_to_array(parts[1], '.'),
                     to_timestamp(wall_next_la_ms(s #>> string_to_array(parts[2], '.')) / 1000.0)));
  end if;
  if t ~ '^\$nextLA:' then return to_jsonb(wall_next_la_ms(s #>> string_to_array(substring(t from 9), '.'))); end if;
  return v;
end $function$;

-- 4. HA write: dotted keys merge into the parent object, then the shared write path
create or replace function public.wall_ha_patch(p_token text, p_patch jsonb, p_inputs jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare s jsonb; acc jsonb := '{}'::jsonb; k text; v jsonb; top text; rest text[]; base jsonb; w public.wall_state; cur jsonb;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'empty patch'; end if;
  select state into s from wall_state where id = 1;
  for k, v in select * from jsonb_each(p_patch) loop
    -- "$toggle:<default>" flips the current boolean at that path
    if jsonb_typeof(v) = 'string' and v #>> '{}' ~ '^\$toggle:(true|false)$' then
      cur := s #> string_to_array(k, '.');
      v := to_jsonb(not coalesce(case when jsonb_typeof(cur) = 'boolean' then (cur #>> '{}')::boolean end,
                                 (split_part(v #>> '{}', ':', 2))::boolean));
    else
      v := wall_ha_resolve(v, s, coalesce(p_inputs, '{}'::jsonb));
    end if;
    top := split_part(k, '.', 1);
    if position('.' in k) > 0 then
      rest := (string_to_array(k, '.'))[2:];
      base := coalesce(acc -> top, s -> top);
      if base is null or jsonb_typeof(base) <> 'object' then base := '{}'::jsonb; end if;
      acc := acc || jsonb_build_object(top, jsonb_set(base, rest, coalesce(v, 'null'::jsonb), true));
    else
      acc := acc || jsonb_build_object(top, coalesce(v, 'null'::jsonb));
    end if;
  end loop;
  -- radio can only come on with a saved station (the cleaner would silently drop it)
  if (acc -> 'radio' ->> 'on') = 'true' and coalesce(acc -> 'radio' ->> 'url', '') = '' then
    raise exception 'no station saved yet: pick one in bestly.tech/admin/wall first';
  end if;
  for k in select jsonb_object_keys(acc) loop
    if not (wall_clean_patch(acc) || wall_clean_toggles(acc) || wall_clean_r4voice(acc) || wall_clean_tour(acc)
            || wall_clean_wake(acc) || wall_clean_widgets(acc) || wall_clean_r4sky(acc) || wall_clean_r4admin(acc)
            || wall_clean_ledsign(acc)) ? k then
      raise exception 'the wall does not accept %', k;
    end if;
  end loop;
  w := wall_apply_patch(acc);
  return jsonb_build_object('ok', true, 'version', w.version,
                            'set', (select jsonb_object_agg(key, w.state -> key) from jsonb_object_keys(acc) key));
end $function$;

create or replace function public.wall_ha_power(p_token text, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare w public.wall_state;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  update wall_state set power = jsonb_build_object('on', p_on, 'seq', coalesce((power->>'seq')::int, 0) + 1, 'at', now()),
                        updated_at = now()
   where id = 1 returning * into w;
  return w.power;
end $function$;

create or replace function public.wall_ha_command(p_token text, p_cmd text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare w public.wall_state;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  if p_cmd not in ('focus','focus_left','focus_right','relaunch','airplay_restart') then raise exception 'unknown command'; end if;
  update wall_state set power = jsonb_build_object('cmd', p_cmd, 'seq', coalesce((power->>'seq')::int, 0) + 1, 'at', now()),
                        updated_at = now()
   where id = 1 returning * into w;
  return w.power;
end $function$;

create or replace function public.wall_ha_get(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare w public.wall_state;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  select * into w from wall_state where id = 1;
  return jsonb_build_object(
    -- geometry is big and not something HA shows
    'wall', w.state - 'corners' - 'mask' - 'wing' - 'air' - 'heads' - 'msg',
    'power', w.power, 'version', w.version, 'updated_at', w.updated_at,
    'pi', w.status ->> 'status', 'pi_at', w.status_at,
    'issues', (select count(*) from monitor_issues where key like 'wall.%' and status = 'open'));
end $function$;

revoke all on function public.wall_ha_patch(text, jsonb, jsonb), public.wall_ha_power(text, boolean),
                       public.wall_ha_command(text, text), public.wall_ha_get(text) from public;
grant execute on function public.wall_ha_patch(text, jsonb, jsonb), public.wall_ha_power(text, boolean),
                          public.wall_ha_command(text, text), public.wall_ha_get(text) to anon, authenticated, service_role;
revoke all on function public.wall_ha_resolve(jsonb, jsonb, jsonb), public.wall_next_la_ms(text, timestamptz) from public, anon, authenticated;
