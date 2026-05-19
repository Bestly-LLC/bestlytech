#!/usr/bin/env bash
# Recover from /login 500 caused by a broken Multi-AI patch.
# Strategy: disable integration_openai temporarily, verify /login comes back,
# then restore the clean source from this repo, re-enable, verify again.
set -euo pipefail

PI_HOST="${PI_HOST:-pi@bestly-pi}"

echo "==> 1. Disable integration_openai on the Pi"
ssh -tt "$PI_HOST" "docker exec -u www-data nextcloud php occ app:disable integration_openai" || true

echo "==> 2. Verify /login recovers"
sleep 3
CODE=$(curl -sS -o /dev/null -w '%{http_code}' https://cloud.bestly.tech/login)
echo "   /login -> $CODE"
if [ "$CODE" != "200" ]; then
  echo "   STILL broken — something else is wrong. Bail and investigate."
  exit 1
fi
echo "   GOOD — login works with integration_openai disabled."

echo "==> 3. Strip ALL diag instrumentation from app source on the Pi"
ssh -tt "$PI_HOST" bash <<'REMOTE'
docker exec -u root nextcloud bash <<'INNER'
APP=/var/www/html/custom_apps/integration_openai
for f in $(grep -rlE "bestly-record\.log|SVC hit|@file_put_contents.*/var/www/html/data" "$APP" 2>/dev/null || true); do
  echo "  cleaning: $f"
  sed -i -E '/bestly-record\.log/d; /SVC hit/d; /@file_put_contents.*data\//d' "$f"
done
# also nuke any orphan logger->error( calls where $this->logger is not declared
grep -rln '$this->logger->error' "$APP/lib/TaskProcessing/" 2>/dev/null | while read F; do
  if ! grep -q "private.*LoggerInterface.*logger" "$F"; then
    echo "  removing orphan logger->error in: $F"
    sed -i '/$this->logger->error/d' "$F"
  fi
done
echo "done"
INNER
REMOTE

echo "==> 4. Re-enable integration_openai"
ssh -tt "$PI_HOST" "docker exec -u www-data nextcloud php occ app:enable integration_openai"

echo "==> 5. Final verify"
sleep 3
CODE=$(curl -sS -o /dev/null -w '%{http_code}' https://cloud.bestly.tech/login)
echo "   /login -> $CODE  (want 200)"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' https://cloud.bestly.tech/status.php)
echo "   /status.php -> $CODE  (want 200)"
