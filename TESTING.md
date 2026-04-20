# Testing — bestlytech

> Placeholder stub created 2026-04-20 by the spec-alignment audit. No automated
> tests exist yet in this repo (no `*.test.*` / `*.spec.*` files outside
> `node_modules`). This file is a manual test charter so future work has a
> starting point.

## Manual smoke checklist

These are the user-facing flows that most need a smoke pass before each deploy.
Item numbers match the `Spec Alignment` section of the shared `App Audit Log`
Google Doc.

### Marketplace Account Setup (`/marketplace-setup`)

The intake form that external clients (e.g. Elizabeth at The Shift Shop,
Shehryar at Purely Hunza) use to hand off Amazon / Shopify / TikTok Shop
setup information.

- Step 0 — Readiness: select Amazon / Shopify / TikTok (any combination), see
  the merged platform-specific readiness checklist, fill contact info.
- Step 1 — Business: legal name, EIN, operating address, and upload the two
  required documents:
  - **Business Registration** (Certificate of Formation / Articles of
    Organization — not the IRS EIN letter).
  - **Proof of Business Address** (bank statement, utility bill, or
    government correspondence dated within 180 days).
- Step 2 — Owner: owner identity, ID-Front / ID-Back uploads, personal
  address proof, optional representative-setup path (RepID + Authorization
  Letter).
- Step 3 — Bank: US vs international, per-platform banks when "same bank"
  toggle is off, card-last-4 for Amazon/Shopify subscriptions (skipped for
  TikTok-only).
- Step 4 — Brand & Accounts (`Step4BrandAccounts.tsx`): existing Amazon
  Seller Central / Shopify / TikTok Shop account reuse, Amazon Brand
  Registry + Trademark upload, Shopify theme/payments, TikTok category +
  warehouse.
- Step 5 — Review (`Step5Review.tsx`): final review and submit.

Known orphaned files that are NOT wired into the flow and must not be edited
without first consolidating:

- `src/components/amazon-setup/steps/Step4Brand.tsx` — superseded by
  `Step4BrandAccounts.tsx`.
- `src/components/amazon-setup/steps/Step7Review.tsx` — superseded by
  `Step5Review.tsx` (no Step 6 exists).

### Admin (`/admin`)

Gated by `AdminRoute` + `AdminLayout`. Manual pass: login via Apple,
submissions list, submission detail, waitlist, hires, contacts, CookieYeti
dashboard subpages, Home Hub subpages (Overview, Pi-hole, Home Assistant,
Homebridge).

### Public product / marketing pages

`/`, `/about`, `/products` (and `/apps` alias), `/services`, `/hire`,
`/contact`, `/report-site`, `/press`, plus per-product pages: CookieYeti,
InventoryProof, Hoku, NeckPilot, Apple Modernization, Tesla Rentals.
Support / privacy / legal pages: CookieYeti, Confesh, general Privacy
Policy, Terms of Service, Terms of Use, Developer Compliance.

## What's NOT covered yet

- No unit tests (Vitest / Jest not configured).
- No component tests (React Testing Library not configured).
- No E2E tests (Playwright / Cypress not configured).
- No CI test step in the GitHub workflow (check `.github/workflows/` if/when
  added).

When automated tests are introduced, the intake flow (`/marketplace-setup`)
is the highest-value first target because it is (a) the only flow with
document uploads, (b) the only flow that persists data to Supabase outside
the admin panel, and (c) the flow most exposed to real clients.
