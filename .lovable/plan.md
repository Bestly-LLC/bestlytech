

## Premium Typography Upgrade

### The Change
Replace **Inter** (the current font) with **Plus Jakarta Sans** -- a geometric, premium sans-serif used by brands like Vercel, Framer, and other high-end tech companies. It has sharper geometry, tighter letter-spacing, and bolder weights that convey confidence and minimalism.

Alternatively, we could pair it with a display font for headlines. Here's the recommendation:

- **Headings**: Plus Jakarta Sans (bold/extrabold) -- sharp, confident, geometric
- **Body**: Plus Jakarta Sans (regular/medium) -- clean and highly legible

### Why Plus Jakarta Sans?
- More geometric and "designed" than Inter
- Heavier weights feel more authoritative
- Widely used by premium tech brands (similar tier to the blue-chip aesthetic)
- Free on Google Fonts, excellent performance
- Excellent support for tight letter-spacing that feels premium

### Files to Modify

| File | Changes |
|------|---------|
| `index.html` | Add Google Fonts `<link>` for Plus Jakarta Sans (weights 400-800) |
| `tailwind.config.ts` | Update `fontFamily.sans` from Inter to Plus Jakarta Sans |
| `src/index.css` | Add refined typography utilities -- tighter letter-spacing on headings, improved line-heights |

### Technical Details

1. **index.html** -- Add the Google Fonts import:
   ```
   <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
   ```

2. **tailwind.config.ts** -- Swap the font family:
   ```
   fontFamily: {
     sans: ['Plus Jakarta Sans', 'system-ui', 'sans-serif'],
   }
   ```

3. **src/index.css** -- Add base typography refinements:
   - Tighter letter-spacing on h1-h4 elements (-0.02em to -0.04em)
   - Slightly increased font-weight on body for crispness
   - Refined line-heights for premium readability

No page-level changes needed -- the font swap cascades globally through Tailwind's `font-sans` default.

