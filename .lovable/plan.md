

# Fix Princess Polly + Improve OneTrust CCPA Variant Handling

## Root Cause

Princess Polly uses **OneTrust CCPA variant** (branded "CookiePro"), not the GDPR variant. The CMP detection correctly identified OneTrust in extension HTML, but the hardcoded selector `#onetrust-reject-all-handler, .ot-pc-refuse-all-btn` doesn't exist on CCPA-configured OneTrust deployments.

What Princess Polly actually has:
- `#onetrust-accept-btn-handler` → "Allow All"
- `.save-preference-btn-handler` → "Confirm My Choices" (saves with current toggles = minimal)
- `.onetrust-close-btn-handler` → Close X button
- **No** `#onetrust-reject-all-handler` — that's GDPR-only

The extension found OneTrust, saved a pattern with non-existent selectors, the extension tried to click them, nothing happened, and the OneTrust overlay backdrop stayed visible (the "splash screen").

## Changes

### 1. SQL: Insert correct Princess Polly pattern immediately

```sql
INSERT INTO cookie_patterns (domain, selector, action_type, cmp_fingerprint, source, confidence, is_active)
VALUES ('us.princesspolly.com', '.save-preference-btn-handler, .onetrust-close-btn-handler, #onetrust-accept-btn-handler', 'reject', 'onetrust', 'manual', 0.90, true)
ON CONFLICT (domain, selector) DO UPDATE SET confidence = 0.90, is_active = true, source = 'manual', updated_at = now();
```

Also deactivate the broken pattern and resolve reports.

### 2. Expand OneTrust CMP selector in both edge functions

Update the OneTrust entry in `KNOWN_CMPS` to include CCPA fallbacks:

```
selector: "#onetrust-reject-all-handler, .ot-pc-refuse-all-btn, .save-preference-btn-handler, .onetrust-close-btn-handler"
```

This way, the extension tries selectors in order: Reject All (GDPR) → Refuse All → Confirm My Choices (CCPA) → Close button. At least one will exist on any OneTrust deployment.

### 3. Files to modify
- `supabase/functions/ai-generate-pattern/index.ts` — update OneTrust selector
- `supabase/functions/probe-report/index.ts` — update OneTrust selector to match

### Technical Detail
The comma-separated CSS selector works as a single `querySelectorAll` in the extension — it returns the first matching element. By ordering reject → refuse → confirm → close, the extension always picks the most privacy-preserving option available.

