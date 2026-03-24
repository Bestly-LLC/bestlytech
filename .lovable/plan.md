

# Improve Community Learning Breakdown Tab & Fix Contrast Issues

## Problems Identified

1. **Recharts tooltip contrast**: All chart tooltips set `background` and `border` via CSS variables but never set `color`. In dark mode, the browser default text color (black) renders invisible against the dark card background. This affects all 5 charts (Activity area/bar, Confidence distribution, Action Types pie, Source Breakdown).

2. **CMP Fingerprints table is bare data**: The CMP names (e.g. "onetrust", "cookiebot", "quantcast") are cryptic abbreviations with no explanation of what they are. Need an eye/info icon with hover tooltip explaining each CMP.

3. **Breakdown tab is thin**: Just four charts/tables with no summary or context. Could use a quick summary row and card descriptions.

## Changes

### File: `src/pages/admin/CommunityLearning.tsx`

**1. Fix Recharts tooltip contrast (all instances)**

Add `color: "hsl(var(--foreground))"` to every `contentStyle` prop on `RechartsTooltip`. There are 5 instances (lines ~990, 1002, 1686, 1709, 1770). Each becomes:
```tsx
contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12, color: "hsl(var(--foreground))" }}
```

**2. Add CMP descriptions map and eye icon tooltips**

Add a `CMP_DESCRIPTIONS` map near the top of the file:
```tsx
const CMP_DESCRIPTIONS: Record<string, string> = {
  onetrust: "OneTrust — Enterprise consent platform used by large corporations",
  cookiebot: "Cookiebot by Usercentrics — GDPR/CCPA cookie consent manager",
  quantcast: "Quantcast Choice — Free CMP focused on GDPR compliance",
  didomi: "Didomi — Privacy & consent management for publishers",
  osano: "Osano — Data privacy platform with cookie consent",
  trustarc: "TrustArc — Privacy compliance and consent manager",
  iubenda: "iubenda — Cookie/privacy policy generator and consent solution",
  termly: "Termly — Cookie consent banner and policy generator",
  complianz: "Complianz — WordPress GDPR/CCPA cookie consent plugin",
  cookiefirst: "CookieFirst — Cookie consent management platform",
  klaro: "Klaro — Open-source privacy consent manager",
  civic: "Civic Cookie Control — UK-focused cookie consent tool",
  unknown: "Unknown — CMP could not be identified from the banner",
};
```

Then in both the mobile and desktop CMP Fingerprints sections, add an eye icon (`Eye` from lucide-react) next to each CMP name that shows the description on hover via `UITooltip`. If the CMP isn't in the map, show a generic fallback.

**3. Add card descriptions to Breakdown charts**

Add `CardDescription` subtitles to each card explaining what the chart shows:
- Confidence Distribution: "How patterns are distributed across confidence levels"
- Action Types: "Which dismiss actions are most common across all patterns"
- CMP Fingerprints: "Consent Management Platforms detected across the network"
- Source Breakdown: "How patterns were created — community reports, AI, or manual"

**4. Add summary stat row at top of Breakdown tab**

Add a 4-column grid of quick stats pulled from existing data:
- Total CMPs detected (cmpDist.length)
- Most common action (from actionStats)
- Most common source (from sourceDist)
- Avg confidence (from overview)

This gives the Breakdown tab a useful at-a-glance summary before diving into charts.

### Technical Details

- Import `Eye` from `lucide-react` (add to existing import)
- All tooltip contrast fixes are the same one-line addition across 5 locations
- CMP descriptions map is a static constant — no data fetching needed
- Summary stats derive from already-fetched state variables

