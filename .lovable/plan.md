

# Surface "No Banner Detected" Reports in Admin Panel

## Overview

Three changes: a new "Manual Review" tab for no-HTML reports, a "Skipped" section in the AI Gen tab, and auto-triggering the edge function on empty-HTML reports.

## 1. New "Manual Review" Tab

**File:** `src/pages/admin/CommunityLearning.tsx`

Add a new tab between "Reports" and the end (or after "Reports") called "Manual Review" with an `AlertTriangle` icon.

- Filter `candidates` (already fetched from `missed_banner_reports`) for rows where `banner_html` is null/empty and `resolved = false`
- Display: domain, report_count, last_reported, cmp_fingerprint, page_url
- Each row gets a "Fetch & Process" button that calls `report-missed-banner` edge function with `{ domain, page_url }` (no `banner_html`) — triggering server-side fetch + AI generation
- Show a count badge on the tab
- Reuse the existing `handleRerunAI` pattern for the fetch call, but target `report-missed-banner` instead of `ai-generate-pattern`

## 2. Skipped Domains Section in AI Gen Tab

**File:** `src/pages/admin/CommunityLearning.tsx`

In the existing "AI Gen" tab content, add a collapsible section below the current AI log table:

- Filter `aiGenLog` for `status === 'skipped_no_html'`
- Show domain, `created_at` (time ago), and a "Retry" button
- Retry calls `report-missed-banner` with the domain (server-side fetch attempt)
- Deduplicate by domain (show latest skip per domain)

## 3. Auto-Trigger Server-Side Fetch for Empty HTML

**File:** `supabase/functions/report-missed-banner/index.ts`

Currently the edge function always calls `ai-generate-pattern` after saving the report. The AI generator already has a `fetchAndExtractBannerHTML()` fallback (Layer 3 in the pipeline), so no changes needed to the AI function itself.

The change: when `banner_html` is empty/null, still trigger `ai-generate-pattern` (it already is), but pass a hint flag so the AI function knows to prioritize server-side fetch. Actually, looking at the existing code, `report-missed-banner` already calls `ai-generate-pattern` unconditionally — so empty-HTML reports already auto-trigger AI. The issue is the AI skips them because it checks `banner_html` on the `missed_banner_reports` row.

**Fix:** In `report-missed-banner/index.ts`, when `banner_html` is empty, pass `{ domain, force_server_fetch: true }` to `ai-generate-pattern`. Then in `ai-generate-pattern/index.ts`, when `force_server_fetch` is true OR `banner_html` is empty, skip the "skipped_no_html" early return and jump straight to the server-side fetch layer.

### Database Changes
None required.

### Edge Function Changes

**`supabase/functions/report-missed-banner/index.ts`:**
- Pass `force_server_fetch: true` when `banner_html` is empty

**`supabase/functions/ai-generate-pattern/index.ts`:**
- Accept `force_server_fetch` param
- When true, bypass the `skipped_no_html` check and go to server-side fetch

## Technical Details

- New state: `noHtmlReports` derived from existing `candidates` data (already fetched)
- New handler: `handleFetchAndProcess(domain, page_url)` — calls `report-missed-banner` edge function
- Tab badge shows count of no-HTML unresolved reports
- Skipped section in AI Gen uses existing `aiGenLog` state filtered by status

