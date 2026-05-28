#!/bin/bash
# Apply the bestly-mic-recover patch to Nextcloud Talk's talk-main.js bundle.
# Idempotent — re-running detects if already applied and is a no-op.
# Must be re-applied after every Talk (spreed) app upgrade.
#
# Usage:
#   ./apply-patch.sh                       # apply on the local Pi
#   ssh pi sudo bash -s < apply-patch.sh   # apply remotely
#
# Required on Pi: docker (the nextcloud-app container)
# Requires the patch source at: scripts/talk-mic-recover/bestly-mic-recover.js

set -euo pipefail

PATCH_FILE="${PATCH_FILE:-$(dirname "$0")/bestly-mic-recover.js}"
CONTAINER="${CONTAINER:-nextcloud-app}"
TARGET="${TARGET:-/var/www/html/custom_apps/spreed/js/talk-main.js}"
MARKER="BESTLY MIC RECOVERY PATCH v1"

if [ ! -f "$PATCH_FILE" ]; then
  echo "ERROR: patch source not found at $PATCH_FILE" >&2
  exit 1
fi

echo "==> checking if Talk is installed and target exists"
if ! docker exec -u www-data "$CONTAINER" test -f "$TARGET"; then
  echo "ERROR: $TARGET not found in container $CONTAINER" >&2
  exit 1
fi

echo "==> checking if already patched"
if docker exec -u www-data "$CONTAINER" grep -q "$MARKER" "$TARGET"; then
  echo "    already patched. To force re-apply: remove from start of file then re-run."
  exit 0
fi

echo "==> backing up original to talk-main.js.bestly-orig (if not already)"
docker exec -u www-data "$CONTAINER" sh -c "[ -f $TARGET.bestly-orig ] || cp $TARGET $TARGET.bestly-orig"

echo "==> copying patch into container"
docker cp "$PATCH_FILE" "$CONTAINER":/tmp/bestly-mic-recover.js
docker exec -u root "$CONTAINER" chown www-data:www-data /tmp/bestly-mic-recover.js

echo "==> prepending patch to talk-main.js"
docker exec -u www-data "$CONTAINER" sh -c \
  "cat /tmp/bestly-mic-recover.js $TARGET.bestly-orig > $TARGET.tmp && mv $TARGET.tmp $TARGET"
docker exec -u root "$CONTAINER" chown www-data:www-data "$TARGET"

echo "==> cleanup tmp"
docker exec -u www-data "$CONTAINER" rm -f /tmp/bestly-mic-recover.js

echo "==> verify"
if docker exec -u www-data "$CONTAINER" grep -q "$MARKER" "$TARGET"; then
  size=$(docker exec -u www-data "$CONTAINER" stat -c%s "$TARGET")
  orig_size=$(docker exec -u www-data "$CONTAINER" stat -c%s "$TARGET.bestly-orig")
  echo "    OK. Patched ($size bytes, was $orig_size)."
  echo ""
  echo "    Users must hard-reload (Cmd+Shift+R) their Talk tabs to pick up the new bundle."
  echo "    Nextcloud's cache-busting uses the app version, so a normal refresh may serve the cached old bundle."
else
  echo "ERROR: patch marker not present after apply — something went wrong" >&2
  exit 1
fi
