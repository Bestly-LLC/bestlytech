-- Rollback for supabase/migrations/20261018193303_call_debrief_quiet_sandbox.sql (Lane S, 2026-10-18). Run by hand: the MCP tool refuses destructive SQL.
-- After this, a sandbox client's debrief behaves like a real client's again (push, Needs-you row, pop-up), and the people fallback applies to recordings with a room.

-- 1. put the first migration's text back into the patched functions
do $do$
declare v_def text; v_old text := $p$where not d.quiet and (d.status = 'pending' or d.created_at > now() - interval '14 days')$p$; v_new text := $p$where d.status = 'pending' or d.created_at > now() - interval '14 days'$p$;
begin
  v_def := pg_get_functiondef('public.call_debrief_list()'::regprocedure);
  if position(v_old in v_def) = 0 then return; end if;
  execute replace(v_def, v_old, v_new);
end $do$;
do $do$
declare v_def text; v_old text := $p$'sent_at', d.sent_at, 'sent_by', d.sent_by, 'sent_count', d.sent_count, 'quiet', d.quiet,$p$; v_new text := $p$'sent_at', d.sent_at, 'sent_by', d.sent_by, 'sent_count', d.sent_count,$p$;
begin
  v_def := pg_get_functiondef('public.call_debrief_get(uuid)'::regprocedure);
  if position(v_old in v_def) = 0 then return; end if;
  execute replace(v_def, v_old, v_new);
end $do$;
do $do$
declare v_def text; v_old text := $p$where d.status = 'pending' and not d.quiet and n.cnt > 0$p$; v_new text := $p$where d.status = 'pending' and n.cnt > 0$p$;
begin
  v_def := pg_get_functiondef('public.admin_today_rows()'::regprocedure);
  if position(v_old in v_def) = 0 then return; end if;
  execute replace(v_def, v_old, v_new);
end $do$;
do $do$
declare v_def text; v_old text := $p$for r in select * from public.call_debriefs d where d.status = 'pending' and not d.quiet and d.remind_at is not null and d.remind_at <= now() loop$p$; v_new text := $p$for r in select * from public.call_debriefs d where d.status = 'pending' and d.remind_at is not null and d.remind_at <= now() loop$p$;
begin
  v_def := pg_get_functiondef('public.call_debrief_watch()'::regprocedure);
  if position(v_old in v_def) = 0 then return; end if;
  execute replace(v_def, v_old, v_new);
end $do$;

do $do$
declare v_def text; v_old text := $p$where d.status = 'pending' and not d.quiet and d.reminded_at is null and d.remind_at is null$p$; v_new text := $p$where d.status = 'pending' and d.reminded_at is null and d.remind_at is null$p$;
begin
  v_def := pg_get_functiondef('public.call_debrief_watch()'::regprocedure);
  if position(v_old in v_def) = 0 then return; end if;
  execute replace(v_def, v_old, v_new);
end $do$;

do $do$
declare v_def text; v_old text := $p$where length(coalesce(x.transcript, '')) >= 400 and x.created_at < now() - interval '60 minutes' and x.created_at > now() - interval '3 days'
       and not public.call_debrief_is_quiet(x, public.call_debrief_client(x))$p$; v_new text := $p$where length(coalesce(x.transcript, '')) >= 400 and x.created_at < now() - interval '60 minutes' and x.created_at > now() - interval '3 days'$p$;
begin
  v_def := pg_get_functiondef('public.call_debrief_watch()'::regprocedure);
  if position(v_old in v_def) = 0 then return; end if;
  execute replace(v_def, v_old, v_new);
end $do$;

-- 2. the first migration's call_debrief_client and call_debrief_create (copied verbatim from that migration)
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

-- 3. the helper and the two columns (these statements are the part the MCP tool refuses)
drop function if exists public.call_debrief_is_quiet(public.meeting_recordings, public.approval_clients);
alter table public.call_debriefs drop column if exists quiet;
alter table public.approval_clients drop column if exists debrief_live_until;
