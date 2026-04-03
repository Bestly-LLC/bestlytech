

# Fix Cookie Yeti: Subscription Sync + Heartbeat Restoration

## Two Root Causes Found

### Issue 1: "No subscription found" for granted access users
The extension checks the `subscriptions` table for entitlement, but users in `granted_access` have **zero corresponding rows** in `subscriptions`. All 5 granted users (including your own admin email) have no subscription record. There is no trigger or mechanism syncing grants into subscriptions.

### Issue 2: Heartbeat monitors all red
The `check-system-health` Edge Function is **missing from `supabase/config.toml`**, so JWT verification is enabled by default. The cron job passes the service_role key as a Bearer token, which the Supabase gateway rejects before the function even executes (401). The function boots but never processes — confirmed by logs showing only "booted" messages with no actual execution output.

Additionally, the `ai-generate-pattern` cron is also returning 401 despite being in config.toml with `verify_jwt = false` — this may indicate a deployment sync issue that redeploying will fix.

---

## Plan

### 1. Create a database trigger to sync `granted_access` → `subscriptions`

SQL migration to:
- Create a trigger function `sync_granted_access_to_subscriptions()` that runs AFTER INSERT on `granted_access`
- On each new grant, upsert a row into `subscriptions` with: email (from grant), plan = `'lifetime'`, status = `'active'`, stripe_customer_id = `'granted_' || grant.id`
- Also backfill all 5 existing granted_access users who currently have no subscription record

### 2. Add `check-system-health` to `config.toml`

Add `[functions.check-system-health]` with `verify_jwt = false` so the cron job's service_role Bearer token reaches the function.

### 3. Redeploy critical Edge Functions

Redeploy `check-system-health`, `ai-generate-pattern`, `auto-retry-failed-patterns`, `run-pattern-maintenance`, and `process-dismissal-consensus` to ensure the gateway config is in sync.

### 4. Test the health check

Call `check-system-health` directly to verify it executes and returns system status instead of 401.

---

## Files Modified
- `supabase/config.toml` — Add `check-system-health` entry
- Database migration — Trigger for granted_access sync + backfill existing records

## Technical Details
- The trigger uses `ON CONFLICT (email, plan)` to avoid duplicates if someone is both a paying subscriber and has granted access
- The backfill INSERT uses `ON CONFLICT DO NOTHING` to be safe against existing records
- The `log_granted_access` function already exists for activity logging — the new sync trigger is separate

