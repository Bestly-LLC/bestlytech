

# Server-Side Fallback for AI Pattern Generator

## Problem
The extension fails to capture cookie banner HTML on sites like Shein (late-loading, iframe, shadow DOM). It sends generic page HTML, the AI correctly rejects it, and no pattern is ever created.

## Solution

### 1. Add Known CMP Signatures Map + Server-Side Fetch Fallback

In `supabase/functions/ai-generate-pattern/index.ts`, after the AI rejects extension HTML as `is_cookie_banner: false`:

**Step A — Fetch the page server-side** using `fetch(page_url || "https://" + domain)` with a browser-like User-Agent.

**Step B — Check for known CMP signatures** in the fetched HTML. A hardcoded map of ~7 CMPs:
- OneTrust → `#onetrust-reject-all-handler`
- Cookiebot → `#CybotCookiebotDialogBodyButtonDecline`
- Didomi → `.didomi-continue-without-agreeing`
- Quantcast → `#qc-cmp2-container [mode="secondary"]`
- TrustArc → `.truste-consent-required`
- Complianz → `.cmplz-deny`

If a known CMP is detected, insert the standard pattern directly via `upsert_pattern` and log as `success_cmp_fallback`. No AI call needed.

**Step C — If no known CMP**, extract cookie-related HTML elements from the fetched page (elements with class/id matching cookie, consent, gdpr, etc.) and send that extracted HTML to the AI for a second attempt.

**Step D — If second AI attempt also fails**, then log as `failed_not_cookie_banner`.

### 2. Updated Flow Logic (inside the `for` loop)

```text
1. AI analyzes extension HTML
2. is_cookie_banner === true  → generate pattern (existing)
3. is_cookie_banner === false →
   a. fetch page server-side
   b. check known CMP signatures → insert standard pattern, log success_cmp_fallback
   c. no known CMP → extract cookie-related elements → AI attempt #2
   d. attempt #2 succeeds → generate pattern (log as success)
   e. attempt #2 fails → log failed_not_cookie_banner
```

### 3. Admin UI Badge Update

In `CommunityLearning.tsx`, add `success_cmp_fallback` to `AI_STATUS_BADGE` with a distinct color (e.g., blue) to distinguish CMP-detected patterns from AI-generated ones.

### 4. Data Cleanup

Delete the current `failed_not_cookie_banner` log entry for `us.shein.com` and reset `ai_attempts`/`ai_processed_at` on `missed_banner_reports` so it gets re-processed.

## Files to Modify
1. **`supabase/functions/ai-generate-pattern/index.ts`** — server-side fetch, CMP detection map, second AI attempt, new status
2. **`src/pages/admin/CommunityLearning.tsx`** — add `success_cmp_fallback` badge

## Technical Notes
- Server-side fetch won't execute JS, so dynamically-injected CMP scripts won't render. But the `<script src="...cookiebot...">` tags and CMP container divs are usually in the static HTML, which is enough for signature detection.
- The CMP signature map covers the most common providers (~80% of sites with cookie banners).
- The extracted-elements fallback handles less common CMPs that aren't in the map but still have identifiable cookie-related class names in static HTML.

