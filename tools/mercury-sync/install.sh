#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Copies the worker into the Pi cron framework and adds the Monday 8:00 AM crontab line (idempotent).
set -e
DEST=/opt/bestly/cron/jobs
STATE=/opt/bestly/cron/state
SRC=$(cd "$(dirname "$0")" && pwd)

mkdir -p "$DEST" "$STATE" /home/pi/scripts/cron-logs

for f in mercury_sync.py mercury-sync.py; do
  [ -f "$DEST/$f" ] && cp -p "$DEST/$f" "$DEST/$f.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$SRC/$f" "$DEST/$f"
done
python3 -m py_compile "$DEST/mercury_sync.py" "$DEST/mercury-sync.py"

# State starts in DRY mode -- nothing is created until this says "live".
if [ ! -f "$STATE/mercury_sync.json" ]; then
  printf '{\n  "mode": "dry",\n  "last_run": null,\n  "created_customer_ids": [],\n  "log": []\n}\n' > "$STATE/mercury_sync.json"
  echo "seeded $STATE/mercury_sync.json in DRY mode"
fi

LINE='0 8 * * 1 /opt/bestly/cron/run.sh mercury-sync   # Rolo: Mercury customers -> Nextcloud contacts (Pi clock = America/Los_Angeles)'
if ! crontab -l | grep -q 'run.sh mercury-sync'; then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-mercury-sync"
  (crontab -l; echo "$LINE") | crontab -
fi
crontab -l | grep mercury-sync

python3 "$SRC/selftest.py"

echo
echo "Installed. Next:"
echo "  1. dry run:  python3 $DEST/mercury_sync.py --dry"
echo "     (it should say 'DRY would create N ...'; a 'skip: ...' line says why Mercury or Nextcloud could not be read)"
echo "  2. review the count, then go live: set \"mode\" to \"live\" in $STATE/mercury_sync.json"
echo "  3. first live run: python3 $DEST/mercury_sync.py --live --max-create 20"
echo "  4. once a real run reports ok:  update pi_jobs set enabled = true where job = 'mercury-sync';"
