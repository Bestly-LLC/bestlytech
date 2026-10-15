-- Security audit: the Cloudflare token (docs/cloudflare-audit-opusplan.md).
--
-- The nightly audit (tools/security-audit/, Pi, Ares) gets a Cloudflare section. It needs a third read-only
-- token, kept in Vault as pi:cloudflare:api_token and pasted on /admin/security like the other two:
--   * security_audit_token_state.which may now be 'cloudflare' (constraint dropped and re-added BY NAME;
--     the live name was read first: security_audit_token_state_which_check)
--   * security_tokens_save_cloudflare(p_token)  admin only, write-only, returns security_tokens_status()
--     A separate function on purpose: a third argument on security_tokens_save would mean dropping the
--     old signature (PostgREST overload ambiguity), and the cloud Supabase connector hangs on drops.
--   * security_tokens_status()  create or replace, same shape plus a `cloudflare` key (old page builds
--     ignore it). Body copied from the live definition (pg_get_functiondef, 2026-10-15); only the values
--     list gained a row.
--
-- pi_secret_get needs NO change. The spec asked for an allowlist entry, but the live pi_secret_get has no
-- allowlist: it reads any Vault secret whose name starts with 'pi:' (service role only). The allowlist lives
-- in pi_secret (the non-prefixed names, see 20261006221500_pi_secret_fireworks.sql), which this does not use.
-- Both read paths the audit uses (/opt/bestly/bin/security, then pi_secret_get) already reach this name.
--
-- No personal data: the token state table holds a token name, a status word and a short note, so there is
-- no privacy_data_map row. The new function is called by a signed-in admin, never with the publishable
-- key, so it does not belong on security_public_rpcs.
--
-- NOT APPLIED by the agent that wrote it. Review, then apply with apply_migration.
--
-- UNDO:
--   drop function if exists public.security_tokens_save_cloudflare(text);
--   -- put security_tokens_status() back to two rows: re-run its definition from
--   -- 20261014210000_security_audit_pi_rpcs.sql (create or replace, no drop needed).
--   delete from public.security_audit_token_state where which = 'cloudflare';
--   alter table public.security_audit_token_state drop constraint if exists security_audit_token_state_which_check;
--   alter table public.security_audit_token_state add constraint security_audit_token_state_which_check
--     check (which in ('vercel', 'supabase'));
--   -- and delete the Vault secret pi:cloudflare:api_token if one was saved:
--   --   select vault.delete_secret(id) from vault.secrets where name = 'pi:cloudflare:api_token';

-- ---------------------------------------------------------------- token state
alter table public.security_audit_token_state
  drop constraint if exists security_audit_token_state_which_check,
  add constraint security_audit_token_state_which_check check (which in ('vercel', 'supabase', 'cloudflare'));

-- --------------------------------------------------- admin page: write-only save
create or replace function public.security_tokens_save_cloudflare(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
  v_val text := btrim(p_token);
  v_name constant text := 'pi:cloudflare:api_token';
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.team_is_admin(), false) then
    raise exception 'admin only';
  end if;
  if v_val is null or v_val = '' or length(v_val) < 20 or length(v_val) > 600 or v_val ~ '\s' then
    raise exception 'that does not look like a Cloudflare token';
  end if;
  select id into v_id from vault.secrets where name = v_name;
  if v_id is null then
    perform vault.create_secret(v_val, v_name, 'Security audit (Pi): cloudflare read-only token. Written by /admin/security.');
  else
    perform vault.update_secret(v_id, v_val);
  end if;
  insert into public.security_audit_token_state (which, status, note, checked_at)
  values ('cloudflare', 'unknown', 'Saved. The next audit run will try it.', now())
  on conflict (which) do update set status = 'unknown', note = excluded.note, checked_at = now();
  return public.security_tokens_status();
end $$;
revoke all on function public.security_tokens_save_cloudflare(text) from public, anon;
grant execute on function public.security_tokens_save_cloudflare(text) to authenticated, service_role;

-- --------------------------------------------------- admin page: status only
create or replace function public.security_tokens_status()
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.team_is_admin(), false) then
    raise exception 'admin only';
  end if;
  return (
    select jsonb_object_agg(t.which, jsonb_build_object(
      'saved_at', (select coalesce(s.updated_at, s.created_at) from vault.secrets s where s.name = t.vault_name),
      'status',   coalesce((select st.status from public.security_audit_token_state st where st.which = t.which), 'unknown'),
      'note',     (select st.note from public.security_audit_token_state st where st.which = t.which),
      'checked_at', (select st.checked_at from public.security_audit_token_state st where st.which = t.which)))
    from (values ('vercel', 'pi:vercel:api_token'), ('supabase', 'pi:supabase:management_token'),
                 ('cloudflare', 'pi:cloudflare:api_token')) as t(which, vault_name)
  );
end $$;
revoke all on function public.security_tokens_status() from public, anon;
grant execute on function public.security_tokens_status() to authenticated, service_role;
