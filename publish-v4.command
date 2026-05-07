#!/bin/bash
# v4 publish: company-first homepage + interactive mesh background
# Commits Index.tsx + InteractiveMeshBackground.tsx straight to main
set -e

cd /Users/jared/Developer/bestlytech

[ -f .git/index.lock ] && rm -f .git/index.lock

echo "→ Switching to main + pulling..."
git checkout main
git pull origin main

echo "→ Staging v4 files..."
git add src/pages/Index.tsx src/components/InteractiveMeshBackground.tsx

echo "Files:"
git diff --cached --name-only

echo "→ Build sanity check..."
if ! npm run build > /tmp/wow-v4-build.log 2>&1; then
  tail -30 /tmp/wow-v4-build.log >&2
  exit 2
fi
echo "✓ Build passes"

git commit -m "feat(home): v4 — company-first thesis + interactive mesh background

Strategic correction: Bestly is a multi-product studio, not a cloud
vendor. Hero now leads with 'We build products that respect you.'
Cloud + Apple Modernization demoted to a Services callout band that
links to /services. Restores What-We-Build (six focus areas) and
featured products (Cookie Yeti, InventoryProof, HOKU) from the
original Index.tsx, restyled in the v3 visual language.

New: src/components/InteractiveMeshBackground.tsx — original
canvas-2d mesh-gradient behind the hero, six indigo blobs drifting
on a slow noise loop with cursor parallax. No external deps,
prefers-reduced-motion respected, pauses when tab hidden.

Visual language unchanged from v3: Newsreader display × Inter body,
ink + indigo palette, kinetic word-by-word reveal, house easing,
WCAG-compliant accent contrast.
"

git push origin main

echo ""
echo "============================================================"
echo "  PUBLISHED v4 to main."
echo "  Vercel rebuilds production within ~90 sec."
echo "  Cmd+Shift+R bestly.tech to bypass Cloudflare cache."
echo "============================================================"
sleep 30
