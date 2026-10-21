#!/bin/sh
# One-paste install for Tally (todo-autotick). Run from the Mac (repo checkout), the files come through the repo-read function:
#   ssh pi@bestly-pi 'sh -s' < tools/todo-autotick/go.sh
# Needs /opt/bestly/cron/tools/repo_get.py on the Pi (tools/repo-get/repo_get.py).
# Installs, does a dry run, and only goes live if the dry run could read Mercury and Bestly Sign.
set -e
RG="python3 /opt/bestly/cron/tools/repo_get.py"
TMP=$(mktemp -d)
for f in todo_autotick.py todo-autotick.py install.sh selftest.py; do
  $RG "tools/todo-autotick/$f" -o "$TMP/$f"
done
sh "$TMP/install.sh"

echo; echo "== dry run =="
OUT=$(python3 /opt/bestly/cron/jobs/todo_autotick.py --dry --quiet 2>&1) || true
echo "$OUT"
if echo "$OUT" | grep -qiE "skip|error|traceback|could not"; then
  echo; echo "STOPPED: dry run could not read everything (see above). Still in dry mode, nothing ticked."
  exit 1
fi

python3 - <<'EOF'
import json
p = "/opt/bestly/cron/state/todo_autotick.json"
s = json.load(open(p)); s["mode"] = "live"; json.dump(s, open(p, "w"), indent=2)
EOF

echo; echo "== first live run =="
/opt/bestly/cron/run.sh todo-autotick
rm -rf "$TMP"
echo; echo "ALL GOOD: Tally is live and runs every hour at :07."
