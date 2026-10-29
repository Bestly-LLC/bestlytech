-- Family Cookbook, part 5: notes, cook log, discard and retry a card.
set check_function_bodies = off;

create or replace function public.family_set_notes(p_token text, p_id int, p_body text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.family_members; r public.pantry_recipes; b text := left(coalesce(p_body, ''), 4000);
begin
  me := public._family_need(p_token);
  r := public._family_get(me, p_id, false);
  if me.role = 'jared' then
    insert into public.recipe_notes (recipe_id, body, updated_at) values (r.id, b, now())
    on conflict (recipe_id) do update set body = excluded.body, updated_at = now();
  else
    insert into public.family_recipe_notes (recipe_id, member_id, body, updated_at) values (r.id, me.id, b, now())
    on conflict (recipe_id, member_id) do update set body = excluded.body, updated_at = now();
  end if;
end $$;

create or replace function public.family_log_cook(p_token text, p_id int, p_summary text, p_note text, p_factor numeric, p_omni boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.family_members; r public.pantry_recipes;
begin
  me := public._family_need(p_token);
  r := public._family_get(me, p_id, false);
  insert into public.recipe_cooks (recipe_id, factor, summary, note, omni, via)
  values (r.id, p_factor, left(coalesce(p_summary, ''), 200), left(coalesce(p_note, ''), 1000), coalesce(p_omni, false) and me.role = 'jared', 'family:' || me.role);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.family_capture_discard(p_token text, p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.family_members;
begin
  me := public._family_need(p_token);
  update public.family_captures set status = 'discarded', updated_at = now() where id = p_id and member_id = me.id and status in ('reading', 'closer', 'ready', 'failed');
  if not found then raise exception 'not_found'; end if;
end $$;

create or replace function public.family_capture_retry(p_token text, p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare me public.family_members;
begin
  me := public._family_need(p_token);
  update public.family_captures set status = 'reading', error = null, attempts = 0, updated_at = now() where id = p_id and member_id = me.id and status = 'failed';
  if not found then raise exception 'not_found'; end if;
  perform public.invoke_edge_function('recipe-parse', jsonb_build_object('capture_id', p_id, 'force', true), 5000);
end $$;
