#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Copies RoofGuard Outreach into the Pi cron framework and adds its crontab line (idempotent). The job is DRAFT-ONLY.
set -e
DEST=/opt/bestly/cron/jobs
cp roofguard_outreach.py "$DEST/roofguard_outreach.py"
python3 -m py_compile "$DEST/roofguard_outreach.py"
if ! crontab -l | grep -q 'run.sh roofguard_outreach'; then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-roofguard"
  (crontab -l
   echo '0 9 * * 1-5 /opt/bestly/cron/run.sh roofguard_outreach   # RoofGuard Outreach: weekdays 9:00 AM, draft-only (never sends), free AI (Pi clock = America/Los_Angeles)') | crontab -
fi
crontab -l | grep roofguard_outreach
