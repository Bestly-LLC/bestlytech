-- Generate the agent's shared secret server-side and keep it in Vault, so it never
-- passes through a chat context and nobody has to paste it into function settings.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'home_hub_agent_key') then
    perform vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'home_hub_agent_key',
      'Shared secret for the on-prem Home Hub agent -> home-hub-agent edge function'
    );
  end if;
end $$;

create or replace function public.get_home_hub_agent_key()
returns text
language sql
security definer
set search_path to 'public','vault'
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'home_hub_agent_key' limit 1;
$$;

revoke all on function public.get_home_hub_agent_key() from public, anon, authenticated;
