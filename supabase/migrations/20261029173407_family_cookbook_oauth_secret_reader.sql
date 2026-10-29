-- The family-auth edge function reads the Bestly Cloud sign-in app's client id and secret from Vault through this. Service role only, two names only.
create or replace function public.family_oauth_client()
returns jsonb language sql stable security definer set search_path = public, vault, pg_temp as $$
  select jsonb_build_object(
    'id', (select decrypted_secret from vault.decrypted_secrets where name = 'family_oauth_client_id' limit 1),
    'secret', (select decrypted_secret from vault.decrypted_secrets where name = 'family_oauth_client_secret' limit 1))
$$;
revoke all on function public.family_oauth_client() from public, anon, authenticated;
grant execute on function public.family_oauth_client() to service_role;
