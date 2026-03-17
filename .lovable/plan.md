

# Fix: Platform-Aware Admin Submission Views

## Problem
The admin submission detail page (`AdminSubmissionDetail.tsx`) is entirely Amazon-centric. It only displays Amazon fields (store name, seller plan, amazon email/phone) and hardcodes the guidance query to `platform: "Amazon"`. If someone submits for Shopify or TikTok, the admin sees blank "—" values everywhere because those platform-specific fields are never rendered.

The submissions list also only shows `r.platform` (the legacy single-platform field) rather than `selected_platforms`.

## Changes

### 1. `AdminSubmissionDetail.tsx` — Add platform-aware sections
- Show a **Platforms** badge row at the top indicating which platforms were selected
- Make the **"Brand & Product"** section platform-aware:
  - Show Amazon subsection (store name, UPCs, category, fulfillment, etc.) only when Amazon is selected
  - Show Shopify subsection (store name, plan, domain, existing URL, shipping) only when Shopify is selected
  - Show TikTok subsection (shop name, handle, category, fulfillment, creator account) only when TikTok is selected
- Make the **"Account Details"** section platform-aware:
  - Amazon: email, phone, seller plan
  - Shopify: email
  - TikTok: email, phone
- Fix the guidance query: instead of hardcoding `platform: "Amazon"`, query for all platforms in `selected_platforms` (or use an `in` filter)

### 2. `AdminSubmissions.tsx` — Show selected platforms
- Replace the single `r.platform` badge with a list of `r.selected_platforms` badges (falling back to `r.platform` for legacy rows)

### 3. No database or form changes needed
The form already collects Shopify and TikTok data correctly and saves it to the right columns. This is purely an admin display issue.

