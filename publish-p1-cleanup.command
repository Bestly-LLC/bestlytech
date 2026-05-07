#!/bin/bash
# P1 cleanup — remove stale worktrees, dist-v* dirs, vite timestamps.
#
# All 5 .claude/worktrees/ are marked 'prunable' by git. None have
# unpushed commits — verified before this script was written.
#
# After this runs:
#   - 5 admin-redesign worktrees gone (~50MB)
#   - 5 dist-v4..v8 build outputs gone (~36MB)
#   - 4 stale vite.config.ts.timestamp-* files gone
#   - .gitignore updated to keep them out for good
#   - feature/admin-ui-overhaul branch deleted (already done in sandbox)
#
# Total reclaim: ~90MB. No source code touched.

set -e
cd /Users/jared/Developer/bestlytech
[ -f .git/index.lock ] && rm -f .git/index.lock
[ -f .git/packed-refs.lock ] && rm -f .git/packed-refs.lock
[ -f .git/refs/heads/feature/admin-ui-overhaul.lock ] && rm -f .git/refs/heads/feature/admin-ui-overhaul.lock

echo "→ Pruning worktrees..."
for w in clever-hellman thirsty-pare bold-dijkstra priceless-cerf determined-margulis; do
  git worktree remove ".claude/worktrees/$w" --force 2>/dev/null || true
done
git worktree prune
rm -rf .claude

echo "→ Removing stale dist-v* dirs..."
rm -rf dist-v4 dist-v5 dist-v6 dist-v7 dist-v8

echo "→ Removing vite timestamp files..."
rm -f vite.config.ts.timestamp-*

echo "→ Removing remote feature branch..."
git push origin --delete feature/admin-ui-overhaul 2>/dev/null || true
git branch -D feature/admin-ui-overhaul 2>/dev/null || true

echo "→ Committing .gitignore update..."
git checkout main
git pull origin main
git add .gitignore
git commit -m "chore: ignore dist-v*, .claude/, .vercel/, vite timestamps

After P1 cleanup we no longer want stale build outputs, abandoned
worktrees, or editor scratch files in the repo." || echo "nothing to commit"
git push origin main

echo ""
echo "============================================================"
echo "  P1 CLEANUP COMPLETE."
echo "  Worktrees + 5 dist-v* dirs gone."
echo "  feature/admin-ui-overhaul branch retired."
echo "  ~90MB reclaimed."
echo "============================================================"
sleep 15
