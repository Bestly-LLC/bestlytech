-- The clipboard intake slot, extended to WeatherKit. Same rule as before: the value
-- is written straight to the vault and never returned, echoed or logged, so a signing
-- key can reach the vault without passing through a chat transcript.
create or replace function public.store_bestly_secret(p_name text, p_value text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed text[] := array[
    'nextcloud_app_password',
    'nextcloud_user',
    'nextcloud_base_url',
    'github_token',
    -- WeatherKit REST: the .p8 signs, the ids identify. Only the key is sensitive,
    -- but all four live together so the proxy reads them in one place.
    'weatherkit_private_key',
    'weatherkit_key_id',
    'weatherkit_team_id',
    'weatherkit_service_id'
  ];
  existing uuid;
begin
  if not (p_name = any(allowed)) then
    raise exception 'store_bestly_secret refuses name %: not on the allowlist', p_name;
  end if;
  if p_value is null or length(p_value) = 0 then
    raise exception 'empty value';
  end if;

  select id into existing from vault.secrets where name = p_name;

  if existing is null then
    perform vault.create_secret(p_value, p_name,
      'Set via the clipboard intake slot so the value never entered a chat context');
    return 'created';
  else
    perform vault.update_secret(existing, p_value, p_name,
      'Rotated via the clipboard intake slot');
    return 'updated';
  end if;
end $$;
