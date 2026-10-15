#!/bin/sh
# One-paste install for Tally (todo-autotick). Run ON the Pi as pi, or from the Mac:
#   ssh pi@bestly-pi 'curl -fsSL https://raw.githubusercontent.com/Bestly-LLC/bestlytech/main/tools/todo-autotick/go.sh | sh'
# Installs, does a dry run, and only goes live if the dry run could read Mercury and Bestly Sign.
set -e
RAW=https://raw.githubusercontent.com/Bestly-LLC/bestlytech/main/tools/todo-autotick
TMP=$(mktemp -d)
for f in todo_autotick.py todo-autotick.py install.sh selftest.py; do
  curl -fsSL "$RAW/$f" -o "$TMP/$f"
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
