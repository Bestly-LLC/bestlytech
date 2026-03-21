

# Add Info Tooltips to AI Action Buttons

## Problem
The three action buttons in the AI Generator tab header — **Maintenance**, **Retry**, and **Run AI** — plus the **Reset Failed** button in the permanently-failed alert have no explanation of what they do. They're cryptic without context.

## Solution
Wrap each button in a tooltip (using the existing `InfoTip`-style pattern) that explains what it does on hover. All four buttons are useful and serve distinct purposes, so none should be removed — they just need clarity.

### Tooltip text for each button

| Button | Tooltip |
|--------|---------|
| **Run AI** | "Triggers AI analysis on all pending missed-banner reports to generate new CSS selectors" |
| **Retry** | "Re-attempts pattern generation on domains that previously failed (up to 5 tries)" |
| **Maintenance** | "Runs auto-fix on broken patterns and processes unresolved user reports" |
| **Reset Failed** | "Re-queues permanently failed domains for fresh AI analysis (older than 30 days)" |

## Implementation
Wrap each `<Button>` in a `<TooltipProvider>/<UITooltip>/<TooltipTrigger>/<TooltipContent>` block at lines 1008-1021 and 645-647 in `src/pages/admin/CommunityLearning.tsx`. The component already imports all tooltip primitives.

## Files Changed

| File | Change |
|------|--------|
| `src/pages/admin/CommunityLearning.tsx` | Wrap 4 buttons with tooltip explanations |

