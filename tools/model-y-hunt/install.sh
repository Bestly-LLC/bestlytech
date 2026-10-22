#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Copies the Model Y Hunter into the Pi cron framework and adds its crontab line (idempotent).
set -e
DEST=/opt/bestly/cron/jobs
cp model_y_hunt.py "$DEST/model_y_hunt.py"
python3 -m py_compile "$DEST/model_y_hunt.py"
mkdir -p /opt/bestly/cron/state 2>/dev/null || true
if ! crontab -l | grep -q 'run.sh model_y_hunt'; then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-modely"
  (crontab -l
   echo '57 7 * * * /opt/bestly/cron/run.sh model_y_hunt   # Model Y Hunter: daily 7:57 AM scan, free, public sources only (Pi clock = America/Los_Angeles)') | crontab -
fi
crontab -l | grep model_y_hunt
