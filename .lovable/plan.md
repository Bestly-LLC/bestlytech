

# Merge AI Fixer into Issues Tab with Rich Post-Fix Details

## Problem
The AI Fixer and Issues tabs are separate, forcing you to jump between tabs. After running the fixer, there's no rich feedback — just a toast and a separate log table. The experience should be unified: see issues, run the fixer right there, and see detailed results inline.

## Design

### 1. Remove the standalone "AI Fixer" tab
- Move the "Run Now" button, schedule cards, and summary stats directly into the **Issues** tab header area
- Remove `ai-fixer` from the `TabsList`

### 2. Redesign the Issues tab as "Issues & AI Fixer"
Layout (top to bottom):
- **Header row**: Title "Pattern Issues" on the left, "Run AI Fixer" button on the right (with schedule info as a subtle tooltip or subtitle)
- **Post-run results panel** (only visible after running the fixer): A collapsible card showing the latest run summary — processed/fixed/failed counts, and a detailed table of what was done, with color-coded action badges and before/after confidence values where applicable
- **Issues table**: The existing issues list, but each row now shows its AI fix status inline — if the fixer already actioned it, display the action taken and result directly in the row (not just a tiny bot icon)

### 3. Enhanced issue rows with fix details
Each issue row will have:
- Existing columns: Issue type, Domain, Selector, Action, Confidence, Reports, Success Rate, Last Seen
- New **"AI Fix"** column: Shows one of:
  - "—" if not actioned
  - A rich inline badge with the action (e.g. "Deleted", "Confidence zeroed", "Confidence halved") + success/fail status
  - If the pattern was deleted, the row gets a strikethrough style + muted opacity to show it's been removed

### 4. Post-run results panel
After clicking "Run AI Fixer", instead of just a toast:
- Show an expandable results card at the top of the Issues tab (using Collapsible)
- Contains: 3 stat cards (Processed / Fixed / Failed) + the detailed fix log table for the latest batch
- Auto-expands after a run, can be collapsed
- Persists until the next page refresh or manual collapse

### 5. Schedule info
- Move the schedule/last-run cards into a compact row below the Issues header (or as a small info line) instead of a separate tab

## Files Changed

| File | Change |
|------|--------|
| `src/pages/admin/CommunityLearning.tsx` | Remove AI Fixer tab, merge its UI into the Issues tab. Add post-run results panel with Collapsible. Enhance issue rows with fix detail column. Add `showFixResults` state. |

