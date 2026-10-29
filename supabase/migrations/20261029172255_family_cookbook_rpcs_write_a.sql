-- Family Cookbook, part 4: write RPCs, delete / restore / edit / approve.
set check_function_bodies = off;

create or replace function public.family_delete(p_token text, p_id int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.family_members; r public.pantry_recipes;
begin
  me := public._family_need(p_token);
  r := public._family_get(me, p_id, false);
  if not (coalesce(r.family_by, 'jared') = me.role or me.role = 'jared') then raise exception 'not_allowed'; end if;
  update public.pantry_recipes set deleted_at = now(), deleted_by = me.role, updated_at = now() where id = r.id;
  return jsonb_build_object('ok', true, 'purgeOn', now() + interval '30 days');
end $$;

create or replace function public.family_restore(p_token text, p_id int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.family_members; r public.pantry_recipes;
begin
  me := public._family_need(p_token);
  r := public._family_get(me, p_id, true);
  update public.pantry_recipes set deleted_at = null, deleted_by = null, updated_at = now() where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.family_edit(p_token text, p_id int, p_title text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.family_members; r public.pantry_recipes; t text := btrim(coalesce(p_title, '')); v_name text;
begin
  me := public._family_need(p_token);
  r := public._family_get(me, p_id, false);
  if not (coalesce(r.family_by, 'jared') = me.role or me.role = 'jared') then raise exception 'not_allowed'; end if;
  if t = '' or length(t) > 120 then raise exception 'bad_title'; end if;
  v_name := case when t = coalesce(r.doc ->> 'title', r.name) then r.name else public._family_unique_name(t) end;
  update public.pantry_recipes set name = v_name, doc = jsonb_set(doc, '{title}', to_jsonb(t)), family_note = left(btrim(coalesce(p_note, '')), 80), updated_at = now()
   where id = r.id;
  return public._family_row((select x from public.pantry_recipes x where x.id = r.id));
end $$;

create or replace function public.family_approve(p_token text, p_id int, p_doc jsonb, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.family_members; r public.pantry_recipes; d jsonb; v_name text;
begin
  me := public._family_need(p_token);
  if me.role not in ('jared', 'mariah') then raise exception 'not_allowed'; end if;
  r := public._family_get(me, p_id, false);
  if r.family_status <> 'review' then raise exception 'not_in_review'; end if;
  d := public._family_clean_doc(p_doc, coalesce(r.slug, public._family_unique_slug(r.name)));
  v_name := case when d ->> 'title' = coalesce(r.doc ->> 'title', r.name) then r.name else public._family_unique_name(d ->> 'title') end;
  update public.pantry_recipes set name = v_name, doc = d, family_status = 'approved', family_flagged_by = null, family_flagged_at = null,
         family_closer = false, family_note = left(btrim(coalesce(p_note, '')), 80), updated_at = now()
   where id = r.id;
  return public._family_row((select x from public.pantry_recipes x where x.id = r.id));
end $$;
