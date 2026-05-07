#!/bin/bash
# v5 publish: interactivity-everywhere homepage
set -e
cd /Users/jared/Developer/bestlytech
[ -f .git/index.lock ] && rm -f .git/index.lock

git checkout main
git pull origin main

git add \
  src/App.tsx \
  src/index.css \
  src/pages/Index.tsx \
  src/components/wow/CursorFollower.tsx \
  src/components/wow/MagneticButton.tsx \
  src/components/wow/TiltCard.tsx \
  src/components/wow/RevealText.tsx \
  src/components/wow/Marquee.tsx \
  src/components/wow/ScrollProgress.tsx

echo "Files staged:"
git diff --cached --name-only

echo "→ Build sanity check..."
if ! npm run build > /tmp/wow-v5-build.log 2>&1; then
  tail -30 /tmp/wow-v5-build.log >&2
  exit 2
fi
echo "✓ Build passes"

git commit -m "feat(home): v5 — interactivity throughout the homepage

Six reusable building blocks under src/components/wow/:
  - CursorFollower    soft indigo dot + ring follower; expands on
                      interactive elements; mounted globally in App.tsx;
                      hidden on touch + reduced-motion
  - MagneticButton    cursor magnetism on CTAs (~80px radius)
  - TiltCard          3D rotateX/Y up to ±6° based on cursor position;
                      sprung return on leave; degrades on touch
  - RevealText        word-by-word entry on scroll-into-view
  - RevealOnScroll    section-level fade + rise on viewport entry
  - Marquee           pure-CSS horizontal text scroll, pauses on hover

Index.tsx retrofit: marquee separator after hero, every section heading
is RevealText, focus-area + product + principle cards are TiltCards,
every CTA is wrapped in MagneticButton.

CSS additions: wow-marquee keyframe, optional cursor-hide rules.

Original Bestly work — no third-party design lifted. All motion respects
prefers-reduced-motion.
"

git push origin main

echo ""
echo "============================================================"
echo "  PUBLISHED v5 to main."
echo "  Vercel rebuilds within ~90 sec."
echo "  Cmd+Shift+R bestly.tech to bypass Cloudflare."
echo "============================================================"
sleep 30
