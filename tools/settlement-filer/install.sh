#!/bin/sh
# Run ON the Mac mini (as jaredbest) from this folder:  sh install.sh
# Idempotent: venv + Playwright + Chromium, copies the worker, installs and (re)loads the launchd job.
set -e
DEST="$HOME/bestly-agents/settlement-filer"
LABEL=tech.bestly.settlement-filer
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DEST/tests" "$DEST/receipts" "$HOME/logs"
if [ ! -x "$DEST/venv/bin/python" ]; then /usr/bin/python3 -m venv "$DEST/venv"; fi
"$DEST/venv/bin/pip" install -q --upgrade pip playwright
"$DEST/venv/bin/python" -m playwright install chromium
if [ "$HERE" != "$DEST" ]; then
  cp "$HERE/filer.py" "$DEST/filer.py"
  cp "$HERE/tests/selftest.py" "$DEST/tests/selftest.py"
fi
"$DEST/venv/bin/python" -m py_compile "$DEST/filer.py"
sed "s#__HOME__#$HOME#g" "$HERE/$LABEL.plist" > "$PLIST"
plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl print "gui/$(id -u)/$LABEL" | grep -E "state|interval|runs" | head -5
echo "installed $LABEL (runs now, then every 30 min). Logs: ~/logs/settlement-filer.log"
