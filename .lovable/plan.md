

## Activation Code System Plan

Three deliverables, no UI changes.

### 1. Database Migration — `activation_codes` table

Run the provided SQL as a migration: creates the table with UUID primary key, unique index on (email, code), partial index on active emails, RLS with public SELECT and service_role-only write policies.

### 2. Edge Function: `send-activation-code`

Create `supabase/functions/send-activation-code/index.ts`:
- CORS headers + OPTIONS handler (matching existing pattern from `run-pattern-maintenance`)
- Validate email with regex
- Rate limit: count rows for this email where `created_at > now() - 1 hour`; reject if >= 5
- Delete inactive pending codes for this email (`active = false`)
- Generate 6-digit code (`Math.floor(100000 + Math.random() * 900000)`)
- Insert row with `expires_at = now() + 15 min`
- Send code via denomailer (same SMTP pattern as `run-pattern-maintenance`)
- Recipient is the user's email, sender is `PRIVATEMAIL_EMAIL`
- Register in `config.toml` with `verify_jwt = false`

### 3. Edge Function: `validate-activation-code`

Create `supabase/functions/validate-activation-code/index.ts`:
- CORS headers + OPTIONS handler
- Query `activation_codes` where email + code match, `active = false`, `expires_at > now()`
- If found: update `active = true`, `activated_at = now()`, `platform`, `ip_address` (from request headers), `expires_at = '2099-12-31'`
- Return success/failure JSON
- Register in `config.toml` with `verify_jwt = false`

### Files

| File | Action |
|------|--------|
| `supabase/migrations/..._activation_codes.sql` | Create — table + indexes + RLS |
| `supabase/functions/send-activation-code/index.ts` | Create |
| `supabase/functions/validate-activation-code/index.ts` | Create |
| `supabase/config.toml` | Edit — add both functions with `verify_jwt = false` |

No new secrets needed — `PRIVATEMAIL_EMAIL` and `PRIVATEMAIL_PASSWORD` already exist.

