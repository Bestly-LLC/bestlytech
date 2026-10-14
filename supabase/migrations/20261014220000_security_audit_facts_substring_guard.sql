-- Fix: security_audit_facts() flagged 80 functions as unguarded anon writers; the truth is 3.
--
-- 20261014210000 wrote the "has no auth check" test as a word-boundary match:
--     prosrc !~* '\m(auth\.uid|...|token|key|staff|current_setting)'
-- In Postgres regex `_` is a word character, so "p_token" is a single word and \mtoken never
-- matches it. Every token-gated RPC (settlement_upsert_t, tesla_worker_claim, wall_pi_push, ...)
-- therefore looked like it had no auth check at all. The Claude task this replaced used plain
-- substring matching, which is what the rule has always meant.
--
-- Dropping \m takes the finding count from 80 back to the real 3: card_scan_log,
-- cy_report_site_issue, ltx_report — the same three the Claude audit reports.
--
-- UNDO: re-apply the body from 20261014210000.
create or replace function public.security_audit_facts()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'admins', (select count(*) from public.user_roles where role = 'admin'),
    'anon_writers', coalesce((
      select jsonb_agg(jsonb_build_object('function', x.proname, 'args', x.args) order by x.proname, x.args)
      from (
        select p.proname, pg_get_function_identity_arguments(p.oid) as args
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prokind = 'f' and p.prosecdef and p.pronargs > 0
          and has_function_privilege('anon', p.oid, 'EXECUTE')
          and p.prosrc ~* '(\minsert\s+into\M|\mupdate\s+[a-z_."]+\s+set\M|\mdelete\s+from\M)'
          and p.prosrc !~* '(auth\.uid|auth\.role|auth\.jwt|has_role|team_is_admin|is_admin|token|key|staff|current_setting)'
          and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      ) x
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.security_audit_facts() from public, anon, authenticated;
grant execute on function public.security_audit_facts() to service_role;
