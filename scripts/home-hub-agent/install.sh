#!/usr/bin/env bash
# Install the Bestly Home Hub agent as a systemd service. Run on the Pi as root.
set -euo pipefail

INSTALL_DIR=/opt/bestly/home-hub-agent
CONFIG_DIR=/etc/bestly
CONFIG=$CONFIG_DIR/home-hub-agent.json
SRC="$(cd "$(dirname "$0")" && pwd)"

install -d "$INSTALL_DIR" "$CONFIG_DIR"
install -m 0755 "$SRC/agent.py" "$INSTALL_DIR/agent.py"

if [ ! -f "$CONFIG" ]; then
  cat > "$CONFIG" <<'JSON'
{
  "supabase_url": "https://rcqfqhguwpmaarseifqg.supabase.co",
  "agent_key": "PASTE_THE_VAULT_KEY_HERE",
  "agent_name": "home-hub",
  "poll_seconds": 15,
  "pihole":        {"base": "http://127.0.0.1/admin", "token": "PASTE_PIHOLE_TOKEN"},
  "homeassistant": {"base": "http://127.0.0.1:8123",  "token": "PASTE_HA_TOKEN"},
  "homebridge":    {"base": "http://127.0.0.1:8581",  "user": "admin", "password": "PASTE_PW"}
}
JSON
  chmod 0600 "$CONFIG"
  echo "Wrote a config template to $CONFIG — fill it in before starting."
fi

cat > /etc/systemd/system/bestly-home-hub-agent.service <<UNIT
[Unit]
Description=Bestly Home Hub agent
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/python3 $INSTALL_DIR/agent.py
Restart=always
RestartSec=10
User=root

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now bestly-home-hub-agent
echo "Installed. Logs: journalctl -u bestly-home-hub-agent -f"
