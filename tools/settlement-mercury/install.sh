#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Copies the worker into the Pi cron framework and adds the crontab line (idempotent): every 2 hours at minute 7.
set -e
DEST=/opt/bestly/cron/jobs
cp settlement_mercury.py "$DEST/settlement_mercury.py"
cp settlement-mercury.py "$DEST/settlement-mercury.py"
python3 -m py_compile "$DEST/settlement_mercury.py" "$DEST/settlement-mercury.py"
LINE='7 */2 * * * /opt/bestly/cron/run.sh settlement-mercury   # Bank Watch: matches Mercury deposits to settlement claims (read-only, no AI; Pi clock = America/Los_Angeles)'
if ! crontab -l | grep -q 'run.sh settlement-mercury'; then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-settlement-mercury"
  (crontab -l; echo "$LINE") | crontab -
fi
crontab -l | grep settlement-mercury
