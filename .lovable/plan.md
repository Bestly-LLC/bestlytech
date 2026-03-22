

# Fix Unreadable Active Series Toggle Chips

## Problem

The active toggle chips in the Pattern Activity graph use the series color for both text and a tinted background. On dark backgrounds, the chips render as solid colored pills where the label text is invisible — the text blends into the colored background.

## Fix

**File:** `src/pages/admin/CommunityLearning.tsx` (line ~953-954)

Change the active chip styling so:
- Background uses the series color at ~20% opacity (keep current approach)
- **Text color is always white/light** so it's readable against the tinted background
- The colored dot indicator remains the series color
- Border uses the series color

```tsx
// Current (broken):
className={`... ${active ? "border-current" : "..."}`}
style={active ? { color: s.color, borderColor: s.color, backgroundColor: s.color + "15" } : undefined}

// Fixed:
className={`... ${active ? "text-foreground" : "border-border text-muted-foreground opacity-50"}`}
style={active ? { borderColor: s.color, backgroundColor: s.color + "20" } : undefined}
```

The key change: remove `color: s.color` from the active style so text uses `text-foreground` (white in dark mode, dark in light mode), making labels always readable. The colored dot already has its own explicit `backgroundColor` so it keeps its color.

