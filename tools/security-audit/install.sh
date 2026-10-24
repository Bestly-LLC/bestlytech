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
put "$SRC/security_audit_ares2.py" security_audit_ares2.py
put "$SRC/security_audit_cve.py" security_audit_cve.py
put "$WEB" security_audit_web_checks.py
# The regression suite lives next to the audit. The L6 gate looks for security_audit_selftest.py first.
put "$SRC/selftest.py" security_audit_selftest.py
python3 -m py_compile "$DEST/security_audit.py" "$DEST/security-audit.py" "$DEST/security_audit_ares2.py" \
  "$DEST/security_audit_cve.py" "$DEST/security_audit_web_checks.py" "$DEST/security_audit_selftest.py"

# State starts in DRY mode -- nothing is written to the database until this says "live".
if [ ! -f "$STATE/security_audit.json" ]; then
  printf '{\n  "mode": "dry",\n  "last_run": null,\n  "last_summary": null,\n  "log": []\n}\n' > "$STATE/security_audit.json"
  echo "seeded $STATE/security_audit.json in DRY mode"
fi

# Stack inventory rows for machines the Pi cannot look inside (Ares 2.1, L7). The Mac mini is entered by hand, verified
# 2026-10-24. A row older than 7 days is reported as "not checked", never treated as current. Never overwritten.
if [ ! -f "$STATE/stack_inventory_extra.json" ]; then
  cat > "$STATE/stack_inventory_extra.json" <<'EOF_EXTRA'
[
  {"host": "jareds-mac-mini", "component": "node", "version": "22.23.4", "cycle": "22", "internet_facing": false, "source": "manual", "verified_at": "2026-10-24"},
  {"host": "jareds-mac-mini", "component": "node-system", "version": "22.14.0", "cycle": "22", "internet_facing": false, "source": "manual", "verified_at": "2026-10-24", "note": "/usr/local/bin/node, root-owned, used only by the Claude desktop app's MCP servers; needs an admin password to replace"}
]
EOF_EXTRA
  echo "seeded $STATE/stack_inventory_extra.json (Mac mini node rows, verified 2026-10-24)"
fi
python3 -c "import json,sys; json.load(open(sys.argv[1]))" "$STATE/stack_inventory_extra.json" || echo "WARNING: $STATE/stack_inventory_extra.json is not valid JSON; the stack check will record it as not checked"

# What web_checks.py needs. Missing pieces are reported here; nothing is installed behind your back.
python3 -c "import requests" 2>/dev/null || echo "WARNING: python3 'requests' is missing -> sudo apt install python3-requests   (web checks cannot run without it)"
command -v git >/dev/null 2>&1 || echo "WARNING: git is missing -> sudo apt install git   (the code-secret checks will record skip)"
command -v npm >/dev/null 2>&1 || echo "WARNING: npm is missing -> sudo apt install npm   (the dependency audit will record skip)"
command -v docker >/dev/null 2>&1 || echo "WARNING: docker is missing or not on pi's PATH -> the stack/CVE watch cannot list containers (it records skip, never pass)"

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
echo
echo "Ares 2.1 (stack / CVE watch, dependency gate, Nextcloud self-heal) is part of the same nightly run."
echo "  To stop the Nextcloud self-heal and only get the alert: set \"heal_nextcloud\": false in $STATE/security_audit.json"
echo "  Mac mini / other hosts: edit $STATE/stack_inventory_extra.json (re-verify within 7 days or it shows as not checked)"
