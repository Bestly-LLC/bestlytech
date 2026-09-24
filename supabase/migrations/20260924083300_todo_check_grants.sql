-- 2026-09-24 outage audit: the admin To-do check card read these tables as `authenticated` without a SELECT grant
-- (~1000 "permission denied" errors/day). RLS still applies.
grant select on public.todo_check_runs, public.todo_check_jobs, public.todo_check_settings to authenticated;
