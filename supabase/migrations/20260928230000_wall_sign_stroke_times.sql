-- Wall round 4 (W5): live signatures. The sign page now sends WHEN each point was drawn, so the wall can replay a
-- signature at the speed it was written. times = one array per stroke, one integer per point (ms since the first
-- touch of the signature), parallel to strokes. Optional: old phones / old page versions send nothing and the wall
-- animates a plausible trace instead. Bad or mismatched timing never blocks a signature; it is just dropped.

alter table public.wall_signatures add column if not exists times jsonb;

create or replace function public.wall_sig_times_ok(p_strokes jsonb, p_times jsonb)
returns boolean language sql immutable set search_path to 'public' as $$
  select p_times is not null and jsonb_typeof(p_times) = 'array' and jsonb_typeof(p_strokes) = 'array'
     and jsonb_array_length(p_times) = jsonb_array_length(p_strokes)
     and not exists (
       select 1 from jsonb_array_elements(p_strokes) with ordinality s(st, i)
         join jsonb_array_elements(p_times) with ordinality t(tt, j) on i = j
        where jsonb_typeof(tt) <> 'array' or jsonb_array_length(tt) * 2 <> jsonb_array_length(st)
           or exists (select 1 from jsonb_array_elements(tt) v
                       where jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 600000))
$$;

create or replace function public.wall_sig_json(s wall_signatures)
returns jsonb language sql immutable set search_path to 'public' as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'strokes', s.strokes, 'times', s.times, 'color', s.color,
                            'aspect', s.aspect, 'test', s.is_test, 'hidden', s.hidden, 'at', s.created_at)
$$;

-- wall_sign / wall_sign_tap gain an optional p_times (default null). Drop the old signatures first so PostgREST never
-- sees two overloads (a 6-arg call would be ambiguous).
drop function if exists public.wall_sign_tap(text, text, jsonb, text, real, text);
drop function if exists public.wall_sign(text, jsonb, text, real, text);

create or replace function public.wall_sign(p_name text, p_strokes jsonb, p_color text, p_aspect real, p_device text, p_times jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_name text; v_n int; v_pts int; r public.wall_signatures;
begin
  v_name := left(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]<>]', '', 'g'), 32);
  v_name := btrim(v_name);
  if jsonb_typeof(p_strokes) <> 'array' then raise exception 'bad drawing'; end if;
  v_n := jsonb_array_length(p_strokes);
  if v_n < 1 or v_n > 80 then raise exception 'draw your name first'; end if;
  if exists (select 1 from jsonb_array_elements(p_strokes) st
              where jsonb_typeof(st) <> 'array' or jsonb_array_length(st) < 2 or jsonb_array_length(st) % 2 <> 0
                 or exists (select 1 from jsonb_array_elements(st) v
                             where jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not between 0 and 1000)) then
    raise exception 'bad drawing';
  end if;
  select coalesce(sum(jsonb_array_length(st)), 0) into v_pts from jsonb_array_elements(p_strokes) st;
  if v_pts > 8000 then raise exception 'drawing too big'; end if;
  if not wall_sig_times_ok(p_strokes, p_times) then p_times := null; end if;
  if p_color !~ '^#[0-9A-Fa-f]{6}$' then p_color := '#FFFFFF'; end if;
  p_aspect := greatest(0.5, least(4.0, coalesce(p_aspect, 1.8)));
  p_device := left(coalesce(p_device, ''), 64);
  -- flood guards: 3 a minute per phone, 40 a minute overall
  if (select count(*) from wall_signatures where device = p_device and p_device <> '' and created_at > now() - interval '1 minute') >= 3
     or (select count(*) from wall_signatures where created_at > now() - interval '1 minute') >= 40 then
    raise exception 'slow down a sec';
  end if;
  insert into wall_signatures (name, strokes, times, color, aspect, device)
  values (v_name, p_strokes, p_times, upper(p_color), p_aspect, nullif(p_device, '')) returning * into r;
  perform wall_sig_broadcast('sign', jsonb_build_object('sig', wall_sig_json(r)));
  return jsonb_build_object('ok', true, 'id', r.id, 'timed', p_times is not null,
    'ping', (select 'wallsign-' || left(md5('wall-' || channel || ':sign'), 20) from wall_state where id = 1));
end $function$;

create or replace function public.wall_sign_tap(p_token text, p_name text, p_strokes jsonb, p_color text, p_aspect real, p_device text, p_times jsonb default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare s wall_sign_sessions; res jsonb;
begin
  select * into s from wall_sign_sessions where token = p_token for update;
  if s.token is null or s.expires_at < now() then raise exception 'tap a coaster again'; end if;
  if coalesce(array_length(s.signature_ids, 1), 0) >= 3 then raise exception 'that''s plenty for one tap'; end if;
  res := wall_sign(p_name, p_strokes, p_color, p_aspect, p_device, p_times);
  update wall_sign_sessions set signature_ids = signature_ids || (res->>'id')::bigint where token = p_token;
  return res || jsonb_build_object('badge_no',
    (select count(*) from wall_signatures where not is_test and id <= (res->>'id')::bigint));
end $function$;

revoke all on function public.wall_sign(text, jsonb, text, real, text, jsonb) from public, anon, authenticated;
grant execute on function public.wall_sign(text, jsonb, text, real, text, jsonb) to service_role;
grant execute on function public.wall_sign_tap(text, text, jsonb, text, real, text, jsonb) to anon, authenticated, service_role;
revoke all on function public.wall_sig_times_ok(jsonb, jsonb) from public, anon, authenticated;
