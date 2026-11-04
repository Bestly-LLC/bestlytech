set -e
cd /opt/bestly/wall
for f in server.py aircraft_enrich.py watchdog.py alerts_batch.py alerts_rare.py; do python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read())" $f && echo ast ok $f; done
cat > /tmp/bestly-wall-alerts.service <<'EOF'
[Unit]
Description=Wall alerts batch: wall-off push, helicopter reasons, rare aircraft (Sky Sync / Wall Watchdog) ALERTS_20261103
After=network-online.target bestly-wall.service
Wants=network-online.target

[Service]
Type=notify
NotifyAccess=main
User=pi
WorkingDirectory=/opt/bestly/wall
ExecStart=/usr/bin/python3 -u /opt/bestly/wall/alerts_batch.py
Restart=always
RestartSec=3
WatchdogSec=180

[Install]
WantedBy=multi-user.target
EOF
sudo -n cp /tmp/bestly-wall-alerts.service /etc/systemd/system/bestly-wall-alerts.service
sudo -n systemctl daemon-reload
sudo -n systemctl restart bestly-wall
sleep 6
sudo -n systemctl enable --now bestly-wall-alerts
sleep 20
systemctl is-active bestly-wall bestly-wall-alerts
cat alerts_status.json | head -c 600; echo
journalctl -u bestly-wall -u bestly-wall-alerts --since "-2 min" --no-pager | tail -15
curl -s -o /dev/null -w "wall health %{http_code}\n" localhost:8099/api/health
