-- Web Push for bestly.tech/admin (applied live 2026-09-22 via MCP; recorded here).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique,
  keys jsonb not null,
  created_at timestamptz not null default now()
);
-- Locked: RLS on with no policies = anon/authenticated get nothing; service role bypasses.
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- VAPID keys live only in Vault: vapid_public_key, vapid_private_key, vapid_mailto.
create or replace function public.push_vapid_get() returns jsonb language sql stable security definer set search_path = public, vault as $$
  select jsonb_build_object(
    'public',  (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_public_key'  limit 1),
    'private', (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_private_key' limit 1),
    'mailto',  (select decrypted_secret from vault.decrypted_secrets where name = 'vapid_mailto'      limit 1));
$$;
create or replace function public.push_vapid_init(p_public text, p_private text, p_mailto text) returns jsonb language plpgsql security definer set search_path = public, vault as $$
begin
  if exists (select 1 from vault.secrets where name = 'vapid_private_key') then return jsonb_build_object('ok', true, 'created', false); end if;
  perform vault.create_secret(p_private, 'vapid_private_key', 'Web Push VAPID private key (bestly.tech/admin). Used by push-notify.');
  perform vault.create_secret(p_public,  'vapid_public_key',  'Web Push VAPID public key (bestly.tech/admin).');
  if not exists (select 1 from vault.secrets where name = 'vapid_mailto') then perform vault.create_secret(p_mailto, 'vapid_mailto', 'Web Push VAPID subject.'); end if;
  return jsonb_build_object('ok', true, 'created', true);
end $$;
create or replace function public.push_vapid_public() returns text language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'vapid_public_key' limit 1;
$$;
create or replace function public.push_service_key_ok(p_key text) returns boolean language sql stable security definer set search_path = public, vault as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'service_role_key' and decrypted_secret = p_key);
$$;
revoke all on function public.push_vapid_get() from public, anon, authenticated;
revoke all on function public.push_vapid_init(text, text, text) from public, anon, authenticated;
revoke all on function public.push_vapid_public() from public, anon;
revoke all on function public.push_service_key_ok(text) from public, anon, authenticated;
grant execute on function public.push_vapid_get() to service_role;
grant execute on function public.push_vapid_init(text, text, text) to service_role;
grant execute on function public.push_vapid_public() to service_role, authenticated;
grant execute on function public.push_service_key_ok(text) to service_role;

-- push_web_send(): pg_net call to push-notify with the Vault service key.
-- scout_notify() now calls it on every Scout notify (see the live definition).
