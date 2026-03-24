

# Merge Activity + AI Gen into "Pipeline" Tab & Fix Build Errors

## Build Errors

The file has cascading JSX parse errors starting at line 932. From my reading, the JSX structure appears correct (all tags close properly, `</Tabs>` at line 2207). This is likely caused by an orphaned code fragment or invisible character introduced during prior edits. The safest fix is to carefully rewrite the Tabs section, which I'll do as part of the merge.

## Tab Merge: Activity + AI Gen → "Pipeline"

**Name options considered:** "Pipeline" conveys the report-to-pattern flow. Other candidates: "Operations", "Engine", "Monitor". I'll go with **"Pipeline"** — it's short, clear, and describes the data flowing from reports through AI to patterns.

### New "Pipeline" tab layout

```text
┌─────────────────────────────────────────────────────────────┐
│ PIPELINE                                                     │
│                                                              │
│ [Action buttons: Maintenance | Retry | Run AI | Reset]       │
│ Last run: 2h ago (auto) · Next: in 13m · 12 runs · 4.2k tok │
│                                                              │
│ ┌─ Pattern Activity Chart ─────────────────────────────────┐ │
│ │  (Area/Bar toggle, series chips, time range selector)    │ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─ Post-Run Results (collapsible, shown after manual run) ─┐ │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─ Pending Candidates ────────────────────────────────────┐  │
│ │  Filter: All | New | Failed    [Bulk re-run selected]   │  │
│ │  Table with checkboxes, domain, reports, HTML, CMP...   │  │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─ AI Generation Log (last 50) ───────────────────────────┐  │
│ └──────────────────────────────────────────────────────────┘ │
│                                                              │
│ ┌─ Skipped — No HTML (collapsible) ───────────────────────┐  │
│ └──────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Changes in `src/pages/admin/CommunityLearning.tsx`

1. **Remove the "Activity" and "AI Gen" TabsTriggers** (lines 935, 937). Replace with a single trigger:
   ```tsx
   <TabsTrigger value="pipeline">
     <Zap className="h-3.5 w-3.5 hidden sm:block" />Pipeline
   </TabsTrigger>
   ```

2. **Remove `<TabsContent value="activity">` (lines 946-1049)** and **`<TabsContent value="ai-generator">` (lines 1254-1700)**

3. **Create a single `<TabsContent value="pipeline">`** containing, in order:
   - The AI Gen header card with action buttons, last run info, token stats (from old AI Gen tab)
   - The Pattern Activity chart with time range + chart type controls + series chips (from old Activity tab)
   - Post-Run Results collapsible (from old AI Gen tab)
   - Pending Candidates section with filters (from old AI Gen tab)
   - AI Generation Log table (from old AI Gen tab)
   - Skipped — No HTML collapsible (from old AI Gen tab)

4. **Update `activeTab` default** from `"activity"` to `"pipeline"` if it was the default

5. **Fix build errors**: While restructuring, ensure all JSX elements are properly nested and closed. The rewrite of this section will resolve the cascading parse errors.

### Tab bar after merge

Pipeline | Domains | Breakdown | Dismissals | Review | Reports

Down from 7 tabs to 6 — cleaner and less cognitive load.

