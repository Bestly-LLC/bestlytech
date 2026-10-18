-- Call debriefs (Lane S, 2026-10-18): Scout drafts a client's to-dos from a recorded call and Jared approves them before they reach her board.
-- Additive: a new table, new functions, one guard trigger on client_todos, and small text patches to five existing functions.
-- Rollback: the repo file supabase/rollbacks/20261018_call_debrief_backend.rollback.sql has the exact undo SQL. bestly_memory key build/call-debrief-2026-10-18/S has the steps in words and the S-orig-* keys hold the original function bodies.

-- ============================================================ 1. columns Lane M fills at ingest (idempotent)
alter table public.meeting_recordings add column if not exists client_slug text;
alter table public.meeting_recordings add column if not exists room text;

-- ============================================================ 2. the header: one row per client call
create table if not exists public.call_debriefs (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null unique references public.meeting_recordings(id) on delete cascade,
  client_id uuid not null references public.approval_clients(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'sent', 'dismissed')),
  remind_at timestamptz,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_by uuid,
  sent_count int not null default 0,
  last_sent_ids uuid[] not null default '{}',
  notified_at timestamptz,
  reminded_at timestamptz,
  dismissed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists call_debriefs_status_idx on public.call_debriefs (status, created_at desc);
alter table public.call_debriefs enable row level security;
do $do$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'call_debriefs' and policyname = 'call_debriefs_admin_read') then
    create policy call_debriefs_admin_read on public.call_debriefs for select to authenticated
      using (public.has_role(auth.uid(), 'admin'::public.app_role));
  end if;
end $do$;
revoke all on public.call_debriefs from public, anon, authenticated;
grant select on public.call_debriefs to authenticated;
grant all on public.call_debriefs to service_role;
do $do$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_debriefs') then
    alter publication supabase_realtime add table public.call_debriefs;
  end if;
end $do$;

-- ============================================================ 3. one draft per call to-do, and the guard
create unique index if not exists client_todos_call_sdid_uidx on public.client_todos ((source->>'scout_daily_id')) where source->>'kind' = 'call';

-- A call to-do starts as a draft and may leave 'draft' (or a removal made in the debrief) only inside call_debrief_send.
create or replace function public.trg_client_todo_call_guard() returns trigger
language plpgsql set search_path to 'public' as $fn$
begin
  if coalesce(current_setting('bestly.debrief_send', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if coalesce(new.source->>'kind', '') = 'call' and new.status not in ('draft', 'dropped') then
      raise exception 'a call to-do starts as a draft and reaches the client only through Send in the call debrief' using errcode = '42501', hint = 'call_debrief_send';
    end if;
    return new;
  end if;
  if (coalesce(old.source->>'kind', '') = 'call' or coalesce(new.source->>'kind', '') = 'call')
     and new.status in ('open', 'ours', 'done')
     and (old.status = 'draft' or (old.status = 'dropped' and old.source->>'held_by' = 'debrief')) then
    raise exception 'a call to-do reaches the client only through Send in the call debrief' using errcode = '42501', hint = 'call_debrief_send';
  end if;
  return new;
end $fn$;
create or replace trigger client_todos_call_guard before insert or update on public.client_todos
  for each row execute function public.trg_client_todo_call_guard();

-- ============================================================ 4. small helpers (internal)
create or replace function public.call_debrief_safe_date(p text) returns date
language plpgsql immutable set search_path to 'public' as $fn$
begin
  if p is null or p !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null; end if;
  return p::date;
exception when others then return null;
end $fn$;

create or replace function public.call_debrief_sec(p text) returns int
language sql immutable set search_path to 'public' as $fn$
  select case when p ~ '^[0-9]{1,3}:[0-9]{2}$' then split_part(p, ':', 1)::int * 60 + split_part(p, ':', 2)::int end
$fn$;

-- "5:30" and "0:05:30" both become "05:30", the form the transcript lines use
create or replace function public.call_debrief_at(p text) returns text
language sql immutable set search_path to 'public' as $fn$
  select case
    when p ~ '^[0-9]{1,3}:[0-9]{2}$' then lpad(split_part(p, ':', 1), 2, '0') || ':' || split_part(p, ':', 2)
    when p ~ '^[0-9]{1,2}:[0-9]{2}:[0-9]{2}$' then lpad((split_part(p, ':', 1)::int * 60 + split_part(p, ':', 2)::int)::text, 2, '0') || ':' || split_part(p, ':', 3)
  end
$fn$;

-- the transcript time of a commitment, looked up by its quote when the to-do row predates the ts field
create or replace function public.call_debrief_ts_for(p_summary jsonb, p_quote text) returns text
language sql stable set search_path to 'public' as $fn$
  select c->>'ts'
    from jsonb_array_elements(case when jsonb_typeof(p_summary->'commitments') = 'array' then p_summary->'commitments' else '[]'::jsonb end) c
   where coalesce(p_quote, '') <> '' and left(coalesce(c->>'quote', ''), 200) = p_quote
   limit 1
$fn$;

-- calls Scout finished before this shipped get no after-the-fact debrief and no alert
create or replace function public.call_debrief_live_since() returns timestamptz
language sql immutable set search_path to 'public' as $fn$
  select timestamptz '2026-10-18 00:00:00-07'
$fn$;

create or replace function public.call_debrief_t12(t timestamptz) returns text
language sql stable set search_path to 'public' as $fn$
  select to_char(t at time zone 'America/Los_Angeles', 'FMHH12:MI AM')
$fn$;

-- the name to use in text: her first name for a real client, the client's name for a sandbox
create or replace function public.call_debrief_person(c public.approval_clients) returns text
language sql stable set search_path to 'public' as $fn$
  select case when c.sandbox then c.name else initcap(coalesce(nullif(c.people[1], ''), c.name)) end
$fn$;

-- which client a recording belongs to: Lane M's client_slug, then its room, then exactly one real client sharing a person
create or replace function public.call_debrief_client(m public.meeting_recordings) returns public.approval_clients
language plpgsql stable security definer set search_path to 'public' as $fn$
declare c public.approval_clients; n int;
begin
  if m.client_slug is not null then
    select * into c from public.approval_clients a where a.slug = m.client_slug and a.active limit 1;
    if c.id is not null then return c; end if;
  end if;
  if m.room is not null then
    select * into c from public.approval_clients a where a.talk_room = m.room and a.active limit 1;
    if c.id is not null then return c; end if;
  end if;
  select count(*) into n from public.approval_clients a
   where a.active and a.kind = 'client' and not a.sandbox and coalesce(a.people, '{}'::text[]) && coalesce(m.people, '{}'::text[]);
  if n = 1 then
    select * into c from public.approval_clients a
     where a.active and a.kind = 'client' and not a.sandbox and coalesce(a.people, '{}'::text[]) && coalesce(m.people, '{}'::text[]) limit 1;
    return c;
  end if;
  return null;
end $fn$;

-- how much of the call's length the transcript spans (last [mm:ss] line / call length), 0 to 100
create or replace function public.call_debrief_coverage(m public.meeting_recordings) returns int
language plpgsql stable set search_path to 'public' as $fn$
declare v_last int; v_len int;
begin
  if m.started_at is null or m.stopped_at is null or m.transcript is null then return null; end if;
  v_len := extract(epoch from (m.stopped_at - m.started_at))::int;
  if v_len <= 0 then return null; end if;
  select max(split_part(x[1], ':', 1)::int * 60 + split_part(x[1], ':', 2)::int) into v_last
    from regexp_matches(m.transcript, '^\[([0-9]+:[0-9]{2})\] ', 'gm') x;
  if v_last is null then return null; end if;
  return least(100, round(100.0 * v_last / v_len))::int;
end $fn$;

create or replace function public.call_debrief_item_json(t public.client_todos) returns jsonb
language sql stable set search_path to 'public' as $fn$
  select jsonb_build_object('id', t.id, 'title', t.title, 'detail', t.detail, 'due', t.due,
                            'quote', t.source->>'quote', 'at', t.source->>'at', 'status', t.status)
$fn$;

-- ============================================================ 5. scout-daily's last step: draft her to-dos, make the header, send ONE Scout push
create or replace function public.call_debrief_create(p_meeting uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  m public.meeting_recordings; c public.approval_clients; d public.call_debriefs;
  v_her text[]; v_person text; v_label text; v_today date := (now() at time zone 'America/Los_Angeles')::date;
  sd record; v_due date; v_due_said boolean; v_at text;
  v_cand int := 0; v_new int := 0; v_drafts int := 0; v_team int := 0;
  v_created boolean := false; v_res jsonb; v_channel text := null;
  v_title text; v_body text; v_dedupe text;
begin
  select * into m from public.meeting_recordings where id = p_meeting;
  if m.id is null then return jsonb_build_object('ok', false, 'error', 'no_meeting'); end if;
  c := public.call_debrief_client(m);
  if c.id is null then return jsonb_build_object('ok', true, 'client', false); end if;

  perform pg_advisory_xact_lock(hashtextextended('call_debrief:' || p_meeting::text, 0));

  select * into d from public.call_debriefs where meeting_id = m.id;
  if d.id is not null and d.client_id <> c.id then
    select * into c from public.approval_clients where id = d.client_id;   -- a header already exists: stay with its client
  end if;
  v_her := coalesce((select array_agg(lower(p)) from unnest(coalesce(c.people, '{}'::text[])) p), '{}'::text[]);
  v_person := public.call_debrief_person(c);
  v_label := 'From your call on ' || to_char(coalesce(m.started_at, m.created_at) at time zone 'America/Los_Angeles', 'FMDy, FMMon FMDD');

  -- her to-dos not yet in client_todos (a removed or sent one still has its row, so it is never made twice)
  select count(*) into v_cand from public.scout_daily s
   where s.kind = 'call' and s.source_key like 'call:' || m.id::text || ':%' and s.status in ('open', 'done', 'snoozed', 'handed')
     and length(btrim(coalesce(s.title, ''))) >= 3
     and lower(coalesce(s.action->>'owner', '')) = any (v_her)
     and not exists (select 1 from public.client_todos t where t.source->>'kind' = 'call' and t.source->>'scout_daily_id' = s.id::text);

  if d.id is null then
    insert into public.call_debriefs (meeting_id, client_id, status, dismissed_at)
    values (m.id, c.id, case when v_cand > 0 then 'pending' else 'dismissed' end, case when v_cand > 0 then null else now() end)
    returning * into d;
    v_created := true;
  end if;

  for sd in
    select s.id, s.title, s.action from public.scout_daily s
     where s.kind = 'call' and s.source_key like 'call:' || m.id::text || ':%' and s.status in ('open', 'done', 'snoozed', 'handed')
       and length(btrim(coalesce(s.title, ''))) >= 3
       and lower(coalesce(s.action->>'owner', '')) = any (v_her)
       and not exists (select 1 from public.client_todos t where t.source->>'kind' = 'call' and t.source->>'scout_daily_id' = s.id::text)
     order by s.created_at, s.id
  loop
    v_due := public.call_debrief_safe_date(sd.action->>'due');
    v_due_said := v_due is not null;
    v_due := coalesce(v_due, v_today + 7);
    v_at := public.call_debrief_at(coalesce(nullif(sd.action->>'ts', ''), public.call_debrief_ts_for(m.summary, sd.action->>'quote')));
    begin
      insert into public.client_todos (client_id, title, due, status, source)
      values (c.id, left(btrim(sd.title), 200), v_due, 'draft',
              jsonb_build_object('kind', 'call', 'meeting', m.name, 'meeting_id', m.id, 'quote', nullif(sd.action->>'quote', ''), 'at', v_at,
                                 'label', v_label, 'scout_daily_id', sd.id, 'debrief_id', d.id, 'due_said', v_due_said));
      v_new := v_new + 1;
    exception when unique_violation then null;
    end;
  end loop;

  select count(*) filter (where t.status = 'draft')::int into v_drafts
    from public.client_todos t where t.source->>'kind' = 'call' and t.source->>'debrief_id' = d.id::text;
  select count(*)::int into v_team from public.scout_daily s
   where s.kind = 'call' and s.source_key like 'call:' || m.id::text || ':%' and s.status = 'open'
     and not (lower(coalesce(s.action->>'owner', '')) = any (v_her));

  -- a re-run that finds new to-dos puts a closed or sent debrief back in front of Jared
  if v_new > 0 and d.status <> 'pending' then
    update public.call_debriefs set status = 'pending', dismissed_at = null, updated_at = now() where id = d.id returning * into d;
  end if;

  if v_new > 0 then
    v_dedupe := 'scout.debrief.' || d.id::text || case when v_created then '' else '.more.' || to_char(now(), 'YYYYMMDDHH24MI') end;
    v_title := format('Your call with %s is ready to review: %s for her list', v_person,
                      case when v_drafts = 1 then '1 thing' else v_drafts::text || ' things' end);
    -- "ready for your ok" is true here (her to-dos wait for his OK) and is how interrupt_class() knows a person is waiting on him
    v_body := format('%s''s to-dos from the %s call are ready for your ok. Nothing reaches her board until you press Send.%s',
                     v_person, public.call_debrief_t12(coalesce(m.started_at, m.created_at)),
                     case when v_team > 0 then format(' Also %s for you and the team.', v_team) else '' end);
    begin
      v_res := public.scout_notify(p_title => v_title, p_body => v_body, p_severity => 'info', p_push => true,
                                   p_url => '/admin?debrief=' || d.id::text, p_dedupe => v_dedupe);
      v_channel := v_res->>'channel';
      if v_channel in ('ha', 'web') or coalesce((v_res->>'duplicate')::boolean, false) then
        update public.call_debriefs set notified_at = now(), updated_at = now() where id = d.id returning * into d;
      end if;
    exception when others then
      v_channel := 'error';
    end;
  end if;

  return jsonb_build_object('ok', true, 'client', true, 'debrief_id', d.id, 'client_slug', c.slug, 'person', v_person,
                            'created', v_created, 'status', d.status, 'new_drafts', v_new, 'drafts', v_drafts, 'team', v_team,
                            'notified', d.notified_at is not null, 'channel', v_channel);
end $fn$;

-- ============================================================ 6. the ten admin RPCs
create or replace function public.call_debrief_list() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
begin
  perform public.admin_require_admin();
  return jsonb_build_object('ok', true, 'debriefs', coalesce((
    select jsonb_agg(x.j order by x.pend desc, x.created_at desc)
      from (
        select (d.status = 'pending') as pend, d.created_at,
               jsonb_build_object(
                 'id', d.id, 'status', d.status,
                 'client_slug', c.slug, 'client_name', c.name, 'person', public.call_debrief_person(c), 'sandbox', c.sandbox,
                 'meeting_id', m.id, 'meeting_name', m.name, 'started_at', m.started_at, 'stopped_at', m.stopped_at,
                 'duration_min', case when m.started_at is not null and m.stopped_at is not null then round(extract(epoch from (m.stopped_at - m.started_at)) / 60)::int end,
                 'coverage', public.call_debrief_coverage(m),
                 'her_count', k.live, 'draft_count', k.drafts, 'sent_count', k.sent, 'team_count', tc.n,
                 'created_at', d.created_at, 'remind_at', d.remind_at, 'sent_at', d.sent_at) as j
          from public.call_debriefs d
          join public.approval_clients c on c.id = d.client_id
          join public.meeting_recordings m on m.id = d.meeting_id
          cross join lateral (
            select count(*) filter (where t.status in ('draft', 'open', 'ours', 'done'))::int as live,
                   count(*) filter (where t.status = 'draft')::int as drafts,
                   count(*) filter (where t.status in ('open', 'ours', 'done'))::int as sent
              from public.client_todos t where t.source->>'kind' = 'call' and t.source->>'debrief_id' = d.id::text) k
          cross join lateral (
            select count(*)::int as n from public.scout_daily s
             where s.kind = 'call' and s.source_key like 'call:' || m.id::text || ':%' and s.status = 'open'
               and not (lower(coalesce(s.action->>'owner', '')) = any (select lower(p) from unnest(coalesce(c.people, '{}'::text[])) p))) tc
         where d.status = 'pending' or d.created_at > now() - interval '14 days'
         order by (d.status = 'pending') desc, d.created_at desc
         limit 50) x), '[]'::jsonb));
end $fn$;

create or replace function public.call_debrief_get(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $fn$
declare
  d public.call_debriefs; m public.meeting_recordings; c public.approval_clients;
  v_her text[]; v_can_undo boolean := false; v_summary jsonb;
begin
  perform public.admin_require_admin();
  select * into d from public.call_debriefs where id = p_id;
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  select * into m from public.meeting_recordings where id = d.meeting_id;
  select * into c from public.approval_clients where id = d.client_id;
  v_her := coalesce((select array_agg(lower(p)) from unnest(coalesce(c.people, '{}'::text[])) p), '{}'::text[]);
  if d.sent_at is not null and now() - d.sent_at <= interval '10 minutes' then
    v_can_undo := exists (select 1 from public.client_todos t
                           where t.id = any (d.last_sent_ids) and t.status = 'open'
                             and t.due is not distinct from nullif(t.source->>'sent_due', '')::date
                             and coalesce(t.forward - 'links', '{}'::jsonb) = '{}'::jsonb);
  end if;
  v_summary := case when m.summary is null then null else m.summary - 'parts' end;
  return jsonb_build_object(
    'ok', true,
    'header', jsonb_build_object(
      'id', d.id, 'status', d.status, 'client_slug', c.slug, 'client_name', c.name, 'person', public.call_debrief_person(c), 'sandbox', c.sandbox,
      'meeting_id', m.id, 'meeting_name', m.name, 'started_at', m.started_at, 'stopped_at', m.stopped_at,
      'duration_min', case when m.started_at is not null and m.stopped_at is not null then round(extract(epoch from (m.stopped_at - m.started_at)) / 60)::int end,
      'coverage', public.call_debrief_coverage(m), 'people', to_jsonb(coalesce(m.people, '{}'::text[])),
      'created_at', d.created_at, 'remind_at', d.remind_at, 'snoozed', (d.remind_at is not null and d.remind_at > now()),
      'sent_at', d.sent_at, 'sent_by', d.sent_by, 'sent_count', d.sent_count,
      'can_undo', v_can_undo, 'undo_until', case when v_can_undo then d.sent_at + interval '10 minutes' end),
    'summary', v_summary,
    'summary_text', v_summary->>'summary',
    'her_items', coalesce((
      select jsonb_agg(public.call_debrief_item_json(t) || jsonb_build_object(
                'scout_daily_id', t.source->>'scout_daily_id', 'due_said', coalesce((t.source->>'due_said')::boolean, true),
                'edited', t.source ? 'edited_at', 'sent_at', t.source->>'sent_at')
             order by public.call_debrief_sec(t.source->>'at') nulls last, t.created_at, t.id)
        from public.client_todos t
       where t.source->>'kind' = 'call' and t.source->>'debrief_id' = d.id::text
         and not (t.status = 'dropped' and t.source->>'held_reason' = 'moved_to_team')), '[]'::jsonb),
    'team_items', coalesce((
      select jsonb_agg(jsonb_build_object(
                'scout_daily_id', s.id, 'owner', s.action->>'owner', 'title', s.title, 'due', s.action->>'due', 'quote', s.action->>'quote',
                'at', public.call_debrief_at(coalesce(nullif(s.action->>'ts', ''), public.call_debrief_ts_for(m.summary, s.action->>'quote'))),
                'status', s.status, 'deck_url', s.action->>'deck_url')
             order by public.call_debrief_sec(public.call_debrief_at(coalesce(nullif(s.action->>'ts', ''), public.call_debrief_ts_for(m.summary, s.action->>'quote')))) nulls last,
                      s.created_at, s.id)
        from public.scout_daily s
       where s.kind = 'call' and s.source_key like 'call:' || m.id::text || ':%' and s.status = 'open'
         and not (lower(coalesce(s.action->>'owner', '')) = any (v_her))), '[]'::jsonb),
    'transcript_available', length(coalesce(m.transcript, '')) > 0);
end $fn$;

create or replace function public.call_debrief_item_update(p_item uuid, p_title text, p_detail text, p_due date) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare t public.client_todos; v_title text; v_detail text; v_slug text;
begin
  perform public.admin_require_admin();
  select * into t from public.client_todos where id = p_item and source->>'kind' = 'call' for update;
  if t.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if t.status <> 'draft' then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;
  if p_title is not null then
    v_title := btrim(regexp_replace(p_title, '\s+', ' ', 'g'));
    if length(v_title) < 3 then return jsonb_build_object('ok', false, 'error', 'title_too_short'); end if;
    if length(v_title) > 200 then return jsonb_build_object('ok', false, 'error', 'title_too_long'); end if;
  end if;
  if p_detail is not null then
    v_detail := btrim(p_detail);
    if length(v_detail) > 1000 then return jsonb_build_object('ok', false, 'error', 'detail_too_long'); end if;
    if v_detail = '' then v_detail := null; end if;
  end if;
  update public.client_todos
     set title = coalesce(v_title, title),
         detail = case when p_detail is null then detail else v_detail end,
         due = coalesce(p_due, due),
         source = source || jsonb_build_object('edited', true, 'edited_at', now())
   where id = t.id returning * into t;
  select slug into v_slug from public.approval_clients where id = t.client_id;
  perform public.call_board_audit('admin:' || auth.uid()::text, 'debrief_item_update', v_slug, true,
    format('Edited the to-do "%s" at %s', left(t.title, 120), public.call_debrief_t12(now())));
  return jsonb_build_object('ok', true, 'item', public.call_debrief_item_json(t));
end $fn$;

create or replace function public.call_debrief_item_remove(p_item uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare t public.client_todos; v_slug text; v_drafts int;
begin
  perform public.admin_require_admin();
  select * into t from public.client_todos where id = p_item and source->>'kind' = 'call' for update;
  if t.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if t.status <> 'draft' then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;
  update public.client_todos
     set status = 'dropped',
         source = source || jsonb_build_object('held_by', 'debrief', 'held_reason', 'removed', 'held_at', now())
   where id = t.id;
  select count(*)::int into v_drafts from public.client_todos x
   where x.source->>'kind' = 'call' and x.source->>'debrief_id' = t.source->>'debrief_id' and x.status = 'draft';
  select slug into v_slug from public.approval_clients where id = t.client_id;
  perform public.call_board_audit('admin:' || auth.uid()::text, 'debrief_item_remove', v_slug, true,
    format('Removed the to-do "%s" at %s', left(t.title, 120), public.call_debrief_t12(now())));
  return jsonb_build_object('ok', true, 'item', jsonb_build_object('id', t.id, 'status', 'dropped'), 'draft_count', v_drafts);
end $fn$;

create or replace function public.call_debrief_item_restore(p_item uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare t public.client_todos; v_slug text; v_drafts int;
begin
  perform public.admin_require_admin();
  select * into t from public.client_todos where id = p_item and source->>'kind' = 'call' for update;
  if t.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if t.status <> 'dropped' or t.source->>'held_by' is distinct from 'debrief' or t.source->>'held_reason' is distinct from 'removed' then
    return jsonb_build_object('ok', false, 'error', 'not_removed');
  end if;
  update public.client_todos
     set status = 'draft', source = source - 'held_by' - 'held_reason' - 'held_at'
   where id = t.id returning * into t;
  select count(*)::int into v_drafts from public.client_todos x
   where x.source->>'kind' = 'call' and x.source->>'debrief_id' = t.source->>'debrief_id' and x.status = 'draft';
  select slug into v_slug from public.approval_clients where id = t.client_id;
  perform public.call_board_audit('admin:' || auth.uid()::text, 'debrief_item_restore', v_slug, true,
    format('Put the to-do "%s" back at %s', left(t.title, 120), public.call_debrief_t12(now())));
  return jsonb_build_object('ok', true, 'item', public.call_debrief_item_json(t), 'draft_count', v_drafts);
end $fn$;

-- p_item is her draft (client_todos.id) or a team to-do (scout_daily.id). p_to is a team first name, or 'her' / her first name.
create or replace function public.call_debrief_move_owner(p_item uuid, p_to text) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  t public.client_todos; s public.scout_daily; d public.call_debriefs; c public.approval_clients; m public.meeting_recordings;
  v_to text := btrim(coalesce(p_to, '')); v_her text[]; v_to_her boolean; v_name text; v_sd_her boolean;
  v_mid uuid; v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_due date; v_due_said boolean; v_at text; v_label text; v_hername text; v_slug text; v_moved text; v_owner text; v_team jsonb;
begin
  perform public.admin_require_admin();

  select * into t from public.client_todos where id = p_item and source->>'kind' = 'call' for update;
  if t.id is not null then
    if t.source->>'scout_daily_id' ~ '^[0-9a-f-]{36}$' then
      select * into s from public.scout_daily where id = (t.source->>'scout_daily_id')::uuid and kind = 'call';
    end if;
    select * into d from public.call_debriefs where id = (case when t.source->>'debrief_id' ~ '^[0-9a-f-]{36}$' then (t.source->>'debrief_id')::uuid end);
  else
    select * into s from public.scout_daily where id = p_item and kind = 'call';
    if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    v_mid := case when s.action->>'meeting_id' ~ '^[0-9a-f-]{36}$' then (s.action->>'meeting_id')::uuid end;
    select * into d from public.call_debriefs where meeting_id = v_mid;
    if d.id is not null then
      select * into t from public.client_todos x where x.source->>'kind' = 'call' and x.source->>'scout_daily_id' = s.id::text for update;
    end if;
  end if;
  if d.id is null or s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  select * into c from public.approval_clients where id = d.client_id;
  select * into m from public.meeting_recordings where id = d.meeting_id;
  select slug into v_slug from public.approval_clients where id = c.id;
  v_her := coalesce((select array_agg(lower(p)) from unnest(coalesce(c.people, '{}'::text[])) p), '{}'::text[]);
  v_hername := initcap(coalesce(nullif(c.people[1], ''), 'her'));
  v_sd_her := lower(coalesce(s.action->>'owner', '')) = any (v_her);

  v_to_her := lower(v_to) in ('her', 'she') or lower(v_to) = any (v_her);
  if not v_to_her then
    select p.name into v_name from public.todo_people p
     where lower(p.name) = lower(v_to) or lower(v_to) = any (select lower(a) from unnest(p.aliases) a) limit 1;
    if v_name is null then return jsonb_build_object('ok', false, 'error', 'unknown_owner'); end if;
    if lower(v_name) = any (v_her) then v_to_her := true; end if;
  end if;

  if v_sd_her and v_to_her then return jsonb_build_object('ok', false, 'error', 'same_owner'); end if;

  if v_sd_her and not v_to_her then
    -- her draft -> the team
    if t.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
    if t.status <> 'draft' then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;
    update public.client_todos
       set status = 'dropped', source = source || jsonb_build_object('held_by', 'debrief', 'held_reason', 'moved_to_team', 'held_at', now(), 'moved_to', v_name)
     where id = t.id;
    perform public.todo_set_owner(s.id, v_name);
    v_moved := 'to_team'; v_owner := v_name;
  elsif not v_sd_her and v_to_her then
    -- a team to-do -> her list, as a draft
    if t.id is not null and t.status not in ('draft', 'dropped') then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;
    if t.id is not null then
      update public.client_todos
         set status = 'draft', source = (source - 'held_by' - 'held_reason' - 'held_at' - 'moved_to')
       where id = t.id returning * into t;
    else
      v_due := public.call_debrief_safe_date(s.action->>'due');
      v_due_said := v_due is not null;
      v_due := coalesce(v_due, v_today + 7);
      v_at := public.call_debrief_at(coalesce(nullif(s.action->>'ts', ''), public.call_debrief_ts_for(m.summary, s.action->>'quote')));
      v_label := 'From your call on ' || to_char(coalesce(m.started_at, m.created_at) at time zone 'America/Los_Angeles', 'FMDy, FMMon FMDD');
      insert into public.client_todos (client_id, title, due, status, source)
      values (c.id, left(btrim(s.title), 200), v_due, 'draft',
              jsonb_build_object('kind', 'call', 'meeting', m.name, 'meeting_id', m.id, 'quote', nullif(s.action->>'quote', ''), 'at', v_at,
                                 'label', v_label, 'scout_daily_id', s.id, 'debrief_id', d.id, 'due_said', v_due_said))
      returning * into t;
    end if;
    perform public.todo_set_owner(s.id, v_hername);
    -- a closed debrief with a new draft goes back in front of Jared
    update public.call_debriefs set status = 'pending', dismissed_at = null, updated_at = now() where id = d.id and status = 'dismissed';
    v_moved := 'to_her'; v_owner := v_hername;
  else
    -- team -> another team member
    if lower(coalesce(s.action->>'owner', '')) = lower(v_name) then return jsonb_build_object('ok', false, 'error', 'same_owner'); end if;
    perform public.todo_set_owner(s.id, v_name);
    v_moved := 'team_to_team'; v_owner := v_name;
  end if;

  select * into s from public.scout_daily where id = s.id;
  v_team := case when v_moved = 'to_her' then null else jsonb_build_object(
              'scout_daily_id', s.id, 'owner', s.action->>'owner', 'title', s.title, 'due', s.action->>'due', 'quote', s.action->>'quote') end;
  perform public.call_board_audit('admin:' || auth.uid()::text, 'debrief_move_owner', v_slug, true,
    format('Moved the to-do "%s" (%s) to %s at %s', left(s.title, 100), v_moved, v_owner, public.call_debrief_t12(now())));
  return jsonb_build_object('ok', true, 'moved', v_moved, 'owner', v_owner,
                            'her_item', case when v_moved = 'to_her' then public.call_debrief_item_json(t) else null end,
                            'team_item', v_team);
end $fn$;

create or replace function public.call_debrief_send(p_id uuid, p_items uuid[]) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  d public.call_debriefs; c public.approval_clients; v_today date := (now() at time zone 'America/Los_Angeles')::date;
  v_now timestamptz := now(); v_ids uuid[]; v_skipped jsonb; v_sent_total int; v_left int;
begin
  perform public.admin_require_admin();
  select * into d from public.call_debriefs where id = p_id for update;
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_items is null or coalesce(array_length(p_items, 1), 0) = 0 then return jsonb_build_object('ok', false, 'error', 'nothing_selected'); end if;
  select * into c from public.approval_clients where id = d.client_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', u.id,
           'reason', case when t.id is null or t.source->>'debrief_id' is distinct from d.id::text then 'not_in_debrief' else 'not_draft' end)), '[]'::jsonb)
    into v_skipped
    from (select distinct x as id from unnest(p_items) x) u
    left join public.client_todos t on t.id = u.id and t.source->>'kind' = 'call'
   where not (t.id is not null and t.source->>'debrief_id' = d.id::text and t.status = 'draft');

  perform set_config('bestly.debrief_send', 'on', true);
  with sent as (
    update public.client_todos t
       set status = 'open',
           due = greatest(coalesce(t.due, v_today + 7), v_today),
           source = t.source || jsonb_build_object('sent_at', v_now, 'sent_by', auth.uid(), 'draft_due', t.due,
                                                   'sent_due', greatest(coalesce(t.due, v_today + 7), v_today))
     where t.id = any (p_items) and t.status = 'draft' and t.source->>'kind' = 'call' and t.source->>'debrief_id' = d.id::text
    returning t.id)
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from sent;
  perform set_config('bestly.debrief_send', '', true);

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'nothing_sent', 'skipped', v_skipped);
  end if;

  select count(*) filter (where status in ('open', 'ours', 'done'))::int, count(*) filter (where status = 'draft')::int
    into v_sent_total, v_left
    from public.client_todos where source->>'kind' = 'call' and source->>'debrief_id' = d.id::text;
  update public.call_debriefs
     set status = 'sent', sent_at = v_now, sent_by = auth.uid(), sent_count = v_sent_total, last_sent_ids = v_ids,
         remind_at = null, dismissed_at = null, updated_at = v_now
   where id = d.id;
  perform public.call_board_audit('admin:' || auth.uid()::text, 'debrief_send', c.slug, true,
    format('Sent %s of %s to-dos to %s''s board at %s Pacific', array_length(v_ids, 1), array_length(v_ids, 1) + v_left,
           public.call_debrief_person(c), public.call_debrief_t12(v_now)));
  return jsonb_build_object('ok', true, 'sent', array_length(v_ids, 1), 'ids', to_jsonb(v_ids), 'skipped', v_skipped,
                            'sent_at', v_now, 'undo_until', v_now + interval '10 minutes');
end $fn$;

create or replace function public.call_debrief_undo_send(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare d public.call_debriefs; c public.approval_clients; v_ids uuid[]; v_undone int; v_touched int; v_sent_total int; v_status text;
begin
  perform public.admin_require_admin();
  select * into d from public.call_debriefs where id = p_id for update;
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if d.sent_at is null or coalesce(array_length(d.last_sent_ids, 1), 0) = 0 then return jsonb_build_object('ok', false, 'error', 'nothing_to_undo'); end if;
  if now() - d.sent_at > interval '10 minutes' then return jsonb_build_object('ok', false, 'error', 'too_late'); end if;
  select * into c from public.approval_clients where id = d.client_id;

  with u as (
    update public.client_todos t
       set status = 'draft',
           due = coalesce(nullif(t.source->>'draft_due', '')::date, t.due),
           source = t.source - 'sent_at' - 'sent_by' - 'sent_due' - 'draft_due'
     where t.id = any (d.last_sent_ids) and t.status = 'open'
       and t.due is not distinct from nullif(t.source->>'sent_due', '')::date
       and coalesce(t.forward - 'links', '{}'::jsonb) = '{}'::jsonb
    returning t.id)
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from u;
  v_undone := coalesce(array_length(v_ids, 1), 0);
  if v_undone = 0 then return jsonb_build_object('ok', false, 'error', 'nothing_to_undo'); end if;
  v_touched := array_length(d.last_sent_ids, 1) - v_undone;

  select count(*) filter (where status in ('open', 'ours', 'done'))::int into v_sent_total
    from public.client_todos where source->>'kind' = 'call' and source->>'debrief_id' = d.id::text;
  v_status := case when v_sent_total > 0 then 'sent' else 'pending' end;
  update public.call_debriefs
     set status = v_status, sent_count = v_sent_total,
         last_sent_ids = coalesce((select array_agg(x) from unnest(d.last_sent_ids) x where x <> all (v_ids)), '{}'::uuid[]),
         sent_at = case when v_sent_total > 0 then d.sent_at else null end,
         sent_by = case when v_sent_total > 0 then d.sent_by else null end,
         updated_at = now()
   where id = d.id;
  perform public.call_board_audit('admin:' || auth.uid()::text, 'debrief_undo_send', c.slug, true,
    format('Took %s to-dos back from %s''s board at %s Pacific (%s she or the team had already touched)', v_undone,
           public.call_debrief_person(c), public.call_debrief_t12(now()), v_touched));
  return jsonb_build_object('ok', true, 'undone', v_undone, 'touched', v_touched, 'status', v_status);
end $fn$;

create or replace function public.call_debrief_snooze(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare d public.call_debriefs; c public.approval_clients; v_at timestamptz;
begin
  perform public.admin_require_admin();
  select * into d from public.call_debriefs where id = p_id for update;
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'not_pending'); end if;
  select * into c from public.approval_clients where id = d.client_id;
  v_at := now() + interval '1 hour';
  update public.call_debriefs set remind_at = v_at, updated_at = now() where id = d.id;
  perform public.call_board_audit('admin:' || auth.uid()::text, 'debrief_snooze', c.slug, true,
    format('Not now: Scout will remind Jared at %s Pacific', public.call_debrief_t12(v_at)));
  return jsonb_build_object('ok', true, 'remind_at', v_at);
end $fn$;

create or replace function public.call_debrief_dismiss(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare d public.call_debriefs; c public.approval_clients;
begin
  perform public.admin_require_admin();
  select * into d from public.call_debriefs where id = p_id for update;
  if d.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if d.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'not_pending'); end if;
  select * into c from public.approval_clients where id = d.client_id;
  update public.call_debriefs set status = 'dismissed', dismissed_at = now(), remind_at = null, updated_at = now() where id = d.id;
  perform public.call_board_audit('admin:' || auth.uid()::text, 'debrief_dismiss', c.slug, true,
    format('Dismissed the debrief at %s Pacific; its drafts stay drafts', public.call_debrief_t12(now())));
  return jsonb_build_object('ok', true, 'status', 'dismissed');
end $fn$;

-- ============================================================ 7. the watchdog (owner Studio Watch, alerts signed by it; reminders are Scout's)
create or replace function public.call_debrief_watch() returns jsonb
language plpgsql security definer set search_path to 'public' as $fn$
declare
  r record; c public.approval_clients; v_n int; v_person text; v_key text; v_mid uuid; v_why text;
  v_healed int := 0; v_snooze int := 0; v_remind int := 0; v_alerts int := 0; v_resolved int := 0;
begin
  -- A. heal: Scout finished the call but the debrief step did not land (a failed call, or a call finished before this shipped)
  for r in
    select x.id from public.meeting_recordings x
     where x.tasks_at is not null and x.tasks_at < now() - interval '10 minutes' and x.created_at > now() - interval '3 days'
       and x.created_at >= public.call_debrief_live_since()
       and x.summary->>'status' = 'done'
       and not exists (select 1 from public.call_debriefs d where d.meeting_id = x.id)
       and (public.call_debrief_client(x)).id is not null
  loop
    begin
      perform public.call_debrief_create(r.id);
      v_healed := v_healed + 1;
    exception when others then null;
    end;
  end loop;

  -- B. Not now has run out: ask again
  for r in select * from public.call_debriefs d where d.status = 'pending' and d.remind_at is not null and d.remind_at <= now() loop
    select * into c from public.approval_clients where id = r.client_id;
    v_person := public.call_debrief_person(c);
    select count(*)::int into v_n from public.client_todos t where t.source->>'kind' = 'call' and t.source->>'debrief_id' = r.id::text and t.status = 'draft';
    if v_n > 0 then
      perform public.scout_notify(
        p_title => format('Your call with %s is still waiting: %s for her list', v_person, case when v_n = 1 then '1 thing' else v_n::text || ' things' end),
        p_body => format('%s''s to-dos are still ready for your ok. Nothing reaches her board until you press Send.', v_person),
        p_severity => 'info', p_push => true, p_url => '/admin?debrief=' || r.id::text,
        p_dedupe => 'scout.debrief.' || r.id::text || '.snooze.' || to_char(r.remind_at, 'YYYYMMDDHH24MISS'));
      v_snooze := v_snooze + 1;
    end if;
    update public.call_debriefs set remind_at = null, notified_at = now(), updated_at = now() where id = r.id;
  end loop;

  -- C. still pending four hours after the last nudge: one reminder, once
  for r in
    select * from public.call_debriefs d
     where d.status = 'pending' and d.reminded_at is null and d.remind_at is null
       and coalesce(d.notified_at, d.created_at) < now() - interval '4 hours'
  loop
    select * into c from public.approval_clients where id = r.client_id;
    v_person := public.call_debrief_person(c);
    select count(*)::int into v_n from public.client_todos t where t.source->>'kind' = 'call' and t.source->>'debrief_id' = r.id::text and t.status = 'draft';
    if v_n > 0 then
      perform public.scout_notify(
        p_title => format('Still waiting on you: %s for %s''s list', case when v_n = 1 then '1 thing' else v_n::text || ' things' end, v_person),
        p_body => format('%s''s to-dos from her call are still ready for your ok. Nothing reaches her board until you press Send.', v_person),
        p_severity => 'info', p_push => true, p_url => '/admin?debrief=' || r.id::text,
        p_dedupe => 'scout.debrief.' || r.id::text || '.remind');
      v_remind := v_remind + 1;
      update public.call_debriefs set reminded_at = now(), notified_at = now(), updated_at = now() where id = r.id;
    end if;
  end loop;

  -- D. a client call has a transcript and, an hour later, still no debrief: alert (Studio Watch signs it)
  for r in
    select x.id, x.name, x.created_at, x.summary from public.meeting_recordings x
     where length(coalesce(x.transcript, '')) >= 400 and x.created_at < now() - interval '60 minutes' and x.created_at > now() - interval '3 days'
       and x.created_at >= public.call_debrief_live_since()
       and not exists (select 1 from public.call_debriefs d where d.meeting_id = x.id)
       and (public.call_debrief_client(x)).id is not null
  loop
    v_why := coalesce(nullif(left(coalesce(r.summary->>'last_error', ''), 200), ''),
                      case when r.summary->>'status' = 'done' then 'the summary finished but the debrief step did not' else 'the summary has not finished' end);
    perform public.bestly_raise('studio:call-debrief:' || r.id::text, 'problem', 'warning',
      format('No debrief yet for the %s call', public.call_debrief_t12(r.created_at)),
      format('The recording %s saved its transcript at %s Pacific and has no debrief an hour later. Scout writes the debrief as soon as a transcript lands and retries every 20 minutes. Why: %s.',
             r.name, public.call_debrief_t12(r.created_at), v_why),
      'studio', format('Ask Scout to run the debrief for %s', r.name));
    v_alerts := v_alerts + 1;
  end loop;

  -- close the alerts whose call now has a debrief (or has aged out)
  for r in select i.key from public.monitor_issues i where i.key like 'studio:call-debrief:%' and i.status = 'open' loop
    v_mid := case when substr(r.key, 21) ~ '^[0-9a-f-]{36}$' then substr(r.key, 21)::uuid end;
    if v_mid is null
       or exists (select 1 from public.call_debriefs d where d.meeting_id = v_mid)
       or not exists (select 1 from public.meeting_recordings x where x.id = v_mid and x.created_at > now() - interval '3 days') then
      perform public.bestly_raise(r.key, 'resolved', 'info', 'The call debrief is ready');
      v_resolved := v_resolved + 1;
    end if;
  end loop;

  if exists (select 1 from public.monitor_issues where key = 'studio:call-debrief-watch' and status = 'open') then
    perform public.bestly_raise('studio:call-debrief-watch', 'resolved', 'info', 'The call debrief check is working again');
  end if;
  return jsonb_build_object('ok', true, 'healed', v_healed, 'snooze_reminders', v_snooze, 'four_hour_reminders', v_remind, 'alerts', v_alerts, 'resolved', v_resolved);
exception when others then
  begin
    perform public.bestly_raise('studio:call-debrief-watch', 'problem', 'warning', 'The call debrief check broke',
      'call_debrief_watch failed: ' || left(sqlerrm, 300) || '. A call could finish without Jared being told its to-dos are ready.', 'studio');
  exception when others then null;
  end;
  return jsonb_build_object('ok', false, 'error', left(sqlerrm, 300));
end $fn$;

-- ============================================================ 8. patches to existing functions (each asserts the text it replaces)
-- 8a. Needs you: one row per pending debrief
do $do$
declare v_def text; v_old text := $p$  where m.status = 'open' and m.severity = 'error' and m.opened_at < now() - interval '1 hour'$p$; v_new text;
begin
  v_def := pg_get_functiondef('public.admin_today_rows()'::regprocedure);
  if position('call_debriefs' in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) then raise exception 'admin_today_rows: the text to patch was not found exactly once'; end if;
  v_new := v_old || $p$

  union all
  select 'debrief:' || d.id::text, 'Scout', 'warning',
         'Call ready to review: ' || n.cnt || case when n.cnt = 1 then ' thing' else ' things' end || ' for ' || public.call_debrief_person(c),
         'Nothing reaches her board until you press Send.', 'Review', '/admin?debrief=' || d.id::text,
         d.created_at, n.cnt, 1, 'call_debriefs', d.id::text,
         'a call debrief is waiting for your OK before anything reaches her board', d.id::text, 'person'::text
    from call_debriefs d
    join approval_clients c on c.id = d.client_id
   cross join lateral (select count(*)::int as cnt from client_todos t
                        where t.source->>'kind' = 'call' and t.source->>'debrief_id' = d.id::text and t.status = 'draft') n
   where d.status = 'pending' and n.cnt > 0$p$;
  execute replace(v_def, v_old, v_new);
end $do$;

-- 8b. Studio must not list a call draft: the debrief is the only way to send one
do $do$
declare v_def text; v_old text := $p$where t.status = 'draft' and (p_client_slug is null or c.slug = p_client_slug)$p$;
        v_new text := $p$where t.status = 'draft' and coalesce(t.source->>'kind', '') <> 'call' and (p_client_slug is null or c.slug = p_client_slug)$p$;
begin
  v_def := pg_get_functiondef('public.studio_mail_drafts(text,text)'::regprocedure);
  if position(v_new in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) then raise exception 'studio_mail_drafts: the text to patch was not found exactly once'; end if;
  execute replace(v_def, v_old, v_new);
end $do$;

-- 8c. ...and Studio's Send and Remove buttons refuse one
do $do$
declare v_def text; v_old text := $p$if t.id is null then return jsonb_build_object('ok', false, 'error', 'not_draft'); end if;$p$; v_new text;
begin
  v_def := pg_get_functiondef('public.studio_draft_send(text,text,uuid)'::regprocedure);
  if position('call_debrief_only' in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) then raise exception 'studio_draft_send: the text to patch was not found exactly once'; end if;
  v_new := v_old || $p$
    if coalesce(t.source->>'kind', '') = 'call' then return jsonb_build_object('ok', false, 'error', 'call_debrief_only'); end if;$p$;
  execute replace(v_def, v_old, v_new);
end $do$;

do $do$
declare v_def text; v_old text := $p$elsif p_kind = 'todo' then update public.client_todos set status = 'dropped'$p$; v_new text;
begin
  v_def := pg_get_functiondef('public.studio_draft_drop(text,text,uuid)'::regprocedure);
  if position('call_debrief_only' in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) then raise exception 'studio_draft_drop: the text to patch was not found exactly once'; end if;
  v_new := $p$elsif p_kind = 'todo' and exists (select 1 from public.client_todos where id = p_id and source->>'kind' = 'call') then return jsonb_build_object('ok', false, 'error', 'call_debrief_only');
  elsif p_kind = 'todo' then update public.client_todos set status = 'dropped'$p$;
  execute replace(v_def, v_old, v_new);
end $do$;

-- 8d. a to-do Jared removed in the debrief must not show up in her origins list either
do $do$
declare v_def text; v_old text := $p$from client_todos t where t.client_id = c.id and t.status <> 'draft'), '{}'));$p$;
        v_new text := $p$from client_todos t where t.client_id = c.id and t.status <> 'draft' and not (t.status = 'dropped' and t.source->>'held_by' = 'debrief')), '{}'));$p$;
begin
  v_def := pg_get_functiondef('public.client_list_origins(text)'::regprocedure);
  if position(v_new in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) then raise exception 'client_list_origins: the text to patch was not found exactly once'; end if;
  execute replace(v_def, v_old, v_new);
end $do$;

-- ============================================================ 9. who may call what
revoke all on function public.call_debrief_live_since(), public.call_debrief_safe_date(text), public.call_debrief_sec(text), public.call_debrief_at(text),
  public.call_debrief_ts_for(jsonb, text), public.call_debrief_t12(timestamptz), public.call_debrief_person(public.approval_clients),
  public.call_debrief_client(public.meeting_recordings), public.call_debrief_coverage(public.meeting_recordings),
  public.call_debrief_item_json(public.client_todos), public.call_debrief_create(uuid), public.call_debrief_watch(),
  public.trg_client_todo_call_guard() from public, anon, authenticated;
grant execute on function public.call_debrief_create(uuid), public.call_debrief_watch() to service_role;

revoke all on function public.call_debrief_list(), public.call_debrief_get(uuid), public.call_debrief_item_update(uuid, text, text, date),
  public.call_debrief_item_remove(uuid), public.call_debrief_item_restore(uuid), public.call_debrief_move_owner(uuid, text),
  public.call_debrief_send(uuid, uuid[]), public.call_debrief_undo_send(uuid), public.call_debrief_snooze(uuid),
  public.call_debrief_dismiss(uuid) from public, anon;
grant execute on function public.call_debrief_list(), public.call_debrief_get(uuid), public.call_debrief_item_update(uuid, text, text, date),
  public.call_debrief_item_remove(uuid), public.call_debrief_item_restore(uuid), public.call_debrief_move_owner(uuid, text),
  public.call_debrief_send(uuid, uuid[]), public.call_debrief_undo_send(uuid), public.call_debrief_snooze(uuid),
  public.call_debrief_dismiss(uuid) to authenticated;

-- ============================================================ 10. the sandbox client gets her name, the watchdog gets a schedule and a team card
update public.approval_clients set people = '{elizabeth}' where slug = 'bestly-test' and coalesce(cardinality(people), 0) = 0;

select cron.schedule('studio-call-debrief-watch', '3-59/5 * * * *', 'select public.call_debrief_watch()');

select public.team_onboard($j$[{
  "slug": "call-debrief-watch",
  "name": "Call Debrief Watch",
  "role": "Makes sure every client call gets a debrief and that Jared sees it",
  "tool_of": "studio-watch",
  "runs_on": "cloud",
  "icon": "check-circle",
  "schedule": "Every 5 minutes",
  "what_it_does": "Finishes a client call's debrief if Scout missed the last step, asks Jared again when he picked Not now, reminds him once if Elizabeth's to-dos from a call are still waiting for his OK after 4 hours, and raises an alert if a client call has a transcript and no debrief an hour later.",
  "pulse": {"src": "cron", "job": "studio-call-debrief-watch", "gap": 20, "alert": true}
}]$j$::jsonb);
