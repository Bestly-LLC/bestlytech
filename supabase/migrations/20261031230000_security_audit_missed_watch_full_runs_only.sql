-- 2026-10-31 (Ares): the missed-audit watch counted ANY security_audit_runs row, so the DB-side policy_without_grant job
-- (0 checks, daily) kept it green while the Pi's full audit sat in DRY mode (writes nothing) from Oct 27 to Oct 31.
-- Now only a full run counts (200+ checks), and the body names the two real causes seen so far.
-- Applied live 2026-10-31 via the Supabase MCP (apply_migration security_audit_missed_watch_full_runs_only).
CREATE OR REPLACE FUNCTION public.security_audit_missed_watch()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_last timestamptz; v_hours numeric; v_any timestamptz;
begin
  -- Owner: security-auditor (Ares), via the 'security' prefix. Nightly full audit on Hestia is due 1 AM PT; allow 26 h.
  select max(started_at) into v_last from security_audit_runs where coalesce(checks_total, 0) >= 200;
  select max(started_at) into v_any from security_audit_runs;
  v_hours := round(extract(epoch from (now() - coalesce(v_last, 'epoch'::timestamptz))) / 3600.0, 1);
  if v_last is null or v_last < now() - interval '26 hours' then
    perform bestly_raise('security.audit-missed', 'problem', 'warning',
      'Last night''s full security audit did not run',
      format('The last FULL audit (200+ checks, from Hestia) started %s (%s hours ago); the nightly run is due at 1:00 AM Pacific.%s Causes seen before: the Pi job left in dry mode after a rebuild (/opt/bestly/cron/state/security_audit.json must say "mode": "live"), or the cron line missing. Log: /home/pi/scripts/cron-logs/security-audit.log.',
             coalesce(to_char(v_last at time zone 'America/Los_Angeles', 'Mon FMDD, FMHH12:MI AM'), 'never'), v_hours,
             case when v_any is not null and v_any > coalesce(v_last, 'epoch'::timestamptz) then ' Smaller database-side runs did happen, so the table looked alive.' else '' end),
      'security', 'Ask Claude to check the security-audit job on Hestia.');
  else
    perform bestly_raise('security.audit-missed', 'resolved', 'info', 'The nightly full security audit is running again');
  end if;
  return jsonb_build_object('ok', true, 'last_full_run', v_last, 'hours_ago', v_hours);
end $function$;
