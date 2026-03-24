

# Fix Activation Code Email Not Sending

## Problem

The `send-activation-code` edge function enqueues emails to `transactional_emails` without an `idempotency_key`. The Lovable Email API requires either `run_id` or `idempotency_key` for transactional emails. This causes `process-email-queue` to fail on every retry with error 400: "Missing run_id or idempotency_key". The email is stuck in the queue (currently at 5 failed attempts, about to hit DLQ).

## Fix

**File:** `supabase/functions/send-activation-code/index.ts`

Add `idempotency_key` to the enqueue payload. Use the `messageId` (already generated as a UUID) as the idempotency key:

```typescript
payload: {
  message_id: messageId,
  idempotency_key: messageId,  // <-- ADD THIS
  to: email,
  from: "Cookie Yeti <noreply@bestly.tech>",
  sender_domain: "notify.bestly.tech",
  subject: "Your Cookie Yeti activation code",
  html,
  purpose: "transactional",
  label: "activation_code",
  queued_at: new Date().toISOString(),
}
```

Then redeploy `send-activation-code`.

## Also: Clear the stuck message

The stuck message (msg_id 4) has failed 4+ times and will hit the DLQ on the next attempt. After deploying the fix, a new activation code request will work correctly. No database change needed — the stuck message will age out.

## SwitchBot Chrome Issue

This is a browser extension behavior difference — the pattern may work in Safari's content script context but not Chrome's. This is outside the scope of this backend fix and would need investigation in the extension codebase.

