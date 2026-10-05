-- Eli can see what RoofGuard Ava may say and suggest new facts. Jared approves before anything goes live.
-- Ava speaks ava_knowledge out loud to real prospects, so a suggestion must never reach a call on its own.
--
--   status 'live'      what Ava can say today (every row that existed before this migration)
--   status 'pending'   Eli's suggestion, waiting on Jared. ALWAYS active = false
--   status 'declined'  Jared said no (kept so Eli sees why). ALWAYS active = false
--
-- Why a pending fact can never reach a call (belt and braces):
--   1. trigger ava_knowledge_guard forces active = false on every insert/update unless status = 'live'
--   2. every edge function that reads the table filters status = 'live' as well as active
--   3. partners have no table rights at all; they go through the SECURITY DEFINER functions below, which never
--      touch scope, active or status of a live fact
-- The admin-only RLS policy on the table is unchanged. Docs: docs/ava-knowledge.md.

-- 1. columns (existing rows pick up status 'live' from the default, which is the backfill)
alter table public.ava_knowledge
  add column if not exists status      text not null default 'live' check (status in ('live', 'pending', 'declined')),
  add column if not exists proposed_by uuid references auth.users (id) on delete set null,
  add column if not exists proposed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users (id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text;
create index if not exists ava_knowledge_status on public.ava_knowledge (status) where status <> 'live';

-- 2. the hard guard: only a live fact can be active
create or replace function public.ava_knowledge_guard() returns trigger language plpgsql as $$
begin
  if new.status is distinct from 'live' then new.active := false; end if;
  return new;
end $$;
drop trigger if exists ava_knowledge_guard on public.ava_knowledge;
create trigger ava_knowledge_guard before insert or update on public.ava_knowledge
  for each row execute function public.ava_knowledge_guard();

-- 3. who owns the alert (every notification belongs to an AI employee)
insert into public.notification_owners (prefix, agent_slug, note)
values ('rg:knowledge', 'partner-scout', 'Eli suggested a fact Ava can share')
on conflict (prefix) do nothing;

-- internal: close the alert once nothing is waiting. Not callable from the browser.
create or replace function public.ava_knowledge_resolve_if_clear() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.ava_knowledge where status = 'pending') then
    perform public.bestly_raise('rg:knowledge', 'resolved', 'info', 'Nothing waiting on you for Ava', 'Every suggested fact has an answer.', 'roofguard');
  end if;
exception when others then
  raise warning 'ava_knowledge_resolve_if_clear: %', sqlerrm;
end $$;
revoke all on function public.ava_knowledge_resolve_if_clear() from public, anon, authenticated;

-- 4. what Eli sees: every live RoofGuard fact (the ones Ava can actually say), then his own pending and declined items
create or replace function public.ava_knowledge_partner_list()
returns table (id uuid, topic text, fact text, status text, review_note text, proposed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select x.id, x.topic, x.fact, x.status, x.review_note, x.proposed_at
    from (
      select k.id, k.topic, k.fact, 'live'::text as status, null::text as review_note, null::timestamptz as proposed_at, 0 as grp
        from public.ava_knowledge k
       where k.scope in ('roofguard', 'both') and k.status = 'live' and k.active
      union all
      select k.id, k.topic, k.fact, k.status, k.review_note, k.proposed_at, 1 as grp
        from public.ava_knowledge k
       where k.proposed_by = auth.uid() and k.status in ('pending', 'declined')
    ) x
   where public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'partner')
   order by x.grp, case when x.grp = 0 then x.topic end, x.proposed_at desc nulls last
$$;

-- 5. Eli suggests a fact (new, or edits his own still-pending one)
create or replace function public.ava_knowledge_propose(p_topic text, p_fact text, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid   uuid := auth.uid();
  v_topic text := btrim(coalesce(p_topic, ''));
  v_fact  text := btrim(coalesce(p_fact, ''));
  v_id    uuid;
  v_name  text;
begin
  if v_uid is null or not public.has_role(v_uid, 'partner') then
    raise exception 'KNOWLEDGE: Sign in again to suggest something.';
  end if;
  if v_topic = '' then raise exception 'KNOWLEDGE: Add a topic.'; end if;
  if v_fact  = '' then raise exception 'KNOWLEDGE: Add what Ava can say.'; end if;
  if length(v_topic) > 60  then raise exception 'KNOWLEDGE: The topic is too long. Keep it under 60 characters.'; end if;
  if length(v_fact)  > 600 then raise exception 'KNOWLEDGE: That is too long. Keep it under 600 characters.'; end if;

  if p_id is not null then
    -- only his own row, only while it is still waiting; scope, active and status are never touched
    update public.ava_knowledge
       set topic = v_topic, fact = v_fact, proposed_at = now()
     where id = p_id and proposed_by = v_uid and status = 'pending' and scope = 'roofguard'
    returning id into v_id;
    if v_id is null then raise exception 'KNOWLEDGE: That suggestion can''t be changed any more.'; end if;
  else
    if (select count(*) from public.ava_knowledge where proposed_by = v_uid and status = 'pending') >= 20 then
      raise exception 'KNOWLEDGE: You have 20 suggestions waiting on Jared. Give him a chance to catch up.';
    end if;
    insert into public.ava_knowledge (scope, topic, fact, active, status, proposed_by, proposed_at)
    values ('roofguard', v_topic, v_fact, false, 'pending', v_uid, now())
    returning id into v_id;
  end if;

  begin
    select coalesce(nullif(split_part(btrim(coalesce(u.raw_user_meta_data ->> 'name', u.raw_user_meta_data ->> 'full_name', '')), ' ', 1), ''), 'Eli')
      into v_name from auth.users u where u.id = v_uid;
    perform public.bestly_raise('rg:knowledge', 'problem', 'info',
      coalesce(v_name, 'Eli') || ' suggested something Ava can say',
      v_topic || ' — ' || left(v_fact, 120) || case when length(v_fact) > 120 then '…' else '' end,
      'roofguard', 'Approve or decline it in RoofGuard > What Ava can share');
  exception when others then
    raise warning 'ava_knowledge_propose alert: %', sqlerrm;   -- the suggestion is saved either way
  end;
  return v_id;
end $$;

-- 6. Eli takes back his own pending suggestion
create or replace function public.ava_knowledge_withdraw(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_n int;
begin
  if v_uid is null or not public.has_role(v_uid, 'partner') then
    raise exception 'KNOWLEDGE: Sign in again to do that.';
  end if;
  delete from public.ava_knowledge where id = p_id and proposed_by = v_uid and status = 'pending';
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'KNOWLEDGE: That suggestion has already been answered.'; end if;
  perform public.ava_knowledge_resolve_if_clear();
end $$;

-- 7. Jared decides (admin only). Eli gets a push either way.
create or replace function public.ava_knowledge_review(p_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare k public.ava_knowledge; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not allowed'; end if;
  select * into k from public.ava_knowledge where id = p_id and status = 'pending' for update;
  if k.id is null then raise exception 'KNOWLEDGE: That one has already been answered.'; end if;

  if p_approve then
    update public.ava_knowledge
       set status = 'live', active = true, reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
     where id = p_id;
  else
    update public.ava_knowledge
       set status = 'declined', active = false, reviewed_by = auth.uid(), reviewed_at = now(), review_note = v_note
     where id = p_id;
  end if;

  if k.proposed_by is not null then
    begin
      perform public.push_web_send(
        case when p_approve then 'Ava can now say it' else 'Not added to what Ava says' end,
        case when p_approve then k.topic || ' is live.' else k.topic || coalesce(': ' || v_note, '. Jared decided not to add it.') end,
        'info', '/partner', 'partner-knowledge', 'partner', k.proposed_by);
    exception when others then
      raise warning 'ava_knowledge_review push: %', sqlerrm;
    end;
  end if;
  perform public.ava_knowledge_resolve_if_clear();
end $$;

-- 8. badge count (admin only)
create or replace function public.ava_knowledge_pending_count()
returns integer language plpgsql stable security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Not allowed'; end if;
  return (select count(*)::int from public.ava_knowledge where status = 'pending');
end $$;

-- every function re-checks the caller's role itself; signed-in users only
do $$
declare f text;
begin
  foreach f in array array[
    'ava_knowledge_partner_list()', 'ava_knowledge_propose(text, text, uuid)', 'ava_knowledge_withdraw(uuid)',
    'ava_knowledge_review(uuid, boolean, text)', 'ava_knowledge_pending_count()'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
