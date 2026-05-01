# Cookie Yeti Retirement & Handoff Plan

Goal: stop all outbound activity (SMS, AI calls, scheduled jobs) from this Lovable/Supabase project (`keowunrxpxlbgebujbao`) while keeping data queryable. Hand off operational ownership to the new project `rcqfqhguwpmaarseifqg`.

---

## 1. Cron jobs — kill list

Currently scheduled in `cron.job`:

| jobid | jobname | schedule | action |
|---|---|---|---|
| 31 | ai-generate-patterns-batch | */15 * * * * | **UNSCHEDULE** |
| 29 | auto-retry-failed-patterns | 0 3 * * * | **UNSCHEDULE** |
| 32 | check-system-health | */15 * * * * | **UNSCHEDULE** (this is the SMS source) |
| 30 | process-dismissal-consensus | 0 4 * * * | **UNSCHEDULE** |
| 33 | reset-failed-patterns-monthly | 0 5 1 * * | **UNSCHEDULE** |
| 28 | run-pattern-maintenance-every-6h | 0 */6 * * * | **UNSCHEDULE** |
| 10 | process-email-queue | 5 seconds | **UNSCHEDULE** (drains transactional/auth email queue — no longer needed since app is retired) |

Migration will use a `DO` block with `cron.unschedule(jobname)` wrapped in `BEGIN/EXCEPTION WHEN OTHERS` per job so missing jobs don't fail.

After migration I'll re-query `cron.job` and show the before/after diff.

---

## 2. Edge functions — neutralize to kill-switch stubs

Replace the body of these with a 200 stub returning:
```json
{"status":"retired","forwarded_to":"rcqfqhguwpmaarseifqg","retired_on":"2026-05-01"}
```

Functions to neutralize (keep slugs deployed, just stub the code):

- `check-system-health` — primary SMS culprit
- `notify-sms` — direct Twilio caller
- `auto-retry-failed-patterns`
- `run-pattern-maintenance`
- `ai-generate-pattern`
- `report-missed-banner` — triggers ai-generate-pattern + email alerts
- `process-dismissal-consensus`
- `reset-failed-patterns`
- `probe-external`, `probe-report` — outbound probes
- `process-email-queue`, `send-transactional-email`, `auth-email-hook` — email sending
- `report-site`, `submit-contact`, `submit-hire-request` — these send notification emails/SMS to admin

Stub keeps CORS headers and responds 200 to OPTIONS + any method. Each will be redeployed via `supabase--deploy_edge_functions`.

**Left alone (read/write only, no outbound):**
- `create-checkout`, `stripe-webhook` — payment functions; safe to leave (Stripe still flows to historical data). I'll flag these for you to disable on Stripe side if desired.
- `upsert-device-token`, `validate-activation-code`, `send-activation-code`, `webauthn-*`, `validate-intake`, `report-dismissal`, `handle-email-unsubscribe`, `handle-email-suppression`, `preview-transactional-email`, `ingest-pihole-stats` — non-alerting; harmless. Will list in inventory but not stub.

If you'd rather stub *every* function, say so and I'll expand the list.

---

## 3. Inventory deliverable

After kill-switch is applied, I'll print one consolidated report:

- **Edge functions**: name, retired/active, purpose, callers
- **Cron jobs**: before/after listing
- **Tables** (28 total): row counts already gathered — `cookie_patterns:86`, `missed_banner_reports:61`, `subscriptions:5`, `granted_access:5`, `device_registrations:3`, `dismissal_reports:9`, `ai_generation_log:148`, `admin_activity_log:6`, `system_alert_state:1`, `email_send_log:83`, plus 18 others. I'll include all with writers/readers.
- **Storage buckets**: `email-assets` (public), `intake-documents` (private)
- **Auth hooks/triggers**: `auth-email-hook` function (will be stubbed); DB triggers list
- **Secrets** (names only): SUPABASE_*, TWILIO_API_KEY, SMTP_*, PRIVATEMAIL_*, STRIPE_*, EMAIL_TO, LOVABLE_API_KEY, MAINTENANCE_SECRET, PIHOLE_INGEST_KEY
- **External integrations**: Stripe, Twilio (connector), PrivateMail SMTP, Lovable AI Gateway

---

## 4. Credential export confirmation

I'll print a checklist showing which of these are SET (✓) or MISSING (✗) on this project, no values:
- LOVABLE_API_KEY ✓
- TWILIO_API_KEY ✓ (connector-managed)
- TWILIO_TO — not present as named secret (hardcoded `816-500-7236` in functions)
- TWILIO_FROM — not present as named secret
- PRIVATEMAIL_EMAIL ✓, PRIVATEMAIL_PASSWORD ✓
- SMTP_HOST/PORT/USER/PASS ✓
- EMAIL_TO ✓

Note: `TWILIO_TO` and `TWILIO_FROM` aren't separate secrets here — the destination number is inline in `notify-sms`/`check-system-health`, and the From number comes from the Twilio connector config. You'll want to set these explicitly on the new project.

---

## 5. Handoff banner

Add to `README.md` (top) and `index.html` `<title>`/meta:

```
> ⚠️ RETIRED 2026-05-01. This project has been superseded by
> rcqfqhguwpmaarseifqg, managed via the bestlytech repo and a
> Cowork agent. Do not deploy changes here. See
> docs/agent-runbook.pdf in the new repo for the current
> operating model.
```

Also add a `RETIRED.md` at repo root with the same notice and a pointer to the new project ref.

---

## 6. Execution order (once approved)

1. Migration: unschedule the 7 cron jobs (DO block, idempotent)
2. Rewrite ~13 edge function `index.ts` files to kill-switch stubs
3. Deploy all neutralized functions
4. Add retirement banner to README.md + create RETIRED.md
5. Re-query `cron.job` and confirm empty (or only safe SQL-only jobs remain — there are none in this project)
6. Print final confirmation report with before/after cron diff, stubbed function list, full inventory, and secret-name checklist

**Not doing**: deleting any functions, dropping any tables, pausing the project, removing secrets, or touching Stripe webhooks at the provider level. All data remains queryable.

---

## Technical notes

- `cron.unschedule(text)` raises if the job doesn't exist → wrapped per-job in `BEGIN ... EXCEPTION WHEN OTHERS THEN NULL; END;`.
- Stub template (per function):
  ```ts
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-maintenance-secret" };
  Deno.serve((req) => req.method === "OPTIONS"
    ? new Response(null, { headers: cors })
    : new Response(JSON.stringify({ status: "retired", forwarded_to: "rcqfqhguwpmaarseifqg", retired_on: "2026-05-01" }),
        { status: 200, headers: { ...cors, "Content-Type": "application/json" } }));
  ```
- `supabase/config.toml` left as-is (function configs harmless once bodies are stubs).
- `process-email-queue` cron uses Vault secret + 5-second interval — unscheduling it is the only way to silence it without touching Vault.

Approve and I'll execute in one pass.
