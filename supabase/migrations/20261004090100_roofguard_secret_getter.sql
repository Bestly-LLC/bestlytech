-- Scoped Vault reader for the RoofGuard dialer (Spark, 2026-10-04): returns only these four names, service role only.
-- The values themselves get added to Vault by Jared through the secret-intake flow; nothing is stored here.
create or replace function public.rg_secret(p_name text)
returns text language plpgsql stable security definer set search_path = public, vault as $$
begin
  if p_name not in ('elevenlabs_api_key', 'elevenlabs_webhook_secret', 'twilio_account_sid', 'twilio_auth_token') then
    raise exception 'rg_secret: % is not a RoofGuard secret', p_name;
  end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1);
end $$;
revoke execute on function public.rg_secret(text) from public, anon, authenticated;
grant execute on function public.rg_secret(text) to service_role;
