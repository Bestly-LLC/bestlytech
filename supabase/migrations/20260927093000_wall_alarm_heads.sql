-- 2026-09-27: wake-up alarm (state.alarm), heads-up alerts (state.heads / headsStop), admin "Restart AirPlay".
create or replace function public.wall_clean_wake(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
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
  return out;
end $$;

create or replace function public.wall_admin_set(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare w public.wall_state;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update wall_state
     set state = state || wall_clean_patch(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_toggles(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_tour(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_wake(coalesce(p_patch, '{}'::jsonb)),
         version = version + 1, updated_at = now()
   where id = 1 returning * into w;
  return jsonb_build_object('state', w.state, 'version', w.version);
end $$;

create or replace function public.wall_admin_command(p_cmd text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare w public.wall_state;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_cmd not in ('focus','relaunch','airplay_restart') then raise exception 'unknown command'; end if;
  update wall_state set power = jsonb_build_object('cmd', p_cmd, 'seq', coalesce((power->>'seq')::int, 0) + 1, 'at', now()),
                        updated_at = now()
   where id = 1 returning * into w;
  return w.power;
end $$;
