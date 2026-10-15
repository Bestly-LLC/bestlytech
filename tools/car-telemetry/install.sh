#!/bin/bash
# One-time install of the Fleet Telemetry receiver on the Pi. Run as root from the folder that holds these files.
# Prints only the SHA-256 of the ingest token (that goes into the database); the token itself stays in .env (root 0600).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
D=/opt/bestly/telemetry
umask 077
mkdir -p "$D"
chmod 700 "$D"
install -m 700 -o root -g root "$SRC/certs.sh" "$D/certs.sh"
install -m 700 -o root -g root "$SRC/finish.sh" "$D/finish.sh"   # written, NOT run by the build
install -m 644 -o root -g root "$SRC/config.json" "$SRC/docker-compose.yml" "$D/"
rm -rf "$D/fwd"; cp -r "$SRC/fwd" "$D/fwd"; chown -R root:root "$D/fwd"; chmod -R a+rX "$D/fwd"
install -m 644 "$SRC/car-telemetry-certs.service" "$SRC/car-telemetry-certs.timer" /etc/systemd/system/
"$D/certs.sh"
if [ ! -s "$D/.env" ]; then
  T=$(openssl rand -hex 32)
  printf 'SUPABASE_ANON_KEY=sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw\nCAR_TELEMETRY_TOKEN=%s\n' "$T" > "$D/.env"
  printf '%s' "$T" | sha256sum | cut -d' ' -f1 > "$D/.token_hash"
  chmod 600 "$D/.env" "$D/.token_hash"
fi
systemctl daemon-reload
systemctl enable --now car-telemetry-certs.timer
echo "TOKEN_SHA256=$(cat "$D/.token_hash")"
