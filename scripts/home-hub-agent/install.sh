#!/usr/bin/env bash
# Install or upgrade the Bestly Home Hub agent as a systemd service. Run on the Pi as root:
#   sudo bash install.sh
set -euo pipefail

INSTALL_DIR=/opt/bestly/home-hub-agent
CONFIG_DIR=/etc/bestly
CONFIG=$CONFIG_DIR/home-hub-agent.json
STATE_DIR=/var/lib/bestly-home-hub
BACKUP_DIR=/mnt/ssd/backups/home-hub
SRC="$(cd "$(dirname "$0")" && pwd)"

install -d "$INSTALL_DIR" "$CONFIG_DIR" "$STATE_DIR"
if [ -d /mnt/ssd ]; then install -d "$BACKUP_DIR"; fi
install -m 0755 "$SRC/agent.py" "$INSTALL_DIR/agent.py"
install -m 0755 "$SRC/launch.sh" "$INSTALL_DIR/launch.sh"
# A hand install is deliberate: never let launch.sh "roll back" over it.
rm -f "$STATE_DIR/update-pending"

if [ ! -f "$CONFIG" ]; then
  cat > "$CONFIG" <<'JSON'
{
  "supabase_url": "https://rcqfqhguwpmaarseifqg.supabase.co",
  "agent_key": "PASTE_THE_VAULT_KEY_HERE",
  "agent_name": "home-hub",
  "poll_seconds": 15
}
JSON
  chmod 0600 "$CONFIG"
  echo "Wrote a config template to $CONFIG — fill it in before starting."
fi

cat > /etc/systemd/system/bestly-home-hub-agent.service <<UNIT
[Unit]
Description=Bestly Home Hub agent
After=network-online.target docker.service
Wants=network-online.target
# launch.sh counts restarts after a self-update; systemd must never give up on its own.
StartLimitIntervalSec=0

[Service]
ExecStart=$INSTALL_DIR/launch.sh
Restart=always
RestartSec=10
User=root
TimeoutStopSec=90
# If the agent restarts mid-maintenance, let apt/dpkg or a backup finish instead of killing it halfway.
KillMode=process

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable bestly-home-hub-agent
# restart, not just start: on an upgrade the old process is still running the old code
systemctl restart bestly-home-hub-agent
echo "Installed. Logs: journalctl -u bestly-home-hub-agent -f"
