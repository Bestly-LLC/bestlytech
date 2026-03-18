

## Better Admin Management of the Dismissal Consensus Pipeline

Currently the Community Learning dashboard has no visibility into dismissal reports or the consensus process. You can't see what users are dismissing, can't trigger consensus processing, and can't toggle patterns on/off with the new `is_active` column. Here's what to add:

### 1. New "Dismissals" Tab on Community Learning

Add a tab between "Reports" and "AI Pattern Generator" showing:

- **Summary cards**: Total dismissal reports, unique domains, pending consensus candidates (domains not yet converted to patterns)
- **Dismissal Reports table**: Domain, clicked selector, banner selector, timestamp — grouped by domain with report counts
- **"Run Consensus" button**: Triggers the `process-dismissal-consensus` edge function and shows results (created count, details)
- **Bulk delete**: Select and clear false-positive dismissal reports

### 2. Pattern Active/Inactive Toggle

On the **Recent** tab's pattern table and the **Domains** detail view, add a toggle switch in each row to flip `is_active` on/off. This lets you soft-disable a bad pattern without deleting it. Inactive patterns get a visual indicator (muted row + badge).

### 3. Overview Stats Update

Add to the existing overview cards or health indicators:
- **Dismissal Reports** count (from `dismissal_reports` table)
- **Consensus Patterns** count (patterns where `source = 'user_consensus'`)

### Files to Modify

| File | Change |
|---|---|
| `src/pages/admin/CommunityLearning.tsx` | Add "Dismissals" tab with table, Run Consensus button, and summary cards. Add `is_active` toggle to Recent tab rows. Fetch dismissal_reports data and consensus pattern count. |

### Technical Details

- Fetch dismissal reports: `supabase.from("dismissal_reports").select("*").order("created_at", { ascending: false }).limit(100)`
- Run consensus: `fetch(VITE_SUPABASE_URL + "/functions/v1/process-dismissal-consensus", { method: "POST", headers: { Authorization: Bearer token } })`
- Toggle active: `supabase.from("cookie_patterns").update({ is_active: !current }).eq("id", patternId)`
- The `find_dismissal_consensus` function already returns pending candidates — we can call it via RPC to show a preview before running consensus

