-- 2026-09-24: watchdog so Scout never silently falls back to "I'd need paid AI" for basic questions again.
-- Runs every 10 min (cron scout-free-watch). Checks and self-heals:
--  1. every free provider (groq, cloudflare) paused at once -> free-llm canary (clears pauses that test OK) and
--     un-pause the provider paused longest, so Scout is never left with zero free AI
--  2. free chat calls (chat-free / chat-agent) mostly failing in 30 min -> canary, alert with the real error
--  3. Jared got 2+ "I'd need paid AI" asks in an hour -> lift free-AI pauses, alert with the reasons Scout gave
-- Alerts go to Scout as incident scout.free_answers (bestly_raise), resolved automatically once all is well.
-- The free-llm canary now runs every 2 hours (was daily).
create table if not exists public.scout_free_watch_log (
  at timestamptz primary key default now(), paused int, chat_calls int, chat_bad int, paid_asks int,
  actions text[], detail jsonb);
alter table public.scout_free_watch_log enable row level security;

create or replace function public.scout_free_watch() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_enabled int; v_paused int; v_calls int; v_bad int; v_asks int; v_err text; v_reasons text;
  v_actions text[] := '{}'; v_problem text := null;
begin
  select count(*) filter (where enabled),
         count(*) filter (where enabled and cooldown_until > now())
    into v_enabled, v_paused
    from llm_providers where name in ('groq','cloudflare');

  select count(*), count(*) filter (where not ok), max(outcome) filter (where not ok)
    into v_calls, v_bad, v_err
    from ai_spend where job in ('chat-free','chat-agent') and at > now() - interval '30 minutes';

  select count(*), string_agg(distinct substring(body from 'paid AI \(Claude\) for this\. ([^.]*\.)'), ' / ')
    into v_asks, v_reasons
    from admin_chat_messages
   where role = 'assistant' and body like 'I''d need paid AI%' and created_at > now() - interval '1 hour';

  if v_enabled > 0 and v_paused >= v_enabled then
    v_problem := 'Every free AI provider was paused at once';
    perform invoke_edge_function('free-llm', '{"op":"canary"}'::jsonb, 120000);
    update llm_providers set cooldown_until = null, cooldown_reason = null, updated_at = now()
     where name = (select name from llm_providers where name in ('groq','cloudflare') and enabled
                    order by cooldown_until asc nulls first limit 1);
    v_actions := array_append(v_actions, 'canary + unpaused the provider paused longest');
  end if;

  if v_calls >= 4 and v_bad * 2 > v_calls then
    v_problem := coalesce(v_problem || '; ', '') || format('%s of %s free Scout chat calls failed in 30 min', v_bad, v_calls);
    if not ('canary + unpaused the provider paused longest' = any(v_actions)) then
      perform invoke_edge_function('free-llm', '{"op":"canary"}'::jsonb, 120000);
      v_actions := array_append(v_actions, 'canary');
    end if;
  end if;

  if v_asks >= 2 then
    v_problem := coalesce(v_problem || '; ', '') || format('Scout asked for paid AI %s times in the last hour (%s)', v_asks, coalesce(v_reasons, 'no reason given'));
    update llm_providers set cooldown_until = null, cooldown_reason = null, updated_at = now()
     where name in ('groq','cloudflare') and cooldown_until > now();
    v_actions := array_append(v_actions, 'lifted free-AI pauses');
  end if;

  insert into scout_free_watch_log(paused, chat_calls, chat_bad, paid_asks, actions, detail)
  values (v_paused, v_calls, v_bad, v_asks, v_actions, jsonb_build_object('last_error', v_err, 'reasons', v_reasons));
  delete from scout_free_watch_log where at < now() - interval '14 days';

  if v_problem is not null then
    perform bestly_raise('scout.free_answers', 'problem', 'warning', 'Scout is falling back to paid AI',
      v_problem || '. Self-heal: ' || array_to_string(v_actions, ', ') || '.' ||
        case when v_err is not null then ' Last free error: ' || left(v_err, 160) else '' end,
      'ai', null, true);
  else  -- nothing wrong right now
    perform bestly_raise('scout.free_answers', 'resolved', 'info', 'Scout answers on free AI again');
  end if;

  return jsonb_build_object('paused', v_paused, 'enabled', v_enabled, 'chat_calls', v_calls, 'chat_bad', v_bad,
    'paid_asks', v_asks, 'actions', v_actions, 'problem', v_problem);
end $$;
revoke all on function public.scout_free_watch() from public, anon, authenticated;

select cron.schedule('scout-free-watch', '*/10 * * * *', 'select public.scout_free_watch()');
select cron.alter_job(job_id := (select jobid from cron.job where jobname = 'free-llm-canary'), schedule := '30 */2 * * *');
