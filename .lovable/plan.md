

# Make Pattern Generation Fully Autonomous

## Scope Clarification

This plan covers the **server-side infrastructure** (edge functions, database tables, cron jobs, admin UI). The **extension-side changes** (DOM probe logic, dismissal click listener, `buildSelector`, messaging) are in a separate codebase and will need to be implemented there separately — but the edge functions they call will be ready.

## Changes

### 1. Database Changes (Migration)

**Add retry tracking columns to `ai_generation_log`** (not `cookie_patterns` — statuses live in `ai_generation_log`):
- `retry_count INT DEFAULT 0` on `missed_banner_reports` (already has `ai_attempts`, so we reuse that as the retry counter — no new column needed)

**Create `dismissal_reports` table:**
```sql
CREATE TABLE dismissal_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  domain TEXT NOT NULL,
  clicked_selector TEXT NOT NULL,
  banner_selector TEXT,
  banner_html TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_dismissal_domain ON dismissal_reports(domain);
ALTER TABLE dismissal_reports ENABLE ROW LEVEL SECURITY;
-- Public insert (extension reports), service role full access
```

**Create `find_dismissal_consensus` RPC function** that finds domains with 3+ matching dismissal reports not already covered by `cookie_patterns`.

**Add `permanently_failed` status** handling — after 5 total `ai_attempts`, the auto-retry skips the domain.

### 2. Edge Function: `auto-retry-failed-patterns`

New edge function (`supabase/functions/auto-retry-failed-patterns/index.ts`):
- Queries `missed_banner_reports` where `resolved = false` AND `ai_attempts < 5` AND (`ai_processed_at IS NULL` OR `ai_processed_at < now() - 24h`)
- Cross-references `ai_generation_log` for domains with status `needs_manual_review`, `failed_not_cookie_banner`, or `error`
- For each domain, calls `ai-generate-pattern` internally (reuses the same pipeline: CMP check → AI → server fetch)
- If `ai_attempts >= 5` after this run, logs `permanently_failed` status
- No auth required (called by cron) — `verify_jwt = false`

### 3. Edge Function: `probe-report`

New edge function (`supabase/functions/probe-report/index.ts`):
- Receives `{ domain, probeResults: [{ selector, html, visible }] }` from the extension
- Picks the best match (visible, largest HTML)
- Runs it through `detectKnownCMP` first, then AI analysis if no CMP match
- On success, inserts pattern via `upsert_pattern` and logs as `success_probe` in `ai_generation_log`
- Marks the `missed_banner_reports` entry as resolved
- No auth required (called by extension) — `verify_jwt = false`

### 4. Edge Function: `process-dismissal-consensus`

New edge function (`supabase/functions/process-dismissal-consensus/index.ts`):
- Calls `find_dismissal_consensus` RPC
- For each domain with 3+ matching dismissals, inserts pattern with `source = 'user_consensus'`, `confidence = 0.85`
- Logs as `success_consensus` in `ai_generation_log`
- Deletes processed dismissal reports
- No auth required (called by cron) — `verify_jwt = false`

### 5. pg_cron Jobs (via insert tool, not migration)

Two cron jobs:
- `auto-retry-failed-patterns`: daily at 3 AM UTC
- `process-dismissal-consensus`: daily at 4 AM UTC

Both use `net.http_post` to call the edge functions with the anon key.

### 6. Update `ai-generate-pattern` Flow

Change the final failure status from `needs_manual_review` to check `ai_attempts`:
- If `ai_attempts >= 4` (this will be the 5th), log as `permanently_failed`
- Otherwise keep logging as `needs_manual_review` (the auto-retry cron will pick it up)

### 7. Admin UI Updates (`CommunityLearning.tsx`)

Add badge styles for new statuses:
- `permanently_failed`: red/dark styling
- `success_probe`: green/teal styling
- `success_consensus`: purple styling

Remove or repurpose the manual review flag icon since domains now auto-resolve.

### 8. Update `config.toml`

Add entries for the three new edge functions with `verify_jwt = false`.

## Files to Create/Modify

1. **`supabase/functions/auto-retry-failed-patterns/index.ts`** — new
2. **`supabase/functions/probe-report/index.ts`** — new
3. **`supabase/functions/process-dismissal-consensus/index.ts`** — new
4. **`supabase/functions/ai-generate-pattern/index.ts`** — update final failure logic for `permanently_failed`
5. **`src/pages/admin/CommunityLearning.tsx`** — new status badges
6. **Migration** — `dismissal_reports` table + `find_dismissal_consensus` RPC + RLS policies
7. **pg_cron setup** — via insert tool (2 cron jobs)
8. **`supabase/config.toml`** — 3 new function entries (auto-updated)

## Technical Notes

- The auto-retry function reuses the existing `ai-generate-pattern` pipeline by calling it via HTTP, so no code duplication.
- `ai_attempts` on `missed_banner_reports` already serves as the retry counter — no new columns needed there.
- The probe-report function shares the same `KNOWN_CMPS` array and AI calling logic. To avoid duplication, the CMP detection and AI calling code will be inlined (edge functions can't import from sibling function directories in Deno Deploy).
- Extension-side changes (probe selector list, dismissal click listener, messaging) are documented but implemented in the extension repo, not here.

