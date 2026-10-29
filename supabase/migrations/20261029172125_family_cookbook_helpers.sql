-- Family Cookbook, part 2: internal helpers (not callable from the API).
set check_function_bodies = off;

-- ---------------------------------------------------------------- internal helpers (not callable from the API)
create or replace function public._family_me(p_token text)
returns public.family_members language sql stable security definer set search_path = public, extensions, pg_temp as $$
  select m.* from public.family_sessions s join public.family_members m on m.id = s.member_id
   where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and s.expires_at > now() and m.status in ('invited', 'active')
   limit 1
$$;

create or replace function public._family_need(p_token text)
returns public.family_members language plpgsql stable security definer set search_path = public, pg_temp as $$
declare me public.family_members;
begin
  me := public._family_me(p_token);
  if me.id is null then raise exception 'not_signed_in'; end if;
  return me;
end $$;

-- WHO SEES WHAT. Flip the last branch to keep Jared's and Mariah's recipes apart from each other too.
create or replace function public._family_can_see(p_viewer text, p_owner text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case when p_owner = 'mom' then p_viewer in ('mom', 'jared', 'mariah')
              when p_viewer = 'mom' then false
              else p_viewer in ('jared', 'mariah') and p_owner in ('jared', 'mariah') end
$$;

create or replace function public._family_label(p_role text)
returns text language sql immutable as $$ select case p_role when 'mom' then 'Mom' when 'jared' then 'Jared' when 'mariah' then 'Mariah' else p_role end $$;

-- A recipe row the viewer may see, or an exception. Deleted rows count (Recently Deleted) when p_deleted is true.
create or replace function public._family_get(p_me public.family_members, p_id int, p_deleted boolean default false)
returns public.pantry_recipes language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r public.pantry_recipes;
begin
  select * into r from public.pantry_recipes where id = p_id and doc is not null;
  if r.id is null or not public._family_can_see(p_me.role, coalesce(r.family_by, 'jared')) then raise exception 'not_found'; end if;
  if r.deleted_at is not null and not p_deleted then raise exception 'not_found'; end if;
  if r.deleted_at is null and p_deleted then raise exception 'not_found'; end if;
  return r;
end $$;

create or replace function public._family_row(r public.pantry_recipes)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'id', r.id::text,
    'title', coalesce(nullif(r.doc ->> 'title', ''), r.name),
    'by', coalesce(r.family_by, 'jared'),
    'added', r.created_at,
    'status', r.family_status,
    'category', coalesce(r.doc ->> 'category', ''),
    'flaggedBy', r.family_flagged_by,
    'flaggedAt', r.family_flagged_at,
    'note', coalesce(r.family_note, ''),
    'closer', r.family_closer,
    'deletedAt', r.deleted_at,
    'deletedBy', r.deleted_by,
    'yield', r.doc -> 'yield',
    'photos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'side', p.side) order by (p.side = 'back'), p.created_at)
                          from public.family_photos p where p.recipe_id = r.id), '[]'::jsonb),
    'hay', lower(concat_ws(' ', r.name, r.family_note, r.doc ->> 'category', public._family_label(coalesce(r.family_by, 'jared')),
                           (select string_agg(i ->> 'name', ' ') from jsonb_array_elements(coalesce(r.doc -> 'ingredients', '[]'::jsonb)) i))))
$$;

-- Drop the "[[w1|best|alt]]" check markup from a doc (used by the Kitchen tab, which has no fix-a-word flow).
create or replace function public._family_plain_doc(p_doc jsonb)
returns jsonb language sql immutable as $$
  select regexp_replace(p_doc::text, '\[\[\w+\|([^|\]"]*)[^\]"]*\]\]', '\1', 'g')::jsonb
$$;

create or replace function public._family_clean_doc(p_doc jsonb, p_slug text)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare t text;
begin
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' or jsonb_typeof(p_doc -> 'ingredients') <> 'array' or jsonb_typeof(p_doc -> 'steps') <> 'array' then
    raise exception 'bad_recipe';
  end if;
  t := btrim(coalesce(p_doc ->> 'title', ''));
  if t = '' or length(t) > 120 then raise exception 'bad_title'; end if;
  if jsonb_array_length(p_doc -> 'ingredients') = 0 or jsonb_array_length(p_doc -> 'steps') = 0
     or jsonb_array_length(p_doc -> 'ingredients') > 80 or jsonb_array_length(p_doc -> 'steps') > 80 then raise exception 'bad_recipe'; end if;
  if length(p_doc::text) > 60000 then raise exception 'too_big'; end if;
  return jsonb_set(jsonb_set(p_doc, '{title}', to_jsonb(t)), '{id}', to_jsonb(p_slug));
end $$;

-- "Mom added 3 recipes": one quiet success row per person per day, signed Basil, lands in the 7 PM recap. No push.
create or replace function public._family_note_added(p_role text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; d text := to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'); who text := public._family_label(p_role);
begin
  if p_role not in ('mom', 'mariah') then return; end if;
  select count(*) into n from public.pantry_recipes
   where family_by = p_role and deleted_at is null and source = 'family'
     and (created_at at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date;
  insert into public.admin_notifications (kind, title, body, url, entity_key, severity, dedupe_key, silent, agent_slug)
  values ('family', 'Basil: ' || who || ' added ' || n || case when n = 1 then ' recipe' else ' recipes' end,
          who || ' added ' || n || ' to the Family Cookbook today.', '/admin/home-hub/kitchen', 'family:' || p_role, 'success', 'family-added:' || p_role || ':' || d, true, 'basil')
  on conflict (dedupe_key) do update set title = excluded.title, body = excluded.body, created_at = now(), read_at = null;
exception when others then null;
end $$;

create or replace function public._family_unique_name(p_title text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_name text := p_title; v_n int := 1;
begin
  while exists (select 1 from public.pantry_recipes where name = v_name) loop v_n := v_n + 1; v_name := p_title || ' (' || v_n || ')'; end loop;
  return v_name;
end $$;

create or replace function public._family_unique_slug(p_text text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_base text := public.recipe_slug(p_text); v_slug text := v_base; v_n int := 1;
begin
  while exists (select 1 from public.pantry_recipes where slug = v_slug) loop v_n := v_n + 1; v_slug := v_base || '-' || v_n; end loop;
  return v_slug;
end $$;

-- The monthly paid-reading budget (Pacific calendar month). Service role / Basil only.
create or replace function public.family_paid_state()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with s as (select paid_on, paid_cap_usd from public.family_settings where id),
       sp as (select coalesce(sum(cost_usd), 0) as spent from public.ai_spend
               where scope = 'family' and at >= (date_trunc('month', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles'))
  select jsonb_build_object('on', s.paid_on, 'cap', s.paid_cap_usd, 'spent', round(sp.spent, 4),
                            'ok', s.paid_on and sp.spent < s.paid_cap_usd,
                            'month', to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM'))
    from s, sp
$$;
