#!/bin/bash
# v8 — bottom "Bestly" wordmark on the homepage
set -e
cd /Users/jared/Developer/bestlytech
[ -f .git/index.lock ] && rm -f .git/index.lock

git checkout main
git pull origin main

git add \
  src/components/wow/BottomWordmark.tsx \
  src/pages/Index.tsx

echo "Files staged:"
git diff --cached --name-only

echo "→ Build sanity check..."
if ! npm run build > /tmp/wow-v8-build.log 2>&1; then
  tail -30 /tmp/wow-v8-build.log >&2
  exit 2
fi
echo "✓ Build passes"

git commit -m "feat(home): v8 — bottom Bestly wordmark

New BottomWordmark component placed after the founder note section on
the homepage. Giant Newsreader 'Bestly' (clamp 8rem-30rem) anchored
at the bottom of a 70vh ink-colored section, pushed down ~18% so
glyphs are partially submerged below the section edge. Indigo
gradient fades the type from full color at glyph top to transparent
at glyph bottom, reinforcing the rising-up-from-below feel.

Reveals on scroll-into-view (Framer Motion whileInView), cursor-X
parallax shifts the word ±18px horizontally as the cursor sweeps
across the section. Disabled on touch + prefers-reduced-motion.

Original Bestly work — common-property bottom-wordmark pattern.
"

git push origin main

echo ""
echo "============================================================"
echo "  PUBLISHED v8 to main."
echo "  Vercel rebuilds within ~90 sec. Cmd+Shift+R bestly.tech."
echo "============================================================"
sleep 25
