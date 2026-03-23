

# Backend Bug Fixes & Redeployments

## Status of Each Fix

| Fix | Status | Action Needed |
|-----|--------|---------------|
| Fix 1: `validate-activation-code` missing `code` in response | **Needs code update + redeploy** | Yes |
| Fix 2: `send-activation-code` SMTP leak | **Not applicable** — already uses email queue (`enqueue_email`), no SMTP client | None |
| Fix 3: Manual Review tab + Skipped section + auto-trigger | **Already implemented** in previous messages | None |
| Fix 4: Missing columns on `missed_banner_reports` | **Already exist** — `page_url`, `banner_html`, `cmp_fingerprint` are in the schema | None |
| Fix 3d: Email notification for persistent failures | **Not yet implemented** | Yes |

## Changes to Make

### 1. Update & redeploy `validate-activation-code`

**File:** `supabase/functions/validate-activation-code/index.ts`

Rewrite with the improved version from the request:
- Return `{ success: true, activated: true, code }` on success (includes the code so extensions can store it)
- Select `*` instead of just `id` so we have the full row
- Better error responses with proper HTTP status codes (400 for invalid, 500 for DB errors)
- Preserve platform from existing row if not provided in request

Then deploy via `deploy_edge_functions`.

### 2. Add email alert for persistent no-HTML failures

Create a new edge function `supabase/functions/notify-manual-review/index.ts` (or add logic to an existing cron) that:
- Queries `missed_banner_reports` for rows with `report_count >= 3`, `resolved = false`, and empty `banner_html`
- Sends an email to jaredbest@icloud.com via the existing `enqueue_email` RPC
- Uses the Bestly navy admin email template style

Alternatively, add this check into the `report-missed-banner` edge function itself — after saving, if the domain hits 3+ reports with no HTML, enqueue the alert email inline. This avoids needing a new function or cron job.

### Technical Details

- `send-activation-code` already uses the `enqueue_email` queue system (not raw SMTP), so Fix 2 is a non-issue
- `report-missed-banner` already passes `force_server_fetch: true` for empty HTML (Fix 3c done)
- The Manual Review tab and Skipped section are already in `CommunityLearning.tsx` (Fix 3a/3b done)
- Only real gaps: the `code` field in validate response, and the persistent-failure email alert

