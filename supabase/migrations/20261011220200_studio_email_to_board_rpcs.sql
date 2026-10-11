-- 2026-10-11 Studio: email to studio@ lands as a DRAFT, one tap sends it to the client's board.
-- Part 3 of 3: the Studio side (list the drafts, send one, switch where it goes, discard), the free-AI refinement
-- (edge fn studio-route-mail: sharper route + a short title, never the body), and the watchdog.
--
-- Rules kept: sending never emails the client (a to-do flips to open, a note becomes a staff note); the words are
-- Jared's as written (only the title is shortened by Spark); the free AI ladder only (paid never); if the model is
-- down the keyword route from part 2 stands, so intake never blocks.

-- ---------------------------------------------------------------- tiny helpers
create or replace function public.mail_clean_title(p text) returns text
language plpgsql immutable set search_path to 'public' as $$
declare t text := coalesce(p, '');
begin
  t := regexp_replace(t, '["“”]', '', 'g');
  t := regexp_replace(t, '\s+', ' ', 'g');
  t := btrim(t);
  t := regexp_replace(t, '^[-*•\s]+', '');
  t := regexp_replace(t, '[.…!:;,\s]+$', '');
  if length(t) > 90 then
    t := left(t, 90);
    if position(' ' in t) > 0 then t := regexp_replace(t, '\s+\S*$', ''); end if;
    t := regexp_replace(t, '[.…!:;,\s]+$', '');
  end if;
  if length(t) < 3 then return null; end if;
  return t;
end $$;

create or replace function public.mail_draft_client(p_kind text, p_id uuid) returns uuid
language sql stable security definer set search_path to 'public' as $$
  select case p_kind
    when 'ask'  then (select client_id from client_asks where id = p_id)
    when 'todo' then (select client_id from client_todos where id = p_id)
    when 'note' then (select client_id from studio_note_drafts where id = p_id) end
$$;

-- ---------------------------------------------------------------- move a draft between ask / to-do / note
-- Internal. Copies the words as written, keeps the lineage in source, then removes the old draft.
create or replace function public.mail_draft_convert(p_kind text, p_id uuid, p_to text, p_item uuid, p_by text, p_state text default 'staff')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  a public.client_asks; t public.client_todos; n public.studio_note_drafts;
  v_client uuid; v_title text; v_body text; v_src jsonb; v_by uuid; v_new uuid; v_detail text; v_url text; v_vid text;
  v_item_title text; v_item_client uuid;
begin
  if p_to not in ('ask', 'todo', 'note') then return jsonb_build_object('ok', false, 'error', 'bad_destination'); end if;
  if p_kind = p_to and p_to <> 'note' then return jsonb_build_object('ok', true, 'kind', p_to, 'id', p_id, 'same', true); end if;

  if p_kind = 'ask' then
    select * into a from client_asks where id = p_id and status = 'draft';
    if a.id is null then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;
    if exists (select 1 from client_ask_reviews where ask_id = a.id) then return jsonb_build_object('ok', false, 'error', 'has_notes'); end if;
    if (case when jsonb_typeof(a.script) = 'array' then jsonb_array_length(a.script) else 0 end) > 0
       or coalesce(a.filming, '{}'::jsonb) <> '{}'::jsonb or coalesce(a.hook_opening, '{}'::jsonb) <> '{}'::jsonb
       or coalesce(a.comment_draft, '') <> '' or coalesce(a.reference->>'what_we_see', '') <> '' then
      return jsonb_build_object('ok', false, 'error', 'has_work'); end if;
    v_client := a.client_id; v_title := a.title; v_body := coalesce(nullif(btrim(a.brief), ''), a.title);
    v_src := coalesce(a.source, '{}'::jsonb); v_by := a.created_by;
  elsif p_kind = 'todo' then
    select * into t from client_todos where id = p_id and status = 'draft';
    if t.id is null then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;
    v_client := t.client_id; v_title := t.title; v_body := coalesce(nullif(btrim(t.detail), ''), t.title);
    v_src := coalesce(t.source, '{}'::jsonb); v_by := t.created_by;
  elsif p_kind = 'note' then
    select * into n from studio_note_drafts where id = p_id and status = 'draft';
    if n.id is null then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;
    v_client := n.client_id; v_title := n.title; v_body := n.note;
    v_src := coalesce(n.source, '{}'::jsonb); v_by := n.created_by;
  else return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;

  if p_to = 'note' then
    select i.client_id, i.title into v_item_client, v_item_title from approval_items i where i.id = p_item;
    if v_item_client is null or v_item_client is distinct from v_client then
      return jsonb_build_object('ok', false, 'error', 'pick_a_post'); end if;
  end if;

  v_src := (v_src - 'needs_script' - 'item_title' - 'route_claimed_at' - 'from')
        || jsonb_build_object('route', p_to, 'route_by', p_by, 'route_state', p_state,
                              'moved_from', p_kind, 'moved_from_id', p_id, 'moved_at', now());
  if p_to = 'ask' then
    v_url := substring(v_body from '(https?://[^\s<>"'')]+)');
    v_vid := substring(v_body from '(https?://[^\s<>"'')]*(?:tiktok\.com|instagram\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|linkedin\.com)[^\s<>"'')]*)');
    insert into client_asks (client_id, title, brief, script, status, created_by, kind, reference, source)
    values (v_client, v_title, nullif(left(btrim(v_body), 1500), ''), '[]'::jsonb, 'draft', v_by,
            public.mail_ask_kind(v_src->>'subject', v_title, v_body),
            case when coalesce(v_vid, v_url) is not null then jsonb_build_object('url', coalesce(v_vid, v_url)) end,
            v_src || jsonb_build_object('needs_script', true))
    returning id into v_new;
  elsif p_to = 'todo' then
    v_detail := nullif(left(btrim(v_body), 1500), '');
    if v_detail is not null and lower(btrim(v_detail)) = lower(btrim(v_title)) then v_detail := null; end if;
    insert into client_todos (client_id, title, detail, status, source, created_by, position)
    values (v_client, left(v_title, 140), v_detail, 'draft', v_src, v_by,
            coalesce((select max(position) + 1 from client_todos where client_id = v_client), 0))
    returning id into v_new;
  else
    insert into studio_note_drafts (client_id, item_id, title, note, status, source, created_by)
    values (v_client, p_item, left(v_title, 140), left(btrim(v_body), 1500), 'draft',
            v_src || jsonb_build_object('item_title', v_item_title), v_by)
    returning id into v_new;
  end if;

  if p_kind = 'ask' then delete from client_asks where id = p_id;
  elsif p_kind = 'todo' then delete from client_todos where id = p_id;
  else delete from studio_note_drafts where id = p_id; end if;
  return jsonb_build_object('ok', true, 'kind', p_to, 'id', v_new);
end $$;
revoke all on function public.mail_draft_convert(text, uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.mail_draft_client(text, uuid) from public, anon, authenticated;
revoke all on function public.mail_clean_title(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- Studio: the drafts that came by email
create or replace function public.studio_mail_drafts(p_token text, p_client_slug text default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare s public.studio_caller; v_drafts jsonb; v_posts jsonb;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_client_slug is not null and not public.staff_may_see_slug(s.id, p_client_slug) then
    return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;

  select coalesce(jsonb_agg(x.j order by x.at desc), '[]'::jsonb) into v_drafts from (
    select a.created_at at, jsonb_build_object(
        'kind', 'ask', 'id', a.id, 'client', c.slug, 'client_name', c.name, 'title', a.title,
        'body', coalesce(nullif(btrim(a.brief), ''), a.title), 'created_at', a.created_at,
        'route_by', a.source->>'route_by', 'route_reason', a.source->>'route_reason', 'route_model', a.source->>'route_model',
        'subject', a.source->>'subject', 'missing', to_jsonb(public.ask_readiness(a)),
        'signoff', public.studio_ask_signoff(a.id)->>'state') j
      from client_asks a join approval_clients c on c.id = a.client_id
     where a.status = 'draft' and a.source ? 'mail_id' and not coalesce((a.source->>'from_client')::boolean, false)
       and (p_client_slug is null or c.slug = p_client_slug) and public.staff_may_see_slug(s.id, c.slug)
    union all
    select t.created_at, jsonb_build_object(
        'kind', 'todo', 'id', t.id, 'client', c.slug, 'client_name', c.name, 'title', t.title,
        'body', coalesce(nullif(btrim(t.detail), ''), t.title), 'created_at', t.created_at,
        'route_by', t.source->>'route_by', 'route_reason', t.source->>'route_reason', 'route_model', t.source->>'route_model',
        'subject', t.source->>'subject')
      from client_todos t join approval_clients c on c.id = t.client_id
     where t.status = 'draft' and (p_client_slug is null or c.slug = p_client_slug) and public.staff_may_see_slug(s.id, c.slug)
    union all
    select n.created_at, jsonb_build_object(
        'kind', 'note', 'id', n.id, 'client', c.slug, 'client_name', c.name, 'title', n.title,
        'body', n.note, 'created_at', n.created_at, 'item_id', n.item_id, 'item_title', i.title,
        'route_by', n.source->>'route_by', 'route_reason', n.source->>'route_reason', 'route_model', n.source->>'route_model',
        'subject', n.source->>'subject')
      from studio_note_drafts n join approval_clients c on c.id = n.client_id left join approval_items i on i.id = n.item_id
     where n.status = 'draft' and (p_client_slug is null or c.slug = p_client_slug) and public.staff_may_see_slug(s.id, c.slug)
  ) x;

  -- the posts a note can attach to: newest first, per client
  select coalesce(jsonb_object_agg(q.slug, q.posts), '{}'::jsonb) into v_posts from (
    select c.slug, (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title, 'stage', i.stage) order by i.created_at desc), '[]'::jsonb)
                      from (select id, title, stage, created_at from approval_items
                             where client_id = c.id and coalesce(internal_status, '') <> 'killed' and btrim(coalesce(title, '')) <> ''
                             order by created_at desc limit 40) i) posts
      from approval_clients c
     where c.active and (p_client_slug is null or c.slug = p_client_slug) and public.staff_may_see_slug(s.id, c.slug)
  ) q;

  return jsonb_build_object('ok', true, 'drafts', v_drafts, 'posts', v_posts);
end $$;

-- ---------------------------------------------------------------- Studio: one tap sends it to their board
-- Never emails the client: a to-do flips to open, a note becomes a normal staff note on the post. An ask goes
-- through the same studio_ask_send as ever (readiness and sign-off rules unchanged).
create or replace function public.studio_draft_send(p_token text, p_kind text, p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare s public.studio_caller; t public.client_todos; n public.studio_note_drafts; v_slug text; r jsonb; v_title text;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if exists (select 1 from public.approval_staff x where x.id = s.id and x.is_system) then
    return jsonb_build_object('ok', false, 'error', 'human_required'); end if;

  select c.slug into v_slug from public.approval_clients c where c.id = public.mail_draft_client(p_kind, p_id);
  if v_slug is null then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;
  if not public.staff_may_see_slug(s.id, v_slug) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;

  if p_kind = 'ask' then
    r := public.studio_ask_send(p_token, p_id, false);
    return coalesce(r, '{}'::jsonb) || jsonb_build_object('kind', 'ask', 'dest', 'Their asks');
  elsif p_kind = 'todo' then
    select * into t from public.client_todos where id = p_id and status = 'draft';
    if t.id is null then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;
    -- the due date set at draft time is a placeholder: it starts counting when it reaches their board
    update public.client_todos
       set status = 'open', due = current_date + 7,
           source = coalesce(source, '{}'::jsonb) || jsonb_build_object('sent_at', now(), 'sent_by', s.name)
     where id = p_id and status = 'draft';
    return jsonb_build_object('ok', true, 'kind', 'todo', 'id', p_id, 'dest', 'Their list');
  elsif p_kind = 'note' then
    select * into n from public.studio_note_drafts where id = p_id and status = 'draft';
    if n.id is null then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;
    r := public.studio_note(p_token, n.item_id, n.note, null, null);
    if not coalesce((r->>'ok')::boolean, false) then return coalesce(r, '{}'::jsonb) || jsonb_build_object('kind', 'note'); end if;
    update public.studio_note_drafts set status = 'sent', sent_at = now(), review_id = nullif(r->>'review', '')::uuid where id = p_id;
    select title into v_title from public.approval_items where id = n.item_id;
    return jsonb_build_object('ok', true, 'kind', 'note', 'id', p_id, 'dest', 'Note on ' || coalesce(v_title, 'the post'), 'item', n.item_id);
  end if;
  return jsonb_build_object('ok', false, 'error', 'bad_kind');
end $$;

-- ---------------------------------------------------------------- Studio: switch where a draft goes
create or replace function public.studio_draft_move(p_token text, p_kind text, p_id uuid, p_to text, p_item uuid default null) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare s public.studio_caller; v_slug text;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select c.slug into v_slug from public.approval_clients c where c.id = public.mail_draft_client(p_kind, p_id);
  if v_slug is null then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;
  if not public.staff_may_see_slug(s.id, v_slug) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  return public.mail_draft_convert(p_kind, p_id, p_to, p_item, s.name, 'staff');
end $$;

-- a note draft can be pointed at a different post
create or replace function public.studio_draft_set_post(p_token text, p_id uuid, p_item uuid) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare s public.studio_caller; n public.studio_note_drafts; v_ic uuid; v_it text; v_slug text;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select * into n from public.studio_note_drafts where id = p_id and status = 'draft';
  if n.id is null then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;
  select slug into v_slug from public.approval_clients where id = n.client_id;
  if not public.staff_may_see_slug(s.id, v_slug) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select client_id, title into v_ic, v_it from public.approval_items where id = p_item;
  if v_ic is distinct from n.client_id then return jsonb_build_object('ok', false, 'error', 'pick_a_post'); end if;
  update public.studio_note_drafts set item_id = p_item, source = coalesce(source, '{}'::jsonb) || jsonb_build_object('item_title', v_it, 'route_state', 'staff')
   where id = p_id;
  return jsonb_build_object('ok', true, 'item_title', v_it);
end $$;

-- ---------------------------------------------------------------- Studio: not now
create or replace function public.studio_draft_drop(p_token text, p_kind text, p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare s public.studio_caller; v_slug text; v_n int;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  select c.slug into v_slug from public.approval_clients c where c.id = public.mail_draft_client(p_kind, p_id);
  if v_slug is null then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;
  if not public.staff_may_see_slug(s.id, v_slug) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if p_kind = 'ask' then return public.studio_ask_delete(p_token, p_id);
  elsif p_kind = 'todo' then update public.client_todos set status = 'dropped' where id = p_id and status = 'draft';
  elsif p_kind = 'note' then update public.studio_note_drafts set status = 'dropped' where id = p_id and status = 'draft';
  else return jsonb_build_object('ok', false, 'error', 'bad_kind'); end if;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', v_n > 0);
end $$;

-- ---------------------------------------------------------------- the free-AI pass (called by edge fn studio-route-mail)
-- Drafts still on the keyword route, not claimed in the last 4 minutes, fewer than 3 tries.
create or replace function public.mail_route_backlog() returns table (kind text, id uuid, client_id uuid, created_at timestamptz)
language sql stable security definer set search_path to 'public' as $$
  select 'ask'::text, a.id, a.client_id, a.created_at from client_asks a
   where a.status = 'draft' and a.source->>'route_state' = 'rules' and coalesce((a.source->>'route_attempts')::int, 0) < 3
     and a.created_at > now() - interval '2 days' and a.created_at < now() - interval '5 seconds'
     and coalesce((a.source->>'route_claimed_at')::timestamptz, 'epoch') < now() - interval '4 minutes'
  union all
  select 'todo', t.id, t.client_id, t.created_at from client_todos t
   where t.status = 'draft' and t.source->>'route_state' = 'rules' and coalesce((t.source->>'route_attempts')::int, 0) < 3
     and t.created_at > now() - interval '2 days' and t.created_at < now() - interval '5 seconds'
     and coalesce((t.source->>'route_claimed_at')::timestamptz, 'epoch') < now() - interval '4 minutes'
  union all
  select 'note', n.id, n.client_id, n.created_at from studio_note_drafts n
   where n.status = 'draft' and n.source->>'route_state' = 'rules' and coalesce((n.source->>'route_attempts')::int, 0) < 3
     and n.created_at > now() - interval '2 days' and n.created_at < now() - interval '5 seconds'
     and coalesce((n.source->>'route_claimed_at')::timestamptz, 'epoch') < now() - interval '4 minutes'
$$;
revoke all on function public.mail_route_backlog() from public, anon, authenticated;

create or replace function public.mail_route_pending(p_limit integer default 6) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r record; v_out jsonb := '[]'::jsonb; v_src jsonb; v_title text; v_body text; v_slug text; v_cname text; v_posts jsonb;
begin
  for r in select * from public.mail_route_backlog() order by created_at limit greatest(1, least(coalesce(p_limit, 6), 20)) loop
    if r.kind = 'ask' then
      update client_asks set source = source || jsonb_build_object('route_claimed_at', now()) where id = r.id
      returning source, title, coalesce(nullif(btrim(brief), ''), title) into v_src, v_title, v_body;
    elsif r.kind = 'todo' then
      update client_todos set source = source || jsonb_build_object('route_claimed_at', now()) where id = r.id
      returning source, title, coalesce(nullif(btrim(detail), ''), title) into v_src, v_title, v_body;
    else
      update studio_note_drafts set source = source || jsonb_build_object('route_claimed_at', now()) where id = r.id
      returning source, title, note into v_src, v_title, v_body;
    end if;
    select c.slug, c.name into v_slug, v_cname from approval_clients c where c.id = r.client_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'title', i.title)), '[]'::jsonb) into v_posts from (
      select id, title from approval_items where client_id = r.client_id and coalesce(internal_status, '') <> 'killed'
         and btrim(coalesce(title, '')) <> '' order by created_at desc limit 40) i;
    v_out := v_out || jsonb_build_array(jsonb_build_object('kind', r.kind, 'id', r.id, 'client', v_slug, 'client_name', v_cname,
      'title', v_title, 'body', v_body, 'subject', v_src->>'subject', 'route', v_src->>'route', 'reason', v_src->>'route_reason',
      'item_id', v_src->>'item_id', 'posts', v_posts));
  end loop;
  return v_out;
end $$;
revoke all on function public.mail_route_pending(integer) from public, anon, authenticated;

create or replace function public.mail_route_mark(p_kind text, p_id uuid, p_error text default null) returns void
language plpgsql security definer set search_path to 'public' as $$
declare v_patch jsonb := jsonb_build_object('route_error', left(coalesce(p_error, 'no answer'), 200), 'route_last_try', now());
begin
  if p_kind = 'ask' then
    update client_asks set source = source || v_patch || jsonb_build_object('route_attempts', coalesce((source->>'route_attempts')::int, 0) + 1,
      'route_state', case when coalesce((source->>'route_attempts')::int, 0) + 1 >= 3 then 'rules_final' else source->>'route_state' end)
     where id = p_id and status = 'draft';
  elsif p_kind = 'todo' then
    update client_todos set source = source || v_patch || jsonb_build_object('route_attempts', coalesce((source->>'route_attempts')::int, 0) + 1,
      'route_state', case when coalesce((source->>'route_attempts')::int, 0) + 1 >= 3 then 'rules_final' else source->>'route_state' end)
     where id = p_id and status = 'draft';
  elsif p_kind = 'note' then
    update studio_note_drafts set source = source || v_patch || jsonb_build_object('route_attempts', coalesce((source->>'route_attempts')::int, 0) + 1,
      'route_state', case when coalesce((source->>'route_attempts')::int, 0) + 1 >= 3 then 'rules_final' else source->>'route_state' end)
     where id = p_id and status = 'draft';
  end if;
end $$;
revoke all on function public.mail_route_mark(text, uuid, text) from public, anon, authenticated;

-- Apply the model's answer: a short title (never the body), and the route if it differs from the keyword one.
-- Only touches a draft nobody has handled (route_state still 'rules').
create or replace function public.mail_draft_refine(p_kind text, p_id uuid, p_route text, p_title text, p_item uuid, p_reason text, p_model text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  cur jsonb; v_title text := public.mail_clean_title(p_title); v_route text; v_kind text := p_kind; v_id uuid := p_id;
  res jsonb; v_patch jsonb;
begin
  if p_kind = 'ask' then select source into cur from client_asks where id = p_id and status = 'draft';
  elsif p_kind = 'todo' then select source into cur from client_todos where id = p_id and status = 'draft';
  elsif p_kind = 'note' then select source into cur from studio_note_drafts where id = p_id and status = 'draft';
  end if;
  if cur is null or cur->>'route_state' is distinct from 'rules' then
    return jsonb_build_object('ok', false, 'skipped', 'not_pending'); end if;

  v_route := case when p_route in ('ask', 'todo', 'note') then p_route else p_kind end;
  if v_route = 'note' and p_item is null then v_route := p_kind; end if;
  if v_route <> p_kind then
    res := public.mail_draft_convert(p_kind, p_id, v_route, p_item, 'ai:' || coalesce(p_model, 'free'), 'ai');
    if coalesce((res->>'ok')::boolean, false) then v_kind := v_route; v_id := (res->>'id')::uuid;
    else v_route := p_kind; end if;
  end if;

  v_patch := jsonb_build_object('route_state', 'ai', 'route_by', 'ai', 'route_model', p_model,
      'route_reason', coalesce(nullif(left(p_reason, 240), ''), cur->>'route_reason'),
      'keyword_route', cur->>'route', 'keyword_reason', cur->>'route_reason', 'title_by_ai', v_title is not null,
      'route_decided_at', now());
  if v_kind = 'ask' then
    update client_asks set title = coalesce(v_title, title), source = (source - 'route_claimed_at') || v_patch where id = v_id;
  elsif v_kind = 'todo' then
    update client_todos set title = coalesce(left(v_title, 140), title), source = (source - 'route_claimed_at') || v_patch where id = v_id;
  else
    update studio_note_drafts set title = coalesce(left(v_title, 140), title),
           item_id = coalesce(case when p_item is not null and exists (select 1 from approval_items i where i.id = p_item and i.client_id = studio_note_drafts.client_id) then p_item end, item_id),
           source = (source - 'route_claimed_at') || v_patch where id = v_id;
  end if;
  return jsonb_build_object('ok', true, 'kind', v_kind, 'id', v_id, 'moved', v_kind <> p_kind);
end $$;
revoke all on function public.mail_draft_refine(text, uuid, text, text, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- the tick, and the watchdog
create or replace function public.studio_route_tick() returns void
language plpgsql security definer set search_path to 'public', 'vault', 'extensions' as $$
declare v_key text;
begin
  if not exists (select 1 from public.mail_route_backlog()) then return; end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'studio_notify_key' limit 1;
  if v_key is null then return; end if;
  perform net.http_post(url := 'https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/studio-route-mail',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-notify-key', v_key),
    body := '{"action":"drain"}'::jsonb, timeout_milliseconds := 55000);
end $$;
revoke all on function public.studio_route_tick() from public, anon, authenticated;

-- Heals by running the tick again; raises studio.routing (owner: Spark) if drafts have sat on the keyword route over
-- 20 minutes. Intake itself never waits on this: a keyword-routed draft is already a draft Jared can send.
create or replace function public.studio_route_watch() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_stuck int;
begin
  select count(*) into v_stuck from (
    select created_at from client_asks where status = 'draft' and source->>'route_state' = 'rules' and coalesce((source->>'route_attempts')::int, 0) < 3
    union all select created_at from client_todos where status = 'draft' and source->>'route_state' = 'rules' and coalesce((source->>'route_attempts')::int, 0) < 3
    union all select created_at from studio_note_drafts where status = 'draft' and source->>'route_state' = 'rules' and coalesce((source->>'route_attempts')::int, 0) < 3
  ) q where created_at < now() - interval '20 minutes' and created_at > now() - interval '2 days';
  if v_stuck > 0 then
    perform public.studio_route_tick();
    perform public.bestly_raise('studio.routing', 'problem', 'warning', 'Studio email routing is behind',
      v_stuck || ' email draft(s) have waited over 20 minutes for the free-AI pass. They are already drafts on the keyword route, so nothing is blocked. Spark re-runs it every minute.',
      'studio', null, false);
  else
    perform public.bestly_raise('studio.routing', 'resolved', 'info', 'Studio email routing is healthy', null, 'studio');
  end if;
  return jsonb_build_object('ok', true, 'behind', v_stuck);
end $$;
revoke all on function public.studio_route_watch() from public, anon, authenticated;

select cron.schedule('studio-route-mail', '* * * * *', $$select public.studio_route_tick()$$);
select cron.schedule('studio-route-watch', '4,19,34,49 * * * *', $$select public.studio_route_watch()$$);

-- Spark owns it: the team card names both schedules, and the alert prefix signs as Spark.
update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', coalesce(pulse->'also', '[]'::jsonb) || '["studio-route-mail","studio-route-watch"]'::jsonb),
       updated_at = now()
 where slug = 'spark' and not coalesce(pulse->'also', '[]'::jsonb) @> '"studio-route-mail"'::jsonb;
insert into public.notification_owners (prefix, agent_slug, note)
select 'studio.routing', 'spark', 'email-to-board routing'
 where not exists (select 1 from public.notification_owners where prefix = 'studio.routing');

-- ---------------------------------------------------------------- public on purpose
-- The Studio app calls these with the publishable key + a staff session token; each checks the token itself.
insert into public.security_public_rpcs (fn, why) values
  ('studio_mail_drafts',  'Studio app (publishable key + staff token) lists drafts that arrived by email'),
  ('studio_draft_send',   'Studio app (publishable key + staff token) sends a drafted ask, to-do or note to the board'),
  ('studio_draft_move',   'Studio app (publishable key + staff token) switches a draft between ask, to-do and note'),
  ('studio_draft_set_post','Studio app (publishable key + staff token) points a note draft at another post'),
  ('studio_draft_drop',   'Studio app (publishable key + staff token) discards a draft')
on conflict (fn) do nothing;
