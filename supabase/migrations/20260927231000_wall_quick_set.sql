-- B5 (wall feedback 2026-09-27): one-tap wall switches from Home Assistant (switch "Wall Plane Tags"),
-- Siri via HomeKit Bridge, and iOS Shortcuts. Gate = the Home Hub agent key (same as wall_pi_trips).
-- Writes through the same clean functions as wall_admin_set and bumps wall_state.version,
-- which is what makes the Pi's sync_loop pull the change.

create or replace function public.wall_quick_set(p_token text, p_key text, p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  w public.wall_state;
  v_patch jsonb;
  v_clean jsonb;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  if p_key is null or p_key not in ('airLabels', 'airLabelsSmall', 'airCardPin', 'leftDate', 'sound') then
    raise exception 'key not allowed';
  end if;
  -- p_value true / false, or "toggle" (flip the current value; unset keys use the wall defaults)
  v_patch := jsonb_build_object(p_key,
    case when jsonb_typeof(p_value) = 'string' and p_value #>> '{}' = 'toggle'
         then to_jsonb(not coalesce((select (state->>p_key)::boolean from wall_state where id = 1),
                                    p_key in ('airLabels', 'airLabelsSmall', 'sound')))
         else p_value end);
  if jsonb_typeof(v_patch->p_key) <> 'boolean' then raise exception 'value must be true, false or "toggle"'; end if;

  v_clean := wall_clean_patch(v_patch) || wall_clean_toggles(v_patch);
  if not v_clean ? p_key then raise exception 'the wall does not accept % yet', p_key; end if;

  update wall_state
     set state = state || v_clean, version = version + 1, updated_at = now()
   where id = 1 returning * into w;
  return jsonb_build_object('ok', true, 'key', p_key, 'value', w.state->p_key, 'version', w.version);
end $function$;

-- Read side for the Home Assistant switch state.
create or replace function public.wall_quick_get(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare s jsonb;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  select state into s from wall_state where id = 1;
  return jsonb_build_object(
    'airLabels', coalesce((s->>'airLabels')::boolean, true),
    'airLabelsSmall', coalesce((s->>'airLabelsSmall')::boolean, true),
    'airCardPin', coalesce((s->>'airCardPin')::boolean, false),
    'leftDate', coalesce((s->>'leftDate')::boolean, false),
    'sound', coalesce((s->>'sound')::boolean, true));
end $function$;

revoke all on function public.wall_quick_set(text, text, jsonb) from public;
revoke all on function public.wall_quick_get(text) from public;
grant execute on function public.wall_quick_set(text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.wall_quick_get(text) to anon, authenticated, service_role;
