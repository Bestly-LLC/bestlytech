-- Wall round 4, W8 (2026-09-28): projection-mapped neon sign on the sign wall.
-- state.ledSign {on, look, color, x, y, s, r, sx, outline, notify, shield, test:{fx, at}} — fine alignment + look of the
-- sign layer in wall.html. Cleaned here and chained into wall_admin_set (keeps every other worker's cleaner).
create or replace function public.wall_clean_ledsign(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare l jsonb; o jsonb := '{}'::jsonb; t jsonb;
  num_ok boolean;
begin
  if not (p ? 'ledSign') then return '{}'::jsonb; end if;
  l := p->'ledSign';
  if jsonb_typeof(l) = 'null' then return jsonb_build_object('ledSign', null); end if;
  if jsonb_typeof(l) <> 'object' then return '{}'::jsonb; end if;
  o := jsonb_build_object(
    'on',      coalesce(case when jsonb_typeof(l->'on') = 'boolean' then l->'on' end, 'true'::jsonb),
    'look',    case when l->>'look' in ('lit','breathe','wash','trace','none') then l->>'look' else 'lit' end,
    'color',   case when coalesce(l->>'color','') ~ '^#[0-9A-Fa-f]{6}$' then l->>'color' else '#F4EEFF' end,
    'x',  case when jsonb_typeof(l->'x')  = 'number' then to_jsonb(round(greatest(-0.3, least(0.3, (l->>'x')::numeric)), 4)) else '0'::jsonb end,
    'y',  case when jsonb_typeof(l->'y')  = 'number' then to_jsonb(round(greatest(-0.3, least(0.3, (l->>'y')::numeric)), 4)) else '0'::jsonb end,
    's',  case when jsonb_typeof(l->'s')  = 'number' then to_jsonb(round(greatest(0.4, least(2.5, (l->>'s')::numeric)), 4)) else '1'::jsonb end,
    'r',  case when jsonb_typeof(l->'r')  = 'number' then to_jsonb(round(greatest(-45, least(45, (l->>'r')::numeric)), 2)) else '0'::jsonb end,
    'sx', case when jsonb_typeof(l->'sx') = 'number' then to_jsonb(round(greatest(0.6, least(1.6, (l->>'sx')::numeric)), 4)) else '1'::jsonb end,
    'outline', coalesce(case when jsonb_typeof(l->'outline') = 'boolean' then l->'outline' end, 'false'::jsonb),
    'notify',  coalesce(case when jsonb_typeof(l->'notify')  = 'boolean' then l->'notify'  end, 'true'::jsonb),
    'shield',  coalesce(case when jsonb_typeof(l->'shield')  = 'boolean' then l->'shield'  end, 'true'::jsonb));
  t := l->'test';
  if jsonb_typeof(t) = 'object' and t->>'fx' in ('sign','turo','motivate','scout','alert','hello') and jsonb_typeof(t->'at') = 'number' then
    o := o || jsonb_build_object('test', jsonb_build_object('fx', t->>'fx', 'at', t->'at'));
  else
    o := o || jsonb_build_object('test', null);
  end if;
  return jsonb_build_object('ledSign', o);
end $$;

create or replace function public.wall_admin_set(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare w public.wall_state;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update wall_state
     set state = state || wall_clean_patch(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_toggles(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_tour(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_wake(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_widgets(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_r4sky(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_r4admin(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_ledsign(coalesce(p_patch, '{}'::jsonb)),
         version = version + 1, updated_at = now()
   where id = 1 returning * into w;
  return jsonb_build_object('state', w.state, 'version', w.version);
end $function$;

-- seed the traced alignment so the wall reports "state" (not "built-in default") from the start
update wall_state
   set state = state || jsonb_build_object('ledSign', jsonb_build_object('on', true, 'look', 'lit', 'color', '#F4EEFF', 'x', 0, 'y', 0, 's', 1, 'r', 0, 'sx', 1,
                                                                         'outline', false, 'notify', true, 'shield', true, 'test', null)),
       version = version + 1, updated_at = now()
 where id = 1 and not (state ? 'ledSign');
