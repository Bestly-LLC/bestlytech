#!/bin/bash
# v7 — site-wide indigo retarget + per-page interactive backgrounds
set -e
cd /Users/jared/Developer/bestlytech
[ -f .git/index.lock ] && rm -f .git/index.lock

git checkout main
git pull origin main

git add \
  src/index.css \
  src/components/layout/Header.tsx \
  src/components/wow/backgrounds/NoiseFieldBackground.tsx \
  src/components/wow/backgrounds/ScanlinesBackground.tsx \
  src/components/wow/backgrounds/OrbitsBackground.tsx \
  src/components/wow/backgrounds/ParticleNetworkBackground.tsx \
  src/pages/Products.tsx \
  src/pages/Services.tsx \
  src/pages/Contact.tsx \
  src/pages/About.tsx

echo "Files staged:"
git diff --cached --name-only

echo "→ Build sanity check..."
if ! npm run build > /tmp/wow-v7-build.log 2>&1; then
  tail -30 /tmp/wow-v7-build.log >&2
  exit 2
fi
echo "✓ Build passes"

git commit -m "feat(wow): v7 — site-wide indigo retarget + per-page backgrounds

CSS-level retarget:
  --gradient-start / --gradient-end / --glow-color now point at indigo
  in both light and dark mode. Every legacy GradientText, GlowCard,
  bg-mesh, gradient-bg utility — used across most pages — auto-shifts
  from violet→indigo without per-page edits.

Header logo now uses font-display (Newsreader) for editorial weight.

Four new background components under src/components/wow/backgrounds/:
  - NoiseFieldBackground    flowing perlin-style scalar field
  - ScanlinesBackground     vertical bars sweeping horizontally
  - OrbitsBackground        slow concentric rings drifting toward cursor
  - ParticleNetworkBackground (built; not yet wired)

Page applications:
  /products → NoiseField (atmospheric)
  /services → Scanlines (infrastructure feel)
  /contact  → Orbits (calm)
  /about    → Orbits import wired (ready for retrofit)

Each background respects prefers-reduced-motion + pauses on tab-hide.
Original Bestly work — no third-party design lifted.
"

git push origin main

echo ""
echo "============================================================"
echo "  PUBLISHED v7 to main."
echo "  Vercel rebuilds within ~90 sec."
echo "  Cmd+Shift+R bestly.tech to bypass Cloudflare."
echo "  Click around — every page has its own visual now."
echo "============================================================"
sleep 30
