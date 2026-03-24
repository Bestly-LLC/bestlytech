

# Merge Domains + Recent Tabs into a Single "Domains" View

## What Changes

Remove the separate "Domains" and "Recent" tabs. Replace them with a single **"Domains"** tab that shows domain-level rows as expandable/collapsible sections. Clicking a domain row expands it to reveal the individual patterns underneath (the data currently in the Recent tab).

## Design

```text
┌─────────────────────────────────────────────────────────────┐
│ Domain          │ Patterns │ Reports │ Success │ Confidence │ Last Active │
├─────────────────────────────────────────────────────────────┤
│ ▶ amazon.com    │    3     │  1,204  │   92%   │   ████ 85% │   2h ago    │
│ ▼ costco.com    │    2     │    87   │   78%   │   ███  70% │   5h ago    │
│   ├ selector: #onetrust-accept  │ accept │ ai │ 75% │ Active ☑ │ 🗑 │
│   └ selector: .cc-dismiss       │ close  │ community │ 65% │ Active ☑ │ 🗑 │
│ ▶ switchbot.com │    1     │    12   │   50%   │   ██  50%  │   1d ago    │
└─────────────────────────────────────────────────────────────┘
```

All existing columns from both tabs are preserved. The domain-level row keeps its sortable headers (domain, patterns, reports, success rate, confidence, last active). The expanded pattern rows show selector, action, CMP, confidence, reports, source, active toggle, and delete button.

## Implementation

### File: `src/pages/admin/CommunityLearning.tsx`

1. **Remove the "Recent" TabsTrigger** (line 917) and its **TabsContent** (lines 1110-1239)

2. **Add expand/collapse state**: `const [expandedDomains, setExpandedDomains] = useState<Set<string>>(new Set())`

3. **Group `recent` patterns by domain**: Create a `useMemo` that builds a `Map<string, pattern[]>` from the `recent` array, keyed by domain

4. **Modify the Domains TabsContent** (lines 1032-1108): After each domain row in the table, if that domain is expanded, render its child pattern rows (indented, with all the columns from the old Recent tab — selector, action, CMP, confidence, source, active toggle, delete button)

5. **Add click handler on domain rows**: Toggle `expandedDomains` set. Add a chevron icon (▶/▼) in the domain column to indicate expandability.

6. **Increase the RPC limit** for `get_recently_learned` from 25 to 100 so expanded domains have full pattern coverage

7. **Make all columns sortable**: The domain-level headers already have sorting. The pattern sub-rows inherit the domain's sort order. Add sorting to the "Discovered" column (map to `created_at` from the recent data).

8. **Mobile view**: Merge similarly — domain cards become expandable, tapping reveals pattern cards underneath

### Data Flow

- `domains` state (from `get_top_domains`) = domain-level aggregate rows
- `recent` state (from `get_recently_learned`) = individual pattern rows, grouped by domain for display under their parent
- Both RPCs continue to be called; no backend changes needed

