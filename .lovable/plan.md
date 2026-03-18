

## Add AI System Health Alert Emails

### What You Get
A proactive email alert sent to you (jaredbest@icloud.com) from Bestly whenever the AI pattern generation system has issues. You won't need to monitor the dashboard — the system will tell you when something needs attention.

### What Already Exists
- `auto-retry-failed-patterns`: Already emails you when domains exhaust 5 retry attempts (permanently failed)
- `run-pattern-maintenance`: Already emails you for pattern fix failures and high-report domains
- Both use PrivateMail SMTP + the shared `alertEmail` template

### What's Missing
The main `ai-generate-pattern` function processes batches silently. If the AI model fails, if most candidates error out, or if the system encounters unexpected issues, nobody knows until you manually check the dashboard.

### The Fix

**File:** `supabase/functions/ai-generate-pattern/index.ts`

Add an alert email at the end of the batch processing (after the `for` loop, before the response) that fires when:
- **High failure rate**: More than 50% of candidates in a batch failed
- **Zero successes in a batch of 3+**: Processed several but generated nothing
- **Unexpected errors**: Any uncaught error in the main try/catch

The email will use the existing `alertEmail` template and PrivateMail SMTP (same pattern as `auto-retry-failed-patterns`). It will include:
- Stats: processed, generated, failed, skipped counts
- List of failed domains with their error reasons
- Timestamp

This is ~40 lines added to the existing response section of `ai-generate-pattern/index.ts`. No new functions, no new files, no database changes.

### Technical Detail

```text
End of batch processing flow:

  [existing loop finishes]
       ↓
  Check: failures > 50% of processed OR (processed >= 3 AND generated == 0)
       ↓ yes
  Build alertEmail with failure details
  Send via PrivateMail SMTP to jaredbest@icloud.com
  Subject: "Cookie Yeti: AI Generation Alert"
       ↓
  [existing response]
```

Import `SMTPClient` and `alertEmail` (already used in sibling functions). Use `PRIVATEMAIL_EMAIL` and `PRIVATEMAIL_PASSWORD` secrets (already configured).

