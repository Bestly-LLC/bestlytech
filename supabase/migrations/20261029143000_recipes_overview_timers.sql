-- Recipes tab, part 4: the page needs to see the kitchen timers that are still running (so a reload or a second device keeps them).
-- recipes_overview() gains a "timers" list; nothing else changes.

create or replace function public.recipes_overview()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'recipes', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.id, 'slug', r.slug, 'name', r.name, 'doc', r.doc, 'photo_path', r.photo_path, 'source', r.source,
          'source_url', r.source_url, 'created_at', r.created_at, 'favorite', r.favorite,
          'pantry', public.recipe_pantry_map(r.doc), 'notes', coalesce(n.body, ''),
          'cooks', coalesce((select jsonb_agg(to_jsonb(c) order by c.cooked_at desc)
                               from (select id, cooked_at, factor, summary, note, omni from public.recipe_cooks
                                      where recipe_id = r.id order by cooked_at desc limit 8) c), '[]'::jsonb))
        order by r.created_at, r.id)
        from public.pantry_recipes r left join public.recipe_notes n on n.recipe_id = r.id
       where r.doc is not null), '[]'::jsonb),
    'legacy', coalesce((
      select jsonb_agg(jsonb_build_object('name', r.name, 'how', r.how, 'minutes', r.minutes, 'serves', r.serves,
                                          'source', r.source, 'omni', r.omni_steps is not null) order by r.created_at desc)
        from public.pantry_recipes r where r.doc is null and r.active), '[]'::jsonb),
    'ferments', coalesce((
      select jsonb_agg(to_jsonb(f) order by f.started_at desc)
        from public.recipe_ferments f where f.state <> 'done' or f.finished_at > now() - interval '2 days'), '[]'::jsonb),
    'groceries', coalesce((select jsonb_agg(to_jsonb(g) order by g.added_at) from public.pantry_groceries g where g.status = 'open'), '[]'::jsonb),
    'settings', public.recipes_settings_get(),
    'timers', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'recipe_id', t.recipe_id, 'label', t.label, 'total_sec', t.total_sec,
                                          'ends_at', t.ends_at, 'status', t.status) order by t.ends_at)
        from public.recipe_timers t where t.status = 'running' or (t.status = 'done' and t.fired_at > now() - interval '30 minutes')), '[]'::jsonb),
    'now', now());
end $$;
