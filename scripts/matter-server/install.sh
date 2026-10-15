#!/usr/bin/env bash
# Install or update the Matter server for Home Assistant on bestly-pi.
# Run ON the Pi as user pi. Safe to re-run: it pulls the latest image and
# re-creates the container; the data dir is kept.
set -euo pipefail

NAME=matter-server
IMAGE=ghcr.io/matter-js/matterjs-server:stable
DATA=/mnt/ssd/apps/matter-server/data

# Preflight: something other than our container on :5580 is a hard stop.
if ss -ltn | awk '{print $4}' | grep -qE '[:.]5580$'; then
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null || true)" = "true" ]; then
    echo "Port 5580 is held by our $NAME container; it will be re-created."
  else
    echo "ERROR: something other than $NAME is already listening on :5580:" >&2
    ss -ltnp | grep -E '[:.]5580\b' >&2 || true
    exit 1
  fi
fi

# The container runs as uid 1000 and must own its data dir.
sudo -n mkdir -p "$DATA"
sudo -n chown -R 1000:1000 /mnt/ssd/apps/matter-server
sudo -n chmod -R u+rwX,go+rX /mnt/ssd/apps/matter-server

docker pull "$IMAGE"

if docker inspect "$NAME" >/dev/null 2>&1; then
  docker rm -f "$NAME" >/dev/null
fi

# LISTEN_ADDRESS=127.0.0.1 on purpose: the server has no auth and only
# Home Assistant (same host) needs the websocket.
docker run -d --name "$NAME" --restart=unless-stopped --network=host \
  -v "$DATA":/data \
  -e LISTEN_ADDRESS=127.0.0.1 \
  -e PRIMARY_INTERFACE=eth0 \
  -e TZ=America/Los_Angeles \
  -e LOG_LEVEL=info \
  "$IMAGE" >/dev/null

echo "Waiting for the server on :5580 (up to 90s)..."
ready=0
for _ in $(seq 1 30); do
  if curl -fsS -o /dev/null http://127.0.0.1:5580/; then ready=1; break; fi
  sleep 3
done
if [ "$ready" != 1 ]; then
  echo "ERROR: server did not answer within 90s. Last 40 log lines:" >&2
  docker logs --tail 40 "$NAME" >&2 || true
  exit 1
fi

echo "Container: $(docker inspect --format '{{.State.Status}}' "$NAME")"
echo "Health:    $(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}no healthcheck{{end}}' "$NAME")"
echo "Matter server ready: ws://localhost:5580/ws"
