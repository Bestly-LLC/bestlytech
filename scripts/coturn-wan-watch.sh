#!/bin/bash
# coturn-wan-watch — heal coturn's external-ip when the WAN address changes.
# Bestly LLC, 2026-05-21. Run hourly via cron.
#
# Coturn's external-ip MUST match the actual WAN IP, otherwise the relay
# address it advertises to clients is dead and TURN media flows fail.
# Verizon FiOS rotates the WAN IP periodically — this script catches that.

set -euo pipefail

CONF=/etc/turnserver.conf
LAN=192.168.0.211
LOG=/var/log/coturn-wan-watch.log
WAN_SERVICES=("https://ifconfig.me" "https://api.ipify.org" "https://ipv4.icanhazip.com")

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" >> "$LOG"; }

# Try multiple WAN-IP services; first one that returns a valid v4 wins.
get_wan() {
	for url in "${WAN_SERVICES[@]}"; do
		ip=$(curl -s4 --max-time 5 "$url" | tr -d '[:space:]')
		if [[ "$ip" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
			echo "$ip"; return 0
		fi
	done
	return 1
}

WAN=$(get_wan || true)
if [ -z "${WAN:-}" ]; then
	log "could not determine WAN IP; leaving config alone"
	exit 0
fi

CURRENT=$(grep -oP '(?<=^external-ip=)[0-9.]+' "$CONF" | head -1)
DESIRED="${WAN}/${LAN}"

if [ "$CURRENT" = "$WAN" ]; then
	# No change. Quiet exit.
	exit 0
fi

log "WAN changed: $CURRENT -> $WAN. Rewriting $CONF and restarting coturn."
sed -i "s|^external-ip=.*|external-ip=${DESIRED}|" "$CONF"
systemctl restart coturn
if systemctl is-active --quiet coturn; then
	log "coturn restarted successfully on $WAN"
else
	log "coturn FAILED to restart on $WAN — see journalctl -u coturn"
	exit 1
fi
