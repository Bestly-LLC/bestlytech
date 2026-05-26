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
esac

# Render menu-bar item
case "$STATE" in
  RECORD)  echo "REC | color=red" ;;
  MEETING) echo "MTG | color=orange" ;;
  *)       echo "Audio" ;;
esac
echo "---"
echo "Input:  $current_input"
echo "Output: $current_output"
echo "---"
echo "Switch to Normal  | bash='$0' param1=--normal  terminal=false refresh=true"
echo "Switch to Meeting | bash='$0' param1=--meeting terminal=false refresh=true"
echo "Switch to Record  | bash='$0' param1=--record  terminal=false refresh=true"
echo "---"
echo "Meeting target: $MEETING_INPUT in / $MEETING_OUTPUT out"
echo "Record  target: $RECORD_INPUT in / $RECORD_OUTPUT out"
echo "Minutes input:  $MINUTES_INPUT (set inside Minutes when in RECORD mode)"
echo "Edit defaults | bash='/usr/bin/open' param1='-t' param2='$CONFIG_FILE' terminal=false"
echo "---"
echo "All available input devices:"
SwitchAudioSource -a -t input  2>/dev/null | sed 's/^/-- /'
echo "All available output devices:"
SwitchAudioSource -a -t output 2>/dev/null | sed 's/^/-- /'
