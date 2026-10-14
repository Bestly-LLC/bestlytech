#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Copies the worker into the Pi cron framework and adds the 6:05 AM crontab line (idempotent).
set -e
DEST=/opt/bestly/cron/jobs
STATE=/opt/bestly/cron/state
SRC=$(cd "$(dirname "$0")" && pwd)

mkdir -p "$DEST" "$STATE" /home/pi/scripts/cron-logs

for f in inbox_cleaner.py inbox_cleaner_rules.py inbox-cleaner.py; do
  [ -f "$DEST/$f" ] && cp -p "$DEST/$f" "$DEST/$f.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$SRC/$f" "$DEST/$f"
done
python3 -m py_compile "$DEST/inbox_cleaner.py" "$DEST/inbox_cleaner_rules.py" "$DEST/inbox-cleaner.py"

# State starts in DRY mode -- nothing moves until this says "live".
if [ ! -f "$STATE/inbox_cleaner.json" ]; then
  printf '{\n  "mode": "dry",\n  "killed_senders": [],\n  "alias_queue": [],\n  "unsubscribe_queue": [],\n  "protected_additions": [],\n  "last_run": null,\n  "log": []\n}\n' > "$STATE/inbox_cleaner.json"
  echo "seeded $STATE/inbox_cleaner.json in DRY mode"
fi

LINE='5 6 * * * /opt/bestly/cron/run.sh inbox-cleaner   # Hermes: daily iCloud inbox cleanup (Pi clock = America/Los_Angeles)'
if ! crontab -l | grep -q 'run.sh inbox-cleaner'; then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-inbox-cleaner"
  (crontab -l; echo "$LINE") | crontab -
fi
crontab -l | grep inbox-cleaner

python3 "$SRC/selftest.py"

echo
echo "Installed. Next:"
echo "  1. dry run:  python3 $DEST/inbox_cleaner.py --dry --limit 1500"
echo "  2. review the senders it would trash"
echo "  3. go live:  set \"mode\" to \"live\" in $STATE/inbox_cleaner.json"
echo "  4. then:     update pi_jobs set enabled = true where job = 'inbox-cleaner';"
