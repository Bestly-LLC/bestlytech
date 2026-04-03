

# Fix Cookie Yeti Uptime + Add Downtime SMS Alerts

## Problem Found

All four system heartbeat indicators (AI Generator, Report Ingestion, Pattern Learning, Cron Jobs) are red because **all cron jobs are authenticating with the anon key as a Bearer token**, which none of the edge functions accept:

- `auto-retry-failed-patterns` — only accepts `x-maintenance-secret` header (no Bearer fallback)
- `process-dismissal-consensus` — only accepts `x-maintenance-secret` header (no Bearer fallback)
- `run-pattern-maintenance` — accepts maintenance secret OR admin Bearer (but anon key is neither)
- `ai-generate-pattern` — requires a valid admin user Bearer token (anon key fails)

The cron jobs have been silently failing with 401 errors, meaning no patterns are being retried, no maintenance is running, and no batch AI generation is happening.

## Plan

### 1. Fix cron job authentication (root cause)

Update all 4 cron jobs to pass the `x-maintenance-secret` from Vault instead of the anon key as Bearer token. This requires a SQL migration to:
- Store the maintenance secret in Vault (if not already there)
- Update each `cron.job` to use `x-maintenance-secret` header pulled from `vault.decrypted_secrets`

### 2. Fix edge functions that lack Bearer fallback

Two functions only accept `x-maintenance-secret` and have no admin Bearer token fallback:
- `auto-retry-failed-patterns` — add the same dual-auth pattern used in `reset-failed-patterns`
- `process-dismissal-consensus` — add the same dual-auth pattern

This ensures both the cron jobs (via secret) AND the admin UI buttons (via Bearer token) work.

### 3. Add downtime SMS alert system

Create a lightweight health-check edge function (`check-system-health`) that:
- Queries the same data sources the heartbeat monitor uses (last AI gen, last report, last pattern, last maintenance)
- Compares against the same thresholds
- If any system is "red", sends an SMS via the existing Twilio integration to your number (816-500-7236)
- Tracks alert state so it doesn't spam — only sends when transitioning from OK → down, and a recovery text when back up

Schedule it via a new pg_cron job every 15 minutes.

### Files to modify
- `supabase/functions/auto-retry-failed-patterns/index.ts` — add admin Bearer token auth fallback
- `supabase/functions/process-dismissal-consensus/index.ts` — add admin Bearer token auth fallback
- `supabase/functions/check-system-health/index.ts` — new function for health monitoring + SMS alerts

### Database changes
- Migration to update cron jobs to use maintenance secret from Vault
- Migration to add `check-system-health` cron job (every 15 minutes)
- Small `system_alert_state` table to track last alert status and prevent duplicate texts

### Technical details
- The maintenance secret is already configured as a Supabase secret (`MAINTENANCE_SECRET`)
- It needs to also be stored in Vault so pg_cron SQL can reference it via `vault.decrypted_secrets`
- The health check function reuses the existing Twilio connector (same as `notify-sms`)
- Alert messages will be concise, e.g. "Cookie Yeti Alert: AI Generator down (last run 73h ago). Cron Jobs down (last run 5h ago)."
- Recovery message: "Cookie Yeti: All systems operational."

