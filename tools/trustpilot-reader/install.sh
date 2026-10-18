#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Copies the Review Reader into the Pi cron framework and adds the every-15-minutes crontab line (idempotent).
set -e
DEST=/opt/bestly/cron/jobs
SRC=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$DEST" /opt/bestly/cron/state /home/pi/scripts/cron-logs

for f in trustpilot_reviews.py trustpilot_parse.py; do
  [ -f "$DEST/$f" ] && cp -p "$DEST/$f" "$DEST/$f.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$SRC/$f" "$DEST/$f"
done
python3 -m py_compile "$DEST/trustpilot_reviews.py" "$DEST/trustpilot_parse.py"

LINE='7-59/15 * * * * /opt/bestly/cron/run.sh trustpilot_reviews   # Maya / Review Reader: files new Trustpilot reviews from the mail bridge copy, DKIM-checked, free, no AI unless the parser fails (Pi clock = America/Los_Angeles). Undo: remove this line; off switch: none needed (read-only)'
if ! crontab -l | grep -q 'run.sh trustpilot_reviews'; then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-trustpilot"
  (crontab -l; echo "$LINE") | crontab -
fi
crontab -l | grep trustpilot_reviews

python3 "$SRC/selftest.py"
echo "Installed. Dry run:  cd /opt/bestly/cron && python3 -c \"import sys; sys.path.insert(0,'.'); from jobs import trustpilot_reviews as j; print(j.main(['--dry']))\""
