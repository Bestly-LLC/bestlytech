# Bestly social card kit (2026-10-04)

Makes the 1080x1080 Instagram/Facebook cards in `public/social/` in the house style
(navy gradient, Source Serif 4 headline, lavender accent, Bestly pill, device render).

1. `npm i three@0.169.0 @fontsource/source-serif-4 @fontsource/inter playwright@1`, then copy
   `source-serif-4-latin-{600,700}-normal.woff2` and `inter-latin-{400,600}-normal.woff2` here as
   `serif600/serif700/inter400/inter600.woff2`, and `public/models/device-web-split.glb` here.
2. `python3 -m http.server 8765` in this folder.
3. Device renders (transparent PNGs): `node shoot.mjs '[{"q":"az=35&el=24&d=2.3","out":"d1.png"}]'`
   (az/el = camera angle in degrees, lift = lid gap, d = distance). Trim with PIL getbbox -> `d1t.png`.
4. Cards: edit `items.json` (h = headline, `<em>` = lavender accent, p = subline, kick = carousel beat label,
   num = big faint slide number, dev = device image + CSS position) and run `node cards.mjs items.json`.
5. Copy to `public/social/`, add the entries to `MANIFEST.json` (assets: file/layout/theme/headline;
   carousels: id/theme/hook/slides). The Pi job `bestly_social` picks them up on its next run.

Layouts: A headline top + device lower-right bleed; B device upper + headline lower; C big statement +
small device lower-right. Carousels: 5 slides, device on 1 and 5 only, Bestly named on slide 5 only.
