#!/bin/sh
# Run ON the Mac mini (as jaredbest) from this folder:  sh install.sh      (ROLLOUT STEP: not run by the build)
# Idempotent: venv + Playwright + Chromium, copies the worker, installs and (re)loads the launchd job.
set -e
DEST="$HOME/bestly-agents/insurance-filer"
LABEL=tech.bestly.insurance-filer
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DEST/tests/fixtures" "$DEST/runs" "$DEST/inbox" "$HOME/logs"
if [ ! -x "$DEST/venv/bin/python" ]; then /usr/bin/python3 -m venv "$DEST/venv"; fi
"$DEST/venv/bin/pip" install -q --upgrade pip playwright
PLAYWRIGHT_BROWSERS_PATH="$DEST/browsers" "$DEST/venv/bin/python" -m playwright install chromium
if [ "$HERE" != "$DEST" ]; then
  cp "$HERE/filer.py" "$HERE/rules.py" "$HERE/walker.py" "$DEST/"
  cp "$HERE"/*.applescript "$DEST/"
  cp "$HERE/tests/selftest.py" "$DEST/tests/selftest.py"
  cp "$HERE"/tests/fixtures/*.html "$DEST/tests/fixtures/"
fi
"$DEST/venv/bin/python" -m py_compile "$DEST/filer.py" "$DEST/rules.py" "$DEST/walker.py"
for f in "$DEST"/*.applescript; do osacompile -o /tmp/ins_check.scpt "$f"; done
# the self-test must pass before the job is loaded
PLAYWRIGHT_BROWSERS_PATH="$DEST/browsers" "$DEST/venv/bin/python" -u "$DEST/tests/selftest.py" | tail -3
sed "s#__HOME__#$HOME#g" "$HERE/$LABEL.plist" > "$PLIST"
plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl print "gui/$(id -u)/$LABEL" | grep -E "state|interval|runs" | head -5
echo "installed $LABEL (runs now, then every 5 min). Logs: ~/logs/insurance-filer.log"
echo "Mail.app must be open and signed in to jared@bestly.tech, with the 'Bestly' signature, for the email step (allow Automation for Terminal/Python once)."
