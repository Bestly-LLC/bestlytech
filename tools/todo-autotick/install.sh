#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Copies the worker into the Pi cron framework and adds the hourly crontab line (idempotent).
set -e
DEST=/opt/bestly/cron/jobs
STATE=/opt/bestly/cron/state
SRC=$(cd "$(dirname "$0")" && pwd)

mkdir -p "$DEST" "$STATE" /home/pi/scripts/cron-logs

for f in todo_autotick.py todo-autotick.py; do
  [ -f "$DEST/$f" ] && cp -p "$DEST/$f" "$DEST/$f.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$SRC/$f" "$DEST/$f"
done
python3 -m py_compile "$DEST/todo_autotick.py" "$DEST/todo-autotick.py"

# State starts in DRY mode -- nothing is ticked until this says "live".
if [ ! -f "$STATE/todo_autotick.json" ]; then
  printf '{\n  "mode": "dry",\n  "last_run": null,\n  "ticked": [],\n  "log": []\n}\n' > "$STATE/todo_autotick.json"
  echo "seeded $STATE/todo_autotick.json in DRY mode"
fi

LINE='7 * * * * /opt/bestly/cron/run.sh todo-autotick   # Tally: tick off client to-dos for paid invoices / signed contracts (Pi clock = America/Los_Angeles)'
if ! crontab -l | grep -q 'run.sh todo-autotick'; then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-todo-autotick"
  (crontab -l; echo "$LINE") | crontab -
fi
crontab -l | grep todo-autotick

python3 "$SRC/selftest.py"

echo
echo "Installed. Next:"
echo "  1. dry run:  python3 $DEST/todo_autotick.py --dry"
echo "     (expect 'DRY would tick 0, 3 still waiting' while all three Centering YOU to-dos are open;"
echo "      a 'skip: ...' line says why Mercury could not be read)"
echo "  2. go live: set \"mode\" to \"live\" in $STATE/todo_autotick.json"
echo "  3. one real run: /opt/bestly/cron/run.sh todo-autotick   (must report ok)"
echo "  4. then:  update pi_jobs set enabled = true where job = 'todo-autotick';"
