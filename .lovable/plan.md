

## Improving the AI Pattern Generator

After reviewing the full pipeline (`ai-generate-pattern`, `auto-retry-failed-patterns`, `process-dismissal-consensus`), here are the concrete issues and proposed fixes:

### Problem 1: action_type is Always Hardcoded

In `insertPattern()` (line 627), the AI's action output is ignored — it always maps to either `"reject"` or `"close"`:
```text
const action = aiResult.action === "hide" ? "close" : "reject";
```
The AI tool schema only offers `"click"` or `"hide"` as options (line 540), so the actual button function (accept vs reject) is never captured. This caused the skatepro mislabeling.

**Fix:** Change the AI tool schema to return `action_type` with values `accept`, `reject`, `close`, `necessary`, `save` (matching the DB constraint). Update `insertPattern()` to use the AI's returned value directly.

### Problem 2: No Selector/Action Contradiction Check

Nothing validates whether a selector containing "accept" in its ID/class is labeled as `reject` (or vice versa).

**Fix:** Add a post-AI validation step that checks for contradictions between the selector text and the action_type. Auto-correct obvious mismatches or flag as `needs_manual_review`.

### Problem 3: Consensus Always Assumes "reject"

In `process-dismissal-consensus` (line 42), every user dismissal is recorded as `action_type: "reject"`. But users might be clicking "accept" buttons to dismiss banners — the intent is dismissal, not necessarily rejection.

**Fix:** Infer action_type from the `clicked_selector` text (if it contains "accept" → `accept`, etc.) instead of hardcoding `reject`.

### Problem 4: No Duplicate/Conflict Detection

The generator can create a new pattern for a domain that already has an active, high-confidence pattern with a different selector — leading to competing patterns.

**Fix:** Before inserting, check if an active pattern with confidence >= 7 already exists for that domain. If so, skip or log as `already_covered`.

### Problem 5: Confidence Cap is Arbitrary

AI-generated patterns are capped at confidence 6 (line 629), even when the AI returns confidence 9-10 for known CMPs. This means AI patterns are always treated as lower quality.

**Fix:** Use a smarter cap: CMP-detected patterns start at 7, AI patterns cap at 6, and let success tracking raise them naturally.

---

### Files to Modify

| File | Changes |
|---|---|
| `supabase/functions/ai-generate-pattern/index.ts` | Update AI tool schema to return proper `action_type`. Fix `insertPattern()` to use AI value. Add contradiction validation. Add duplicate detection. |
| `supabase/functions/process-dismissal-consensus/index.ts` | Infer `action_type` from `clicked_selector` instead of hardcoding `reject`. |

### Technical Details

**Updated AI tool schema** (replaces current `action` enum):
```text
action_type: {
  type: "string",
  enum: ["accept", "reject", "necessary", "save", "close"],
  description: "What the button ACTUALLY DOES. 'accept' = accepts all cookies, 
    'reject' = rejects/declines, 'necessary' = essential only, 
    'save' = saves current preferences, 'close' = closes/hides banner"
}
```

**Contradiction validator:**
```text
function validateSelectorAction(selector, actionType):
  if selector matches /accept|agree|allow/i AND actionType is "reject" → flag
  if selector matches /reject|decline|deny/i AND actionType is "accept" → flag
```

**Consensus action inference:**
```text
if clicked_selector matches /accept|agree|allow/i → "accept"
if clicked_selector matches /reject|decline|deny/i → "reject"  
if clicked_selector matches /close|dismiss|x-button/i → "close"
else → "reject" (default)
```

