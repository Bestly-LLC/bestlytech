-- Hunter: Apollo keys, one per owner (Maya = Bestly Apollo account, Reese = RoofGuard Apollo account).
--   hunter_apollo_key_put(owner, value)  admin-only, write-only: Vault names apollo_api_key_maya / apollo_api_key_reese.
--   hunter_apollo_status()               admin-only: which keys are saved, when, last test result. Never returns a key.
--   hunter_secret(name)                  now also allows the two Apollo names (service role only).

create table if not exists public.hunter_apollo_state (
  owner text primary key check (owner in ('maya','reese')),
  saved_at timestamptz, tested_at timestamptz, test_ok boolean, test_note text
);
alter table public.hunter_apollo_state enable row level security;

create or replace function public.hunter_secret(p_name text) returns text
language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not public.hunter_worker_ok() then raise exception 'not allowed'; end if;
  if p_name not in ('jev_api_key','apollo_api_key_maya','apollo_api_key_reese') then
    raise exception 'hunter_secret: % is not a Hunter secret', p_name; end if;
  return (select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1);
end $$;

create or replace function public.hunter_apollo_key_put(p_owner text, p_value text) returns timestamptz
language plpgsql security definer set search_path = public, vault as $$
declare v_id uuid; v_cur text; v text := btrim(coalesce(p_value, '')); n text;
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  if p_owner not in ('maya','reese') then raise exception 'unknown owner'; end if;
  if length(v) < 12 or length(v) > 400 or v ~ '\s' then raise exception 'That does not look like an Apollo key.'; end if;
  n := 'apollo_api_key_' || p_owner;
  select s.id, d.decrypted_secret into v_id, v_cur from vault.secrets s join vault.decrypted_secrets d on d.id = s.id where s.name = n;
  if v_id is null then perform vault.create_secret(v, n, 'Hunter: Apollo API key for ' || p_owner);
  elsif v_cur is distinct from v then perform vault.update_secret(v_id, v, n, 'Hunter: Apollo API key for ' || p_owner);
  end if;
  insert into hunter_apollo_state(owner, saved_at, tested_at, test_ok, test_note) values (p_owner, now(), null, null, null)
    on conflict (owner) do update set saved_at = now(), tested_at = null, test_ok = null, test_note = null;
  return now();
end $$;

create or replace function public.hunter_apollo_status() returns jsonb
language plpgsql stable security definer set search_path = public, vault as $$
begin
  if not public.team_is_admin() then raise exception 'not allowed'; end if;
  return (select jsonb_object_agg(o, jsonb_build_object(
      'key_saved', exists (select 1 from vault.secrets where name = 'apollo_api_key_' || o),
      'saved_at', st.saved_at, 'tested_at', st.tested_at, 'test_ok', st.test_ok, 'test_note', st.test_note))
    from unnest(array['maya','reese']) o left join hunter_apollo_state st on st.owner = o);
end $$;

revoke all on function public.hunter_apollo_key_put(text, text) from public, anon;
revoke all on function public.hunter_apollo_status() from public, anon;
grant execute on function public.hunter_apollo_key_put(text, text) to authenticated, service_role;
grant execute on function public.hunter_apollo_status() to authenticated, service_role;
