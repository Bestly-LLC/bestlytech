-- Home Hub: commands stuck in 'running' never expired.
--
-- expire_stale_home_hub_commands only handled 'pending' rows older than 10 minutes. If the Pi
-- claimed a command and then died (reboot, power, network), the row stayed 'running' forever and
-- the admin page kept spinning on it. Now a 'running' row claimed more than 15 minutes ago is
-- expired too. (A result the agent reports later still overwrites 'expired' with what happened.)
--
-- The function only ran from the edge function's poll, which is exactly what stops when the Pi
-- does, so it also runs from pg_cron every 5 minutes. Based on the live definition, 2026-09-16.

create or replace function public.expire_stale_home_hub_commands()
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.home_hub_commands
     set status = 'expired',
         error = 'No agent claimed this command within 10 minutes',
         completed_at = now()
   where status = 'pending'
     and created_at < now() - interval '10 minutes';

  update public.home_hub_commands
     set status = 'expired',
         error = 'The Pi stopped responding while running this command',
         completed_at = now()
   where status = 'running'
     and coalesce(claimed_at, created_at) < now() - interval '15 minutes';
$$;

-- Unchanged from 20260916100000_lockdown_exposed_data.sql: service role only.
revoke execute on function public.expire_stale_home_hub_commands() from public, anon, authenticated;
grant execute on function public.expire_stale_home_hub_commands() to service_role;

-- cron.schedule with an existing job name updates that job, so this is safe to re-run.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('expire-stale-home-hub-commands', '*/5 * * * *',
      'select public.expire_stale_home_hub_commands()');
  end if;
end $$;
