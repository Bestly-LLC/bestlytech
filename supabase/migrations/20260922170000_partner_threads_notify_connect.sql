-- Partner portal, round 3:
--   1. Scout conversations (threads) for partners: partner_chat_threads + partner_chat.thread_id
--   2. Studio notifications inside the partner portal (same notify_outbox + seen_at Studio uses)
--   3. "Connect my Claude" for partners: partner_connectors (key shown once, stored as sha256)

-- 1. Threads ------------------------------------------------------------------
create table if not exists public.partner_chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_chat_threads_user_idx on public.partner_chat_threads (user_id, updated_at desc);
alter table public.partner_chat_threads enable row level security;
drop policy if exists partner_chat_threads_own on public.partner_chat_threads;
create policy partner_chat_threads_own on public.partner_chat_threads for select to authenticated using (user_id = auth.uid());
grant select on public.partner_chat_threads to authenticated;
alter table public.partner_chat_threads replica identity full;
do $$ begin alter publication supabase_realtime add table public.partner_chat_threads; exception when duplicate_object then null; end $$;

alter table public.partner_chat add column if not exists thread_id uuid references public.partner_chat_threads (id) on delete cascade;
create index if not exists partner_chat_thread_idx on public.partner_chat (thread_id, created_at);
-- Existing messages: one thread per person.
do $$ declare u uuid; t uuid; begin
  for u in select distinct user_id from public.partner_chat where thread_id is null loop
    insert into public.partner_chat_threads (user_id, title)
      values (u, coalesce((select left(content, 60) from public.partner_chat where user_id = u and role = 'user' order by created_at limit 1), 'Earlier chat'))
      returning id into t;
    update public.partner_chat set thread_id = t where user_id = u and thread_id is null;
  end loop;
end $$;

drop function if exists public.partner_chat_send(text);
create or replace function public.partner_chat_send(p_text text, p_thread uuid default null)
returns public.partner_chat language plpgsql security definer set search_path = public as $$
declare r public.partner_chat; t text := btrim(coalesce(p_text, '')); th uuid := p_thread;
begin
  if auth.uid() is null or (public.partner_roster_name() is null and not public.has_role(auth.uid(), 'admin')) then
    raise exception 'partners only';
  end if;
  if t = '' then raise exception 'empty message'; end if;
  if length(t) > 4000 then raise exception 'Keep it under 4,000 characters.'; end if;
  if (select count(*) from public.partner_chat where user_id = auth.uid() and role = 'user' and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'That''s a lot of questions for one hour. Try again in a bit.';
  end if;
  if th is null then
    insert into public.partner_chat_threads (user_id, title)
      values (auth.uid(), left(regexp_replace(t, '\s+', ' ', 'g'), 60)) returning id into th;
  elsif not exists (select 1 from public.partner_chat_threads where id = th and user_id = auth.uid()) then
    raise exception 'not your conversation';
  else
    update public.partner_chat_threads set updated_at = now() where id = th;
  end if;
  insert into public.partner_chat (user_id, role, content, status, thread_id) values (auth.uid(), 'user', t, 'pending', th) returning * into r;
  return r;
end $$;
revoke all on function public.partner_chat_send(text, uuid) from public, anon;
grant execute on function public.partner_chat_send(text, uuid) to authenticated;

create or replace function public.partner_thread_rename(p_id uuid, p_title text)
returns void language sql security definer set search_path = public as $$
  update public.partner_chat_threads set title = left(coalesce(nullif(btrim(p_title), ''), title), 80), updated_at = now()
   where id = p_id and user_id = auth.uid();
$$;
create or replace function public.partner_thread_delete(p_id uuid)
returns void language sql security definer set search_path = public as $$
  delete from public.partner_chat_threads where id = p_id and user_id = auth.uid();
$$;
revoke all on function public.partner_thread_rename(uuid, text), public.partner_thread_delete(uuid) from public, anon;
grant execute on function public.partner_thread_rename(uuid, text), public.partner_thread_delete(uuid) to authenticated;

-- The worker's context: history now comes from the same conversation only.
create or replace function public.partner_ai_claim(p_key text, p_model text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q public.partner_chat; a_id uuid; who text; nm text; is_admin boolean;
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  update public.partner_ai_status set seen_at = now(), model = coalesce(p_model, model)
   where id = 1 and (seen_at is null or seen_at < now() - interval '15 seconds' or model is distinct from coalesce(p_model, model));
  update public.partner_chat set status = 'pending', updated_at = now()
   where role = 'user' and status = 'working' and updated_at < now() - interval '4 minutes';
  update public.partner_chat set status = 'error', content = coalesce(nullif(content, ''), 'Interrupted. Ask again.'), updated_at = now()
   where role = 'assistant' and status = 'working' and updated_at < now() - interval '4 minutes';

  select * into q from public.partner_chat where role = 'user' and status = 'pending'
   order by created_at limit 1 for update skip locked;
  if q.id is null then return null; end if;
  update public.partner_chat set status = 'working', updated_at = now() where id = q.id;
  insert into public.partner_chat (user_id, role, content, status, reply_to, thread_id)
    values (q.user_id, 'assistant', '', 'working', q.id, q.thread_id) returning id into a_id;

  select roster_name, name into who, nm from public.partners where user_id = q.user_id;
  is_admin := public.has_role(q.user_id, 'admin');
  return jsonb_build_object(
    'question_id', q.id, 'reply_id', a_id, 'question', q.content,
    'name', coalesce(nm, case when is_admin then 'Jared' else 'Partner' end),
    'history', coalesce((select jsonb_agg(jsonb_build_object('role', h.role, 'content', h.content) order by h.created_at)
       from (select role, content, created_at from public.partner_chat
              where user_id = q.user_id and thread_id is not distinct from q.thread_id
                and status = 'done' and id <> q.id and content <> ''
              order by created_at desc limit 16) h), '[]'::jsonb),
    'calls', coalesce((select jsonb_agg(jsonb_build_object('date', m.started_at, 'title', m.name,
        'people', m.people, 'summary', m.summary) order by m.started_at desc)
       from (select * from public.meeting_recordings
              where (is_admin and who is null) or who = any (people)
              order by started_at desc nulls last limit 8) m), '[]'::jsonb),
    'todos', coalesce((select jsonb_agg(jsonb_build_object('title', s.title, 'owner', s.action->>'owner',
        'due', s.action->>'due', 'status', s.status))
       from (select * from public.scout_daily s where kind = 'call' and status = 'open'
               and exists (select 1 from public.meeting_recordings m where m.id::text = s.action->>'meeting_id'
                           and ((is_admin and who is null) or who = any (m.people)))
             order by created_at desc limit 25) s), '[]'::jsonb),
    'emails', coalesce((select jsonb_agg(jsonb_build_object('date', e.sent_at, 'subject', e.subject, 'text', left(e.body_text, 600),
        'files', (select jsonb_agg(a->>'name') from jsonb_array_elements(e.attachments) a)) order by e.sent_at desc)
       from (select * from public.partner_mail where roster = coalesce(who, roster) order by sent_at desc nulls last limit 8) e), '[]'::jsonb),
    'pipeline', jsonb_build_object(
      'deals', coalesce((select jsonb_agg(jsonb_build_object('company', company_name, 'stage', current_stage))
         from public.cloud_deals where current_stage between 3 and 8), '[]'::jsonb),
      'leads', coalesce((select jsonb_agg(jsonb_build_object('company', coalesce(nullif(company_name, ''), 'Unnamed'), 'size', user_count_band))
         from public.cloud_leads where coalesce(status, 'new') not in ('lost', 'won', 'closed', 'spam', 'converted', 'archived')), '[]'::jsonb))
  );
end $$;
revoke all on function public.partner_ai_claim(text, text) from public;
grant execute on function public.partner_ai_claim(text, text) to anon;

-- 2. Studio notifications in the portal ----------------------------------------
create or replace function public.partner_staff_id()
returns uuid language sql stable security definer set search_path = public as $$
  select s.id from public.approval_staff s
    join public.partners p on p.user_id = auth.uid()
   where s.active and (s.slug = p.roster_name or lower(s.email) = lower(p.email))
   limit 1;
$$;
revoke all on function public.partner_staff_id() from public, anon;

create or replace function public.partner_studio_notifications()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare sid uuid := public.partner_staff_id(); v_seen timestamptz;
begin
  if sid is null then return jsonb_build_object('ok', false, 'unread', 0, 'items', '[]'::jsonb); end if;
  select seen_at into v_seen from public.staff_notify where staff_id = sid;
  return jsonb_build_object('ok', true, 'seen_at', v_seen,
    'unread', (select count(*) from public.notify_outbox o where o.staff_id = sid
                 and o.created_at > coalesce(v_seen, now() - interval '3 days') and o.created_at > now() - interval '14 days'),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'kind', o.kind, 'subject', o.subject, 'body', left(o.body, 400),
        'link', o.link, 'at', o.created_at, 'unread', o.created_at > coalesce(v_seen, now() - interval '3 days')) order by o.created_at desc)
      from (select * from public.notify_outbox where staff_id = sid and created_at > now() - interval '30 days'
             order by created_at desc limit 40) o), '[]'::jsonb));
end $$;
create or replace function public.partner_studio_seen()
returns void language plpgsql security definer set search_path = public as $$
declare sid uuid := public.partner_staff_id();
begin
  if sid is null then return; end if;
  insert into public.staff_notify (staff_id, seen_at) values (sid, now())
  on conflict (staff_id) do update set seen_at = now(), updated_at = now();
end $$;
revoke all on function public.partner_studio_notifications(), public.partner_studio_seen() from public, anon;
grant execute on function public.partner_studio_notifications(), public.partner_studio_seen() to authenticated;

-- 3. Connect my Claude ------------------------------------------------------------
create table if not exists public.partner_connectors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  key_sha256 text not null unique,
  label text not null default 'Claude',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
alter table public.partner_connectors enable row level security;  -- read through the RPCs below only

create or replace function public.partner_connector_create(p_label text default 'Claude')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare k text;
begin
  if auth.uid() is null or (public.partner_roster_name() is null and not public.has_role(auth.uid(), 'admin')) then
    raise exception 'partners only';
  end if;
  if (select count(*) from public.partner_connectors where user_id = auth.uid() and revoked_at is null) >= 5 then
    raise exception 'You already have 5 connections. Remove one first.';
  end if;
  k := 'bpc_' || encode(gen_random_bytes(24), 'hex');
  insert into public.partner_connectors (user_id, key_sha256, label)
    values (auth.uid(), encode(digest(k, 'sha256'), 'hex'), left(coalesce(nullif(btrim(p_label), ''), 'Claude'), 40));
  return jsonb_build_object('key', k);
end $$;
create or replace function public.partner_connector_list()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'created_at', created_at, 'last_used_at', last_used_at) order by created_at desc), '[]'::jsonb)
    from public.partner_connectors where user_id = auth.uid() and revoked_at is null;
$$;
create or replace function public.partner_connector_revoke(p_id uuid)
returns void language sql security definer set search_path = public as $$
  update public.partner_connectors set revoked_at = now() where id = p_id and user_id = auth.uid();
$$;
revoke all on function public.partner_connector_create(text), public.partner_connector_list(), public.partner_connector_revoke(uuid) from public, anon;
grant execute on function public.partner_connector_create(text), public.partner_connector_list(), public.partner_connector_revoke(uuid) to authenticated;

-- For the partner-mcp edge function (service role only).
create or replace function public.partner_connector_auth(p_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare c public.partner_connectors; p public.partners;
begin
  select * into c from public.partner_connectors where key_sha256 = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex') and revoked_at is null;
  if c.id is null then return null; end if;
  update public.partner_connectors set last_used_at = now() where id = c.id and (last_used_at is null or last_used_at < now() - interval '5 minutes');
  select * into p from public.partners where user_id = c.user_id;
  return jsonb_build_object('user_id', c.user_id, 'roster', p.roster_name, 'name', coalesce(p.name, 'Jared'),
    'admin', public.has_role(c.user_id, 'admin'), 'call_url', p.call_url);
end $$;
revoke all on function public.partner_connector_auth(text) from public, anon, authenticated;
