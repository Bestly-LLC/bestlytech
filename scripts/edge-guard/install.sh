#!/bin/sh
# Install or update Edge Guard on the Mac mini. Safe to re-run. Run from this folder:  sh install.sh
set -e
DEST="$HOME/bestly-agents/edge-guard"
PLIST="$HOME/Library/LaunchAgents/tech.bestly.edge-guard.plist"
mkdir -p "$DEST"
cp "$(dirname "$0")/edge-guard.py" "$DEST/edge-guard.py"
chmod 755 "$DEST/edge-guard.py"
cp "$(dirname "$0")/tech.bestly.edge-guard.plist" "$PLIST"
launchctl bootout "gui/$(id -u)/tech.bestly.edge-guard" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Edge Guard installed. Log: $DEST/edge-guard.log"
