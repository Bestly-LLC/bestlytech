-- 2026-09-27: Halloween show/party tour commands (hshow, hparty) and the theme switch (state.theme = 'halloween' | null).
create or replace function public.wall_clean_tour(p jsonb)
returns jsonb language plpgsql immutable set search_path to 'public' as $$
declare out jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p->'tour') = 'object' and p->'tour'->>'cmd' in ('play','party','stop','skit','hshow','hparty') and jsonb_typeof(p->'tour'->'at') = 'number' then
    out := out || jsonb_build_object('tour', jsonb_build_object('cmd', p->'tour'->>'cmd', 'at', p->'tour'->'at'));
  end if;
  if jsonb_typeof(p->'volume') = 'number' and (p->>'volume')::numeric between 0 and 100 then
    out := out || jsonb_build_object('volume', round((p->>'volume')::numeric));
  end if;
  if p ? 'theme' and (jsonb_typeof(p->'theme') = 'null' or p->>'theme' = 'halloween') then
    out := out || jsonb_build_object('theme', p->'theme');
  end if;
  return out;
end $$;
