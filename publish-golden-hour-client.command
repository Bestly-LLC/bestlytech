#!/bin/bash
# Golden Hour — publish the "Golden Hour Garden Design" client entry on /services.
# The change is already committed to local main (commit ea0d6d4). This pushes it,
# which triggers Vercel's git integration to rebuild + deploy bestly.tech.
set -e
cd /Users/jared/Developer/bestlytech
[ -f .git/index.lock ] && rm -f .git/index.lock

git checkout main

echo "→ Build sanity check..."
if ! npm run build > /tmp/ghclient-build.log 2>&1; then
  echo "Build FAILED — see /tmp/ghclient-build.log" >&2
  tail -30 /tmp/ghclient-build.log >&2
  exit 2
fi
echo "✓ Build passes"

echo "→ Syncing with origin/main..."
git pull --rebase origin main

echo "→ Pushing..."
git push origin main

echo ""
echo "============================================================"
echo "  PUBLISHED — Golden Hour added to /services."
echo "  Vercel rebuilds within ~90 sec, then hard-refresh:"
echo "  https://www.bestly.tech/services"
echo "============================================================"
sleep 20
