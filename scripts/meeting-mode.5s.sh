#!/bin/bash
#
# SwiftBar plugin: Meeting Mode audio toggle
# ===========================================
# Click the bar item to flip between MEETING and NORMAL audio I/O.
#
#   MEETING mode = mic: OBSBOT,  speaker: MacBook built-in (configurable)
#   NORMAL  mode = restores the input + output that were active before
#                  you flipped into meeting mode
#
# Install:
#   1. brew install switchaudio-osx
#   2. brew install --cask swiftbar
#   3. Launch SwiftBar once; pick a plugin folder (e.g. ~/SwiftBar)
#   4. Symlink (or copy) this script into that folder:
#        ln -s ~/Developer/bestlytech/scripts/meeting-mode.5s.sh ~/SwiftBar/
#   5. SwiftBar picks it up automatically. Filename suffix `.5s.sh` makes
#      it refresh every 5 seconds so the bar reflects manual device
#      changes you make outside this script.
#
# Customize device names (optional): create ~/.bestly/meeting-mode.conf with:
#   MEETING_INPUT="OBSBOT Tiny"
#   MEETING_OUTPUT="MacBook Pro Speakers"
#
# State file: ~/.bestly/meeting-mode.state — JSON blob holding the prior
# devices so NORMAL mode can restore them.

set -euo pipefail

# Make sure brew's bin is on PATH when SwiftBar runs this (it has a minimal env)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

CONFIG_DIR="$HOME/.bestly"
CONFIG_FILE="$CONFIG_DIR/meeting-mode.conf"
STATE_FILE="$CONFIG_DIR/meeting-mode.state"
mkdir -p "$CONFIG_DIR"

# Defaults (override in $CONFIG_FILE)
MEETING_INPUT_DEFAULT="OBSBOT"
MEETING_OUTPUT_DEFAULT="MacBook Pro Speakers"
[ -f "$CONFIG_FILE" ] && source "$CONFIG_FILE"
MEETING_INPUT="${MEETING_INPUT:-$MEETING_INPUT_DEFAULT}"
MEETING_OUTPUT="${MEETING_OUTPUT:-$MEETING_OUTPUT_DEFAULT}"

if ! command -v SwitchAudioSource >/dev/null 2>&1; then
  echo "❌ Audio :sba.symbol.x:"
  echo "---"
  echo "SwitchAudioSource not installed | color=red"
  echo "Install: brew install switchaudio-osx"
  exit 0
fi

current_input="$(SwitchAudioSource -c -t input 2>/dev/null || echo unknown)"
current_output="$(SwitchAudioSource -c -t output 2>/dev/null || echo unknown)"

# Match by substring so 'OBSBOT' matches 'OBSBOT Tiny', 'OBSBOT Meet 2', etc.
input_matches_meeting() { [[ "$current_input" == *"$MEETING_INPUT"* ]]; }
output_matches_meeting() { [[ "$current_output" == *"$MEETING_OUTPUT"* ]]; }

if input_matches_meeting && output_matches_meeting; then
  STATE="MEETING"
else
  STATE="NORMAL"
fi

case "${1:-}" in
  --toggle)
    if [ "$STATE" = "MEETING" ]; then
      # Restore prior devices from state file
      if [ -f "$STATE_FILE" ]; then
        prior_input="$(awk -F'=' '/^prior_input=/ {sub("prior_input=",""); print}' "$STATE_FILE" || true)"
        prior_output="$(awk -F'=' '/^prior_output=/ {sub("prior_output=",""); print}' "$STATE_FILE" || true)"
        if [ -n "${prior_input:-}" ]; then
          SwitchAudioSource -t input  -s "$prior_input"  >/dev/null 2>&1 || true
        fi
        if [ -n "${prior_output:-}" ]; then
          SwitchAudioSource -t output -s "$prior_output" >/dev/null 2>&1 || true
        fi
      fi
      rm -f "$STATE_FILE"
    else
      # Going INTO meeting mode — remember current devices first
      cat > "$STATE_FILE" <<EOF
prior_input=$current_input
prior_output=$current_output
EOF
      # Find a device that contains the meeting name. SwitchAudioSource -a -t input
      # lists all input devices; pick the first one that matches.
      meeting_in="$(SwitchAudioSource -a -t input  | grep -F "$MEETING_INPUT"  | head -1 || true)"
      meeting_out="$(SwitchAudioSource -a -t output | grep -F "$MEETING_OUTPUT" | head -1 || true)"
      if [ -n "$meeting_in" ]; then
        SwitchAudioSource -t input  -s "$meeting_in"  >/dev/null 2>&1 || true
      fi
      if [ -n "$meeting_out" ]; then
        SwitchAudioSource -t output -s "$meeting_out" >/dev/null 2>&1 || true
      fi
    fi
    exit 0
    ;;
esac

# Render the menu-bar item
if [ "$STATE" = "MEETING" ]; then
  echo "🎙️ Meeting"
else
  echo "🔊 Normal"
fi
echo "---"
echo "Current input:  $current_input"
echo "Current output: $current_output"
echo "---"
if [ "$STATE" = "MEETING" ]; then
  echo "Switch to NORMAL (restore previous devices) | bash='$0' param1=--toggle terminal=false refresh=true"
else
  echo "Switch to MEETING ($MEETING_INPUT in / $MEETING_OUTPUT out) | bash='$0' param1=--toggle terminal=false refresh=true"
fi
echo "---"
echo "Meeting input device:  $MEETING_INPUT"
echo "Meeting output device: $MEETING_OUTPUT"
echo "Edit defaults… | bash='/usr/bin/open' param1='-t' param2='$CONFIG_FILE' terminal=false"
echo "---"
echo "All available input devices:"
SwitchAudioSource -a -t input  2>/dev/null | sed 's/^/-- /'
echo "All available output devices:"
SwitchAudioSource -a -t output 2>/dev/null | sed 's/^/-- /'
