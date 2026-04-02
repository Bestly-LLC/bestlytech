

# Refine Glossy Icons & Remove from Hero

## What Changes

1. **Remove floating icons from hero section** — Delete lines 95-101 in `Index.tsx` (the 6 absolutely-positioned `<img>` tags in the hero). The hero goes back to clean text-only.

2. **Regenerate 6 icons to match the CleanMyMac reference exactly** — The current icons look too candy/bubbly. The reference shows:
   - Distinct geometric glass shapes (circle, hexagon, chevron, octagon, blob, star) with **depth, refraction, and colored rim lighting**
   - Embedded **white 3D symbols** inside (not flat — they have volume and shadow)
   - Rich color glow emanating from behind/below each icon
   - Material feels like polished glass/resin, not candy — more weight, more realism
   - Each icon uses a single dominant hue: green, blue, orange/amber, pink, teal

   Regenerate all 6 using `google/gemini-3-pro-image-preview` with much more specific prompts referencing "polished glass material, refractive edges, volumetric white symbol, colored rim light, dark background, 3D render, product visualization quality." Special attention to the Physical Products icon which needs the most work.

3. **Icons remain in the "What We Build" grid cards only** — No changes to that section, just better assets.

## Files Modified
- `src/pages/Index.tsx` — Remove lines 95-101 (hero floating icons), keep imports for the grid section
- `src/assets/glossy-*.png` — All 6 regenerated with refined prompts

