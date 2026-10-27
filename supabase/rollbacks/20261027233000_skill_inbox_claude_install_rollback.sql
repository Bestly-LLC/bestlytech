-- Rollback for 20261027233000_skill_inbox_claude_install.sql. Safe to run twice. Skills already installed on the Macs are left alone.
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'skill-inbox-claude-watch';
  end if;
end $$;
drop function if exists public.skill_inbox_claude_watch();
drop function if exists public.skill_inbox_mac_beat_t(text, text, boolean, text);
drop function if exists public.skill_inbox_mac_done_t(text, text, uuid, text, text, text, text);
drop function if exists public.skill_inbox_mac_queue_t(text, text);
drop table if exists public.skill_inbox_claude_hosts;
alter table public.skill_inbox drop column if exists claude_app_offered;
delete from public.pi_jobs where job = 'skill_inbox_claude';
update public.bestly_agents set pulse = jsonb_set(pulse, '{also}', (select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(pulse->'also') e where e <> '"skill_inbox_claude"'::jsonb))
 where slug = 'platform-radar';
delete from public.db_watchdog_tokens where label like 'skill-inbox-mac-%';
-- then put the previous decide function and card back by re-running the "decide" and "_skill_inbox_card" parts of 20261027221500_skill_inbox.sql
