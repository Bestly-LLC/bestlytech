

# Floating Glossy Icons Around Hero Text

## What We're Building

Add the glossy 3D icons in a scattered, floating "splatter" formation around the hero headline text — similar to how CleanMyMac positions their candy-glass icons orbiting around the central content. The icons will be absolutely positioned at various spots around the hero area, each with unique size, rotation, and a gentle floating animation at different speeds/delays.

Additionally, regenerate the icons to look more like the CleanMyMac reference — distinct geometric shapes (hexagons, rounded diamonds, blob shapes) with embedded symbols, glass-like depth, and colored glows — rather than generic glossy orbs.

## Technical Details

### 1. Regenerate glossy icon assets (6 images)

Use the AI image generation endpoint (google/gemini-3-pro-image-preview) to create 6 new icons that match the CleanMyMac style more closely:
- Each icon should have a unique geometric glass shape (circle, hexagon, chevron, octagon, blob, star-shape)
- Embedded white symbols inside (app grid, sparkle, lightning bolt, hand/shield, folder, gear)
- Vibrant distinct colors per icon (green, blue, orange, pink, teal, purple)
- Transparent background, glossy/refractive glass material
- Save as `src/assets/glossy-*.png`, overwriting existing files

### 2. Add floating icons to hero section in `src/pages/Index.tsx`

Position 6 icons absolutely within the hero `<section>` container using CSS classes:
- Scatter them around the edges and mid-zones of the hero (top-left, top-right, mid-left, mid-right, bottom-left, bottom-right)
- Vary sizes (w-16 to w-28)
- Apply subtle rotation via inline `transform: rotate()`
- Use the existing `animate-float-slow` animation with staggered `animationDelay` values
- Add `opacity-80` so they don't overpower the text
- Hide on small screens (`hidden sm:block`) to keep mobile clean

### 3. Keep "What We Build" section as-is

The grid section below will continue using the same icons in the cards — the hero icons are decorative duplicates positioned for visual impact.

