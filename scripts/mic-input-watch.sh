#!/bin/bash
#
# mic-input-watch — pin the macOS default Input device.
# Auto-restores PINNED_INPUT whenever something flips it away (e.g. macOS
# Bluetooth auto-couple when AirPods become the Output).
#
# Solves the recurring "AirPods grab the mic in the middle of a call and the
# unmute button greys out" failure mode that even the SwiftBar Meeting Mode
# plugin doesn't catch (because the OS auto-flips AFTER the plugin's manual
# toggle).
#
# Self-healing pattern, same architecture as cloudflared-origin-watch.
# See docs/nextcloud-502-recovery-opusplan.md for the prior art.

set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

CONFIG_FILE="${CONFIG_FILE:-$HOME/.bestly/mic-input-watch.conf}"
PAUSE_FILE="${PAUSE_FILE:-$HOME/.bestly/mic-input-watch.paused}"
LOG_FILE="${LOG_FILE:-$HOME/.bestly/mic-input-watch.log}"

mkdir -p "$(dirname "$CONFIG_FILE")"

# Defaults — overridable in ~/.bestly/mic-input-watch.conf
PINNED_INPUT_DEFAULT="OBSBOT"
POLL_INTERVAL_DEFAULT=3
NTFY_TOPIC_DEFAULT="bestly-sysalert-7q2k9mx4"
ENABLED_DEFAULT="true"
FLAP_THRESHOLD_DEFAULT=5         # if > N flips per minute, pause for a beat
FLAP_COOLDOWN_DEFAULT=60         # seconds to pause after flap detected
NOTIFY_AFTER_DEFAULT="3"         # ntfy only after Nth consecutive restore (suppress noise)

[ -f "$CONFIG_FILE" ] && source "$CONFIG_FILE"
PINNED_INPUT="${PINNED_INPUT:-$PINNED_INPUT_DEFAULT}"
POLL_INTERVAL="${POLL_INTERVAL:-$POLL_INTERVAL_DEFAULT}"
NTFY_TOPIC="${NTFY_TOPIC:-$NTFY_TOPIC_DEFAULT}"
ENABLED="${ENABLED:-$ENABLED_DEFAULT}"
FLAP_THRESHOLD="${FLAP_THRESHOLD:-$FLAP_THRESHOLD_DEFAULT}"
FLAP_COOLDOWN="${FLAP_COOLDOWN:-$FLAP_COOLDOWN_DEFAULT}"
NOTIFY_AFTER="${NOTIFY_AFTER:-$NOTIFY_AFTER_DEFAULT}"

log() {
  local msg="$(date -u +%FT%TZ) $*"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE" 2>/dev/null || true
  # Rotate at 1 MB
  if [ -f "$LOG_FILE" ] && [ "$(stat -f%z "$LOG_FILE" 2>/dev/null || echo 0)" -gt 1048576 ]; then
    mv "$LOG_FILE" "$LOG_FILE.1" 2>/dev/null || true
  fi
}

notify() {
  local title="$1" body="$2"
  curl -sfm 5 -d "$body" -H "X-Title: $title" \
       "https://ntfy.sh/$NTFY_TOPIC" >/dev/null 2>&1 || true
  osascript -e "display notification \"$body\" with title \"$title\"" 2>/dev/null || true
}

if [ "$ENABLED" != "true" ]; then
  log "ENABLED=false in config — exiting"
  exit 0
fi

if ! command -v SwitchAudioSource >/dev/null 2>&1; then
  log "FATAL: SwitchAudioSource not on PATH. Install: brew install switchaudio-osx"
  exit 1
fi

log "starting mic-input-watch (pin=$PINNED_INPUT interval=${POLL_INTERVAL}s)"

flip_count=0
flip_window_start=$(date +%s)
last_notify_count=0
consecutive_restores=0

while true; do
  # Paused via touch file? (SwiftBar plugin can create this)
  if [ -f "$PAUSE_FILE" ]; then
    sleep "$POLL_INTERVAL"
    continue
  fi

  current="$(SwitchAudioSource -c -t input 2>/dev/null || echo unknown)"

  # Substring match — "OBSBOT" matches "OBSBOT Tiny 2 Lite Microphone"
  if [[ "$current" == *"$PINNED_INPUT"* ]]; then
    # No drift, all good
    if [ "$consecutive_restores" -gt 0 ]; then
      log "input settled at $current (after $consecutive_restores restores)"
      consecutive_restores=0
    fi
    sleep "$POLL_INTERVAL"
    continue
  fi

  # Drift detected — find and restore the pinned device
  target="$(SwitchAudioSource -a -t input | grep -F "$PINNED_INPUT" | head -1 || true)"
  if [ -z "$target" ]; then
    log "WARN: pinned device '$PINNED_INPUT' not currently available (unplugged?). current=$current — will try again next poll."
    sleep "$POLL_INTERVAL"
    continue
  fi

  log "drift: input=$current -> restoring to $target"
  SwitchAudioSource -t input -s "$target" >/dev/null 2>&1 || {
    log "ERR: failed to restore input device"
    sleep "$POLL_INTERVAL"
    continue
  }

  consecutive_restores=$((consecutive_restores + 1))

  # Flap detection — if we're restoring many times per minute, something's fighting us
  now=$(date +%s)
  flip_count=$((flip_count + 1))
  window=$((now - flip_window_start))
  if [ "$window" -ge 60 ]; then
    flip_window_start=$now
    flip_count=1
  fi

  if [ "$flip_count" -ge "$FLAP_THRESHOLD" ]; then
    log "FLAP detected ($flip_count restores in ${window}s) — backing off ${FLAP_COOLDOWN}s. Consider disabling whatever is fighting (System Settings -> Bluetooth -> AirPods info -> uncheck Use as Sound Input)."
    notify "mic-input-watch flap" "Restored $flip_count times in ${window}s — cooling off ${FLAP_COOLDOWN}s. Check Bluetooth AirPods 'Use as Sound Input' setting."
    sleep "$FLAP_COOLDOWN"
    flip_count=0
    flip_window_start=$(date +%s)
    continue
  fi

  # Suppress notification noise — only ntfy after N consecutive restores (means OS is actively fighting)
  if [ "$consecutive_restores" -eq "$NOTIFY_AFTER" ]; then
    notify "mic-input-watch" "Repeatedly restoring Input to $target (was: $current). OS Bluetooth auto-coupling is fighting. Cooling off if it continues."
  fi

  sleep "$POLL_INTERVAL"
done
