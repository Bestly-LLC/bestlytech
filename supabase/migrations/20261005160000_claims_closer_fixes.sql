-- Claims Closer fixes, 2026-10-05 (applied live as claims_closer_tables / claims_closer_triggers / claims_closer_admin /
-- claims_closer_mail_uuid / claims_closer_paid_mail; this file is the record).
--   - bestly_mail.id is a uuid: claim_events.mail_id, claim_cases.opened_from_mail and claims_open_case(p_mail_id) take uuid.
--   - Turo's paid-invoice mail says "Willie has been charged for your reimbursement invoice" / "accepted the reimbursement
--     invoice": claims_mail_seen now reads that as invoice_paid (checked before invoice_sent) and marks the matching amount paid.
--   - Alerts are signed by Claims Closer (claims_notify -> notify_route source 'Claims Closer'), per Jared's rule.
--   - Team card: team_onboard('claims-closer', pulse cron claims-closer-tick, owns 'claims.').
--   - cron: claims-closer-tick every 2 min -> claims_tick().
alter table public.claim_events alter column mail_id type uuid using null;
alter table public.claim_cases alter column opened_from_mail type uuid using null;
-- function bodies: see 20261005040000_claims_closer.sql with the changes above.
