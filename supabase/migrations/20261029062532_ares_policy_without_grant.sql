-- Ares nightly check: policy_without_grant (2026-10-28). Plan: docs/ha-automator-v2-opusplan.md (B6). DETECTION ONLY.
--
-- The hole: postgres' default privileges in `public` no longer grant new tables to `authenticated`. A table with an RLS policy
-- for signed-in users but no GRANT answers "permission denied" before RLS ever runs, so the admin page that reads it is dead
-- while every server-side probe (service_role) stays green. Found 2026-10-29 on ha_automations (Tinker's page, 8 days).
--
-- This adds ares_policy_without_grant_check(): for every public table with row security on and a policy for `authenticated`,
-- if some policy has none of its matching privileges granted (select / insert / update / delete; ALL needs at least one),
-- it opens a yellow finding `policy_without_grant:<table>` in the same security_findings table Ares already uses.
-- It NEVER grants anything. Findings are marked watching_until so the hourly auto-fixer does not page Jared for a decision he has
-- not made yet (whether to restore the grant on the other admin-only tables); they show on /admin/security and close themselves
-- the night the grant (or the policy) is fixed.
-- Cron: ares-policy-without-grant, nightly 8:52 UTC (about 1:52 AM Los Angeles). Owner: Ares (security-auditor).
-- UNDO at the bottom.

create or replace function public.ares_policy_without_grant_check()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run uuid; r record; v_checks jsonb := '[]'::jsonb; v_keys text[] := '{}'; v_open int := 0; v_closed int := 0;
  v_out jsonb; v_summary text;
begin
  if not (session_user in ('postgres', 'supabase_admin') or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not allowed';
  end if;

  for r in
    select c.oid as reloid, c.relname,
           array_agg(distinct p.polname order by p.polname) as policies,
           array_agg(distinct p.polcmd::text) as cmds
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
       and (select oid from pg_roles where rolname = 'authenticated') = any (p.polroles)
     group by c.oid, c.relname
    having bool_or(not exists (
             select 1
               from unnest(case p.polcmd when 'r' then array['select'] when 'a' then array['insert'] when 'w' then array['update']
                                         when 'd' then array['delete'] else array['select', 'insert', 'update', 'delete'] end) pv
              where has_table_privilege('authenticated', c.oid, pv)))
     order by c.relname
  loop
    v_keys := v_keys || ('policy_without_grant:' || r.relname);
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'key', 'policy_without_grant:' || r.relname, 'result', 'yellow', 'layer', 'Database (Supabase)', 'asset', 'public.' || r.relname,
      'check', 'policy_without_grant',
      'title', 'public.' || r.relname || ' has a signed-in policy but no grant',
      'detail', 'Policy ' || array_to_string(r.policies, ', ') || ' lets signed-in users in, but the authenticated role has no matching privilege on the table, so any page that reads it gets "permission denied" before the policy is even checked. Server-side checks (service role) cannot see this.',
      'fix', 'If a signed-in admin page reads or writes public.' || r.relname || ', run: grant select, insert, update, delete on public.' || r.relname || ' to authenticated (the policy still limits rows). If nothing signed-in uses it, drop the unused policy instead. Ares only detects; he does not grant.',
      'evidence', jsonb_build_object('table', r.relname, 'policies', to_jsonb(r.policies), 'commands', to_jsonb(r.cmds))));
  end loop;

  -- close findings whose table was fixed (or dropped) since the last night
  for r in
    select key, layer, asset, check_name, title from security_findings
     where status = 'open' and check_name = 'policy_without_grant' and not (key = any (v_keys))
  loop
    v_checks := v_checks || jsonb_build_array(jsonb_build_object(
      'key', r.key, 'result', 'pass', 'layer', r.layer, 'asset', r.asset, 'check', r.check_name, 'title', r.title));
    v_closed := v_closed + 1;
  end loop;

  v_open := coalesce(array_length(v_keys, 1), 0);
  v_summary := 'policy_without_grant: ' || v_open || ' table(s) with a signed-in policy and no grant, ' || v_closed || ' closed. Detection only.';
  v_run := public.security_run_start('scheduled', jsonb_build_object('check', 'policy_without_grant', 'by', 'ares_policy_without_grant_check'));
  v_out := public.security_checks_record(v_run, v_checks);

  -- the other 29+ tables wait on Jared's decision; do not let the hourly auto-fixer page him about each one
  update security_findings
     set autofix = jsonb_build_object('state', 'watching_until', 'at', now(),
           'reason', 'Detection only. Ares does not grant. Jared decides whether to restore the grant or drop the unused policy.')
   where status = 'open' and check_name = 'policy_without_grant' and autofix is null;

  perform public.security_run_finish(v_run, v_summary, false);
  perform public.agent_beat('security-auditor', true, v_summary, null);
  return jsonb_build_object('open', v_open, 'closed', v_closed, 'record', v_out);
end $$;

revoke all on function public.ares_policy_without_grant_check() from public, anon, authenticated;
grant execute on function public.ares_policy_without_grant_check() to service_role;

select cron.schedule('ares-policy-without-grant', '52 8 * * *', $cron$select public.ares_policy_without_grant_check()$cron$)
 where not exists (select 1 from cron.job where jobname = 'ares-policy-without-grant');

-- Ares' team card names every cron job he owns (the Roster Scanner flags schedules nobody owns)
update public.bestly_agents
   set pulse = jsonb_set(pulse, '{also}', coalesce(pulse->'also', '[]'::jsonb) || '"ares-policy-without-grant"'::jsonb), updated_at = now()
 where slug = 'security-auditor' and not coalesce(pulse->'also', '[]'::jsonb) ? 'ares-policy-without-grant';

-- UNDO:
--   select cron.unschedule('ares-policy-without-grant');
--   drop function public.ares_policy_without_grant_check();
--   update security_findings set status='dismissed', dismissed_reason='check removed' where check_name='policy_without_grant' and status='open';
--   update bestly_agents set pulse = jsonb_set(pulse,'{also}', (pulse->'also') - 'ares-policy-without-grant') where slug='security-auditor';
