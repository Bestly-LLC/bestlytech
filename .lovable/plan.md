

## Make the AI Fixer Bulletproof

This overhaul addresses five systemic problems causing repeated failures in the autonomous cookie pattern pipeline. After this, known CMPs resolve instantly, shadow DOM CMPs route correctly, and failed domains get a second-chance AI model before giving up.

---

### What Changes

**1. Database: Add `strategy` column to `cookie_patterns`**
- Single migration: `ALTER TABLE cookie_patterns ADD COLUMN IF NOT EXISTS strategy TEXT;`
- When set (e.g. `'usercentrics'`), the extension uses its built-in JS API handler instead of `document.querySelector()`
- NULL = normal CSS selector matching (AI-generated patterns)

**2. Layer 0 Enhancement: Set `strategy` on CMP fingerprint matches**
- The existing Layer 0 code (lines 296-324) already matches `cmp_fingerprint` to `KNOWN_CMPS` — just needs to also set the `strategy` column after insert
- One additional `.update({ strategy: knownCMP.cmp_fingerprint })` call

**3. Layer 1/3 Enhancement: Set `strategy` on all CMP detections**
- `insertCMPPattern()` (lines 798-845) handles all CMP-detected inserts — add `strategy` update there once, covering all CMP detection layers automatically

**4. Gemini Failsafe (new Layer between current AI failure and marking as failed)**
- New `geminiFailsafe()` function using Lovable AI gateway with `google/gemini-2.5-flash` model
- Different prompt strategy: analyzes full-page HTML for CMP clues (script tags, config objects) rather than looking for banner elements
- If Gemini identifies a known CMP, sets `strategy` field; if it finds a custom selector, caps confidence at 6
- Wired in at line ~479 (after "ALL PATHS FAILED" comment, before marking as failed)
- Uses existing `LOVABLE_API_KEY` — no new secrets needed

**5. Monthly reprocessing of old failures**
- New `reset-failed-patterns` Edge Function (simple, ~40 lines)
- Resets `resolved=false, ai_attempts=0` for domains that were `permanently_failed` 30+ days ago and still have no high-confidence active pattern
- Triggered on-demand from admin or via monthly cron

**6. Admin dashboard: Show "CMP Strategy" for strategy-based patterns**
- In `CommunityLearning.tsx` (or wherever patterns are displayed), if `strategy` is set, show "Handled via [CMP] strategy" badge instead of treating the selector as testable

---

### Files Modified

| File | Change |
|------|--------|
| `supabase/migrations/new` | Add `strategy TEXT` column |
| `supabase/functions/ai-generate-pattern/index.ts` | Add `strategy` updates in Layer 0 + `insertCMPPattern()`, add `geminiFailsafe()`, wire into pipeline |
| `supabase/functions/reset-failed-patterns/index.ts` | New function for monthly reprocessing |
| `supabase/config.toml` | Register `reset-failed-patterns` |
| `src/pages/admin/CommunityLearning.tsx` | Show strategy badge for CMP-routed patterns |

### Pipeline After Changes

```text
Report → [Layer 0] cmp_fingerprint match? → pattern + strategy, conf 9
           ↓ no
         [Layer 1] CMP in extension HTML? → pattern + strategy, conf 7
           ↓ no
         [Layer 2] AI (Gemini Pro) on HTML → pattern, conf ≤6
           ↓ no
         [Layer 3] Server fetch → CMP script tags? → pattern + strategy
           ↓ no
         [Layer 3b] AI on server HTML → pattern, conf ≤6
           ↓ no
         [Layer 4] Gemini Flash failsafe (different prompt) → pattern
           ↓ no
         Mark failed → auto-retry daily (5x) → permanently_failed
           ↓ 30 days
         Monthly reset → re-enters pipeline with improved detection
```

### Technical Notes

- Gemini failsafe uses Lovable AI gateway (`google/gemini-2.5-flash`), same auth as primary AI — no `GEMINI_API_KEY` needed
- `strategy` column is nullable, backward-compatible — existing patterns unaffected
- Health alert emails (already implemented) will cover Gemini failsafe failures too
- The `insertCMPPattern()` function is the single choke point for all CMP pattern inserts, so adding `strategy` there covers Layers 0, 1, and 3 automatically

