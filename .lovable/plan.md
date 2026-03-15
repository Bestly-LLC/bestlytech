

# Bestly-Branded Alert Email Redesign

## What changes

Redesign the `alertEmail()` function and `baseLayout()` in `supabase/functions/_shared/email-template.ts` to be fully Bestly-branded with the logo, matching the site's navy/indigo identity with a bold, polished design.

## Design

Since email clients can't render local assets, the logo will be referenced from the published site's built assets. We'll use the published URL to source the logo image.

**Header**: Deep navy banner (`#1e3a5f`) with the Bestly logo (rotated 20° to match the site) + "Bestly" wordmark in white — mirroring the site header exactly.

**Body card**: White card with generous padding, a gradient accent line at top (matching the footer's gradient accent), and the severity badge redesigned with bolder styling.

**Stats section**: Navy-backed metric cards instead of the current gray background — each stat in a rounded pill with white text on navy.

**Items table**: Alternating row shading with the brand's indigo-blue accent for row borders instead of plain gray.

**Footer**: Trust badges row ("GDPR Compliant · CCPA Ready · Zero Data Resale") + "Bestly Technologies · Los Angeles, CA" — matching the site footer.

**Color palette** (from the site):
- Primary navy: `#1e3a5f`
- Accent indigo: `#4f7cac`
- Gradient accent: navy → indigo → transparent
- Background: `#f8f9fa`

## Technical details

- Edit `baseLayout()` to include the logo image from the published site URL, the 20° rotation, gradient accent line, and trust badges footer
- Edit `alertEmail()` to use bolder severity styling with navy stat cards
- `brandedEmail()` automatically inherits the new `baseLayout()`
- `activationCodeEmail()` is untouched (it has its own Cookie Yeti layout)
- Redeploy `run-pattern-maintenance` and `send-activation-code` edge functions

## Files

| File | Action |
|------|--------|
| `supabase/functions/_shared/email-template.ts` | Edit `baseLayout()` + `alertEmail()` — full Bestly brand overhaul |
| Edge functions | Redeploy `run-pattern-maintenance` |

