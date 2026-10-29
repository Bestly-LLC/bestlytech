-- The Recipes tab reads three tables straight from the browser (Realtime + a poll): without an explicit grant the page
-- gets "permission denied" before the admin RLS policy runs. Everything else goes through admin-guarded RPCs.
grant select on public.recipe_handoff, public.recipe_commands, public.recipe_parse_jobs to authenticated;
