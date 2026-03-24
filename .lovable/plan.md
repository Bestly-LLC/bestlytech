

# Cookie Yeti Transactional Email Setup

## What We're Building

Three branded email templates for Cookie Yeti, all sent through the existing email infrastructure (notify.bestly.tech domain, already verified):

1. **Order Confirmation** — Triggered after a successful Stripe payment (checkout.session.completed). Shows the plan purchased (Monthly/Yearly/Lifetime), amount, and a thank-you message.

2. **Welcome Email** — Triggered after a new subscription is created (same webhook, after the order confirmation). Welcomes the user to Cookie Yeti, explains what they get, and links to download/activate.

3. **Subscription Status Notification** — Triggered on subscription changes: renewal success, cancellation, past_due, or expiration. Keeps users informed about their account status.

## Approach

The project already has a working email queue (`enqueue_email` RPC, `process-email-queue` cron) and the `send-activation-code` function already sends via this queue. However, there's no formal transactional email scaffold (no `send-transactional-email` Edge Function, no registry, no unsubscribe page).

**We'll scaffold the full transactional infrastructure first**, then create the three templates.

## Steps

### 1. Scaffold transactional email infrastructure
- Use the scaffold tool to create `send-transactional-email`, `handle-email-unsubscribe`, `handle-email-suppression` Edge Functions and the registry pattern
- This builds on top of the existing queue infrastructure

### 2. Create three email templates
All in `supabase/functions/_shared/transactional-email-templates/`:

- **`order-confirmation.tsx`** — Cookie Yeti arctic/ice theme (matching existing activation code style). Shows plan name, amount paid, order date. Subject: "Your Cookie Yeti order is confirmed"
- **`welcome.tsx`** — Warm welcome with quick-start steps (install extension, activate with code, enjoy). Subject: "Welcome to Cookie Yeti!"
- **`subscription-update.tsx`** — Dynamic template handling renewal, cancellation, past_due, and expiration states with appropriate messaging. Subject varies by status.

All templates will use the Cookie Yeti navy/ice palette (#1a365d, #bfdbfe) and Plus Jakarta Sans typography to match the existing activation code email branding.

### 3. Register templates in `registry.ts`

### 4. Wire up the Stripe webhook
Update `stripe-webhook/index.ts` to send emails on:
- `checkout.session.completed` → order-confirmation + welcome
- `customer.subscription.updated` → subscription-update (renewal/past_due)
- `customer.subscription.deleted` → subscription-update (canceled)

Each send uses `supabase.functions.invoke('send-transactional-email', ...)` with proper idempotency keys derived from the Stripe event ID.

### 5. Create unsubscribe page
Add a `/email-unsubscribe` route in the app that validates tokens and processes unsubscribes via the `handle-email-unsubscribe` Edge Function.

### 6. Deploy all Edge Functions
Deploy `send-transactional-email`, `handle-email-unsubscribe`, `handle-email-suppression`, and the updated `stripe-webhook`.

## Files Modified/Created
- `supabase/functions/send-transactional-email/index.ts` — scaffolded
- `supabase/functions/handle-email-unsubscribe/index.ts` — scaffolded
- `supabase/functions/handle-email-suppression/index.ts` — scaffolded
- `supabase/functions/_shared/transactional-email-templates/registry.ts`
- `supabase/functions/_shared/transactional-email-templates/order-confirmation.tsx`
- `supabase/functions/_shared/transactional-email-templates/welcome.tsx`
- `supabase/functions/_shared/transactional-email-templates/subscription-update.tsx`
- `supabase/functions/stripe-webhook/index.ts` — add email sends
- `src/pages/EmailUnsubscribe.tsx` — unsubscribe page
- `src/App.tsx` — add route

