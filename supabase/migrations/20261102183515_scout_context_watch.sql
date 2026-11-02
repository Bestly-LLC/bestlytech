-- Scout chat memory fix (2026-11-02), item G: scout_reply_watch grows two more checks.
--   scout.context.repeat -> chat-router  (same read 3+ times in 2 hours, one thread: Scout re-read instead of
--                                          checking the action ledger, e.g. thread d42608b1 reading llm_providers 3x)
--   scout.context.lost    -> chat-router (a "continue"/"try now"-style follow-up got answered with no brief goal)
-- Both auto-recover: rebuild that thread's brief from its last 30 messages + 25 actions (deterministic, no LLM —
-- this is a cron watcher, not the edge function). Recap-only: bestly_raise with severity 'warning', same as the
-- existing leak/paid-ask checks, never an interrupt (interrupt_class() only escalates security/money/person/down-an-hour).
-- UNDO: redeploy the previous scout_reply_watch() body from migration 20261011030000_scout_phase2_watchers.sql;
--       delete from notification_owners where prefix = 'scout.context';

insert into public.notification_owners (prefix, agent_slug, note) values
  ('scout.context', 'chat-router', 'Scout re-read the same thing, or lost the goal on a follow-up')
on conflict (prefix) do nothing;

-- Deterministic rebuild: carries no LLM call (this runs in Postgres, not the edge function). The edge function's
-- own end-of-run brief update (admin-chat v91) does the real LLM-compressed version; this is just the floor so a
-- thread Scout lost never sits with an empty brief until he types again.
create or replace function public.scout_context_rebuild_brief(p_thread_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_goal text; v_done jsonb;
begin
  select body into v_goal from admin_chat_messages
   where thread_id = p_thread_id and role = 'user' and body not ilike 'keep going%'
   order by created_at desc limit 1;
  select coalesce(jsonb_agg(distinct tool), '[]'::jsonb) into v_done
    from (select tool from admin_chat_actions where thread_id = p_thread_id and ok
            order by created_at desc limit 25) x;
  update admin_chat_threads
     set brief = jsonb_build_object(
           'goal', coalesce(left(v_goal, 300), ''), 'facts', '[]'::jsonb,
           'done', v_done, 'open', '[]'::jsonb, 'decisions', '[]'::jsonb, 'avoid', '[]'::jsonb
         ),
         brief_at = now()
   where id = p_thread_id;
end $function$;
revoke all on function public.scout_context_rebuild_brief(uuid) from public, anon, authenticated;

create or replace function public.scout_reply_watch()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_leaks int; v_ign int; v_repeat_threads int; v_lost_threads int; v_repeat_sample text; v_lost_sample text;
begin
  -- Replies in the last 6 hours that were raw tool JSON, a model talking to itself, or harmony tool markers.
  select count(*) into v_leaks from admin_chat_messages
   where role = 'assistant' and created_at > now() - interval '6 hours'
     and (body ~ '^\s*[\{\[]\s*"' or body ~* 'to=functions\.'
          or body ~* '^\s*(we need to|we[''’]re in the|let[''’]?s (read|list|search|check|look|open|find|try|query)|need to (read|list|search|check|look|open|find))');
  if v_leaks >= 2 then
    perform bestly_raise('scout.reply.leak', 'problem', 'warning', 'Scout showed raw working notes instead of an answer',
      format('%s replies in the last 6 hours were raw tool JSON or a step written out as text. The reply guard (admin-chat v44) should have caught them.', v_leaks), 'scout');
  else
    perform bestly_raise('scout.reply.leak', 'resolved', 'info', 'Scout replies are clean again');
  end if;

  -- He typed "use paid AI" (or "pair AI") and the switch was off and did not turn on within 3 minutes.
  select count(*) into v_ign from admin_chat_messages m
   where m.role = 'user' and m.created_at > now() - interval '6 hours'
     and m.body ~* '\m(use|using|switch to|with)\s+(paid|pair)\s*ai\M'
     and m.body !~* '^\s*(are|is|was|were|did|do|does|am)\M'
     and not exists (select 1 from scout_paid_log l where l.is_on and l.at between m.created_at - interval '1 minute' and m.created_at + interval '3 minutes')
     and not coalesce((select p.is_on and (p.until is null or p.until > m.created_at) from scout_paid_log p where p.at < m.created_at order by p.at desc limit 1), false);
  if v_ign >= 1 then
    perform bestly_raise('scout.paid-ask.ignored', 'problem', 'warning', 'You asked for paid AI and the switch did not turn on',
      format('%s message(s) in the last 6 hours asked for paid AI while the switch was off, and it stayed off. Likely the daily cap, or a bug in the typed-ask check.', v_ign), 'scout');
  else
    perform bestly_raise('scout.paid-ask.ignored', 'resolved', 'info', 'Typed paid-AI asks are working');
  end if;

  -- scout.context.repeat: same tool+args read 3+ times in 2 hours, one thread (the ledger should have stopped this).
  with reps as (
    select thread_id, tool, args, count(*) as reads
      from admin_chat_actions
     where created_at > now() - interval '2 hours' and tool in ('read_file', 'search_code', 'run_sql')
     group by thread_id, tool, args having count(*) >= 3
  )
  select count(distinct thread_id), max(format('thread %s: %s x%s', thread_id, tool, reads))
    into v_repeat_threads, v_repeat_sample from reps;
  if v_repeat_threads >= 1 then
    perform scout_context_rebuild_brief(thread_id) from (select distinct thread_id from reps) t;
    perform bestly_raise('scout.context.repeat', 'problem', 'warning', 'Scout re-read the same thing instead of using its log',
      format('%s thread(s) re-ran an identical read 3+ times in 2 hours (e.g. %s). Rebuilt each thread''s brief so the next reply uses it instead of reading again.', v_repeat_threads, coalesce(v_repeat_sample, 'n/a')), 'scout');
  else
    perform bestly_raise('scout.context.repeat', 'resolved', 'info', 'No repeated reads in the last 2 hours');
  end if;

  -- scout.context.lost: a "continue"/"try now"-style follow-up landed on a thread with no working brief.
  with lost as (
    select distinct m.thread_id from admin_chat_messages m
      join admin_chat_threads t on t.id = m.thread_id
     where m.role = 'user' and m.created_at > now() - interval '6 hours'
       and m.body ~* '^\s*(continue|keep going|go on|try (it )?now|try again|again|go|retry|any luck)\.?\s*$'
       and (t.brief is null or coalesce(t.brief->>'goal', '') = '')
  )
  select count(*), max(format('thread %s', thread_id)) into v_lost_threads, v_lost_sample from lost;
  if v_lost_threads >= 1 then
    perform scout_context_rebuild_brief(thread_id) from lost;
    perform bestly_raise('scout.context.lost', 'problem', 'warning', 'A follow-up landed with no working goal to continue',
      format('%s thread(s) got "continue"/"try now" with no brief goal set (e.g. %s). Rebuilt each from its last messages and actions.', v_lost_threads, coalesce(v_lost_sample, 'n/a')), 'scout');
  else
    perform bestly_raise('scout.context.lost', 'resolved', 'info', 'Follow-ups are landing on a working brief');
  end if;

  return jsonb_build_object('ok', true, 'leaks', v_leaks, 'paid_asks_ignored', v_ign, 'context_repeat_threads', v_repeat_threads, 'context_lost_threads', v_lost_threads);
end $function$;

revoke all on function public.scout_reply_watch() from public, anon, authenticated;
