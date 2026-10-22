#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Copies Job Finder into the Pi cron framework and adds its crontab line (idempotent).
set -e
DEST=/opt/bestly/cron/jobs
cp job_finder.py "$DEST/job_finder.py"
python3 -m py_compile "$DEST/job_finder.py"
if ! crontab -l | grep -q 'run.sh job_finder'; then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-jobfinder"
  (crontab -l
   echo '0 7 * * * /opt/bestly/cron/run.sh job_finder   # Job Finder: daily 7:00 AM, files new roles on the Nextcloud Job Search board, free (Pi clock = America/Los_Angeles)') | crontab -
fi
crontab -l | grep job_finder
