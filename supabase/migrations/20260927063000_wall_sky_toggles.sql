-- Wall: on/off switches for the sky layers (Jared, 2026-09-26): stars + constellations, moon,
-- sun + planets, plane labels. Booleans only; everything else still goes through wall_clean_patch.
create or replace function public.wall_clean_toggles(p jsonb)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $$
declare out jsonb := '{}'::jsonb; k text;
begin
  foreach k in array array['skyStars','skyMoon','skySun','airLabels'] loop
    if jsonb_typeof(p->k) = 'boolean' then out := out || jsonb_build_object(k, p->k); end if;
  end loop;
  return out;
end $$;

create or replace function public.wall_admin_set(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare w public.wall_state;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update wall_state
     set state = state || wall_clean_patch(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_toggles(coalesce(p_patch, '{}'::jsonb)),
         version = version + 1, updated_at = now()
   where id = 1 returning * into w;
  return jsonb_build_object('state', w.state, 'version', w.version);
end $$;

-- 2026-09-27: Planets split from Sun.
create or replace function public.wall_clean_toggles(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare out jsonb := '{}'::jsonb; k text;
begin
  foreach k in array array['skyStars','skyMoon','skySun','skyPlanets','airLabels'] loop
    if jsonb_typeof(p->k) = 'boolean' then out := out || jsonb_build_object(k, p->k); end if;
  end loop;
  return out;
end $$;

-- 2026-09-27: nearest-plane card on/off and helicopters-in-card switches.
create or replace function public.wall_clean_toggles(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare out jsonb := '{}'::jsonb; k text;
begin
  foreach k in array array['skyStars','skyMoon','skySun','skyPlanets','airLabels','airCard','airCardHeli'] loop
    if jsonb_typeof(p->k) = 'boolean' then out := out || jsonb_build_object(k, p->k); end if;
  end loop;
  return out;
end $$;

-- 2026-09-27: show for friends. state.tour {cmd: play|party|stop, at(ms)} via wall_clean_tour, chained into wall_admin_set.
create or replace function public.wall_clean_tour(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
begin
  if jsonb_typeof(p->'tour') = 'object' and p->'tour'->>'cmd' in ('play','party','stop') and jsonb_typeof(p->'tour'->'at') = 'number' then
    return jsonb_build_object('tour', jsonb_build_object('cmd', p->'tour'->>'cmd', 'at', p->'tour'->'at'));
  end if;
  return '{}'::jsonb;
end $$;
create or replace function public.wall_admin_set(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare w public.wall_state;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update wall_state
     set state = state || wall_clean_patch(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_toggles(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_tour(coalesce(p_patch, '{}'::jsonb)),
         version = version + 1, updated_at = now()
   where id = 1 returning * into w;
  return jsonb_build_object('state', w.state, 'version', w.version);
end $$;
