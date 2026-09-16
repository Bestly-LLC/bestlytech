-- Cookie Yeti render engine key (self-hosted engine at www.bestly.tech/api/cy-render).
-- The value is generated inside the database and lives only in Vault.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'cy_render_key') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'cy_render_key',
      'Shared key between Cookie Yeti edge functions and the Vercel render engine /api/cy-render'
    );
  end if;
end $$;

-- Edge functions (service role) fetch the key to call the engine.
create or replace function public.cy_render_key()
returns text language sql stable security definer set search_path = public
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'cy_render_key' $$;
revoke all on function public.cy_render_key() from public, anon, authenticated;
grant execute on function public.cy_render_key() to service_role;

-- The engine checks a presented key without holding any secret itself.
create or replace function public.cy_render_key_ok(p_key text)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from vault.decrypted_secrets
    where name = 'cy_render_key' and length(coalesce(p_key, '')) >= 32 and decrypted_secret = p_key
  )
$$;
revoke all on function public.cy_render_key_ok(text) from public;
grant execute on function public.cy_render_key_ok(text) to anon, authenticated, service_role;
