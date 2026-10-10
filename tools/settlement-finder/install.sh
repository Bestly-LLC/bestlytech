#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Copies the worker into the Pi cron framework and adds the 7:20 AM crontab line (idempotent).
set -e
DEST=/opt/bestly/cron/jobs
cp settlement_finder.py "$DEST/settlement_finder.py"
cp settlement-finder.py "$DEST/settlement-finder.py"
python3 -m py_compile "$DEST/settlement_finder.py" "$DEST/settlement-finder.py"
LINE='20 7 * * * /opt/bestly/cron/run.sh settlement-finder   # Nickel: finds open class action settlements + matches them to Jared (free AI, Pi clock = America/Los_Angeles)'
if ! crontab -l | grep -q 'run.sh settlement-finder'; then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-settlement-finder"
  (crontab -l; echo "$LINE") | crontab -
fi
crontab -l | grep settlement-finder
