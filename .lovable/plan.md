

# Rename "Amazon" to "Marketplace" and Add Platform Filtering

## Problem

The sidebar says "Amazon" but the intake system supports Amazon, Shopify, and TikTok Shop. The dashboard and submissions pages also lack platform-level filtering and breakdown.

## What's Missing

1. **Sidebar label** says "Amazon" — should say "Marketplace" (or "Marketplaces")
2. **Dashboard** doesn't show platform breakdown — all submissions are one bucket with no visibility into how many are Amazon vs Shopify vs TikTok
3. **Submissions list** has no platform filter dropdown — you can search by name/email and filter by status, but not by platform
4. **Dashboard recent submissions table** doesn't show platform column
5. **Setup Guide** already supports platform tabs (Amazon, Shopify, TikTok, Shared) — no changes needed there

## Changes

### 1. AdminSidebar.tsx
- Rename the "Amazon" group label to "Marketplace"

### 2. AdminDashboard.tsx
- Add platform breakdown stat cards or a mini chart showing submission counts per platform (Amazon / Shopify / TikTok)
- Add a "Platform" column to the Recent Submissions table
- Compute per-platform counts from `selected_platforms` array on each intake

### 3. AdminSubmissions.tsx
- Add a platform filter dropdown alongside the existing status filter (options: All, Amazon, Shopify, TikTok)
- Filter logic checks if the platform value exists in the `selected_platforms` array (or falls back to the `platform` column)

### 4. Files to modify
- `src/components/admin/AdminSidebar.tsx` — rename group label
- `src/pages/admin/AdminDashboard.tsx` — platform breakdown + platform column in recent table
- `src/pages/admin/AdminSubmissions.tsx` — platform filter dropdown

