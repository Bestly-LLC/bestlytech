-- Remove hoascope.com / app.hoascope.com from external_health monitoring.
-- These were seeded by 20260430000000_external_health_probe.sql but the public
-- sites don't exist yet, so they reported `unknown` indefinitely on /status.
-- See docs/onboarding-audit-2026-05.md, action item 6.
delete from public.external_health
where service in ('hoascope.com', 'app.hoascope.com');

delete from public.external_health_history
where service in ('hoascope.com', 'app.hoascope.com');
