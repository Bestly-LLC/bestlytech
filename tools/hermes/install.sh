#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Installs Hermes (Mail Clerk): the Mailroom reader job (every 5 minutes), the mail guard service, the browser worker.
# Idempotent. Undo: remove the crontab line, `sudo systemctl disable --now bestly-hermes-guard`, delete /opt/bestly/hermes.
set -e
SRC=$(cd "$(dirname "$0")" && pwd)
JOBS=/opt/bestly/cron/jobs
HOME_DIR=/opt/bestly/hermes
[ -d "$HOME_DIR" ] || { sudo -n mkdir -p "$HOME_DIR" && sudo -n chown pi:pi "$HOME_DIR"; }
mkdir -p "$JOBS" /opt/bestly/cron/state /home/pi/scripts/cron-logs

python3 "$SRC/selftest.py"

for f in hermes_mailroom.py hermes_rules.py; do
  [ -f "$JOBS/$f" ] && cp -p "$JOBS/$f" "$JOBS/$f.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$SRC/$f" "$JOBS/$f"
done
for f in hermes_guard.py ipostal_browser.py hermes_rules.py; do
  cp "$SRC/$f" "$HOME_DIR/$f"
done
python3 -m py_compile "$JOBS/hermes_mailroom.py" "$JOBS/hermes_rules.py" "$HOME_DIR/hermes_guard.py" "$HOME_DIR/ipostal_browser.py"
/opt/bestly/turo-watch/.venv/bin/python -m py_compile "$HOME_DIR/ipostal_browser.py"

sudo -n cp "$SRC/bestly-hermes-guard.service" /etc/systemd/system/bestly-hermes-guard.service
sudo -n systemctl daemon-reload
sudo -n systemctl enable --now bestly-hermes-guard
sleep 3
systemctl is-active bestly-hermes-guard

LINE='*/5 * * * * /opt/bestly/cron/run.sh hermes_mailroom   # Hermes (Mail Clerk): files iPostal1 alerts from the Mailroom folder, runs only actions Jared approved, restarts bestly-hermes-guard if it stalls (Pi clock = America/Los_Angeles). Undo: remove this line; off switch: hermes_state.enabled = false'
if ! crontab -l | grep -q 'run.sh hermes_mailroom'; then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-hermes"
  (crontab -l; echo "$LINE") | crontab -
fi
crontab -l | grep hermes_mailroom
echo "Installed. Dry run:  cd /opt/bestly/cron && python3 -c \"import sys; sys.path.insert(0,'.'); from jobs import hermes_mailroom as j; print(j.main(['--dry']))\""
