-- Phase 2 (2026-10-10), Scout fixes 1-7: watchdogs, signed by the employee that owns each job.
--   scout.reflect.stale        -> scout-learner  (nightly reflect has not finished in 26 hours)
--   scout.reply.leak           -> chat-router    (Scout showed Jared raw tool JSON or a narrated step)
--   scout.paid-ask.ignored     -> chat-router    (he typed "use paid AI" and the switch did not turn on)
-- UNDO: select cron.unschedule('scout-reflect-watch'); select cron.unschedule('scout-reply-watch');
--       drop function public.scout_reflect_watch(); drop function public.scout_reply_watch();
--       delete from notification_owners where prefix in ('scout.reflect','scout.reply','scout.paid-ask');

insert into public.notification_owners (prefix, agent_slug, note) values
  ('scout.reflect', 'scout-learner', 'Nightly reflect (lessons) did not finish'),
  ('scout.reply', 'chat-router', 'Scout reply was raw tool output or a narrated step'),
  ('scout.paid-ask', 'chat-router', 'Typed paid-AI ask did not turn the switch on')
on conflict (prefix) do nothing;

create or replace function public.scout_reflect_watch()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_last timestamptz; v_hours numeric; v_note text;
begin
  -- A finished reflect: ok=true (new rows) or an old-style row that has "learned" and no error.
  select max(ran_at) into v_last from scout_daily_runs
   where job = 'reflect' and (result->>'ok' = 'true' or (result->>'ok' is null and result ? 'learned' and not (result ? 'error')));
  v_hours := round(extract(epoch from (now() - coalesce(v_last, 'epoch'::timestamptz))) / 3600.0, 1);
  if v_last is null or v_last < now() - interval '26 hours' then
    select coalesce(left(coalesce(result->>'error', (result->'failed'->>0), 'no error recorded'), 240), 'no run recorded') into v_note
      from scout_daily_runs where job = 'reflect' order by day desc limit 1;
    perform bestly_raise('scout.reflect.stale', 'problem', 'warning',
      'Scout has not learned anything in over a day',
      format('The last reflect that finished was %s (%s hours ago). It runs at 2:00 AM Pacific and retries every hour until it finishes. Last problem: %s. If the free AI is down for good, turning on Paid AI lets the retry use Claude for this one job.',
             coalesce(to_char(v_last at time zone 'America/Los_Angeles', 'Mon FMDD, FMHH12:MI AM'), 'never'), v_hours, coalesce(v_note, 'none')),
      'scout');
  else
    perform bestly_raise('scout.reflect.stale', 'resolved', 'info', 'Scout is learning nightly again');
  end if;
  return jsonb_build_object('ok', true, 'last_finished', v_last, 'hours_ago', v_hours);
end $function$;

create or replace function public.scout_reply_watch()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_leaks int; v_ign int;
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
  return jsonb_build_object('ok', true, 'leaks', v_leaks, 'paid_asks_ignored', v_ign);
end $function$;

revoke all on function public.scout_reflect_watch() from public, anon, authenticated;
revoke all on function public.scout_reply_watch() from public, anon, authenticated;

select cron.schedule('scout-reflect-watch', '*/30 * * * *', $c$select public.scout_reflect_watch()$c$);
select cron.schedule('scout-reply-watch', '*/15 * * * *', $c$select public.scout_reply_watch()$c$);
