-- 2026-10-05 The Roster Scanner flagged ava-voices-health (built tonight, no owner). It checks Ava's voices, so it
-- belongs to Ava's Line Check tool.
select public.team_assign_jobs('{"ava-line-check":["ava-voices-health"]}'::jsonb);
