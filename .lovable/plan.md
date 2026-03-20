

# Linktree-Style Page for Bestly

## What
A standalone `/links` page with a clean, mobile-first "link in bio" layout — Bestly branding at top, then a vertical stack of link buttons to all projects and social profiles. No Header/Footer (like Linktree, it's a standalone page).

## Links to include
**Products:**
- Cookie Yeti → `/cookie-yeti`
- InventoryProof → `https://inventoryproof.com`
- HOKU → `https://hoku-clean.com`
- NeckPilot → `/neckpilot`

**Company pages:**
- Bestly Website → `/`
- Services → `/services`
- Hire Us → `/hire`
- Contact → `/contact`
- Press Kit → `/press`

**Social (placeholders — will use # until you provide URLs):**
- Instagram
- TikTok
- LinkedIn
- Twitter/X

## Design
- Centered column, max-w-md, dark background with subtle gradient
- Bestly logo + `jared-headshot.png` avatar at top
- "Jared Best" name + "Founder, Bestly LLC" tagline
- Each link is a rounded pill button with icon + label, hover glow effect
- Product links show the product icon images where available
- Social icons row at bottom (circular icon buttons)
- Fully responsive (already mobile-first)
- Respects dark/light theme

## Files
| File | Action |
|------|--------|
| `src/pages/Links.tsx` | New — the linktree page |
| `src/App.tsx` | Add `/links` route (outside Layout, no header/footer) |

