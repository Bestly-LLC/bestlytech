-- 2026-10-11 Studio: email to studio@ lands as a DRAFT, one tap sends it to the client's board.
-- Part 1 of 3: schema, and every client-facing read of client_todos learns that a draft is invisible.
--
-- Jared: "The whole point of Studio is to avoid emailing back and forth. Anything I send to studio@bestly.tech
-- should, based on its context, go on her to-do list or her ask list in her portal - not an email to her."
-- He chose: it lands as a draft in Studio first, and ONE TAP from him sends it to her board.
--
-- Undo: see bestly_memory area=studio key=studio/email-to-board.

-- 1. a to-do can be a draft. Drafts have no due date until they are sent.
alter table public.client_todos drop constraint if exists client_todos_status_check;
alter table public.client_todos add constraint client_todos_status_check
  check (status = any (array['open','ours','done','dropped','draft']));

create or replace function public.client_todos_due_default() returns trigger
language plpgsql set search_path to 'public', 'extensions' as $$
begin
  if new.due is null then
    new.due := greatest(current_date + 7, current_date);
  end if;
  return new;
end $$;

-- 2. a note on an existing post, drafted from an email, waits here until Jared sends it (then it becomes a normal
--    staff note via studio_note). No email address is stored: the sender is the staff row.
create table if not exists public.studio_note_drafts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.approval_clients(id) on delete cascade,
  item_id uuid not null references public.approval_items(id) on delete cascade,
  title text not null,
  note text not null,
  status text not null default 'draft' check (status in ('draft','sent','dropped')),
  source jsonb,
  created_by uuid references public.approval_staff(id),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  review_id uuid
);
create index if not exists studio_note_drafts_client_idx on public.studio_note_drafts (client_id, status);
alter table public.studio_note_drafts enable row level security;
revoke all on public.studio_note_drafts from anon, authenticated;

-- 3. Jared mails from two addresses; only one was on his staff row.
update public.approval_staff
   set alt_emails = coalesce(alt_emails, '{}') || array['jaredbest@icloud.com']
 where slug = 'jared' and not ('jaredbest@icloud.com' = any (coalesce(alt_emails, '{}')));

-- 4. Everything the client's board, calendar feed and origin labels read: a draft is not there.
create or replace function public.client_todos_board(p_token text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare c public.approval_caller;
begin
  c := public.approval_resolve_client(p_token);
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true,
    'todos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'detail', t.detail, 'due', t.due,
        'status', t.status, 'done_at', t.done_at,
        'next', t.forward->>'next',
        'we_can', t.forward->>'we_can',
        'blocked', t.forward->>'blocked',
        'handed_at', t.forward->>'handed_at',
        'links', coalesce((select jsonb_agg(l) from jsonb_array_elements(
                   case when jsonb_typeof(t.forward->'links') = 'array' then t.forward->'links' else '[]'::jsonb end) l
                   where l->>'url' ~* '^(https://|mailto:)'), '[]'::jsonb),
        'from', case when t.source is not null then jsonb_build_object(
                  'label', t.source->>'label', 'meeting', t.source->>'meeting',
                  'at', t.source->>'at', 'quote', t.source->>'quote') end)
        order by (t.status = 'open') desc, (t.status = 'ours') desc,
                 t.due nulls last, t.position, t.created_at)
      from public.client_todos t
      where t.client_id = c.id and t.status not in ('dropped', 'draft')), '[]'::jsonb));
end $$;

create or replace function public.calendar_feed_read(p_key text, p_back integer default 60, p_fwd integer default 240) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare f public.calendar_feeds%rowtype; v_client uuid; v_name text; v_from date; v_to date; v_staff boolean;
begin
  select * into f from public.calendar_feeds where key = p_key and revoked_at is null;
  if f.key is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  update public.calendar_feeds set last_read = now() where key = p_key;

  v_staff := f.kind = 'staff';
  v_client := f.client_id;
  select name into v_name from public.approval_clients where id = v_client;
  v_from := current_date - greatest(0, least(coalesce(p_back, 60), 365));
  v_to   := current_date + greatest(7, least(coalesce(p_fwd, 240), 730));

  return jsonb_build_object('ok', true, 'name', v_name, 'staff', v_staff, 'from', v_from, 'to', v_to,
    'dates', coalesce((select jsonb_agg(jsonb_build_object('on', d.on_date, 'slug', d.slug, 'name', d.name, 'kind', d.kind, 'note', d.note) order by d.on_date)
                         from public.calendar_dates(v_from, v_to) d), '[]'::jsonb),
    'posts', coalesce((select jsonb_agg(jsonb_build_object('id', it.id, 'on', it.scheduled_for, 'title', it.title,
                                 'media_type', it.media_type, 'platform', it.platform, 'stage', it.stage,
                                 'status', it.status, 'internal_status', it.internal_status, 'posted_at', it.posted_at,
                                 'v', it.content_version, 'at', it.created_at) order by it.scheduled_for)
                         from public.approval_items it
                        where it.client_id = v_client and it.status <> 'draft'
                          and it.scheduled_for between v_from and v_to
                          and (v_staff or it.stage = 'client')), '[]'::jsonb),
    'asks', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'on', a.due, 'title', a.title, 'status', a.status,
                                 'seconds', a.target_seconds, 'at', a.created_at) order by a.due)
                        from public.client_asks a
                       where a.client_id = v_client and a.due between v_from and v_to
                         and (v_staff or a.status in ('open','received'))
                         and a.status <> 'draft'), '[]'::jsonb),
    -- a dropped job is gone from the board, so it is gone from the calendar; a draft was never on it
    'todos', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'on', t.due, 'title', t.title,
                                 'status', t.status, 'next', t.forward->>'next',
                                 'blocked', t.forward->>'blocked', 'at', t.created_at,
                                 'done_at', t.done_at) order by t.due)
                         from public.client_todos t
                        where t.client_id = v_client and t.due between v_from and v_to
                          and t.status not in ('dropped', 'draft')), '[]'::jsonb));
end $$;

create or replace function public.client_todo_set(p_token text, p_id uuid, p_done boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare c public.approval_caller; v_title text; v_was text;
begin
  c := public.approval_resolve_client(p_token);
  -- view-as: staff can look, but nothing here is done as her
  if public.client_viewer(p_token) is not null then return jsonb_build_object('ok', false, 'error', 'view_only', 'message', 'You are viewing as the client. Nothing here is saved as them.'); end if;
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select status into v_was from public.client_todos where id = p_id and client_id = c.id;
  update public.client_todos
     set status  = case when p_done then 'done'
                        when v_was = 'done' and forward ? 'handed_at' then 'ours'
                        else 'open' end,
         done_at = case when p_done then now() end,
         done_by = case when p_done then 'client' end
   where id = p_id and client_id = c.id and status not in ('dropped', 'draft')
   returning title into v_title;
  if v_title is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  begin
    if p_done then
      perform public.talk_say('review', '☑️ ' || c.name || ' ticked off: "' || v_title || '"',
        'todo:' || p_id::text, '☑️ {n} things ticked off on ' || c.name || '''s list.',
        jsonb_build_object('todo', p_id));
    end if;
  exception when others then null;
  end;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.client_list_origins(p_token text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare c public.approval_caller;
begin
  c := public.approval_resolve_client(p_token);
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true, 'todos', coalesce((
    select jsonb_object_agg(t.id, jsonb_build_object(
      'by', case when coalesce(public.staff_display(t.created_by), t.created_actor->>'name') in ('Jared', 'Eli')
                 then coalesce(public.staff_display(t.created_by), t.created_actor->>'name') else 'the studio' end || '',
      'from', case when t.source ? 'label' then replace(t.source->>'label', 'Call with Jared and Eli', 'our call') end,
      'quote', public.origin_clip(t.source->>'quote', 160),
      'at', t.created_at))
    from client_todos t where t.client_id = c.id and t.status <> 'draft'), '{}'));
end $$;

create or replace function public.client_todo_source(p_token text, p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  c public.approval_caller;
  t public.client_todos;
  m record;
  v_lines text[];
  v_keep  text[] := '{}';
  v_at    text;
  v_quote text;
  v_probe text;
  v_hit   int := 0;
  i int; lo int; hi int;
  v_out jsonb := '[]'::jsonb;
  v_who text; v_txt text; v_ts text; v_line text;
  WIN constant int := 7;   -- lines either side. A window, not a transcript.
begin
  c := public.approval_resolve_client(p_token);
  if c.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  select * into t from public.client_todos where id = p_id and client_id = c.id and status not in ('dropped', 'draft');
  if t.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if t.source is null or coalesce(t.source->>'meeting','') = '' then
    return jsonb_build_object('ok', true, 'lines', '[]'::jsonb,
      'label', t.source->>'label', 'quote', t.source->>'quote', 'why', 'no_recording');
  end if;

  select r.transcript, r.people, r.started_at into m
    from public.meeting_recordings r where r.name = t.source->>'meeting' limit 1;
  if m.transcript is null then
    return jsonb_build_object('ok', true, 'lines', '[]'::jsonb,
      'label', t.source->>'label', 'quote', t.source->>'quote', 'why', 'no_recording');
  end if;
  -- the gate: one of her own people has to have been on the call
  if not (coalesce(m.people, '{}') && coalesce(c_people(c.slug), '{}')) then
    return jsonb_build_object('ok', true, 'lines', '[]'::jsonb,
      'label', t.source->>'label', 'quote', t.source->>'quote', 'why', 'not_hers');
  end if;

  -- keep only real spoken lines; the header comments are ours, not theirs
  foreach v_line in array regexp_split_to_array(m.transcript, E'\n') loop
    if v_line ~ '^\[[0-9]+:[0-9]{2}\] ' then v_keep := v_keep || v_line; end if;
  end loop;
  v_lines := v_keep;
  if array_length(v_lines, 1) is null then
    return jsonb_build_object('ok', true, 'lines', '[]'::jsonb,
      'label', t.source->>'label', 'quote', t.source->>'quote', 'why', 'no_recording');
  end if;

  v_at := coalesce(t.source->>'at', '');
  v_quote := coalesce(t.source->>'quote', '');

  -- 1. the timestamp we recorded, when it is one
  if v_at ~ '^[0-9]+:[0-9]{2}$' then
    for i in 1 .. array_length(v_lines, 1) loop
      if v_lines[i] like '[' || v_at || ']%' then v_hit := i; exit; end if;
    end loop;
  end if;
  -- 2. otherwise the quote itself, on a distinctive middle chunk of it
  if v_hit = 0 and length(v_quote) > 12 then
    v_probe := lower(substr(v_quote, 1, 40));
    for i in 1 .. array_length(v_lines, 1) loop
      if position(v_probe in lower(v_lines[i])) > 0 then v_hit := i; exit; end if;
    end loop;
  end if;
  if v_hit = 0 then
    return jsonb_build_object('ok', true, 'lines', '[]'::jsonb,
      'label', t.source->>'label', 'quote', v_quote, 'why', 'not_found');
  end if;

  lo := greatest(1, v_hit - WIN);
  hi := least(array_length(v_lines, 1), v_hit + WIN);
  for i in lo .. hi loop
    v_ts  := substring(v_lines[i] from '^\[([0-9]+:[0-9]{2})\]');
    v_who := substring(v_lines[i] from '^\[[0-9]+:[0-9]{2}\] ([^:]+):');
    v_txt := regexp_replace(v_lines[i], '^\[[0-9]+:[0-9]{2}\] [^:]+: ', '');
    v_out := v_out || jsonb_build_object(
      'at', v_ts,
      'who', initcap(replace(coalesce(v_who, '—'), '?', '')),
      'sure', coalesce(v_who, '') not like '%?%',
      'text', v_txt,
      'hit', i = v_hit);
  end loop;

  return jsonb_build_object('ok', true,
    'label', t.source->>'label',
    'quote', v_quote,
    'on', m.started_at::date,
    'started', m.started_at,
    'lines', v_out);
end $$;
