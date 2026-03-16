

# Visual AI Fixer Indicators

## Problem
When viewing patterns in the Issues, Recent, and Domains tabs, there's no way to tell which ones have been actioned by the AI fixer. The fix log data is siloed in the AI Fixer tab.

## Solution
Cross-reference patterns displayed in the **Issues**, **Recent**, and **Domains** tabs with the `fixLog` data (already fetched) to show a visual "AI Fixed" indicator on rows that were actioned.

### Changes to `src/pages/admin/CommunityLearning.tsx`

1. **Build a lookup Set** from `fixLog` keyed by `domain` (and optionally `domain+selector`) so we can quickly check if a pattern was actioned:
   ```ts
   const fixedDomains = new Set(fixLog.map(f => f.domain));
   const fixedPatterns = new Set(fixLog.map(f => `${f.domain}::${f.selector}`));
   ```

2. **Issues tab** — Add an AI bot icon + tooltip on rows where `fixedPatterns` has a match. Show the action taken (e.g. "deleted_stale", "confidence_zeroed") as a small badge next to the issue badge. Color the row with a subtle blue/purple left border or background tint to distinguish AI-actioned rows.

3. **Recent tab** — Same indicator: a small `<Wrench>` or `<Bot>` icon with "AI Actioned" tooltip on rows matching `fixedPatterns`.

4. **Domains tab** — Show a small AI badge next to domain names that appear in `fixedDomains`, indicating the fixer has touched patterns on that domain.

5. **AI Fixer tab fix log table** — Add color-coded action badges (instead of plain text) for the "Action" column: `deleted_stale` → red destructive badge, `deleted_broken` → red, `confidence_zeroed` → amber, `confidence_halved` → amber, `skipped` → muted.

### Visual Design
- Use the existing `<Wrench>` icon (already imported) in a small 14px size with `text-purple-500` coloring
- Add a `<Tooltip>` wrapper showing "AI Fixer: {action_taken}" on hover
- Rows with AI actions get a subtle `border-l-2 border-purple-500/50` left accent

### Import Addition
- Add `Bot` from lucide-react (or reuse `Wrench`) and `Tooltip`/`TooltipTrigger`/`TooltipContent`/`TooltipProvider` from shadcn

### No database changes needed — all data is already available in the existing `fixLog` state.

