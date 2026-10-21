-- ROLLBACK for the call-debrief backend migration (Lane S, 2026-10-18): supabase/migrations/<version>_call_debrief_backend.sql
-- Run it by hand in the Supabase SQL editor or psql. The agents' MCP tool refuses SQL that contains DROP, so an agent cannot run this file.
-- It is safe only while no call to-do has reached a client board. The first block stops you if one has.
-- The original bodies of the five patched functions are also saved in bestly_memory under build/call-debrief-2026-10-18/S-orig-<name>.
-- meeting_recordings.client_slug and .room stay: Lane M's ingest writes them.

-- 0. stop if a call to-do is already on a client's board
do $$
begin
  if exists (select 1 from public.client_todos where source->>'kind' = 'call' and status in ('open', 'ours', 'done')) then
    raise exception 'A call to-do is already on a client board. Take it off by hand first, then run this file again.';
  end if;
end $$;

-- 1. the watchdog: schedule, team card, open alerts
select cron.unschedule('studio-call-debrief-watch');
delete from public.bestly_agents where slug = 'call-debrief-watch';
delete from public.monitor_issues where key like 'studio:call-debrief%';

-- 2. put the five patched functions back (the inverse of section 8 of the migration)
-- 2a. Needs you: remove the debrief row
do $do$
declare v_def text; v_added text := $p$

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
begin
  v_def := pg_get_functiondef('public.admin_today_rows()'::regprocedure);
  if position(v_added in v_def) = 0 then return; end if;
  execute replace(v_def, v_added, '');
end $do$;

-- 2b. Studio lists call drafts again
do $do$
declare v_def text; v_cur text := $p$where t.status = 'draft' and coalesce(t.source->>'kind', '') <> 'call' and (p_client_slug is null or c.slug = p_client_slug)$p$; v_orig text := $p$where t.status = 'draft' and (p_client_slug is null or c.slug = p_client_slug)$p$;
begin
  v_def := pg_get_functiondef('public.studio_mail_drafts(text,text)'::regprocedure);
  if position(v_cur in v_def) = 0 then return; end if;
  execute replace(v_def, v_cur, v_orig);
end $do$;

-- 2c. Studio Send no longer refuses a call draft
do $do$
declare v_def text; v_added text := $p$
    if coalesce(t.source->>'kind', '') = 'call' then return jsonb_build_object('ok', false, 'error', 'call_debrief_only'); end if;$p$;
begin
  v_def := pg_get_functiondef('public.studio_draft_send(text,text,uuid)'::regprocedure);
  if position(v_added in v_def) = 0 then return; end if;
  execute replace(v_def, v_added, '');
end $do$;

-- 2d. Studio Remove no longer refuses a call draft
do $do$
declare v_def text; v_cur text := $p$elsif p_kind = 'todo' and exists (select 1 from public.client_todos where id = p_id and source->>'kind' = 'call') then return jsonb_build_object('ok', false, 'error', 'call_debrief_only');
  elsif p_kind = 'todo' then update public.client_todos set status = 'dropped'$p$; v_orig text := $p$elsif p_kind = 'todo' then update public.client_todos set status = 'dropped'$p$;
begin
  v_def := pg_get_functiondef('public.studio_draft_drop(text,text,uuid)'::regprocedure);
  if position(v_cur in v_def) = 0 then return; end if;
  execute replace(v_def, v_cur, v_orig);
end $do$;

-- 2e. her origins list counts removed call to-dos again
do $do$
declare v_def text; v_cur text := $p$from client_todos t where t.client_id = c.id and t.status <> 'draft' and not (t.status = 'dropped' and t.source->>'held_by' = 'debrief')), '{}'));$p$; v_orig text := $p$from client_todos t where t.client_id = c.id and t.status <> 'draft'), '{}'));$p$;
begin
  v_def := pg_get_functiondef('public.client_list_origins(text)'::regprocedure);
  if position(v_cur in v_def) = 0 then return; end if;
  execute replace(v_def, v_cur, v_orig);
end $do$;

-- 3. the guard, its unique index, and the call to-dos still waiting as drafts (or removed)
drop trigger if exists client_todos_call_guard on public.client_todos;
drop function if exists public.trg_client_todo_call_guard();
delete from public.client_todos where source->>'kind' = 'call' and status in ('draft', 'dropped');
drop index if exists public.client_todos_call_sdid_uidx;

-- 4. the table (its realtime membership and policy go with it) and every function
drop table if exists public.call_debriefs;
drop function if exists public.call_debrief_live_since();
drop function if exists public.call_debrief_safe_date(text);
drop function if exists public.call_debrief_sec(text);
drop function if exists public.call_debrief_at(text);
drop function if exists public.call_debrief_ts_for(jsonb, text);
drop function if exists public.call_debrief_t12(timestamptz);
drop function if exists public.call_debrief_person(public.approval_clients);
drop function if exists public.call_debrief_client(public.meeting_recordings);
drop function if exists public.call_debrief_coverage(public.meeting_recordings);
drop function if exists public.call_debrief_item_json(public.client_todos);
drop function if exists public.call_debrief_create(uuid);
drop function if exists public.call_debrief_watch();
drop function if exists public.call_debrief_list();
drop function if exists public.call_debrief_get(uuid);
drop function if exists public.call_debrief_item_update(uuid, text, text, date);
drop function if exists public.call_debrief_item_remove(uuid);
drop function if exists public.call_debrief_item_restore(uuid);
drop function if exists public.call_debrief_move_owner(uuid, text);
drop function if exists public.call_debrief_send(uuid, uuid[]);
drop function if exists public.call_debrief_undo_send(uuid);
drop function if exists public.call_debrief_snooze(uuid);
drop function if exists public.call_debrief_dismiss(uuid);

-- 5. the sandbox client goes back to no people
update public.approval_clients set people = '{}' where slug = 'bestly-test';

-- 6. scout-daily (an edge function, not SQL): redeploy it with verify_jwt false from a checkout of the pin from before this change
--    (the repo is private, so no raw-URL shim): git checkout 5c87e1e3cf6b7271d2aa43907fc5c0ea12f01c4b -- supabase/functions/scout-daily
--      then: supabase functions deploy scout-daily --project-ref rcqfqhguwpmaarseifqg --use-api --no-verify-jwt
--    Do this FIRST if you are rolling everything back. If you skip it the function still works: it catches a failed call_debrief_create and falls
--    back to the plain "Call with ..." notice, so a missing function costs nothing.
--    (The pin before that one, from before Oct 13, is 8e0bf1e9564fa06078134a0e1d4c5ed20c78564c.)
