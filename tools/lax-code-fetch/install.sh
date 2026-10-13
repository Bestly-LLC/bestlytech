#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Installs Parker (the LAX garage code fetcher) into the Pi cron framework and adds its crontab line (idempotent).
# Safe any time: until the Park My Share login is saved on Turo Watch > Settings the job only says "skip: login not saved".
set -e
cp lax_code_fetch.py /opt/bestly/cron/jobs/lax_code_fetch.py
python3 -m py_compile /opt/bestly/cron/jobs/lax_code_fetch.py
sudo -n mkdir -p /opt/bestly/parkmyshare
sudo -n cp browser.py /opt/bestly/parkmyshare/browser.py
sudo -n chown -R pi:pi /opt/bestly/parkmyshare
/opt/bestly/turo-watch/.venv/bin/python -m py_compile /opt/bestly/parkmyshare/browser.py
/opt/bestly/turo-watch/.venv/bin/python -c "import playwright" || echo "WARN: turo-watch venv has no Playwright; browser fallback won't work"
if ! crontab -l | grep -q 'run.sh lax_code_fetch'; then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-laxcode"
  (crontab -l
   echo '*/5 * * * * /opt/bestly/cron/run.sh lax_code_fetch   # Parker: LAX garage QR from Park My Share, free, no AI (ticks every 5 min, asks Park My Share only when due)') | crontab -
fi
crontab -l | grep lax_code_fetch
