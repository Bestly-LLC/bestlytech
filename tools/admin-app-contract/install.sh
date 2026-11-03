#!/bin/bash
# Install on the Mac mini: copy to ~/Bestly/admin-app-contract and load the 6:40 AM LaunchAgent.  Run from this folder.
set -e
D="$HOME/Bestly/admin-app-contract"
mkdir -p "$D" "$HOME/Library/LaunchAgents"
cp check.py run-daily.sh "$D/"
chmod +x "$D/run-daily.sh" "$D/check.py"
sed "s#/Users/jaredbest#$HOME#g" tech.bestly.admin-app-contract.plist > "$HOME/Library/LaunchAgents/tech.bestly.admin-app-contract.plist"
launchctl bootout "gui/$(id -u)/tech.bestly.admin-app-contract" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/tech.bestly.admin-app-contract.plist"
launchctl print "gui/$(id -u)/tech.bestly.admin-app-contract" | head -5
echo "installed; first run tomorrow 6:40 AM (run now: bash $D/run-daily.sh)"
