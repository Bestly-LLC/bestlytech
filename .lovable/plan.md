

# Enhanced Activity Graph Controls

## What Changes

Add interactive controls above the Activity graph so you can toggle individual data series on/off, switch time ranges, and choose between chart types.

### Controls to Add

1. **Series toggle chips** — Clickable pill buttons for each series (Reports, New Patterns, New Domains, Active Patterns). Click to show/hide that line. Active chips are colored to match their line; inactive chips are muted.

2. **Time range selector** — Dropdown or button group: 7 days, 14 days, 30 days, 90 days. Currently hardcoded to 30 days via the `p_days` parameter. The DB function `get_daily_pattern_activity` already accepts `p_days`, so this just requires passing a different value and re-fetching.

3. **Chart type toggle** — Small icon button group to switch between Area chart (current) and Bar chart (stacked bars, useful for comparing daily totals side-by-side).

### Layout

```text
┌─────────────────────────────────────────────────────┐
│ Pattern Activity                                    │
│                                                     │
│ [7d] [14d] [30d] [90d]    [Area ▣] [Bar ▥]        │
│                                                     │
│ ● Reports  ● New Patterns  ● New Domains  ○ Active │
│                                                     │
│ ┌─────────────────────────────────────────────┐     │
│ │           ~ chart area ~                    │     │
│ └─────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────┘
```

## Technical Details

### File: `src/pages/admin/CommunityLearning.tsx`

- Add state: `activityDays` (default 30), `visibleSeries` (Set of enabled keys), `chartType` ('area' | 'bar')
- Re-fetch activity data when `activityDays` changes (call `get_daily_pattern_activity` with new `p_days`)
- Render series toggle chips in the CardHeader area, each colored to match its line
- Conditionally render `<AreaChart>` or `<BarChart>` based on `chartType`
- Only render `<Area>`/`<Bar>`/`<Line>` components for series present in `visibleSeries`
- Import `BarChart, Bar` from recharts (already using recharts)

No database changes needed — the existing function supports variable day ranges.

