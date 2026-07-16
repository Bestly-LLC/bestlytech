#!/usr/bin/env bash
# nextcloud-offsite-backup.sh
#
# Ships nightly Nextcloud snapshots off-machine to Backblaze B2 via restic.
# Runs on bestly-pi-1 as a systemd timer (see scripts/systemd/nextcloud-offsite-backup.{service,timer}).
#
# What gets backed up (in this order):
#   1. Postgres dump  (nextcloud DB)
#   2. /var/lib/docker/volumes/nextcloud_data/_data       — user files
#   3. /var/lib/docker/volumes/nextcloud_config/_data     — config.php + secrets
#   4. /opt/nextcloud/docker-compose.yml                  — stack definition
#
# Restic gives us: dedup, encryption at rest, off-machine copy, one-command restore.
# B2 is the target because it's ~$6/TB/mo and Bestly already has a Backblaze account.
#
# Prerequisites (install once):
#   sudo apt install -y restic postgresql-client
#   # Create the B2 bucket "bestly-nextcloud-backup" via B2 console (private, lifecycle=none)
#   # Populate /etc/nextcloud-backup.env with:
#   #   RESTIC_PASSWORD=<generate 32-char random, store in Vaultwarden>
#   #   B2_ACCOUNT_ID=<application key ID>
#   #   B2_ACCOUNT_KEY=<application key>
#   #   RESTIC_REPOSITORY=b2:bestly-nextcloud-backup:/
#   sudo chmod 600 /etc/nextcloud-backup.env
#   # Then initialize the repo once:
#   sudo -E env $(sudo cat /etc/nextcloud-backup.env | xargs) restic init
#
# Runbook + restore procedure: docs/nextcloud-backup-runbook.md
#
set -euo pipefail

# --- config ---------------------------------------------------------------
LOG_TAG="nextcloud-offsite-backup"
ENV_FILE="/etc/nextcloud-backup.env"
STAGING_DIR="/mnt/ssd/backups/offsite-staging"
NC_CONTAINER="nextcloud-app-1"    # adjust if your compose service name differs
DB_CONTAINER="nextcloud-db-1"
DB_NAME="nextcloud"
DB_USER="nextcloud"
DATA_VOLUME="/var/lib/docker/volumes/nextcloud_data/_data"
CONFIG_VOLUME="/var/lib/docker/volumes/nextcloud_config/_data"
COMPOSE_FILE="/opt/nextcloud/docker-compose.yml"
NTFY_TOPIC="bestly-sysalert-7q2k9mx4"
RETENTION_KEEP_DAILY=7
RETENTION_KEEP_WEEKLY=4
RETENTION_KEEP_MONTHLY=6

# --- helpers --------------------------------------------------------------
log()    { logger -t "$LOG_TAG" -- "$*"; echo "[$LOG_TAG] $*" >&2; }
ntfy()   {
  # ASCII headers only (em-dashes break ntfy header validation)
  local title="$1"; shift
  local body="$*"
  curl -fsS -H "Title: $(echo -n "$title" | LC_ALL=C sed 's/[^\x20-\x7E]//g')" \
       -d "$body" "https://ntfy.sh/$NTFY_TOPIC" >/dev/null 2>&1 || true
}
die() {
  log "FATAL: $*"
  ntfy "Nextcloud offsite backup FAILED" "$(date -Iseconds) — $*"
  # Leave HOLD so operator investigates before next run auto-triggers a duplicate
  touch "$STAGING_DIR/HOLD" 2>/dev/null || true
  exit 1
}

# --- preflight ------------------------------------------------------------
[ -f "$ENV_FILE" ] || die "missing $ENV_FILE — see script header for setup"
set -a; . "$ENV_FILE"; set +a

[ -n "${RESTIC_PASSWORD:-}" ]     || die "RESTIC_PASSWORD not set in $ENV_FILE"
[ -n "${B2_ACCOUNT_ID:-}" ]       || die "B2_ACCOUNT_ID not set in $ENV_FILE"
[ -n "${B2_ACCOUNT_KEY:-}" ]      || die "B2_ACCOUNT_KEY not set in $ENV_FILE"
[ -n "${RESTIC_REPOSITORY:-}" ]   || die "RESTIC_REPOSITORY not set in $ENV_FILE"

command -v restic >/dev/null       || die "restic not installed (apt install restic)"
command -v docker >/dev/null       || die "docker not on PATH"

mkdir -p "$STAGING_DIR"
[ -f "$STAGING_DIR/HOLD" ] && die "HOLD file exists — investigate prior failure, then remove: rm $STAGING_DIR/HOLD"

# --- 1. Postgres dump ------------------------------------------------------
DATE_UTC=$(date -u +%Y-%m-%dT%H-%M-%SZ)
DUMP_FILE="$STAGING_DIR/pgdump-$DATE_UTC.sql.gz"
log "starting Postgres dump → $DUMP_FILE"
docker exec -e PGPASSWORD="${DB_PASSWORD:-}" "$DB_CONTAINER" \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --format=plain --no-owner --clean --if-exists \
  | gzip -9 > "$DUMP_FILE" || die "pg_dump failed"

# --- 2. Put Nextcloud into maintenance mode for the file backup -----------
# Skip if we want zero-downtime; restic is snapshot-consistent on individual
# files but not cross-file consistent. For Bestly's data volume this window
# is < 30s and off-hours (2am UTC) so we take it.
log "enabling maintenance mode"
docker exec -u www-data "$NC_CONTAINER" php occ maintenance:mode --on \
  || log "warn: could not enable maintenance mode (proceeding anyway)"

trap '
  log "cleaning up: disabling maintenance mode"
  docker exec -u www-data "$NC_CONTAINER" php occ maintenance:mode --off || true
' EXIT

# --- 3. restic backup ------------------------------------------------------
log "running restic backup to $RESTIC_REPOSITORY"
restic backup \
  --tag "auto" \
  --tag "$(date -u +%Y-%m-%d)" \
  --host bestly-pi-1 \
  --exclude '*.tmp' \
  --exclude '*/cache/*' \
  --exclude '*/uploads_tmp/*' \
  "$DUMP_FILE" \
  "$DATA_VOLUME" \
  "$CONFIG_VOLUME" \
  "$COMPOSE_FILE" \
  || die "restic backup failed"

# --- 4. clean up local pg dump (restic has it now) ------------------------
rm -f "$DUMP_FILE"

# --- 5. retention ----------------------------------------------------------
log "applying retention policy (${RETENTION_KEEP_DAILY}d/${RETENTION_KEEP_WEEKLY}w/${RETENTION_KEEP_MONTHLY}m)"
restic forget \
  --keep-daily "$RETENTION_KEEP_DAILY" \
  --keep-weekly "$RETENTION_KEEP_WEEKLY" \
  --keep-monthly "$RETENTION_KEEP_MONTHLY" \
  --prune \
  || log "warn: restic forget/prune failed (non-fatal)"

# --- 6. integrity spot-check ----------------------------------------------
# Full 'restic check' is expensive; do a fast subset weekly instead.
if [ "$(date -u +%u)" = "7" ]; then
  log "Sunday — running restic check (fast subset)"
  restic check --read-data-subset=5% || log "warn: restic check reported issues"
fi

# --- 7. success signal ----------------------------------------------------
SNAPSHOT_ID=$(restic snapshots --latest 1 --json | grep -o '"short_id":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "unknown")
REPO_SIZE=$(restic stats latest --mode raw-data 2>/dev/null | grep 'Total Size' | awk '{print $3, $4}' || echo "?")
log "success: snapshot=$SNAPSHOT_ID repo_size=$REPO_SIZE"
ntfy "Nextcloud offsite backup OK" "$DATE_UTC snapshot=$SNAPSHOT_ID size=$REPO_SIZE"

trap - EXIT
docker exec -u www-data "$NC_CONTAINER" php occ maintenance:mode --off || log "warn: could not disable maintenance mode"

exit 0
