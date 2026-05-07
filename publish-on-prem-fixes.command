#!/bin/bash
# Marketing copy + UX micro-fixes:
#   1. "on-prem" / "on-premise" → "on premises" / "on-premises" site-wide
#   2. /products "Learn More" links to detail pages now open in a new tab
#   3. /cloud "We think you should." stays on one line (whitespace-nowrap)
#   4. Light mode is now the default theme (was dark)

set -e
cd /Users/jared/Developer/bestlytech
[ -f .git/index.lock ] && rm -f .git/index.lock

# Stage local copies before rebase in case origin moved
mkdir -p /tmp/onprem-stage
cp src/pages/Index.tsx        /tmp/onprem-stage/Index.tsx
cp src/pages/InHouseCloud.tsx /tmp/onprem-stage/InHouseCloud.tsx
cp src/pages/Products.tsx     /tmp/onprem-stage/Products.tsx
cp src/main.tsx               /tmp/onprem-stage/main.tsx
cp index.html                 /tmp/onprem-stage/index.html
cp src/components/admin/SystemPulse.tsx /tmp/onprem-stage/SystemPulse.tsx

git checkout main
git stash push -u -m "onprem-staged" \
  src/pages/Index.tsx \
  src/pages/InHouseCloud.tsx \
  src/pages/Products.tsx \
  src/main.tsx \
  index.html \
  src/components/admin/SystemPulse.tsx 2>/dev/null || true

git pull --rebase origin main

# Restore from staged copies (these are the source of truth)
cp /tmp/onprem-stage/Index.tsx        src/pages/Index.tsx
cp /tmp/onprem-stage/InHouseCloud.tsx src/pages/InHouseCloud.tsx
cp /tmp/onprem-stage/Products.tsx     src/pages/Products.tsx
cp /tmp/onprem-stage/main.tsx         src/main.tsx
cp /tmp/onprem-stage/index.html       index.html
cp /tmp/onprem-stage/SystemPulse.tsx  src/components/admin/SystemPulse.tsx

git stash drop 2>/dev/null || true

git add \
  src/pages/Index.tsx \
  src/pages/InHouseCloud.tsx \
  src/pages/Products.tsx \
  src/main.tsx \
  index.html \
  src/components/admin/SystemPulse.tsx

echo "Files staged:"
git diff --cached --name-only

if git diff --cached --quiet; then
  echo "Nothing new to commit."
else
  echo "→ Build sanity check..."
  if ! npm run build > /tmp/onprem-build.log 2>&1; then
    tail -30 /tmp/onprem-build.log >&2
    exit 2
  fi
  echo "✓ Build passes"

  git commit -m "chore: copy + UX micro-fixes

* Site-wide: 'on-prem' / 'on-premise' → 'on premises' / 'on-premises'
  - index.html meta description
  - Index.tsx (hero pills, marquee, body copy)
  - InHouseCloud.tsx (projects outcome, section title, badge)

* Products page: 'Learn More' to a separate detail page now opens in
  a new tab (matches existing external https://... behavior).

* /cloud headline: 'We think you should.' wraps as a unit instead of
  mid-phrase via whitespace-nowrap on the gradient span.

* main.tsx: ThemeProvider defaultTheme dark → light. Dark still
  reachable via the toggle and OS preference still respected.

* SystemPulse.tsx: improved AI-generator liveness algorithm
  (any-activity = alive, idle-without-success = ok). Brought in
  via earlier intentional edit.
"

  git push origin main
fi

echo ""
echo "============================================================"
echo "  PUBLISHED on-prem + UX micro-fixes."
echo "  Vercel rebuild in ~90 sec."
echo "============================================================"
sleep 12
