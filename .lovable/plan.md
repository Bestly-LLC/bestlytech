

# Fix Cookie Yeti Community Learning — Everything Red

## Root Cause

The cron jobs are executing every 15 minutes but all edge functions return **401 Unauthorized** silently. Here's why:

- All cron jobs pass `email_queue_service_role_key` from **Vault** as a Bearer token
- The edge functions compare that token against `SUPABASE_SERVICE_ROLE_KEY` (Deno env var)
- These are **different values** — the vault secret was set up for the email queue and is likely the anon key or an old value
- Result: every cron-triggered function call fails auth, no patterns get generated, no maintenance runs, heartbeat stays red

## Fix (3 steps)

### 1. Add `MAINTENANCE_SECRET` to Vault

The `MAINTENANCE_SECRET` already exists as an edge function secret. We need to also store it in Vault so pg_cron SQL can reference it. Run a migration:

```sql
SELECT vault.create_secret(
  (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'email_queue_service_role_key'),
  'maintenance_secret'
);
```

Actually — since we can't read the existing vault secret reliably, the better approach: update all cron jobs to pass the maintenance secret via the `x-maintenance-secret` header instead of (or in addition to) the Bearer token. We'll insert `MAINTENANCE_SECRET` into vault so SQL can reference it.

### 2. Update all cron jobs to use `x-maintenance-secret` header

Update cron jobs 11-19 (maintenance, retry, AI gen, consensus, health check) to include the maintenance secret as a header. This way even if the Bearer token is wrong, the functions will authorize via the `x-maintenance-secret` check.

Migration to:
- Insert the maintenance secret value into vault (the user will need to provide it, or we create a new one and update the edge function secret too)
- Drop and recreate each cron job with headers including `'x-maintenance-secret'` from `vault.decrypted_secrets WHERE name = 'maintenance_secret'`
- Keep the Bearer token as a fallback

### 3. Redeploy all critical edge functions

Redeploy: `check-system-health`, `ai-generate-pattern`, `auto-retry-failed-patterns`, `run-pattern-maintenance`, `process-dismissal-consensus`, `reset-failed-patterns` to ensure `verify_jwt = false` config is synced to the gateway.

## Alternative simpler approach

Instead of vault gymnastics, fix the vault secret itself: delete the old `email_queue_service_role_key` and re-insert it with the correct service role key value. But we don't have direct access to the service role key value.

**Recommended approach**: Create a new vault secret `maintenance_secret`, set it to a known value, update the `MAINTENANCE_SECRET` edge function secret to match, then update all cron jobs to pass it via `x-maintenance-secret` header.

## Files Modified
- Database migration — Insert vault secret + update all cron job definitions
- No code file changes needed (edge functions already accept `x-maintenance-secret`)

## Technical Details
- The `ai-generate-pattern`, `run-pattern-maintenance`, `auto-retry-failed-patterns`, `check-system-health`, `process-dismissal-consensus` functions all already check `x-maintenance-secret` header
- pg_net `http_post` supports arbitrary headers via jsonb — we just need to add the header
- Once crons authenticate successfully, the heartbeat monitors will turn green within one cycle (15 min)
- The SMS alert system will also start working — it will send a recovery text when systems come back online

