

# Auto-Process Missed Banner Reports Immediately

## Problem
When the extension reports a missed banner via the `report_missed_banner_with_html` RPC, nothing happens until the cron job runs (every 6 hours). The domain sits idle waiting for processing.

## Solution
Create a new edge function `report-missed-banner` that:
1. Accepts the same parameters as the existing RPC (`domain`, `page_url`, `banner_html`, `cmp_fingerprint`)
2. Calls the existing `report_missed_banner_with_html` RPC to save the report
3. Immediately calls `ai-generate-pattern` (via internal HTTP) in single-domain mode to process it right away
4. Returns the AI result to the caller (so the extension could even get a pattern back in real-time)

The cron job (`auto-retry-failed-patterns`) remains as a safety net for retries.

## Changes

### 1. New edge function: `supabase/functions/report-missed-banner/index.ts`
- Accept POST with `{ domain, page_url?, banner_html?, cmp_fingerprint? }`
- Use service role client to call `report_missed_banner_with_html` RPC
- Fire-and-forget (or await) internal call to `ai-generate-pattern` with `{ domain }` using service role key
- Return combined result: report saved + AI processing outcome
- Set `verify_jwt = false` in config.toml (extension calls this without auth)

### 2. Update `supabase/config.toml`
- Add `[functions.report-missed-banner]` with `verify_jwt = false`

### Technical Details

The extension currently calls `supabase.rpc("report_missed_banner_with_html", {...})` directly. The new function wraps that RPC call and chains the AI processing. The extension would need to switch to calling this edge function instead, but since we control only the backend here, we'll make the function available and the extension can be updated separately.

Alternatively, to make this work without any extension changes: we can use a **database webhook/trigger** approach — but Deno edge functions can't be triggered by DB webhooks in Lovable Cloud. So the cleanest path is the new edge function.

The `ai-generate-pattern` already supports single-domain mode (`{ domain: "example.com" }`), so the internal call is straightforward:

```typescript
// Fire off AI processing for this domain immediately
fetch(`${supabaseUrl}/functions/v1/ai-generate-pattern`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${serviceRoleKey}`,
  },
  body: JSON.stringify({ domain }),
});
```

### Files
- **New**: `supabase/functions/report-missed-banner/index.ts`
- **Edit**: `supabase/config.toml` (add function entry)

