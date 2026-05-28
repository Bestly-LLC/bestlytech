#!/bin/bash
#
# SwiftBar plugin: Meeting Mode audio toggle (3 states)
# =====================================================
# Click the bar item to cycle through:
#   NORMAL  -> your everyday audio devices (restored from state)
#   MEETING -> mic: OBSBOT, speaker: Mac mini Speakers (no BlackHole loopback)
#   RECORD  -> mic: OBSBOT, speaker: Speakers + BlackHole
#              (Minutes should record from Mic + BlackHole)
#
# Background: see docs/blackhole-minutes-setup.md and the Nextcloud runbook
# at Bestly/Operations/Runbooks/pre-call-audio.md. v1 of this script only had
# NORMAL/MEETING; v2 adds RECORD so Minutes captures both sides of a call.
#
# Install:
#   1. brew install switchaudio-osx
#   2. brew install --cask swiftbar
#   3. Launch SwiftBar once; pick a plugin folder (e.g. ~/SwiftBar)
#   4. scripts/meeting-mode-install.sh  (symlinks this script into SwiftBar)
#
# Customize device names (optional): create ~/.bestly/meeting-mode.conf with:
#   MEETING_INPUT="OBSBOT"
#   MEETING_OUTPUT="Mac mini Speakers"
#   RECORD_INPUT="OBSBOT"
#   RECORD_OUTPUT="Speakers + BlackHole"
#   MINUTES_INPUT="Mic + BlackHole"
#
# State file: ~/.bestly/meeting-mode.state holds the prior devices so NORMAL
# mode can restore them.

set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

CONFIG_DIR="$HOME/.bestly"
CONFIG_FILE="$CONFIG_DIR/meeting-mode.conf"
STATE_FILE="$CONFIG_DIR/meeting-mode.state"
mkdir -p "$CONFIG_DIR"

# Defaults (override in $CONFIG_FILE)
MEETING_INPUT_DEFAULT="OBSBOT"
MEETING_OUTPUT_DEFAULT="Mac mini Speakers"
RECORD_INPUT_DEFAULT="OBSBOT"
RECORD_OUTPUT_DEFAULT="Speakers + BlackHole"
MINUTES_INPUT_DEFAULT="Mic + BlackHole"

[ -f "$CONFIG_FILE" ] && source "$CONFIG_FILE"
MEETING_INPUT="${MEETING_INPUT:-$MEETING_INPUT_DEFAULT}"
MEETING_OUTPUT="${MEETING_OUTPUT:-$MEETING_OUTPUT_DEFAULT}"
RECORD_INPUT="${RECORD_INPUT:-$RECORD_INPUT_DEFAULT}"
RECORD_OUTPUT="${RECORD_OUTPUT:-$RECORD_OUTPUT_DEFAULT}"
MINUTES_INPUT="${MINUTES_INPUT:-$MINUTES_INPUT_DEFAULT}"

if ! command -v SwitchAudioSource >/dev/null 2>&1; then
  echo "Audio ?"
  echo "---"
  echo "SwitchAudioSource not installed | color=red"
  echo "Install: brew install switchaudio-osx"
  exit 0
fi

current_input="$(SwitchAudioSource -c -t input 2>/dev/null || echo unknown)"
current_output="$(SwitchAudioSource -c -t output 2>/dev/null || echo unknown)"

# Substring match so 'OBSBOT' matches 'OBSBOT Tiny 2 Lite Microphone'
input_is_record()    { [[ "$current_input"  == *"$RECORD_INPUT"*  ]]; }
output_is_record()   { [[ "$current_output" == *"$RECORD_OUTPUT"* ]]; }
input_is_meeting()   { [[ "$current_input"  == *"$MEETING_INPUT"* ]]; }
output_is_meeting()  { [[ "$current_output" == *"$MEETING_OUTPUT"* ]]; }

if input_is_record && output_is_record; then
  STATE="RECORD"
elif input_is_meeting && output_is_meeting; then
  STATE="MEETING"
else
  STATE="NORMAL"
fi

remember_prior() {
  cat > "$STATE_FILE" <<EOF
prior_input=$current_input
prior_output=$current_output
EOF
}

restore_prior() {
  if [ -f "$STATE_FILE" ]; then
    pi="$(awk -F'=' '/^prior_input=/  {sub("prior_input=","");  print}' "$STATE_FILE" || true)"
    po="$(awk -F'=' '/^prior_output=/ {sub("prior_output=","");print}' "$STATE_FILE" || true)"
    [ -n "${pi:-}" ] && SwitchAudioSource -t input  -s "$pi" >/dev/null 2>&1 || true
    [ -n "${po:-}" ] && SwitchAudioSource -t output -s "$po" >/dev/null 2>&1 || true
    rm -f "$STATE_FILE"
  fi
}

switch_to() {
  local target_in="$1" target_out="$2"
  local in_match out_match
  in_match="$(SwitchAudioSource  -a -t input  | grep -F "$target_in"  | head -1 || true)"
  out_match="$(SwitchAudioSource -a -t output | grep -F "$target_out" | head -1 || true)"
  [ -n "$in_match"  ] && SwitchAudioSource -t input  -s "$in_match"  >/dev/null 2>&1 || true
  [ -n "$out_match" ] && SwitchAudioSource -t output -s "$out_match" >/dev/null 2>&1 || true
}

WATCH_PAUSE_FILE="$HOME/.bestly/mic-input-watch.paused"

# Detect frontmost app and tell it to reload (for browser call tabs).
# Falls back to sending Cmd+R as a keystroke if AppleScript can't target the app.
refresh_frontmost_browser() {
  local front
  front="$(osascript -e 'tell application "System Events" to name of first application process whose frontmost is true' 2>/dev/null || echo unknown)"
  case "$front" in
    "Google Chrome"|"Chromium"|"Brave Browser"|"Microsoft Edge"|"Arc"|"Comet")
      osascript -e "tell application \"$front\" to tell active tab of front window to reload" 2>/dev/null
      ;;
    "Safari")
      osascript -e 'tell application "Safari" to do JavaScript "location.reload()" in current tab of front window' 2>/dev/null
      ;;
    *)
      # Generic Safari WebApp (Bestly Cloud etc.) — bundle id com.apple.Safari.WebApp.<UUID>
      if [[ "$front" == *"WebApp"* ]] || [[ "$front" == "Bestly Cloud" ]]; then
        osascript -e "tell application \"System Events\" to keystroke \"r\" using {command down}" 2>/dev/null
      else
        # Last resort — send Cmd+R to whatever is foreground
        osascript -e "tell application \"System Events\" to keystroke \"r\" using {command down}" 2>/dev/null
      fi
      ;;
  esac
  echo "$front"
}

case "${1:-}" in
  --meeting)
    [ "$STATE" = "NORMAL" ] && remember_prior
    switch_to "$MEETING_INPUT" "$MEETING_OUTPUT"
    exit 0 ;;
  --record)
    [ "$STATE" = "NORMAL" ] && remember_prior
    switch_to "$RECORD_INPUT" "$RECORD_OUTPUT"
    osascript -e "display notification \"Open Minutes, pick input '$MINUTES_INPUT', hit Start.\" with title \"Record mode active\" sound name \"Pop\"" 2>/dev/null || true
    exit 0 ;;
  --normal)
    restore_prior
    exit 0 ;;
  --fix-call)
    # One-click rescue for "mute button greyed out" mid-call:
    #   (a) hard-pin OBSBOT as input, ordering Output first then Input so
    #       the macOS Bluetooth auto-couple can't undo it
    #   (b) reload the frontmost browser tab so the call app drops its
    #       cached dead-AirPods mic stream and re-acquires OBSBOT
    in_match="$(SwitchAudioSource -a -t input | grep -F "$MEETING_INPUT" | head -1 || true)"
    [ -n "$in_match" ] && SwitchAudioSource -t input -s "$in_match" >/dev/null 2>&1 || true
    sleep 0.5
    # Re-pin in case auto-couple flipped it during the sleep
    [ -n "$in_match" ] && SwitchAudioSource -t input -s "$in_match" >/dev/null 2>&1 || true
    front="$(refresh_frontmost_browser)"
    osascript -e "display notification \"Mic re-pinned to OBSBOT, reloaded $front\" with title \"Fix Call Mic\" sound name \"Pop\"" 2>/dev/null || true
    exit 0 ;;
  --pause-watch)
    touch "$WATCH_PAUSE_FILE"
    osascript -e "display notification \"mic-input-watch paused. Click 'Resume' to re-enable.\" with title \"Auto-pin paused\"" 2>/dev/null || true
    exit 0 ;;
  --resume-watch)
    rm -f "$WATCH_PAUSE_FILE"
    osascript -e "display notification \"mic-input-watch resumed.\" with title \"Auto-pin active\"" 2>/dev/null || true
    exit 0 ;;
esac

# Watcher status (mic-input-watch daemon — see scripts/mic-input-watch.sh)
watch_status="off"
if launchctl list 2>/dev/null | grep -q tech.bestly.mic-input-watch; then
  if [ -f "$WATCH_PAUSE_FILE" ]; then
    watch_status="paused"
  else
    watch_status="active"
  fi
fi

# Render menu-bar item — current state determines color
case "$STATE" in
  RECORD)  echo "REC | color=red" ;;
  MEETING) echo "MTG | color=orange" ;;
  *)       echo "Audio" ;;
esac
echo "---"
echo "🎤 FIX CALL MIC (one-click rescue) | bash='$0' param1=--fix-call terminal=false refresh=true color=#10b981"
echo "---"
echo "Input:  $current_input"
echo "Output: $current_output"
case "$watch_status" in
  active) echo "Watcher: 🟢 auto-pinning $MEETING_INPUT every 3s | color=#10b981" ;;
  paused) echo "Watcher: ⏸ paused — drift will NOT auto-correct | color=#f59e0b" ;;
  off)    echo "Watcher: ⚪️ not installed (run scripts/install-mic-input-watch.sh) | color=#6b7280" ;;
esac
echo "---"
echo "Switch to Normal  | bash='$0' param1=--normal  terminal=false refresh=true"
echo "Switch to Meeting | bash='$0' param1=--meeting terminal=false refresh=true"
echo "Switch to Record  | bash='$0' param1=--record  terminal=false refresh=true"
echo "---"
if [ "$watch_status" = "paused" ]; then
  echo "▶ Resume auto-pin | bash='$0' param1=--resume-watch terminal=false refresh=true"
elif [ "$watch_status" = "active" ]; then
  echo "⏸ Pause auto-pin (next 60s of drift will stay) | bash='$0' param1=--pause-watch terminal=false refresh=true"
fi
echo "---"
echo "Meeting target: $MEETING_INPUT in / $MEETING_OUTPUT out"
echo "Record  target: $RECORD_INPUT in / $RECORD_OUTPUT out"
echo "Minutes input:  $MINUTES_INPUT (set inside Minutes when in RECORD mode)"
echo "Edit defaults | bash='/usr/bin/open' param1='-t' param2='$CONFIG_FILE' terminal=false"
echo "Watcher log | bash='/usr/bin/open' param1='-t' param2='$HOME/.bestly/mic-input-watch.log' terminal=false"
echo "---"
echo "All available input devices:"
SwitchAudioSource -a -t input  2>/dev/null | sed 's/^/-- /'
echo "All available output devices:"
SwitchAudioSource -a -t output 2>/dev/null | sed 's/^/-- /'
