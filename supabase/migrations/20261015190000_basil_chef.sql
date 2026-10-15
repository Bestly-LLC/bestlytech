-- Basil's chef (Oct 15 2026). Jared: "make it so Scout can look at my pantry items and then using a gourmet chef skill,
-- provide me with recipes. And then if it's necessary to use the OmniCook, that it suggests doing that as well."
--
-- The chef itself is _shared/chef.ts (free AI first, never paid). It reads the pantry through basil_chef_pantry() and
-- saves through basil_chef_save() into pantry_recipes, the same table and shape the Kitchen page's recipe view and cook
-- mode already read, so a chef recipe opens, bolds its amounts and runs its timers like any other.
-- Callers: the Kitchen page ("Ask the chef", via the basil-chef edge function), Scout chat (kitchen_chef tool) and
-- Hey Scout ("ask the chef", "surprise me", "a recipe with salmon").
-- Chef recipes are kept; only the newest 12 stay active (they can show up in Tonight's ideas), older ones still open.

alter table public.pantry_recipes
  add column if not exists source text not null default 'basil',
  add column if not exists chef_note text,
  add column if not exists ask text,
  add column if not exists created_at timestamptz not null default now();

-- What the chef gets to cook with: everything in stock or low, flagged when it should be used soon, plus the chef's
-- recent dishes so it doesn't repeat itself.
create or replace function public.basil_chef_pantry() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object(
        'name', p.name, 'where', p.location, 'category', p.category, 'low', p.status = 'low',
        'use_soon', p.use_soon or p.use_by <= current_date + 2) order by p.location, p.name)
      from pantry_items p where p.status in ('have', 'low')), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(r.name order by r.created_at desc)
      from (select name, created_at from pantry_recipes where source = 'chef' order by created_at desc limit 15) r), '[]'::jsonb));
$$;
revoke all on function public.basil_chef_pantry() from public, anon, authenticated;

-- Save the chef's recipes. Each recipe: name, how, chef_note, serves, minutes, ingredients, steps, omni_steps.
-- A name the hand-written set already uses gets " (chef's take)"; a chef name seen before is refreshed.
create or replace function public.basil_chef_save(p_recipes jsonb, p_ask text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb; nm text; saved text[] := '{}'; needs text[];
begin
  for r in select * from jsonb_array_elements(coalesce(p_recipes, '[]'::jsonb)) loop
    nm := left(btrim(r->>'name'), 80);
    continue when nm is null or nm = '';
    if exists (select 1 from pantry_recipes where name = nm and source <> 'chef') then
      nm := left(nm, 66) || ' (chef''s take)';
    end if;
    select coalesce(array_agg(i->>'m'), '{}') into needs
      from jsonb_array_elements(r->'ingredients') i
      where coalesce(i->>'m', '') <> '' and not coalesce((i->>'opt')::boolean, false);
    insert into pantry_recipes (name, needs, how, active, serves, minutes, ingredients, steps, omni_steps, omni_note,
                                source, chef_note, ask, created_at)
    values (nm, needs, r->>'how', true, (r->>'serves')::int, (r->>'minutes')::int, r->'ingredients', r->'steps',
            nullif(nullif(r->'omni_steps', 'null'::jsonb), '[]'::jsonb),
            case when jsonb_array_length(coalesce(nullif(r->'omni_steps', 'null'::jsonb), '[]'::jsonb)) > 0
                 then coalesce(nullif(btrim(r->>'omni_why'), '') || ' ', '')
                      || 'Settings are a starting guide: pick the closest mode on your Omni Cook and check doneness.' end,
            'chef', r->>'chef_note', left(p_ask, 200), now())
    on conflict (name) do update set needs = excluded.needs, how = excluded.how, active = true, serves = excluded.serves,
      minutes = excluded.minutes, ingredients = excluded.ingredients, steps = excluded.steps,
      omni_steps = excluded.omni_steps, omni_note = excluded.omni_note, chef_note = excluded.chef_note,
      ask = excluded.ask, created_at = now()
    where pantry_recipes.source = 'chef';
    saved := saved || nm;
  end loop;
  update pantry_recipes set active = false
   where source = 'chef' and active
     and id not in (select id from pantry_recipes where source = 'chef' order by created_at desc limit 12);
  return to_jsonb(saved);
end $$;
revoke all on function public.basil_chef_save(jsonb, text) from public, anon, authenticated;

-- The recipe view shows the chef's note and a Chef label.
create or replace function public.basil_kitchen_recipe(p_name text) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r pantry_recipes;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into r from pantry_recipes where name = p_name;
  if not found then raise exception 'recipe not found'; end if;
  return jsonb_build_object(
    'name', r.name, 'how', r.how, 'serves', r.serves, 'minutes', r.minutes, 'omni_note', r.omni_note,
    'source', r.source, 'chef_note', r.chef_note,
    'steps', r.steps, 'omni_steps', r.omni_steps,
    'ingredients', coalesce((
      select jsonb_agg(e.i || jsonb_build_object('item', p.name, 'item_id', p.id, 'status', p.status) order by e.o)
      from jsonb_array_elements(r.ingredients) with ordinality e(i, o)
      left join lateral (
        select x.id, x.name, x.status from pantry_items x
        where e.i ? 'm' and x.name ~* (e.i->>'m')
        order by (x.status in ('have', 'low')) desc, x.use_soon desc, length(x.name)
        limit 1) p on true), '[]'::jsonb));
end $$;
revoke all on function public.basil_kitchen_recipe(text) from public, anon;
grant execute on function public.basil_kitchen_recipe(text) to authenticated;

-- The page's "Chef's recent" row: the newest chef recipes, with how many of their pantry items are in stock.
create or replace function public.basil_kitchen_chef_recent(p_limit int default 6) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('name', r.name, 'how', r.how, 'minutes', r.minutes,
      'serves', r.serves, 'omni', r.omni_steps is not null, 'chef_note', r.chef_note, 'ask', r.ask,
      'created_at', r.created_at) order by r.created_at desc)
    from (select * from pantry_recipes where source = 'chef' order by created_at desc limit greatest(1, least(p_limit, 24))) r),
    '[]'::jsonb);
end $$;
revoke all on function public.basil_kitchen_chef_recent(int) from public, anon;
grant execute on function public.basil_kitchen_chef_recent(int) to authenticated;
