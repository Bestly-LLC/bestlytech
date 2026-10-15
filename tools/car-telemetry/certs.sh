#!/bin/bash
# Fleet Telemetry receiver certificates (Blue Steel live location). Run as root on the Pi. Idempotent.
#   - private CA (EC P-256), valid 10 years, created once
#   - server certificate (EC P-256), valid 2 years, SAN = telemetry.bestly.tech (what the car connects to, via the AWS relay)
#     + the Pi's Tailscale host; re-signed when fewer than 45 days remain or a name is missing
# Install: /opt/bestly/telemetry/certs.sh (root 0700). Timer: car-telemetry-certs.timer (daily).
set -euo pipefail
D=/opt/bestly/telemetry
HOST=telemetry.bestly.tech
ALT=bestly-pi.taile42611.ts.net
RENEW_DAYS=${RENEW_DAYS:-45}
umask 077
mkdir -p "$D/ca" "$D/server" "$D/pub"
chmod 700 "$D" "$D/ca" "$D/server"
chmod 755 "$D/pub"   # public material only (mounted into the forwarder container)

if [ ! -s "$D/ca/ca.key" ] || [ ! -s "$D/ca/ca.crt" ]; then
  openssl ecparam -name prime256v1 -genkey -noout -out "$D/ca/ca.key"
  openssl req -x509 -new -key "$D/ca/ca.key" -sha256 -days 3650 -subj "/O=Bestly LLC/CN=Bestly Telemetry CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out "$D/ca/ca.crt"
  echo "created CA"
fi

need=1
if [ -s "$D/server/server.crt" ] && [ -s "$D/server/server.key" ] \
   && openssl x509 -in "$D/server/server.crt" -noout -checkend $((RENEW_DAYS * 86400)) >/dev/null 2>&1 \
   && openssl verify -CAfile "$D/ca/ca.crt" "$D/server/server.crt" >/dev/null 2>&1 \
   && openssl x509 -in "$D/server/server.crt" -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:$HOST" \
   && openssl x509 -in "$D/server/server.crt" -noout -ext subjectAltName 2>/dev/null | grep -q "DNS:$ALT"; then
  need=0
fi

if [ "$need" = 1 ]; then
  tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
  openssl ecparam -name prime256v1 -genkey -noout -out "$tmp/server.key"
  openssl req -new -key "$tmp/server.key" -subj "/O=Bestly LLC/CN=$HOST" -out "$tmp/server.csr"
  printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:%s,DNS:%s\n' "$HOST" "$ALT" > "$tmp/ext.cnf"
  openssl x509 -req -in "$tmp/server.csr" -CA "$D/ca/ca.crt" -CAkey "$D/ca/ca.key" -CAserial "$D/ca/ca.srl" -CAcreateserial \
    -days 730 -sha256 -extfile "$tmp/ext.cnf" -out "$tmp/server.crt"
  install -m 600 -o root -g root "$tmp/server.key" "$D/server/server.key"
  install -m 600 -o root -g root "$tmp/server.crt" "$D/server/server.crt"
  echo "signed new server certificate: $(openssl x509 -in "$D/server/server.crt" -noout -enddate)"
fi

# Public copies for the forwarder (days-left beat) and for reference.
install -m 644 "$D/server/server.crt" "$D/pub/server.crt"
install -m 644 "$D/ca/ca.crt" "$D/pub/ca.crt"

# The receiver reads the certificate only at start-up: restart it after a renewal.
if [ "$need" = 1 ] && [ -f "$D/docker-compose.yml" ] && docker compose -f "$D/docker-compose.yml" ps --status running --services 2>/dev/null | grep -q fleet-telemetry; then
  docker compose -f "$D/docker-compose.yml" restart fleet-telemetry
fi
