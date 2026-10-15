-- The homepage "content_changed" checker hashed client-rendered SPA shells, failed fetches and
-- redirecting hosts, so it cried wolf. The checker itself is fixed in
-- scripts/security-audit/web_checks.py and tools/security-audit/security_audit.py (Pi job; needs
-- install.sh on the Pi). This migration only closes the three findings it raised falsely,
-- the same way the audit closes a fixed finding (status fixed, resolved_at, audit log row).
-- No schema change; the pending-hash state lives in security_audit_runs.inventory.fingerprints.

with closed as (
  update public.security_findings
     set status = 'fixed', resolved_at = now(), updated_at = now(),
         dismissed_reason = null
   where status = 'open'
     and key in ('web:eldoraluxe.com:content_changed',
                 'web:www.eldoraluxe.com:content_changed',
                 'web:review.bestly.tech:content_changed')
  returning key, asset
)
insert into public.security_audit_log (finding_key, actor, action, asset, before, after, note)
select key, 'audit', 'fixed', asset, jsonb_build_object('status', 'open'), jsonb_build_object('status', 'fixed'),
       'false positive: checker hashed SPA shell; checker fixed 2026-10-15'
  from closed;
