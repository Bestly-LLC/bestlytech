

## Audit: What's Still Missing

### 1. Unregistered Edge Functions
Three functions exist on disk but are **not in `config.toml`**, so they will never deploy:
- `ai-generate-pattern`
- `probe-report`
- `process-dismissal-consensus`

**Fix**: Add all three to `supabase/config.toml` with `verify_jwt = false`.

### 2. No Cron Jobs Actually Scheduled
The migration only enabled `pg_cron` and `pg_net` extensions — but **no cron jobs were actually created**. The daily auto-retry and `run-pattern-maintenance` have no scheduled triggers.

**Fix**: Use the Supabase insert tool (not migrations) to schedule:
- `auto-retry-failed-patterns` — daily at 6 AM UTC
- `run-pattern-maintenance` — daily at 7 AM UTC

### 3. No Admin Trigger for `run-pattern-maintenance`
The Community Learning dashboard has a "Retry Failed" button but **no button to manually trigger the maintenance function** (pattern fixer + report processor).

**Fix**: Add a "Run Maintenance" button next to the existing "Retry Failed" button in the dashboard.

### 4. No `permanently_failed` Email/SMS Alert
When `auto-retry-failed-patterns` marks a domain as `permanently_failed`, no notification is sent to the admin. The `run-pattern-maintenance` function only alerts on fix failures and priority reports — not on domains that exhausted all AI retries.

**Fix**: After the auto-retry loop, if any domains were marked `permanently_failed`, send an alert email via the existing SMTP setup.

### Summary of Changes

| File | Change |
|---|---|
| `supabase/config.toml` | Register `ai-generate-pattern`, `probe-report`, `process-dismissal-consensus` |
| Database (insert, not migration) | Schedule 2 cron jobs |
| `src/pages/admin/CommunityLearning.tsx` | Add "Run Maintenance" button |
| `supabase/functions/auto-retry-failed-patterns/index.ts` | Send email alert on `permanently_failed` domains |

