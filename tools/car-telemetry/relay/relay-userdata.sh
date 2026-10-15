#!/bin/bash
# Record of the EC2 user-data that built bestly-telemetry-relay (i-0f172801cbf3d13e8, us-west-2, t4g.nano AL2023 arm64,
# Elastic IP 44.241.28.216, SG sg-0bb1bcc7e0bd414a6: 443 + 22 in, IAM profile bestly-telemetry-relay = SSM only).
# Passes Tesla Fleet Telemetry (TCP 443) to the Pi through a reverse SSH tunnel the Pi opens.
# Holds no keys or certificates. TLS (mTLS) ends on the Pi. Admin only through SSM.
set -euo pipefail
useradd --system --create-home --home-dir /home/tunnel --shell /sbin/nologin tunnel || true
install -d -m 700 -o tunnel -g tunnel /home/tunnel/.ssh
touch /home/tunnel/.ssh/authorized_keys; chown tunnel:tunnel /home/tunnel/.ssh/authorized_keys; chmod 600 /home/tunnel/.ssh/authorized_keys
cat > /etc/ssh/sshd_config.d/10-bestly-relay.conf <<'CONF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
AllowUsers tunnel
AllowTcpForwarding no
X11Forwarding no
AllowAgentForwarding no
Match User tunnel
    AllowTcpForwarding remote
    PermitListen 127.0.0.1:9444
    PermitTTY no
    ForceCommand /bin/false
CONF
sshd -t
systemctl restart sshd
cat > /etc/systemd/system/telemetry-relay.socket <<'CONF'
[Unit]
Description=Tesla Fleet Telemetry public port 443
[Socket]
ListenStream=0.0.0.0:443
[Install]
WantedBy=sockets.target
CONF
cat > /etc/systemd/system/telemetry-relay.service <<'CONF'
[Unit]
Description=Pass TCP 443 to the Pi tunnel on 127.0.0.1:9444
Requires=telemetry-relay.socket
After=telemetry-relay.socket
[Service]
ExecStart=/usr/lib/systemd/systemd-socket-proxyd --connections-max=64 127.0.0.1:9444
DynamicUser=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
NoNewPrivileges=yes
CONF
systemctl daemon-reload
systemctl enable --now telemetry-relay.socket
hostnamectl set-hostname bestly-telemetry-relay
