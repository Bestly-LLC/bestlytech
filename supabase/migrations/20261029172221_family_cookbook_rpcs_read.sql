-- Family Cookbook, part 3: read RPCs (all take the session token).
set check_function_bodies = off;

create or replace function public.family_me(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare me public.family_members;
begin
  me := public._family_need(p_token);
  update public.family_sessions set last_seen = now(), expires_at = greatest(expires_at, now() + interval '90 days')
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  return jsonb_build_object(
    'id', me.role, 'name', public._family_label(me.role), 'last', me.last_name, 'reviewer', me.role in ('jared', 'mariah'),
    'activeRoles', coalesce((select jsonb_agg(role order by role) from public.family_members where status in ('invited', 'active')), '[]'::jsonb));
end $$;

create or replace function public.family_logout(p_token text)
returns void language sql security definer set search_path = public, extensions, pg_temp as $$
  delete from public.family_sessions where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function public.family_recipes(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.family_members;
begin
  me := public._family_need(p_token);
  return jsonb_build_object('recipes', coalesce((
    select jsonb_agg(public._family_row(r) order by r.created_at desc, r.id desc)
      from public.pantry_recipes r
     where r.doc is not null and r.deleted_at is null and public._family_can_see(me.role, coalesce(r.family_by, 'jared'))), '[]'::jsonb));
end $$;

create or replace function public.family_recipe(p_token text, p_id int)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.family_members; r public.pantry_recipes; v_notes text;
begin
  me := public._family_need(p_token);
  r := public._family_get(me, p_id, false);
  if me.role = 'jared' then select body into v_notes from public.recipe_notes where recipe_id = r.id;
  else select body into v_notes from public.family_recipe_notes where recipe_id = r.id and member_id = me.id; end if;
  return public._family_row(r) || jsonb_build_object(
    'doc', r.doc,
    'canEdit', (coalesce(r.family_by, 'jared') = me.role or me.role = 'jared'),
    'notes', coalesce(v_notes, ''),
    'cooks', coalesce((select jsonb_agg(jsonb_build_object('at', c.cooked_at, 'desc', coalesce(c.summary, ''), 'note', coalesce(c.note, ''),
                                                              'by', nullif(replace(c.via, 'family:', ''), c.via)) order by c.cooked_at desc)
                         from (select * from public.recipe_cooks where recipe_id = r.id order by cooked_at desc limit 12) c), '[]'::jsonb));
end $$;

create or replace function public.family_review_list(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.family_members;
begin
  me := public._family_need(p_token);
  if me.role not in ('jared', 'mariah') then return jsonb_build_object('recipes', '[]'::jsonb); end if;
  return jsonb_build_object('recipes', coalesce((
    select jsonb_agg(public._family_row(r) || jsonb_build_object('doc', r.doc) order by r.family_flagged_at desc nulls last, r.id desc)
      from public.pantry_recipes r
     where r.doc is not null and r.deleted_at is null and r.family_status = 'review'
       and public._family_can_see(me.role, coalesce(r.family_by, 'jared'))), '[]'::jsonb));
end $$;

create or replace function public.family_deleted_list(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.family_members;
begin
  me := public._family_need(p_token);
  return jsonb_build_object('recipes', coalesce((
    select jsonb_agg(public._family_row(r) order by r.deleted_at desc, r.id desc)
      from public.pantry_recipes r
     where r.doc is not null and r.deleted_at is not null and r.deleted_at > now() - interval '30 days'
       and public._family_can_see(me.role, coalesce(r.family_by, 'jared'))), '[]'::jsonb));
end $$;

create or replace function public.family_captures(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.family_members;
begin
  me := public._family_need(p_token);
  return jsonb_build_object('captures', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'draft', case when c.status = 'ready' then c.draft end, 'closer', c.closer,
             'lowconf', c.lowconf, 'hasBack', c.has_back, 'error', c.error, 'created', c.created_at,
             'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'side', p.side) order by (p.side = 'back'), p.created_at)
                                   from public.family_photos p where p.capture_id = c.id), '[]'::jsonb)) order by c.created_at)
      from public.family_captures c where c.member_id = me.id and c.status in ('reading', 'closer', 'ready', 'failed')), '[]'::jsonb));
end $$;

create or replace function public.family_photo_path(p_token text, p_photo uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.family_members; p public.family_photos; r public.pantry_recipes; cm uuid;
begin
  me := public._family_need(p_token);
  select * into p from public.family_photos where id = p_photo;
  if p.id is null then raise exception 'not_found'; end if;
  if p.recipe_id is not null then
    select * into r from public.pantry_recipes where id = p.recipe_id;
    if r.id is null or not public._family_can_see(me.role, coalesce(r.family_by, 'jared')) then raise exception 'not_found'; end if;
    if r.deleted_at is not null and r.deleted_at < now() - interval '30 days' then raise exception 'not_found'; end if;
  else
    select member_id into cm from public.family_captures where id = p.capture_id;
    if cm is distinct from me.id then raise exception 'not_found'; end if;
  end if;
  return p.storage_path;
end $$;
