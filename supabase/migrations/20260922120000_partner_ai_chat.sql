-- Partner assistant (/partner "Ask"): a free AI chat for Eli.
-- Zero cost: answers come from the local model on Jared's Mac mini (Ollama, qwen3), not a paid API.
-- Flow: the portal inserts a question (partner_chat_send) -> the Mac worker polls partner_ai_claim with
-- its key, streams the answer back through partner_ai_write -> the portal sees it via Realtime (RLS).

create table if not exists public.partner_chat (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null default '',
  status text not null default 'done' check (status in ('pending', 'working', 'done', 'error')),
  reply_to uuid references public.partner_chat (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists partner_chat_user_idx on public.partner_chat (user_id, created_at);
create index if not exists partner_chat_pending_idx on public.partner_chat (created_at) where status = 'pending';
alter table public.partner_chat enable row level security;
drop policy if exists partner_chat_own on public.partner_chat;
create policy partner_chat_own on public.partner_chat for select to authenticated using (user_id = auth.uid());
alter table public.partner_chat replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.partner_chat;
exception when duplicate_object then null; end $$;

-- Is the Mac answering? One row, bumped by the worker's polls.
create table if not exists public.partner_ai_status (
  id int primary key default 1 check (id = 1),
  seen_at timestamptz,
  model text
);
insert into public.partner_ai_status (id) values (1) on conflict do nothing;
alter table public.partner_ai_status enable row level security;
drop policy if exists partner_ai_status_read on public.partner_ai_status;
create policy partner_ai_status_read on public.partner_ai_status for select to authenticated using (true);

-- Ask a question (partners and the admin).
create or replace function public.partner_chat_send(p_text text)
returns public.partner_chat language plpgsql security definer set search_path = public as $$
declare r public.partner_chat; t text := btrim(coalesce(p_text, ''));
begin
  if auth.uid() is null or (public.partner_roster_name() is null and not public.has_role(auth.uid(), 'admin')) then
    raise exception 'partners only';
  end if;
  if t = '' then raise exception 'empty message'; end if;
  if length(t) > 4000 then raise exception 'Keep it under 4,000 characters.'; end if;
  if (select count(*) from public.partner_chat where user_id = auth.uid() and role = 'user' and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'That''s a lot of questions for one hour. Try again in a bit.';
  end if;
  insert into public.partner_chat (user_id, role, content, status) values (auth.uid(), 'user', t, 'pending') returning * into r;
  return r;
end $$;
revoke all on function public.partner_chat_send(text) from public, anon;
grant execute on function public.partner_chat_send(text) to authenticated;

-- Start over: clears your own conversation.
create or replace function public.partner_chat_clear()
returns void language sql security definer set search_path = public as $$
  delete from public.partner_chat where user_id = auth.uid();
$$;
revoke all on function public.partner_chat_clear() from public, anon;
grant execute on function public.partner_chat_clear() to authenticated;

create or replace function public.partner_ai_key_ok(p_key text)
returns boolean language sql stable security definer set search_path = public, vault as $$
  select coalesce(length(p_key) >= 32 and p_key = (select decrypted_secret from vault.decrypted_secrets where name = 'partner_ai_worker_key' limit 1), false);
$$;
revoke all on function public.partner_ai_key_ok(text) from public, anon, authenticated;

-- Worker: heartbeat + take the oldest waiting question, with the asker's context.
create or replace function public.partner_ai_claim(p_key text, p_model text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare q public.partner_chat; a_id uuid; who text; nm text; is_admin boolean;
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  update public.partner_ai_status set seen_at = now(), model = coalesce(p_model, model)
   where id = 1 and (seen_at is null or seen_at < now() - interval '15 seconds' or model is distinct from coalesce(p_model, model));
  -- A worker that died mid-answer: put the question back.
  update public.partner_chat set status = 'pending', updated_at = now()
   where role = 'user' and status = 'working' and updated_at < now() - interval '4 minutes';
  update public.partner_chat set status = 'error', content = coalesce(nullif(content, ''), 'Interrupted. Ask again.'), updated_at = now()
   where role = 'assistant' and status = 'working' and updated_at < now() - interval '4 minutes';

  select * into q from public.partner_chat where role = 'user' and status = 'pending'
   order by created_at limit 1 for update skip locked;
  if q.id is null then return null; end if;
  update public.partner_chat set status = 'working', updated_at = now() where id = q.id;
  insert into public.partner_chat (user_id, role, content, status, reply_to)
    values (q.user_id, 'assistant', '', 'working', q.id) returning id into a_id;

  select roster_name, name into who, nm from public.partners where user_id = q.user_id;
  is_admin := public.has_role(q.user_id, 'admin');
  return jsonb_build_object(
    'question_id', q.id, 'reply_id', a_id, 'question', q.content,
    'name', coalesce(nm, case when is_admin then 'Jared' else 'Partner' end),
    'history', coalesce((select jsonb_agg(jsonb_build_object('role', h.role, 'content', h.content) order by h.created_at)
       from (select role, content, created_at from public.partner_chat
              where user_id = q.user_id and status = 'done' and id <> q.id and content <> ''
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
    'pipeline', jsonb_build_object(
      'deals', coalesce((select jsonb_agg(jsonb_build_object('company', company_name, 'stage', current_stage))
         from public.cloud_deals where current_stage between 3 and 8), '[]'::jsonb),
      'leads', coalesce((select jsonb_agg(jsonb_build_object('company', coalesce(nullif(company_name, ''), 'Unnamed'), 'size', user_count_band))
         from public.cloud_leads where coalesce(status, 'new') not in ('lost', 'won', 'closed', 'spam', 'converted', 'archived')), '[]'::jsonb))
  );
end $$;
revoke all on function public.partner_ai_claim(text, text) from public;
grant execute on function public.partner_ai_claim(text, text) to anon;

-- Worker: stream the answer in (p_done=false), then finish it (p_done=true) or fail it (p_error).
create or replace function public.partner_ai_write(p_key text, p_reply_id uuid, p_content text, p_done boolean default false, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
declare q uuid;
begin
  if not public.partner_ai_key_ok(p_key) then raise exception 'bad key'; end if;
  update public.partner_chat
     set content = case when p_error is not null then coalesce(nullif(p_content, ''), p_error) else coalesce(p_content, '') end,
         status = case when p_error is not null then 'error' when p_done then 'done' else 'working' end,
         updated_at = now()
   where id = p_reply_id and role = 'assistant'
   returning reply_to into q;
  if q is not null and (p_done or p_error is not null) then
    update public.partner_chat set status = 'done', updated_at = now() where id = q;
  end if;
end $$;
revoke all on function public.partner_ai_write(text, uuid, text, boolean, text) from public;
grant execute on function public.partner_ai_write(text, uuid, text, boolean, text) to anon;
