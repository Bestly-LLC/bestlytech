

# Fix Cookie Yeti Pricing Everywhere

## Problem

The correct pricing is:
- Monthly: **$0.99/mo**
- Yearly: **$7.99/yr**
- Lifetime: **$149.99** (already correct)

Currently the Cookie Yeti page and email preview data show $4.99/mo and $39.99/yr, and the "Save 33%" badge needs recalculating (savings are now ~33% as well: $0.99x12=$11.88 vs $7.99 = 33% savings, so badge is still accurate).

The email templates themselves are fine -- they receive the actual amount from Stripe at runtime. The only hardcoded wrong prices are in the preview/test data and the CookieYeti page.

## Changes

### 1. `src/pages/CookieYeti.tsx` — Update CONFIG and FAQ
- Change `CONFIG.pricing.monthly` from `"$4.99"` to `"$0.99"`
- Change `CONFIG.pricing.yearly` from `"$39.99"` to `"$7.99"`
- Update FAQ answer from `"Monthly at $4.99/mo, Yearly at $39.99/yr (save 33%)"` to `"Monthly at $0.99/mo, Yearly at $7.99/yr (save 33%)"`

### 2. `supabase/functions/_shared/transactional-email-templates/order-confirmation.tsx` — Fix preview data
- Change `previewData` amount from `'$29.99'` to `'$7.99'`

### 3. Redeploy edge functions
- Deploy `send-transactional-email` so the updated preview data takes effect

