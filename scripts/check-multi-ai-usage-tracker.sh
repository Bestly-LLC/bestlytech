#!/usr/bin/env bash
# Read the diag log + row count from the Pi.
set -euo pipefail
PI_HOST="${PI_HOST:-pi@cloud.bestly.tech}"

ssh -tt "$PI_HOST" bash <<'REMOTE'
echo "===== bestly-record.log ====="
docker exec -u root nextcloud cat /var/www/html/data/bestly-record.log 2>/dev/null || echo "(no log file yet)"
echo
echo "===== oc_bestly_ai_usage row count ====="
docker exec -u postgres nextcloud-db psql -U nextcloud -d nextcloud -c "SELECT count(*) FROM oc_bestly_ai_usage;"
echo
echo "===== latest 5 rows ====="
docker exec -u postgres nextcloud-db psql -U nextcloud -d nextcloud -c "SELECT id, user_id, provider_id, model_id, prompt_tokens, completion_tokens, cost_usd, to_timestamp(created_at) FROM oc_bestly_ai_usage ORDER BY id DESC LIMIT 5;"
echo
echo "===== last 20 lines nextcloud.log filtered ====="
docker exec -u root nextcloud tail -200 /var/www/html/data/nextcloud.log 2>/dev/null | grep -iE 'usage|bestly|multi.?ai|record' | tail -20 || echo "(nothing matching)"
REMOTE
