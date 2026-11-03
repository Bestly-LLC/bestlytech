#!/bin/bash
# Daily App Contract Check (LaunchAgent tech.bestly.admin-app-contract, 6:40 AM, Mac mini). No AI.
# Pulls the newest app source from the sky-alerts checkout, then compares every server call with the live database and tells Scout.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
D="$HOME/Bestly/admin-app-contract"
SKY="$HOME/Developer/sky-alerts"
WEB="$HOME/Developer/bestlytech"
SRC="$SKY/ios/BestlySky/BestlySky"
git -C "$SKY" fetch -q origin 2>/dev/null
# check the newest pushed app code, not a stale working copy
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
if git -C "$SKY" rev-parse -q --verify origin/feature/sky-alerts >/dev/null; then
  git -C "$SKY" archive origin/feature/sky-alerts ios/BestlySky/BestlySky | tar -x -C "$TMP" && SRC="$TMP/ios/BestlySky/BestlySky"
fi
REPOARG=()
[ -d "$WEB/.git" ] && REPOARG=(--repo "$WEB")
/usr/bin/python3 "$D/check.py" "$SRC" --daily "${REPOARG[@]}"
