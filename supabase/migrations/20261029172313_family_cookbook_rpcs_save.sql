-- Family Cookbook, part 6: save a checked card as a recipe.
set check_function_bodies = off;

create or replace function public.family_capture_save(p_token text, p_id uuid, p_doc jsonb, p_note text, p_flag boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.family_members; c public.family_captures; d jsonb; v_slug text; v_name text; v_id int; v_title text; v_how text;
begin
  me := public._family_need(p_token);
  select * into c from public.family_captures where id = p_id and member_id = me.id for update;
  if c.id is null then raise exception 'not_found'; end if;
  if c.status = 'saved' then raise exception 'already_saved'; end if;
  if c.status <> 'ready' then raise exception 'not_ready'; end if;
  v_title := btrim(coalesce(p_doc ->> 'title', ''));
  v_slug := public._family_unique_slug(coalesce(nullif(v_title, ''), 'recipe'));
  d := public._family_clean_doc(p_doc, v_slug);
  v_title := d ->> 'title';
  v_name := public._family_unique_name(v_title);
  v_how := left(coalesce(nullif(d ->> 'blurb', ''), d -> 'steps' -> 0 ->> 'text', v_title), 300);
  insert into public.pantry_recipes (name, needs, how, active, serves, minutes, source, slug, doc, category,
                                     family_by, family_status, family_flagged_by, family_flagged_at, family_note, family_closer)
  values (v_name, '{}', v_how, false,
          case when (d #>> '{yield,amount}') ~ '^[0-9]+(\.[0-9]+)?$' then (d #>> '{yield,amount}')::numeric::int end,
          case when (d #>> '{time,total_min}') ~ '^[0-9]+$' then (d #>> '{time,total_min}')::int end,
          'family', v_slug, d, nullif(d ->> 'category', ''),
          me.role, case when p_flag then 'review' else 'approved' end,
          case when p_flag then me.role end, case when p_flag then now() end,
          left(btrim(coalesce(p_note, '')), 80), c.closer or c.lowconf)
  returning id into v_id;
  update public.family_photos set recipe_id = v_id where capture_id = c.id;
  update public.family_captures set status = 'saved', recipe_id = v_id, updated_at = now() where id = c.id;
  perform public._family_note_added(me.role);
  return public._family_row((select x from public.pantry_recipes x where x.id = v_id));
end $$;
