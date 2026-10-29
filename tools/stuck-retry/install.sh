#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Copies the runner into the Pi cron framework and adds the one-minute crontab line (idempotent).
set -e
DEST=/opt/bestly/cron/jobs
STATE=/opt/bestly/cron/state
SRC=$(cd "$(dirname "$0")" && pwd)

mkdir -p "$DEST" "$STATE" /home/pi/scripts/cron-logs

python3 "$SRC/selftest.py"

f=run_requests.py
[ -f "$DEST/$f" ] && cp -p "$DEST/$f" "$DEST/$f.bak-$(date +%Y%m%d-%H%M%S)"
cp "$SRC/$f" "$DEST/$f"
python3 -m py_compile "$DEST/$f"

LINE='* * * * * /opt/bestly/cron/run.sh run_requests   # Command Center "Retry now": run the Pi job that was asked for'
if ! crontab -l | grep -q 'run.sh run_requests'; then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-run-requests"
  (crontab -l; echo "$LINE") | crontab -
fi
crontab -l | grep run_requests

echo
echo "Installed. Next:"
echo "  1. one real run:  /opt/bestly/cron/run.sh run_requests   (must report 'ok nothing waiting')"
echo "  2. then:  update pi_jobs set enabled = true where job = 'run_requests';"
echo "  3. the stuck-feed watchdog raises 'a Pi retry request has waited 5+ minutes' if this job is ever off."
