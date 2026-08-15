# Bestly Cloud — Media Pool & Rotation

## Why this file exists
2026-07-17: Jared caught that three LinkedIn posts in a row (07-15, 07-16, 07-17)
used the exact same graphic (`hero.png`). Root cause: the daily engine's old
"PICK VISUAL" step listed `hero.png` first as the default/safe option and had
**no history file, no anti-repeat check, and no enforced rotation** — unlike
hooks and themes, which already had `hook_history.jsonl` / `theme_history.jsonl`
gating repeats. So the engine picked the same image every single day by default.

Fixed by adding `kit/media_history.jsonl` (same pattern as the hook/theme
history files) and a hard rotation rule in the scheduled task. See rule below.

## Current asset pool (updated 2026-07-28)
| File | Type | Best for |
|---|---|---|
| `kit/thumbnails/device-3d-renders/device3d_split_light_square.png` | **3D render, light bg, 1200x1200** — NEW 2026-07-28 | "The 3D device" theme, product posts, any post needing a genuinely different look from the dark assets |
| `kit/thumbnails/device-3d-renders/device3d_split_light_wide.png` | **3D render, light bg, 1584x829 (1.91:1)** — NEW 2026-07-28 | same as above, when a landscape/link-card ratio reads better |
| `kit/thumbnails/brand-cards/card_hours_until_back.png` | **typographic brand card, matte black, 1200x1200** — NEW 2026-08-15, generated with PIL | backups / recovery / downtime themes, ask-a-boring-question |
| `kit/thumbnails/brand-cards/card_key_vs_permission.png` | **typographic brand card, matte black, 1200x1200** — NEW 2026-08-04, generated with PIL | own-your-infrastructure / ownership + control themes |
| `kit/thumbnails/hero.png` | static brand card ("Stop renting your business from big tech") | rent-vs-buy / own-your-infrastructure themes |
| `kit/thumbnails/device-shots/device_clean_v6.png` | static device photo/render | behind-the-box, product-focused themes |
| `kit/thumbnails/device-shots/device_clean_v7.png` | static device photo/render | behind-the-box, product-focused themes |
| `kit/thumbnails/device-shots/device_clean_v7_top.png` | static device photo/render (top angle) | behind-the-box, product-focused themes |
| `kit/thumbnails/device-3d-renders/*.png` (if present) | fresh stills captured from the live 3D hero on bestly.tech/cloud | "The 3D device" theme, any post that wants a genuinely new angle |
| `kit/videos/*.mp4` (if present) | short clips of the 3D hero, built by `social/scripts/render-3d-clips.cjs` | "The 3D device" theme, highest-effort visual slot |

**Pool is intentionally meant to grow.** When Jared or the engine adds new
static graphics (AI-generated brand cards, new product photography, new 3D
renders), add a row here and drop the file in the matching `kit/thumbnails/`
subfolder. Never let the pool shrink back to a single default image.

## Rotation rule (non-negotiable, mirrors the hook/theme anti-repeat rule)
1. Before picking a visual, **read `kit/media_history.jsonl`**.
2. **Never reuse the same media file two posts in a row.**
3. **Never reuse the same media file more than once in any rolling 5-post window**, if the pool has 5+ assets available. If the pool is smaller than 5, rotate through every available asset before any repeat.
4. Prefer a file whose *type* differs from yesterday's too (e.g. don't follow a static brand card with another static brand card if a device photo or 3D render is available and unused recently) — this is what actually reads as "different" to a scrolling viewer, not just a different filename.
5. Log every choice — `{date, media_file, media_type, reason}` — to `kit/media_history.jsonl` every run, same as theme_history/hook_history.
6. If the entire pool has been used within the anti-repeat window (pool exhausted), that's a signal to generate a new asset, not to quietly repeat one. Flag it in run-report.md as "media pool exhausted — consider adding a new graphic" rather than silently reusing.

## Where the 3D graphic actually is (found 2026-07-17)
Jared thought this was lost from Downloads. It isn't — it's already live on the
site and stored in the repo:

- **File:** `public/models/device-web-split.glb` (also copied to `dist/models/`
  on build). ~626 KB, Draco-compressed, 96.7k tris.
- **Used by:** `src/components/cloud/CloudScrollHero.tsx` via
  `src/components/cloud/deviceModel.ts` — this is the live, scroll-scrubbed
  WebGL hero animation on `bestly.tech/cloud` right now.
- **Origin:** generated from a 2D reference photo via **Tripo** (a low-cost
  image-to-3D / text-to-3D generator) — see the comment in `deviceModel.ts`.
  The raw Tripo export had a noisy baked color/roughness texture and a broken
  self-overlapping top panel; both were cleaned up in Blender (textures
  stripped, top panel replaced with one clean capped panel, all surfaces
  unified to a single "BestlyGunmetal" material). What's in the repo now is
  the *cleaned, final* version — better than the raw Tripo output, no need to
  re-download or regenerate it.
- **A separate, unrelated attempt exists in scheduled tasks:**
  `trellis-device-3d-retry` (disabled, never fired) was a backup plan to
  redo the conversion with Hugging Face's free TRELLIS.2 model from a
  different source photo (`~/Downloads/61+Cp3cDNNL._AC_SL1500_.jpg` — an
  Amazon product photo). This was abandoned once the Tripo + Blender result
  above worked out, so there's nothing to recover there either.

## Turning the 3D model into social graphics
Two ways to get real images/clips out of the GLB above for LinkedIn posts,
neither of which requires re-finding anything in Downloads:

1. **Static stills via headless browser** (cheapest, most reliable): screenshot
   `bestly.tech/cloud`'s hero at a few scroll positions using the exposed dev
   hooks (`window.__heroSetP(p)`). No ffmpeg needed, just Playwright + a
   screenshot call. Output goes to `kit/thumbnails/device-3d-renders/`.
2. **Full video clips**: `node social/scripts/render-3d-clips.cjs` — already
   written, records 12 short MP4s of the hero at different angles/scroll
   sweeps via Playwright + CDP screencasting + ffmpeg. Needs
   `playwright install chromium` done once. Headless WebGL can be flaky in
   some sandboxes (script has fallback flags noted inline) — if it produces
   black frames, run it from Jared's own machine (`headed: true` locally)
   instead of a remote sandbox.
3. **Manual, highest-fidelity option**: open Blender (with the MCP add-on
   running) and import `public/models/device-web-split.glb` directly —
   renders straight from the source mesh, no browser/WebGL involved. Ask
   Claude to render a batch of stills once Blender is open.

## SOLVED 2026-07-28 — the headless-capture path now works (no image-gen credits needed)
The "pool exhausted" flag raised on 07-17 / 07-26 / 07-27 is **resolved**. Option 1 above
(static stills via headless browser) was proven working end-to-end inside the daily-run
sandbox. Repeatable recipe:

1. `npx playwright install chromium` downloads fine, but `install-deps` fails (no root).
   The only missing system lib is **libxdamage1**. Get it without root:
   ```
   mkdir -p /tmp/deps && cd /tmp/deps
   apt-get download libxdamage1          # works unprivileged
   dpkg-deb -x libxdamage1_*.deb ./root
   export LD_LIBRARY_PATH=/tmp/deps/root/usr/lib/aarch64-linux-gnu:$LD_LIBRARY_PATH
   ```
2. Launch chromium with software WebGL:
   `--no-sandbox --disable-dev-shm-usage --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist`
3. **`window.__heroSetP` does NOT exist on production** — it's gated behind `import.meta.env.DEV`
   in `CloudScrollHero.tsx`. Don't wait on it. Instead, after `networkidle` + ~8s for the GLB
   to load, hide every non-canvas element and set a flat background, then screenshot:
   ```js
   const cv = document.querySelector('canvas');
   document.querySelectorAll('body *').forEach(el => {
     if (el === cv || el.contains(cv) || el.tagName === 'CANVAS') return;
     el.style.setProperty('visibility','hidden','important');
   });
   document.body.style.background = '#f4f5f7';
   ```
4. Screenshot the full page, then crop the device bbox and **composite it onto a fresh
   flat canvas** (don't just crop — a raw crop picks up dark page bands at the edges).
   Background colour of the live hero is `#f4f5f7`.
5. Scroll-stepping to capture multiple angles is **very slow under swiftshader** (one frame
   ~40s+, and it stalled after the first frame). Capture the default frame only, or budget
   several minutes and run it in the background.

Raw intermediate captures are parked in `kit/thumbnails/device-3d-renders/_raw/` — those are
NOT pool assets (they contain nav bars, cookie banners, cut-off UI chips). Only the two
`device3d_split_light_*.png` files are brand-safe pool assets.

## AI-generated brand cards (blocked 2026-07-17 — no image-gen credits)
As an additional variety source (not a replacement for the above), the
engine can generate fresh on-brand quote-card graphics (matte black bg,
white headline, thin accent line, burnt-orange dot — matching `hero.png`'s
style) via the image-gen tool available to Claude. Attempted 5 on 2026-07-17;
blocked with "Out of credits in the selected workspace." Add credits to
that workspace to unblock this path — it's the fastest way to get truly
unique per-post graphics without depending on Blender or WebGL capture.

## SOLVED 2026-08-04 — per-post unique brand cards, no credits required
Pool exhaustion recurred (07-17, 07-26, 07-27, and again 08-04 when all five
brand-safe assets landed inside a single rolling-5 window). Fixed properly this
time: on-brand typographic cards can be rendered **deterministically with PIL in
the run sandbox** — no image-gen credits, no WebGL, no Blender.

Recipe (see `kit/thumbnails/brand-cards/` for output):
- 1200x1200, background `#0a0a0a`, text `#f5f4f1`, accent dot `#c84d2b`.
- Headline: `/usr/share/fonts/truetype/lato/Lato-Black.ttf` at ~118px, hand-broken
  into short lines, left margin 110px, line-height 1.14.
- Thin 3px rule under the headline + an 18px burnt-orange dot to its right.
- Grey (`#969694`) one-line subhead in Lato-Regular 40px.
- `bestly.tech/cloud` in Lato-Black 36px at the bottom-left.
- No photos, no people, no icons — matches `hero.png`'s house style.

**This means the engine should never again need to repeat a graphic.** When rule 3
would force a repeat, generate a fresh card from that day's sharpest line instead,
drop it in `kit/thumbnails/brand-cards/`, and add a row to the pool table above.
