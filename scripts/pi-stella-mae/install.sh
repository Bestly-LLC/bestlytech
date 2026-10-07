#!/bin/sh
# Run ON THE PI from this folder: installs Stella + Mae into /opt/bestly/cron and adds their cron lines (idempotent).
# Backs up the crontab first. Usage: sh install.sh [--no-cron]
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
DEST=/opt/bestly/cron
mkdir -p "$DEST/jobs" "$DEST/tools"
for f in stella_reviews stella_queue mae_fleet; do cp "$HERE/jobs/$f.py" "$DEST/jobs/$f.py"; done
cp "$HERE/tools/turo_reviews_reader.py" "$DEST/tools/turo_reviews_reader.py"
chmod +x "$DEST/tools/turo_reviews_reader.py"
[ "$1" = "--no-cron" ] && { echo "files installed, cron untouched"; exit 0; }
crontab -l > "/home/pi/crontab.backup-$(date +%Y%m%d-%H%M%S)"
crontab -l > /tmp/cron.new
add() { grep -q "run.sh $2\$" /tmp/cron.new || { awk -v line="$1 /opt/bestly/cron/run.sh $2" '/^# --- end bestly-cron/{print line} {print}' /tmp/cron.new > /tmp/cron.new2 && mv /tmp/cron.new2 /tmp/cron.new; }; }
add "3 10,18 * * *" stella_reviews
add "*/10 * * * *" stella_queue
add "17 * * * *" mae_fleet
crontab /tmp/cron.new
echo "cron updated:"; crontab -l | grep -E "stella|mae"
