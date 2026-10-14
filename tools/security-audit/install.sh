#!/bin/sh
# Run ON the Pi (as pi) from this folder:  sh install.sh
# Copies the audit into the Pi cron framework and adds the 1:00 AM crontab line (idempotent).
# The job starts in DRY mode and is registered DISABLED in pi_jobs; see README.md for the switch-on steps.
set -e
DEST=/opt/bestly/cron/jobs
STATE=/opt/bestly/cron/state
SRC=$(cd "$(dirname "$0")" && pwd)

# web_checks.py is reused unchanged from the repo. In a checkout it is two folders up; if this folder was
# copied to the Pi on its own, put web_checks.py next to install.sh.
WEB=""
for c in "$SRC/web_checks.py" "$SRC/../../scripts/security-audit/web_checks.py"; do
  if [ -f "$c" ]; then WEB="$c"; break; fi
done
if [ -z "$WEB" ]; then
  echo "web_checks.py not found (looked beside install.sh and in ../../scripts/security-audit/)." >&2
  echo "Copy scripts/security-audit/web_checks.py next to install.sh and run again." >&2
  exit 1
fi

mkdir -p "$DEST" "$STATE" /home/pi/scripts/cron-logs

stamp=$(date +%Y%m%d-%H%M%S)
put() { # put <source file> <dest name>
  [ -f "$DEST/$2" ] && cp -p "$DEST/$2" "$DEST/$2.bak-$stamp"
  cp "$1" "$DEST/$2"
}
put "$SRC/security_audit.py" security_audit.py
put "$SRC/security-audit.py" security-audit.py
put "$WEB" security_audit_web_checks.py
python3 -m py_compile "$DEST/security_audit.py" "$DEST/security-audit.py" "$DEST/security_audit_web_checks.py"

# State starts in DRY mode -- nothing is written to the database until this says "live".
if [ ! -f "$STATE/security_audit.json" ]; then
  printf '{\n  "mode": "dry",\n  "last_run": null,\n  "last_summary": null,\n  "log": []\n}\n' > "$STATE/security_audit.json"
  echo "seeded $STATE/security_audit.json in DRY mode"
fi

# What web_checks.py needs. Missing pieces are reported here; nothing is installed behind your back.
python3 -c "import requests" 2>/dev/null || echo "WARNING: python3 'requests' is missing -> sudo apt install python3-requests   (web checks cannot run without it)"
command -v git >/dev/null 2>&1 || echo "WARNING: git is missing -> sudo apt install git   (the code-secret checks will record skip)"
command -v npm >/dev/null 2>&1 || echo "WARNING: npm is missing -> sudo apt install npm   (the dependency audit will record skip)"

LINE='0 1 * * * /opt/bestly/cron/run.sh security-audit   # Ares: nightly security audit (Pi clock = America/Los_Angeles)'
if ! (crontab -l 2>/dev/null | grep -q 'run.sh security-audit'); then
  crontab -l > "/home/pi/scripts/crontab.bak-$(date +%Y%m%d)-security-audit" 2>/dev/null || true
  (crontab -l 2>/dev/null; echo "$LINE") | crontab -
fi
crontab -l | grep security-audit

python3 "$SRC/selftest.py"

echo
echo "Installed. Next:"
echo "  1. paste the Vercel and Supabase tokens: bestly.tech/admin/security > Audit tokens"
echo "  2. dry run (writes nothing):  python3 $DEST/security_audit.py --dry"
echo "  3. one real run:              python3 $DEST/security_audit.py --live --force"
echo "     (while the Claude task still runs, expect both to share finding keys; that is safe)"
echo "  4. go live nightly: set \"mode\" to \"live\" in $STATE/security_audit.json"
echo "  5. then:     update pi_jobs set enabled = true where job = 'security-audit';"
