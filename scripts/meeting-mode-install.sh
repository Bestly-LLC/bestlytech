#!/bin/bash
#
# Installer for the Meeting Mode SwiftBar plugin.
# Run from your Mac:  ./scripts/meeting-mode-install.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_SRC="$SCRIPT_DIR/meeting-mode.5s.sh"

# 1. Make sure SwitchAudioSource is installed
if ! command -v SwitchAudioSource >/dev/null 2>&1; then
  echo "📦 Installing switchaudio-osx…"
  brew install switchaudio-osx
else
  echo "✓ switchaudio-osx already installed"
fi

# 2. Make sure SwiftBar is installed
if ! ls /Applications/SwiftBar.app >/dev/null 2>&1 && ! ls "$HOME/Applications/SwiftBar.app" >/dev/null 2>&1; then
  echo "📦 Installing SwiftBar…"
  brew install --cask swiftbar
  echo "▶︎ Launching SwiftBar for first-time setup…"
  open -a SwiftBar || true
  echo "   When SwiftBar asks for a plugin folder, pick ~/SwiftBar (or anywhere)."
  echo "   After picking, press RETURN to continue."
  read -r
else
  echo "✓ SwiftBar already installed"
fi

# 3. Determine plugin folder (default ~/SwiftBar; or read from SwiftBar prefs)
PLUGIN_DIR="$HOME/SwiftBar"
PREF_DIR="$(defaults read com.ameba.SwiftBar PluginDirectory 2>/dev/null || true)"
if [ -n "$PREF_DIR" ] && [ -d "$PREF_DIR" ]; then
  PLUGIN_DIR="$PREF_DIR"
fi
mkdir -p "$PLUGIN_DIR"

# 4. Symlink the plugin (so future repo updates are picked up automatically)
PLUGIN_DEST="$PLUGIN_DIR/meeting-mode.5s.sh"
chmod +x "$PLUGIN_SRC"
if [ -L "$PLUGIN_DEST" ] || [ -e "$PLUGIN_DEST" ]; then
  rm -f "$PLUGIN_DEST"
fi
ln -s "$PLUGIN_SRC" "$PLUGIN_DEST"

echo "✓ Plugin symlinked → $PLUGIN_DEST"

# 5. Make sure ~/.bestly exists, create a starter config if none
mkdir -p "$HOME/.bestly"
CONFIG_FILE="$HOME/.bestly/meeting-mode.conf"
if [ ! -f "$CONFIG_FILE" ]; then
  cat > "$CONFIG_FILE" <<EOF
# Meeting Mode audio devices. Match by substring — exact case-sensitive contains.
# Run \`SwitchAudioSource -a\` in a terminal to see exact device names.
MEETING_INPUT="OBSBOT"
MEETING_OUTPUT="MacBook Pro Speakers"
EOF
  echo "✓ Wrote default config → $CONFIG_FILE"
else
  echo "✓ Existing config at $CONFIG_FILE (left alone)"
fi

# 6. Refresh SwiftBar so the new plugin shows up
osascript -e 'tell application "SwiftBar" to refresh' 2>/dev/null || true

echo
echo "✓ Done. Look at the right side of your menu bar — you should see"
echo "  🔊 Normal (or 🎙️ Meeting if your devices already match)."
echo
echo "  Click it to flip between modes. Edit $CONFIG_FILE if your OBSBOT or"
echo "  Mac speaker device names differ from the defaults."
