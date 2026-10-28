-- Local alerts v2 (part 2): token-gated read of the one Vault secret the collector may use, and wider USGS radius (quakes are felt far away).
create or replace function public.citizen_secret(p_token text, p_name text)
returns text language plpgsql security definer set search_path = public, vault as $$
declare v text;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  if p_name <> 'lametro_api_key' then raise exception 'not allowed'; end if;
  select decrypted_secret into v from vault.decrypted_secrets where name = p_name limit 1;
  return v;
end $$;
revoke all on function public.citizen_secret(text, text) from public;
grant execute on function public.citizen_secret(text, text) to anon, authenticated;
update citizen_sources set max_ft = 1320000 where source = 'usgs';

-- Shared display rules travel in the snapshot so the wall and the admin map cannot disagree: dots within dot_ft, notes_max lines in the notes stack.
do $$ declare d text; begin
  d := pg_get_functiondef('public.citizen_snapshot_json'::regproc);
  if d like '%dot_ft%' then return; end if;
  d := replace(d, '''rev'', 2,', '''rev'', 2, ''dot_ft'', 6600, ''notes_max'', 3,');
  execute d;
end $$;
