

# Fix: AI Pattern Generator Misidentifying Non-Cookie-Banner HTML

## Problem Summary

The AI pattern generator successfully ran on `us.shein.com`, but the HTML captured by the extension was Shein's **signup/registration popup** — not a cookie consent banner. The AI analyzed the wrong element and created a useless pattern. This is why visiting Shein again doesn't dismiss any cookie banner.

The core issue is on the **extension side** (capturing the wrong HTML), but we can add server-side validation to prevent this class of error.

## What's Working Correctly

- The flow works end-to-end: AI generates selector → inserts into `cookie_patterns` → extension queries patterns on next visit
- The `upsert_pattern` RPC and `mark_ai_processed` logic are correct
- The "Re-run AI" button and stale-skip clearing logic from the last fix are correct

## Changes Needed

### 1. Add HTML validation to the AI prompt (ai-generate-pattern edge function)

Update the AI prompt to instruct the model to **reject HTML that isn't a cookie/consent banner**. Add a new JSON field `is_cookie_banner: boolean` to the expected response. If the AI determines the HTML is not a cookie banner (e.g., it's a signup popup, newsletter modal, etc.), log it as `skipped_not_cookie_banner` and don't insert a pattern.

This prevents garbage patterns from polluting the database even when the extension sends the wrong HTML.

### 2. Add a "Delete Pattern" action to the Community Learning admin UI

In the Domains tab or Recent Patterns table, add a delete button so the admin can manually remove incorrect patterns (like the current Shein one). This calls a `DELETE` on `cookie_patterns` for that row.

### 3. Clean up the bad Shein data

- Delete the incorrect `cookie_patterns` entry for `us.shein.com` with the signup popup selector
- Reset the `missed_banner_reports` entry so it can be re-processed when the extension sends correct HTML
- Delete the misleading `ai_generation_log` "success" entry

### Files to Modify

1. **`supabase/functions/ai-generate-pattern/index.ts`** — Add `is_cookie_banner` validation to AI prompt and response handling
2. **`src/pages/admin/CommunityLearning.tsx`** — Add delete button for patterns in the admin UI
3. **Data cleanup** — Remove the bad Shein pattern and reset its report status

### Technical Detail: Updated AI Prompt Addition

The prompt will include:
> "First determine if this HTML is actually a cookie consent/privacy banner. If it's a signup form, newsletter popup, promotional modal, or any non-cookie element, set is_cookie_banner to false."

If `is_cookie_banner === false`, the function logs `skipped_not_cookie_banner` and moves on without inserting a pattern.

