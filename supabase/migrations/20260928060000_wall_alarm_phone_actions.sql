-- Wall alarm: Snooze / Stop from the iPhone notification (W4, 2026-09-27).
-- The Pi hears the notification button (HA mobile_app_notification_action) and records it here so the
-- admin and a restarted Pi agree: stop -> state.alarm.stop = now (ms), snooze -> state.alarm.snooze = until (ms).

create or replace function public.wall_pi_alarm(p_token text, p_action text, p_until bigint default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare a jsonb; now_ms bigint := (extract(epoch from now()) * 1000)::bigint;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  select state->'alarm' into a from wall_state where id = 1 for update;
  if a is null or jsonb_typeof(a) <> 'object' then
    return jsonb_build_object('ok', false, 'why', 'no alarm set');
  end if;
  if p_action = 'stop' then
    a := (a - 'snooze') || jsonb_build_object('stop', now_ms);
  elsif p_action = 'snooze' and p_until is not null and p_until > now_ms and p_until < now_ms + 3600000 then
    a := a || jsonb_build_object('snooze', p_until);
  else
    raise exception 'bad action';
  end if;
  update wall_state set state = jsonb_set(state, '{alarm}', a), version = version + 1, updated_at = now() where id = 1;
  return jsonb_build_object('ok', true, 'alarm', a);
end $$;

revoke all on function public.wall_pi_alarm(text, text, bigint) from public;
grant execute on function public.wall_pi_alarm(text, text, bigint) to anon, authenticated, service_role;

-- keep a snooze when the admin re-saves the alarm (same function as before plus the 'snooze' number)
CREATE OR REPLACE FUNCTION public.wall_clean_wake(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
declare out jsonb := '{}'::jsonb; a jsonb; h jsonb; lst jsonb := '[]'::jsonb; n int := 0;
begin
  if p ? 'alarm' then
    a := p->'alarm';
    if jsonb_typeof(a) = 'null' then out := out || '{"alarm": null}'::jsonb;
    elsif jsonb_typeof(a) = 'object' and coalesce(a->>'time','') ~ '^\d{1,2}:\d{2}$' then
      out := out || jsonb_build_object('alarm', jsonb_strip_nulls(jsonb_build_object(
        'on', coalesce((a->>'on')::boolean, true),
        'time', a->>'time',
        'days', case when a->>'days' in ('once','weekdays','weekends','daily') then a->>'days' else 'once' end,
        'vol', least(100, greatest(10, coalesce((a->>'vol')::int, 60))),
        'label', left(a->>'label', 40),
        'set_at', case when jsonb_typeof(a->'set_at') = 'number' then a->'set_at' end,
        'stop', case when jsonb_typeof(a->'stop') = 'number' then a->'stop' end,
        'snooze', case when jsonb_typeof(a->'snooze') = 'number' then a->'snooze' end,
        'test', case when jsonb_typeof(a->'test') = 'number' then a->'test' end)));
    end if;
  end if;
  if p ? 'heads' then
    if jsonb_typeof(p->'heads') = 'array' then
      for h in select * from jsonb_array_elements(p->'heads') loop
        exit when n >= 5;
        if jsonb_typeof(h) = 'object' and jsonb_typeof(h->'at') = 'number' then
          lst := lst || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
            'id', left(coalesce(h->>'id', md5(h->>'at')), 24), 'at', h->'at',
            'title', left(coalesce(h->>'title', 'Heads-up'), 40), 'sub', left(h->>'sub', 80),
            'sound', coalesce((h->>'sound')::boolean, true), 'vol', least(100, greatest(10, coalesce((h->>'vol')::int, 55))),
            'soon', least(60, greatest(0, coalesce((h->>'soon')::int, 15))))));
          n := n + 1;
        end if;
      end loop;
      out := out || jsonb_build_object('heads', lst);
    elsif jsonb_typeof(p->'heads') = 'null' then out := out || '{"heads": null}'::jsonb;
    end if;
  end if;
  if jsonb_typeof(p->'headsStop') = 'number' then out := out || jsonb_build_object('headsStop', p->'headsStop'); end if;
  -- Turo handoff alert dismiss (Claude 2026-09-27): {id, at} or null
  if p ? 'tripDismiss' then
    if jsonb_typeof(p->'tripDismiss') = 'null' then out := out || '{"tripDismiss": null}'::jsonb;
    elsif jsonb_typeof(p->'tripDismiss') = 'object' and jsonb_typeof(p->'tripDismiss'->'at') = 'number'
          and coalesce(p->'tripDismiss'->>'id', '') ~ '^[A-Za-z0-9_*:-]{1,40}$' then
      out := out || jsonb_build_object('tripDismiss', jsonb_build_object('id', p->'tripDismiss'->>'id', 'at', p->'tripDismiss'->'at'));
    end if;
  end if;
  return out;
end $function$;
