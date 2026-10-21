#!/bin/bash
# pi-relay-setup.sh - switch Blue Steel live location from the Tailscale Funnel to telemetry.bestly.tech (AWS relay).
# Run on the Pi as root, with the commit it was downloaded from:   sudo bash pi-relay-setup.sh <commit>
# What it does (each step is safe to re-run):
#   1. Downloads certs.sh, finish.sh and the tunnel unit from the repo (repo-read function) at <commit> and checks their SHA-256.
#   2. Installs them (old copies kept as *.bak-20261014-relay) and re-signs the receiver certificate so it also
#      names telemetry.bestly.tech (certs.sh restarts the receiver).
#   3. Creates the tunnel key (/opt/bestly/telemetry/relay, root 0700) and pins the relay's host key.
#   4. Posts the PUBLIC key to the database (car_telemetry_relay_key, ingest token) so Claude can authorize it on the relay.
#   5. Turns the old Funnel on tcp 8443 off (the https /v1 entrance is not touched).
#   6. Starts car-telemetry-tunnel.service. It retries every 15 s until the key is authorized on the relay.
# Undo: systemctl disable --now car-telemetry-tunnel; rm /etc/systemd/system/car-telemetry-tunnel.service;
#       restore /opt/bestly/telemetry/{certs.sh,finish.sh}.bak-20261014-relay and run certs.sh.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run with sudo" >&2; exit 1; }
C=${1:?usage: sudo bash pi-relay-setup.sh <commit>}
[[ "$C" =~ ^[0-9a-f]{7,40}$ ]] || { echo "commit must be a git hash" >&2; exit 1; }
D=/opt/bestly/telemetry
R=$D/relay
RG="python3 /opt/bestly/cron/tools/repo_get.py"   # authenticated repo fetch (repo-read function)
RELAY_IP=44.241.28.216
RELAY_HOSTKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAHun/RNXxEIhUsyHLkc7NFc1AhEshn9q6Vep/663rTV"
SB=https://rcqfqhguwpmaarseifqg.supabase.co
say() { printf '%s  %s\n' "$(date '+%I:%M:%S %p')" "$*"; }

say "1/6 downloading files at $C"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
$RG tools/car-telemetry/certs.sh -r "$C" -o "$T/certs.sh"
$RG tools/car-telemetry/finish.sh -r "$C" -o "$T/finish.sh"
$RG tools/car-telemetry/relay/car-telemetry-tunnel.service -r "$C" -o "$T/car-telemetry-tunnel.service"
( cd "$T" && sha256sum -c --quiet - ) <<'SUMS'
61af839b645fba6a1b6cb7fb84cd8a2d8354f23bedb7c4358904518b13be0790  certs.sh
fc7289ab8a21f4e6ae827eccfaf95b4d17fc469db01617887a65bfb2a5affdd7  finish.sh
446db1e16de3052d78e95a2da18d468cace2ef846607a8273ce9d6f446693f52  car-telemetry-tunnel.service
SUMS
say "      checksums match"

say "2/6 installing certs.sh + finish.sh, re-signing the receiver certificate for telemetry.bestly.tech"
for f in certs.sh finish.sh; do
  [ -f "$D/$f.bak-20261014-relay" ] || cp -p "$D/$f" "$D/$f.bak-20261014-relay"
  install -m 700 -o root -g root "$T/$f" "$D/$f"
done
"$D/certs.sh"
openssl x509 -in "$D/pub/server.crt" -noout -ext subjectAltName | grep -q 'DNS:telemetry.bestly.tech' \
  || { echo "STOP: the certificate still does not name telemetry.bestly.tech" >&2; exit 1; }
say "      $(openssl x509 -in "$D/pub/server.crt" -noout -ext subjectAltName | tail -1 | sed 's/^ *//')"

say "3/6 tunnel key and relay host key"
umask 077
mkdir -p "$R"; chmod 700 "$R"
[ -s "$R/id_ed25519" ] || ssh-keygen -q -t ed25519 -N '' -C bestly-pi-telemetry -f "$R/id_ed25519"
echo "$RELAY_IP $RELAY_HOSTKEY" > "$R/known_hosts"
chmod 600 "$R/id_ed25519" "$R/known_hosts"; chmod 644 "$R/id_ed25519.pub"
say "      $(ssh-keygen -lf "$R/id_ed25519.pub")"

say "4/6 sending the public key to the database"
set -a; . "$D/.env"; set +a
PUB=$(cat "$R/id_ed25519.pub")
OUT=$(curl -sS --max-time 20 -X POST "$SB/rest/v1/rpc/car_telemetry_relay_key" -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" -H 'Content-Type: application/json' \
  -d "{\"p_token\":\"$CAR_TELEMETRY_TOKEN\",\"p_pubkey\":\"$PUB\"}")
echo "      $OUT"
echo "$OUT" | grep -q '"ok"' || { echo "STOP: the database did not take the key (line above)" >&2; exit 1; }

say "5/6 turning the old Funnel on tcp 8443 off"
tailscale funnel --tcp=8443 off >/dev/null 2>&1 || true
tailscale funnel status 2>/dev/null | grep -q 'tcp://.*:8443' && { echo "STOP: the tcp 8443 Funnel is still on" >&2; exit 1; }
say "      off (the https /v1 entrance is unchanged)"

say "6/6 starting the tunnel service"
install -m 644 -o root -g root "$T/car-telemetry-tunnel.service" /etc/systemd/system/car-telemetry-tunnel.service
systemctl daemon-reload
systemctl enable --now car-telemetry-tunnel
say "done. Tell Claude 'relay setup done'. The tunnel keeps retrying until Claude authorizes the key on the relay."
