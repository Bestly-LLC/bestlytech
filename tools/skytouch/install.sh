#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Copies the two SkyTouch jobs into the Pi cron framework and adds their crontab lines (idempotent).
# Safe to run any time: both jobs read the SkyTouch master switch first and do nothing but a "paused" heartbeat while it is off.
set -e
DEST=/opt/bestly/cron/jobs
for f in skytouch_common.py skytouch_ical.py skytouch_triage.py skytouch_morning.py; do
  cp "$f" "$DEST/$f"
done
python3 -m py_compile "$DEST/skytouch_common.py" "$DEST/skytouch_ical.py" "$DEST/skytouch_triage.py" "$DEST/skytouch_morning.py"
if ! crontab -l | grep -q 'run.sh skytouch_'; then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-skytouch"
  (crontab -l
   echo '3 * * * * /opt/bestly/cron/run.sh skytouch_triage   # SkyTouch front desk: reads client texts hourly, free, no AI (paused until switched on at /admin/skytouch)'
   echo '11 8 * * * /opt/bestly/cron/run.sh skytouch_morning   # SkyTouch morning check, free, no AI (Pi clock = America/Los_Angeles)') | crontab -
fi
crontab -l | grep skytouch_
