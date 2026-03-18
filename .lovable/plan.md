

# Backend Fixes: Email Normalization, AI Re-run, Subscription Admin

## Issue 1: Email Case Sensitivity

### Database Migration
- Create `lowercase_subscription_email()` trigger function
- Add BEFORE INSERT OR UPDATE triggers on `subscriptions` and `granted_access` tables
- One-time data fix: UPDATE existing rows to `LOWER(TRIM(email))`
- Create `webhook_events` table with RLS (admin SELECT, service_role ALL)

### Edge Function Updates
- **`stripe-webhook/index.ts`**: Lowercase email before upsert (`email.toLowerCase().trim()`), log every event to `webhook_events` table before processing
- **`validate-activation-code/index.ts`**: Already lowercases email — no change needed
- **`send-activation-code/index.ts`**: Already lowercases email — no change needed

### Subscribers Admin Page (`CYSubscribers.tsx`)
Add two new sections below the existing subscribers table:
1. **Granted Access section** — shows `granted_access` rows + "Grant Access" button (email input + reason input + insert via supabase)
2. **Webhook Log section** — shows last 20 `webhook_events` rows (event_type, email, stripe_event_id, created_at) with auto-refresh

## Issue 2: AI Fixer Skipping Domains

### Database Migration
- Modify `report_missed_banner_with_html` RPC: add logic to DELETE `ai_generation_log` entries with `skipped_no_html` status when new HTML arrives
- Also reset `ai_attempts` to 0 and `ai_processed_at` to NULL on `missed_banner_reports` when fresh HTML clears a stale skip

### Edge Function Update (`ai-generate-pattern/index.ts`)
- Accept optional `{ domain: string }` in request body to process a single domain on-demand
- When domain is specified, query that domain directly from `missed_banner_reports` instead of using `get_ai_generation_candidates`

### Community Learning Page (`CommunityLearning.tsx`)
- Add "Re-run AI" button to each row in the Pending Candidates table
- Button deletes `ai_generation_log` entries with `skipped_no_html` or `error` for that domain, resets `ai_attempts`/`ai_processed_at`, then calls `ai-generate-pattern` with `{ domain }` body
- Shows loading spinner per-row, refreshes data on completion

## Files to Modify
1. **New migration SQL** — triggers, data fix, webhook_events table, update `report_missed_banner_with_html`
2. **`supabase/functions/stripe-webhook/index.ts`** — lowercase email, log to webhook_events
3. **`supabase/functions/ai-generate-pattern/index.ts`** — single-domain mode
4. **`src/pages/admin/CYSubscribers.tsx`** — granted access section, webhook log section
5. **`src/pages/admin/CommunityLearning.tsx`** — re-run AI button per candidate row

