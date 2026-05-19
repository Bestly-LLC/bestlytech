#!/usr/bin/env bash
# Run from your Mac — SSHs into the Pi, patches UsageTracker.php with diag
# instrumentation, restarts Nextcloud, prints the next steps.
#
# Assumes you can already do: ssh pi@cloud.bestly.tech (or change PI_HOST below).
set -euo pipefail

PI_HOST="${PI_HOST:-pi@cloud.bestly.tech}"

ssh -tt "$PI_HOST" bash <<'REMOTE'
set -euo pipefail
echo "==> Patching UsageTracker.php inside the nextcloud container"

docker exec -u root nextcloud bash <<'INNER'
set -euo pipefail
F=/var/www/html/custom_apps/integration_openai/lib/MultiAi/UsageTracker.php
[ -f "$F" ] || { echo "MISSING: $F"; exit 1; }
cp "$F" "$F.bak.$(date +%s)"

php -r '
$p = "/var/www/html/custom_apps/integration_openai/lib/MultiAi/UsageTracker.php";
$s = file_get_contents($p);

// 1. ENTER diag — first line inside record()
$enter = "\n\t\t@file_put_contents(\"/var/www/html/data/bestly-record.log\", sprintf(\"[%s] ENTER user=%s prov=%s model=%s p=%s c=%s t=%s\n\", date(\"c\"), \$userId ?? \"null\", \$providerId, \$modelId, \$promptTokens ?? \"null\", \$completionTokens ?? \"null\", \$totalTokens ?? \"null\"), FILE_APPEND);";
$s = preg_replace("/(public function record\([^)]*\): void \{)/", "$1" . $enter, $s, 1);

// 2. POST-INSERT diag
$s = str_replace(
  "\$qb->executeStatement();",
  "\$rows = \$qb->executeStatement();\n\t\t\t@file_put_contents(\"/var/www/html/data/bestly-record.log\", \"[\" . date(\"c\") . \"] POST-INSERT rows=\$rows\n\", FILE_APPEND);",
  $s
);

// 3. CATCH diag
$s = str_replace(
  "} catch (\\Throwable \$e) {",
  "} catch (\\Throwable \$e) {\n\t\t\t@file_put_contents(\"/var/www/html/data/bestly-record.log\", \"[\" . date(\"c\") . \"] CATCH \" . get_class(\$e) . \": \" . \$e->getMessage() . \"\n\", FILE_APPEND);",
  $s
);

file_put_contents($p, $s);
echo "patched\n";
'

# wipe stale log + ensure file is writable by www-data
rm -f /var/www/html/data/bestly-record.log
touch /var/www/html/data/bestly-record.log
chown www-data:www-data /var/www/html/data/bestly-record.log
INNER

echo "==> Restarting nextcloud container"
docker restart nextcloud >/dev/null
sleep 6
echo "==> Done. Now:"
echo "   1. Open the Nextcloud Assistant in your browser and send ONE chat message"
echo "   2. Then re-run: $0 --tail"
REMOTE
