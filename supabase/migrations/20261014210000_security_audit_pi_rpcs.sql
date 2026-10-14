-- Security audit on the Pi: the database side.
--
-- The nightly audit moves from a Claude scheduled task to a Pi cron job (tools/security-audit/).
-- The Pi talks to Supabase through PostgREST as the service role and cannot run raw SQL, so the
-- three things the Claude task did with raw SQL become small RPCs here:
--   security_audit_facts()          admin count + anon-callable SECURITY DEFINER writers
--   security_checks_record()        ONE batched write of every check (passes included)
--   security_token_state_put()      remembers whether the last run could use each token
-- and the two API tokens the audit needs get a write-only paste box on /admin/security:
--   security_tokens_save()          admin only, writes Vault pi:vercel:api_token / pi:supabase:management_token
--   security_tokens_status()        saved-at time + last-run state. NEVER returns a value.
--
-- NOT APPLIED by the agent that wrote it. Review, then apply with apply_migration.
-- Until it is applied the worker degrades honestly: facts become `skip`, the batch falls back to one
-- security_check call per check, token state is simply not recorded.
--
-- UNDO:
--   drop function if exists public.security_audit_facts();
--   drop function if exists public.security_checks_record(uuid, jsonb);
--   drop function if exists public.security_token_state_put(text, text, text);
--   drop function if exists public.security_tokens_save(text, text);
--   drop function if exists public.security_tokens_status();
--   drop table if exists public.security_audit_token_state;
--
-- No personal data: the new table holds a token name, a status word and a short note, never an
-- email or phone, so there is no privacy_data_map row to add. None of these functions is called
-- with the publishable key, so none belongs on security_public_rpcs.

-- ---------------------------------------------------------------- token state
create table if not exists public.security_audit_token_state (
  which      text primary key check (which in ('vercel', 'supabase')),
  status     text not null default 'unknown' check (status in ('unknown', 'ok', 'missing', 'rejected')),
  note       text,
  checked_at timestamptz not null default now()
);
alter table public.security_audit_token_state enable row level security;
revoke all on public.security_audit_token_state from public, anon, authenticated;
grant select, insert, update on public.security_audit_token_state to service_role;

-- ------------------------------------------------------------ worker: the facts
create or replace function public.security_audit_facts()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'admins', (select count(*) from public.user_roles where role = 'admin'),
    -- SECURITY DEFINER writers that anon can really execute (has_function_privilege covers the PUBLIC
    -- grant trap) and whose body has no auth check. Same rule the Claude task used, plus the 2026-10-11
    -- addition: team_is_admin() / is_admin() / auth.role() count as auth checks.
    'anon_writers', coalesce((
      select jsonb_agg(jsonb_build_object('function', x.proname, 'args', x.args) order by x.proname, x.args)
      from (
        select p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and p.pronargs > 0
          and has_function_privilege('anon', p.oid, 'EXECUTE')
          and p.prosrc ~* '(\minsert\s+into\M|\mupdate\s+[a-z_."]+\s+set\M|\mdelete\s+from\M)'
          and p.prosrc !~* '\m(auth\.uid|auth\.role|auth\.jwt|has_role|team_is_admin|is_admin|token|key|staff|current_setting)'
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      ) x
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.security_audit_facts() from public, anon, authenticated;
grant execute on function public.security_audit_facts() to service_role;

-- ------------------------------------------------------- worker: batched write
-- Each element is the same shape security_check takes. One bad element is reported and the rest still
-- land (a security tool must not lose 200 checks because one had a bad value).
create or replace function public.security_checks_record(p_run uuid, p_checks jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c jsonb;
  v_out text;
  outcomes jsonb := '{}'::jsonb;
  errs jsonb := '[]'::jsonb;
begin
  if p_run is null or jsonb_typeof(p_checks) <> 'array' then
    raise exception 'security_checks_record: need a run id and a json array';
  end if;
  for c in select * from jsonb_array_elements(p_checks) loop
    begin
      v_out := public.security_check(
        p_run, c->>'key', c->>'result', c->>'layer', c->>'asset', c->>'check',
        c->>'title', c->>'detail', c->>'fix', coalesce(c->'evidence', '{}'::jsonb));
      outcomes := jsonb_set(outcomes, array[v_out], to_jsonb(coalesce((outcomes->>v_out)::int, 0) + 1));
    exception when others then
      errs := errs || to_jsonb(left(coalesce(c->>'key', '?') || ': ' || sqlerrm, 200));
    end;
  end loop;
  return jsonb_build_object('outcomes', outcomes, 'errors', errs);
end $$;
revoke all on function public.security_checks_record(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.security_checks_record(uuid, jsonb) to service_role;

-- ----------------------------------------------------- worker: token state
create or replace function public.security_token_state_put(p_which text, p_status text, p_note text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.security_audit_token_state (which, status, note, checked_at)
  values (p_which, p_status, left(p_note, 200), now())
  on conflict (which) do update set status = excluded.status, note = excluded.note, checked_at = now();
$$;
revoke all on function public.security_token_state_put(text, text, text) from public, anon, authenticated;
grant execute on function public.security_token_state_put(text, text, text) to service_role;

-- --------------------------------------------------- admin page: write-only save
-- Pattern: home_hub_vault_put / chargepoint_connect. Admin only, value goes straight into Vault, and
-- the function returns timestamps, never the secret. A null/empty argument leaves that token alone.
create or replace function public.security_tokens_save(p_vercel text default null, p_supabase text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
  v_val text;
  v_name text;
  v_which text;
  v_pair text[];
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.team_is_admin(), false) then
    raise exception 'admin only';
  end if;
  foreach v_pair slice 1 in array array[array['vercel', p_vercel], array['supabase', p_supabase]] loop
    v_which := v_pair[1];
    v_val := nullif(btrim(v_pair[2]), '');
    continue when v_val is null;
    if length(v_val) < 16 or length(v_val) > 600 or v_val ~ '\s' then
      raise exception 'that does not look like a % token', v_which;
    end if;
    v_name := case v_which when 'vercel' then 'pi:vercel:api_token' else 'pi:supabase:management_token' end;
    select id into v_id from vault.secrets where name = v_name;
    if v_id is null then
      perform vault.create_secret(v_val, v_name, 'Security audit (Pi): ' || v_which || ' read-only token. Written by /admin/security.');
    else
      perform vault.update_secret(v_id, v_val);
    end if;
    insert into public.security_audit_token_state (which, status, note, checked_at)
    values (v_which, 'unknown', 'Saved. The next audit run will try it.', now())
    on conflict (which) do update set status = 'unknown', note = excluded.note, checked_at = now();
  end loop;
  return public.security_tokens_status();
end $$;
revoke all on function public.security_tokens_save(text, text) from public, anon;
grant execute on function public.security_tokens_save(text, text) to authenticated, service_role;

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
    from (values ('vercel', 'pi:vercel:api_token'), ('supabase', 'pi:supabase:management_token')) as t(which, vault_name)
  );
end $$;
revoke all on function public.security_tokens_status() from public, anon;
grant execute on function public.security_tokens_status() to authenticated, service_role;
