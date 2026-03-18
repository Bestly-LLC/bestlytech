

## Fix: CMP Detection When Banner HTML is Missing

### The Problem

The current code already has comprehensive CMP script signature detection (lines 10-147, `detectKnownCMP` function). However, when `candidate.banner_html` is null/empty, the code **skips the entire domain at line 294-307** before ever reaching the CMP detection layers. This means sites like skatepro.com where the extension captures no banner HTML get marked as `skipped_no_html` and never benefit from script tag detection.

### The Fix

**File:** `supabase/functions/ai-generate-pattern/index.ts`

**Single change:** Replace the early `skipped_no_html` bailout (lines 294-307) with a server-side fetch + CMP detection attempt. Instead of skipping, fetch the page HTML and run `detectKnownCMP()` on it. Only skip if the server fetch also fails or finds no CMP.

**Updated flow for null banner_html:**
1. Fetch page HTML server-side via `fetchPageHtml()`
2. Run `detectKnownCMP()` on fetched HTML — if match, insert CMP pattern (confidence 7) and continue
3. If CMP detection fails, extract cookie elements and try AI analysis
4. Only mark as `skipped_no_html` if server fetch itself fails

This is a ~30-line change replacing the 12-line skip block. No new functions needed — `detectKnownCMP`, `insertCMPPattern`, `fetchPageHtml`, `extractCookieElements`, and `callAI` all already exist.

### Why This Works

Skatepro's static HTML contains `<script src="https://app.usercentrics.eu/browser-ui/loader.js">`. The existing `detectKnownCMP()` already checks for `usercentrics.eu` in its `scriptSignatures`. The only issue is the code never gets a chance to run because of the early bailout.

### Confidence Level

CMP-detected patterns from server HTML will use the existing confidence 7 (same as Layer 1/3a CMP detection). No schema or database changes needed.

