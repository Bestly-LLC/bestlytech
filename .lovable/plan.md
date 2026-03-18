

# Hard Fix: AI Pattern Generator Pipeline

## Root Cause Analysis

Shein uses a **custom cookie banner** (not a known CMP) that is **100% JavaScript-rendered**. The static HTML from both the extension capture AND server-side fetch contain zero cookie-related elements. The current pipeline:

1. Extension sends signup popup HTML → AI correctly rejects it
2. Server-side fetch returns JS-only page → `extractCookieElements` finds nothing
3. Result: `failed_not_cookie_banner` every time

Additionally, the current `KNOWN_CMPS` array is only checked **after** the AI rejects the extension HTML (step 3b on server HTML). It should be checked **first** on the extension HTML itself, before wasting an AI call.

## Three-Layer Fix

### Layer 1: Expanded CMP Detection — Check Extension HTML First

**File: `supabase/functions/ai-generate-pattern/index.ts`**

- Move `detectKnownCMP()` call to **before** the first AI call. Run it on the extension-provided `banner_html` first. If a known CMP is detected, insert the standard pattern immediately with `success_cmp_fallback` status. Zero AI cost.
- Expand `KNOWN_CMPS` from 7 entries to ~15, adding: **Usercentrics**, **Iubenda**, **LiveRamp/PrivacyManager**, **CookieYes**, **Termly**, **Klaro**, **Civic/CookieControl**, **Admiral**, **Sourcepoint (sp-cc)**. Each entry includes detection signatures and standard reject/dismiss selectors.
- Keep the server-side CMP check as a secondary fallback for when extension HTML is bad.

New flow order:
```text
1. CMP check on extension HTML → if match → insert pattern, done
2. AI analysis on extension HTML (upgraded model)
3. If AI rejects:
   a. Server-side fetch
   b. CMP check on server HTML → if match → insert pattern, done
   c. Extract cookie elements → 2nd AI attempt
   d. If still fails → log as needs_manual_review
```

### Layer 2: Upgrade AI Model to Gemini 2.5 Pro

**File: `supabase/functions/ai-generate-pattern/index.ts`**

- Change the model from `google/gemini-3-flash-preview` to `google/gemini-2.5-pro` in the `callAI` function and in all `ai_model` log entries.
- Tighten the prompt with explicit validation rules:
  - "The selector you output MUST match an element present in the provided HTML"
  - "If you cannot find a cookie/consent/GDPR banner, set is_cookie_banner to false"
  - Add examples of what IS and IS NOT a cookie banner
  - Request structured output via tool calling instead of raw JSON parsing for more reliable responses

### Layer 3: `needs_manual_review` Status

**File: `supabase/functions/ai-generate-pattern/index.ts`**

- When all automated paths fail (CMP check on extension HTML, AI on extension HTML, CMP check on server HTML, AI on server HTML), log as `needs_manual_review` instead of `failed_not_cookie_banner`.
- Include diagnostic info in the log: what was tried, what failed, whether server fetch succeeded.

**File: `src/pages/admin/CommunityLearning.tsx`**

- Add `needs_manual_review` to `AI_STATUS_BADGE` with a distinct orange/warning style.
- In the AI Generation Log tab, make `needs_manual_review` entries stand out with a flag icon.

### Layer 4: Clean Up Shein Data

**SQL (data operation via insert tool)**

- Delete existing `ai_generation_log` entries for `us.shein.com`
- Reset `ai_attempts` and `ai_processed_at` on `missed_banner_reports` for `us.shein.com`

Since Shein uses a custom banner (not a known CMP), it will still hit `needs_manual_review` — but the upgraded Gemini 2.5 Pro model working on extension HTML has a much better chance of identifying the actual cookie banner if the extension captures it correctly in a future report. For now, Shein gets flagged for manual pattern entry.

## Files to Modify

1. **`supabase/functions/ai-generate-pattern/index.ts`** — CMP-first flow, expanded CMP list, model upgrade, tightened prompt, `needs_manual_review` status
2. **`src/pages/admin/CommunityLearning.tsx`** — add `needs_manual_review` badge styling

## Technical Details

- The `KNOWN_CMPS` array grows from 7 to ~15 entries. Each has `name`, `signatures[]`, `selector`, `action`, `cmp_fingerprint`.
- Model change: `google/gemini-3-flash-preview` → `google/gemini-2.5-pro` (pattern generation is one-time per domain, cost is negligible).
- The `callAI` function prompt will be enhanced with explicit rules and examples.
- No schema changes needed — `ai_generation_log.status` is a free-text field.

