-- Sign in to /admin with a username instead of the (Apple private-relay) email.
-- The username lives in auth.users.raw_user_meta_data->>'username', set from the admin's
-- one-time "set up a password" prompt. This maps it back to the email for signInWithPassword.
-- Only resolves admins; returns null otherwise, so it can't be used to enumerate other accounts.
create or replace function public.admin_login_email(p_username text)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.email
  from auth.users u
  join public.user_roles r on r.user_id = u.id and r.role = 'admin'
  where lower(u.raw_user_meta_data->>'username') = lower(trim(p_username))
    and length(trim(p_username)) >= 3
  limit 1
$$;
revoke all on function public.admin_login_email(text) from public;
grant execute on function public.admin_login_email(text) to anon, authenticated;
