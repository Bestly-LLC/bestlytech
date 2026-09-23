-- WeatherKit REST needs four values, not three: the private key signs the token,
-- the Key ID names the key, the Team ID is the issuer, and the SERVICE ID is the
-- subject. A bundle/App ID in the subject is what makes Apple return 401 with no
-- useful message, so it is stored and named separately here.
create or replace function public.get_weatherkit_credentials()
returns table (team_id text, service_id text, key_id text, private_key text)
language sql
security definer
set search_path = public
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'weatherkit_team_id'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'weatherkit_service_id'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'weatherkit_key_id'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'weatherkit_private_key');
$$;

-- Only the server may read it. No anon, no authenticated: a browser that could call
-- this would have the signing key.
revoke all on function public.get_weatherkit_credentials() from public, anon, authenticated;
grant execute on function public.get_weatherkit_credentials() to service_role;
