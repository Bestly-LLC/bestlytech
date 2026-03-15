

# Cookie Yeti Branded Activation Code Email

## What changes

Redesign the `activationCodeEmail()` function in `supabase/functions/_shared/email-template.ts` to be fully Cookie Yeti themed instead of using the generic Bestly layout.

## Design

The activation code email will get its own dedicated layout with:

- **Dark header band** with a large snowflake emoji (❄️) and "Cookie Yeti" wordmark in white — matching the product's icy/privacy-first identity
- **Icy blue gradient background** (`#e8f4f8` to `#f0f7fa`) instead of generic gray
- **Code display**: Large digits on a frosted glass card with an icy blue border and subtle snowflake accents
- **Color palette**: Arctic blues (`#1a365d` deep navy, `#3b82f6` bright blue, `#bfdbfe` light ice, `#0ea5e9` accent cyan) — pulling from the product's identity
- **Tagline**: "Distraction-Free Browsing, Automatically" below the logo
- **Privacy badge**: Shield icon reference + "100% Privacy-First" in the footer
- **Footer**: "Cookie Yeti by Bestly Technologies · Los Angeles, CA"

## Technical details

- Only the `activationCodeEmail` function changes — `alertEmail` and `brandedEmail` stay as-is (those are admin/Bestly emails)
- The function will use its own inline layout rather than calling `baseLayout()`, so it's fully self-contained with the Cookie Yeti theme
- No other files change — just the one shared template file
- After editing, the `send-activation-code` edge function needs redeployment

## Files

| File | Action |
|------|--------|
| `supabase/functions/_shared/email-template.ts` | Edit `activationCodeEmail()` — full Cookie Yeti themed layout |
| `supabase/functions/send-activation-code/index.ts` | Redeploy (no code change) |

