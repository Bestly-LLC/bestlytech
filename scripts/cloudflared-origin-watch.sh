#!/bin/bash
# cloudflared-origin-watch — probe local Nextcloud origin and restart
# cloudflared if probe fails N consecutive times. Prevents stale connection
# pools from sticking after a container restart.
# See docs/nextcloud-502-recovery-opusplan.md for context.

set -euo pipefail

PROBE_URL="${PROBE_URL:-http://localhost:8082/status.php}"
PROBE_INTERVAL="${PROBE_INTERVAL:-30}"
FAILURE_THRESHOLD="${FAILURE_THRESHOLD:-3}"
RESTART_COOLDOWN="${RESTART_COOLDOWN:-300}"
NTFY_TOPIC="${NTFY_TOPIC:-bestly-sysalert-7q2k9mx4}"

consecutive_failures=0
last_restart=0

log() { echo "$(date -u +%FT%TZ) $*"; }

probe() {
  curl -sf -m 5 -o /dev/null -w "%{http_code}" "$PROBE_URL" 2>/dev/null
}

notify() {
  local msg="$1"
  curl -sfm 5 -d "$msg" -H "X-Title: cloudflared-origin-watch" \
       "https://ntfy.sh/$NTFY_TOPIC" >/dev/null 2>&1 || true
}

log "starting cloudflared-origin-watch; probe=$PROBE_URL interval=${PROBE_INTERVAL}s threshold=$FAILURE_THRESHOLD"

while true; do
  code="$(probe || echo 000)"
  now=$(date +%s)

  if [ "$code" = "200" ] || [ "$code" = "302" ] || [ "$code" = "301" ]; then
    if [ "$consecutive_failures" -gt 0 ]; then
      log "origin recovered after $consecutive_failures failures (now $code)"
    fi
    consecutive_failures=0
  else
    consecutive_failures=$((consecutive_failures + 1))
    log "probe failed: code=$code (consecutive=$consecutive_failures)"
    if [ "$consecutive_failures" -ge "$FAILURE_THRESHOLD" ]; then
      if [ $((now - last_restart)) -lt "$RESTART_COOLDOWN" ]; then
        log "cooldown active, not restarting (last restart $((now - last_restart))s ago)"
      else
        log "RESTARTING cloudflared (consecutive=$consecutive_failures threshold=$FAILURE_THRESHOLD)"
        notify "cloudflared-origin-watch: restarting cloudflared after $consecutive_failures consecutive probe failures. URL=$PROBE_URL last_code=$code"
        systemctl restart cloudflared
        last_restart=$now
        consecutive_failures=0
        sleep 10
      fi
    fi
  fi
  sleep "$PROBE_INTERVAL"
done
