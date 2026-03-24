

# Real-Time Dismissal Processing

## Current Problem
Dismissal reports (when a user clicks a cookie banner button) are inserted directly into the `dismissal_reports` table by the extension. They sit there until either a manual "Run Consensus" click or the daily cron job processes them. This means a user could dismiss a banner and another user visiting the same site minutes later still won't benefit.

## Solution
Create a new edge function `report-dismissal` that the extension calls instead of inserting directly. This function will:
1. Save the dismissal report to `dismissal_reports`
2. Immediately run consensus logic for that specific domain (inline, not calling the full batch function)
3. If consensus is met (threshold = 1, so a single report suffices), create the pattern right away

This mirrors how `report-missed-banner` works — save the report, then immediately process it.

## Changes

### 1. New Edge Function: `supabase/functions/report-dismissal/index.ts`
- Accept `{ domain, clicked_selector, banner_selector, banner_html }` from the extension
- Insert into `dismissal_reports`
- Check if the domain already has an active pattern with confidence >= 5 — if so, skip
- If no existing pattern, immediately run the consensus logic inline:
  - Infer `action_type` from the clicked_selector text (same regex as existing consensus function)
  - Call `upsert_pattern` RPC to create/update the pattern
  - Set confidence to `min(5 + report_count, 9)`
  - Log to `ai_generation_log` with source `user_consensus`
  - Mark any matching `missed_banner_reports` as resolved
  - Clean up processed dismissal reports for that domain
- Return result with pattern details

### 2. Update `supabase/config.toml`
- Add `[functions.report-dismissal]` with `verify_jwt = false` (extension calls it unauthenticated)

### 3. Keep the daily cron as a safety net
- The existing daily consensus cron stays as a fallback for any edge cases

## Technical Notes
- The extension currently inserts directly into `dismissal_reports` via the Supabase client. After this change, the extension should call this edge function instead. Since the extension code isn't in this repo, this function will work alongside direct inserts — the cron catches anything that bypasses the function.
- No database changes needed — all existing tables and RPCs are sufficient.

