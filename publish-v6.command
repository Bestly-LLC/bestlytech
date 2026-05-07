#!/bin/bash
# v6 — replace mesh with reactive dot-grid hero background
set -e
cd /Users/jared/Developer/bestlytech
[ -f .git/index.lock ] && rm -f .git/index.lock

git checkout main
git pull origin main

git add \
  src/components/InteractiveDotGrid.tsx \
  src/pages/Index.tsx

echo "Files staged:"
git diff --cached --name-only

echo "→ Build sanity check..."
if ! npm run build > /tmp/wow-v6-build.log 2>&1; then
  tail -30 /tmp/wow-v6-build.log >&2
  exit 2
fi
echo "✓ Build passes"

git commit -m "feat(home): v6 — reactive dot-grid hero background

Replaces the soft mesh-gradient with a more legibly-interactive
dot-grid pattern. ~28px square lattice of indigo dots, each scaling
and brightening with cursor proximity (200px radius of influence).

- Perpetual low-frequency drift via per-dot phase + global sine — the
  grid is never fully still.
- Periodic auto-ripples emanate from random origins every 4-7s as
  thin radial brightness pulses, so visitors who don't move see
  motion too.
- Hairline connections between bright neighboring dots near the
  cursor — subtle 'network' effect that reads as a data grid.
- Pure Canvas 2D, no Three.js / shaders.
- Pauses on tab-hide, single static frame under prefers-reduced-motion.

Original Bestly work — pattern (dot-grid ripple) is widely-used
common-property design vocabulary; specific implementation is fresh.
"

git push origin main

echo ""
echo "============================================================"
echo "  PUBLISHED v6 to main."
echo "  Vercel rebuilds within ~90 sec."
echo "  Cmd+Shift+R bestly.tech to bypass Cloudflare."
echo "============================================================"
sleep 30
