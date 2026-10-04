-- Bestly to-dos <-> Apple Reminders list "Bestly" (Nextcloud CalDAV task list). APPLIED LIVE 2026-10-04 ~1:20 AM PT.
-- Pi job: scripts/pi-wave-b/reminders_sync.py -> /opt/bestly/cron/jobs/reminders_sync.py, cron */2, pi_jobs watchdog.
-- Function body: see the live definition of public.reminders_todo_sync(uuid[], jsonb) (a service_role twin of
-- ha_todo_sync: same "You" list; adds from Reminders become call to-dos with source_key 'rem:<uid>').

-- The Pi may read the Nextcloud login from Vault (pi_secret allowlist).
-- pi_secret(p_name) allowlist += 'nextcloud_user', 'nextcloud_app_password', 'nextcloud_base_url'.

revoke all on function public.reminders_todo_sync(uuid[], jsonb) from public, anon, authenticated;
grant execute on function public.reminders_todo_sync(uuid[], jsonb) to service_role;

insert into public.pi_jobs (job, enabled, max_gap_min) values ('reminders_sync', true, 15)
on conflict (job) do update set enabled = true, max_gap_min = 15;
