-- 2026-10-31 admin cleanup part 2, item 2 (Code Worker on the Mac mini, launchd tech.bestly.code-worker).
-- The worker's heartbeat was watched (agent_beats code-worker) but its OUTCOMES were not: jobs failed for days with
-- "could not get the FreeLLM key from the Pi" and "the free AI made no change" and nobody was told.
-- code_worker_watch() (every 10 min) raises, signed Code Worker via the 'code.' prefix:
--   code.freellm-key   a job in the last 6 h died on the FreeLLM key path (ssh to Hestia / Vault) -> warning, Claude-fixable
--   code.free-ai-stuck the last 3 finished jobs in 24 h all ended with the free AI making no change -> warning
-- Both resolve by themselves on the next clean job.
create or replace function public.code_worker_watch()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_key int; v_stuck int; v_recent int; v_last text;
begin
  select count(*) into v_key from code_jobs
   where finished_at > now() - interval '6 hours'
     and coalesce(result->>'reason', '') ilike '%FreeLLM key%';
  if v_key > 0 then
    select left(result->>'reason', 300) into v_last from code_jobs
     where finished_at > now() - interval '6 hours' and coalesce(result->>'reason', '') ilike '%FreeLLM key%'
     order by finished_at desc limit 1;
    perform bestly_raise('code.freellm-key', 'problem', 'warning', 'Code Worker: I can''t get the FreeLLM key from Hestia',
      format('%s job(s) in the last 6 hours stopped before the free AI ran: %s. The key lives in Vault and reaches the Mac mini over ssh (bestly-pi / hestia); after a Pi rebuild the host key or the alias is the usual cause. Jobs stay in the queue and run once this works.', v_key, coalesce(v_last, '')),
      'code', null, false);
  else
    perform bestly_raise('code.freellm-key', 'resolved', 'info', 'Code Worker: the FreeLLM key path works again');
  end if;

  select count(*) into v_recent from (select 1 from code_jobs where finished_at > now() - interval '24 hours' order by finished_at desc limit 3) r;
  select count(*) into v_stuck from (
    select result from code_jobs where finished_at > now() - interval '24 hours' order by finished_at desc limit 3) r
   where coalesce(r.result->>'reason', '') ilike '%made no change%';
  if v_recent >= 3 and v_stuck = v_recent then
    perform bestly_raise('code.free-ai-stuck', 'problem', 'warning', 'Code Worker: the free AI made no change on the last 3 jobs',
      'Every job in the last day ended with the free AI changing nothing (FreeLLM models rate-limited or without tool calling). The jobs wait as needs_yes; approve paid AI on one of them or wait for the free models to reset.',
      'code', 'Open the code jobs on /admin and tap Yes on one to let paid AI try, or leave them for the free models to reset.', false);
  else
    perform bestly_raise('code.free-ai-stuck', 'resolved', 'info', 'Code Worker: the free AI is making changes again');
  end if;
  return jsonb_build_object('freellm_key_failures_6h', v_key, 'no_change_last3', v_stuck, 'recent', v_recent);
end $function$;

select cron.unschedule(jobid) from cron.job where jobname = 'code-worker-watch';
select cron.schedule('code-worker-watch', '4-59/10 * * * *', $$select public.code_worker_watch()$$);
