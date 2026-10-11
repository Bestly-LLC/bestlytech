-- SECURITY FIX (2026-10-10, found by the Privacy Clerk build): team_is_admin() checked current_user, which inside a
-- SECURITY DEFINER function is always the owner (postgres), so it returned true for EVERY signed-in user.
-- 71 functions use it as their admin guard. session_user is postgres only for direct DB sessions (pg_cron, SQL editor);
-- through PostgREST it is 'authenticator', so signed-in users now need the admin role (or the service role).
-- UNDO: replace session_user with current_user below (restores the old, broken behavior).
create or replace function public.team_is_admin()
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select session_user in ('postgres','supabase_admin')
      or coalesce(auth.role(), '') = 'service_role'
      or coalesce(public.has_role(auth.uid(), 'admin'::app_role), false)
$function$;
