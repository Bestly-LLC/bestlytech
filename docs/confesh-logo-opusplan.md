# Confesh logo swap — opusplan

Planned by Opus 2026-10-11, executed by Sonnet.

## Goal
bestly.tech shows a placeholder Confesh icon (purple chat bubble + lock). Replace it with the real Confesh app icon (gold "C" on near-black) everywhere Confesh appears.

## Source of truth
- Real icon: `Bestly-LLC/confesh` → `Confesh/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png` (1024×1024, RGB, square full-bleed).
- Site asset: `src/assets/confesh-icon.png` (512×512 RGBA). Imported once in `src/config/products.ts` (`confeshIcon`), rendered by Products.tsx, Index.tsx, ProductsDropdown.tsx, Links.tsx.

## Steps
1. Look at how sibling icons are stored (`cookieyeti-icon.png`, `inventoryproof-icon.png`, `schoolpilot-icon.png`): size, alpha, whether rounded corners are baked in. Match that convention.
2. Build the new `src/assets/confesh-icon.png` from AppIcon-1024: resize to 512×512 (Lanczos). If siblings have baked rounded corners, apply the same iOS-style continuous corner (~22.4% radius) with an antialiased, soft edge — no hard jaggies. Optimize (pngquant/oxipng if available) so it is not larger than needed.
3. Keep the same filename → no code changes needed. Only add/alter code if a render spot crops or distorts the icon.
4. Check other places for a Confesh image: `public/` (og images, favicons), `public/maya/site-index.json`, Supabase `team_products.icon` (currently a lucide name, leave it). Fix any real image references; leave text alone.
5. Verify: `npm ci` if needed, `npx tsc --noEmit`, `npm run build`. Render the new PNG next to two sibling icons and look at it.

## Shipping (other agents are pushing to main)
- Commit only the touched files. `git pull --rebase origin main` immediately before pushing; never force-push; never revert anyone else's change.
- Push to `main` (Vercel auto-deploys). Confirm the Vercel deployment goes READY and the live /products page serves the new icon.
