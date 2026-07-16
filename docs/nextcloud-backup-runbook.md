# Nextcloud offsite backup runbook

**Why this exists:** On 2026-06-05 we lost the entire Nextcloud stack because we had *no external backup*. The existing `nextcloud-auto-update-opusplan.md` pipeline takes a pre-upgrade DB snapshot to `/mnt/ssd/backups/nc-auto/` — but that's on the same SSD. When the SSD dies (as it did in June), the snapshots die with it. This runbook fixes that hole by shipping a nightly encrypted snapshot to Backblaze B2.

**Target:** cloud.bestly.tech (running as Docker Compose on bestly-pi-1).
**Tool:** `restic` — dedup, encryption at rest, native B2 support, one-command restore.
**Destination:** Backblaze B2 bucket `bestly-nextcloud-backup` (~$6/TB/mo, expected repo size ~15-30 GB).
**Cadence:** nightly at 02:15 UTC.
**Retention:** 7 daily / 4 weekly / 6 monthly (~6 months of history).

## One-time setup (Jared runs on the Pi)

Everything below happens on `bestly-pi-1`. All commands assume `sudo`.

### 1. Create the B2 bucket + application key

1. Log into `secure.backblaze.com` → **B2 Cloud Storage → Buckets → Create a Bucket**.
   - Name: `bestly-nextcloud-backup`
   - Files in bucket are: **Private**
   - Default encryption: **Disabled** (restic handles encryption client-side)
   - Object Lock: **Disabled** (can revisit later; interacts with restic prune)
   - Lifecycle Settings: **Keep only the last version** — but note this can conflict with restic. If uncertain, choose **Keep all versions**.
2. **B2 Cloud Storage → Application Keys → Add a New Application Key**.
   - Name: `nextcloud-backup-pi`
   - Allow access to: `bestly-nextcloud-backup` only
   - Type of access: **Read and Write**
   - Copy the `keyID` and `applicationKey` — **you will not see the applicationKey again.**

Store both values in Vaultwarden under `bestly-cloud / nextcloud-b2-backup`.

### 2. Install restic on the Pi

```bash
sudo apt update
sudo apt install -y restic postgresql-client jq
restic version   # should show 0.15+ (Debian bookworm ships 0.14; if so, install from restic.net latest)
```

### 3. Populate the env file

```bash
sudo tee /etc/nextcloud-backup.env >/dev/null <<'EOF'
# Generate with: openssl rand -base64 24
RESTIC_PASSWORD=REPLACE_ME_WITH_STRONG_PASSPHRASE

# From step 1 above
B2_ACCOUNT_ID=REPLACE_WITH_KEY_ID
B2_ACCOUNT_KEY=REPLACE_WITH_APPLICATION_KEY

RESTIC_REPOSITORY=b2:bestly-nextcloud-backup:/

# Postgres password for the nextcloud DB user — read from your existing
# compose env file. Find it with:
#   sudo grep POSTGRES_PASSWORD /opt/nextcloud/*.env
DB_PASSWORD=REPLACE_WITH_POSTGRES_PASSWORD
EOF

sudo chmod 600 /etc/nextcloud-backup.env
sudo chown root:root /etc/nextcloud-backup.env
```

**Store `RESTIC_PASSWORD` in Vaultwarden.** Without it the entire backup is unrecoverable.

### 4. Initialize the restic repo

```bash
sudo -E bash -c 'set -a; . /etc/nextcloud-backup.env; set +a; restic init'
```

Expect: `created restic repository ... at b2:bestly-nextcloud-backup:/`

### 5. Install the script + systemd units

The repo tree at `/opt/bestly/repo` should be the checkout of `github.com:bestlytech/bestlytech`. If it's not already there:

```bash
sudo mkdir -p /opt/bestly && cd /opt/bestly
sudo git clone git@github.com:bestlytech/bestlytech.git repo
```

Then symlink and enable:

```bash
sudo ln -sf /opt/bestly/repo/scripts/nextcloud-offsite-backup.sh /usr/local/bin/nextcloud-offsite-backup.sh
sudo chmod +x /opt/bestly/repo/scripts/nextcloud-offsite-backup.sh

sudo cp /opt/bestly/repo/scripts/systemd/nextcloud-offsite-backup.service /etc/systemd/system/
sudo cp /opt/bestly/repo/scripts/systemd/nextcloud-offsite-backup.timer   /etc/systemd/system/

sudo systemctl daemon-reload
sudo systemctl enable --now nextcloud-offsite-backup.timer
```

### 6. Fire the first run manually + verify

```bash
sudo systemctl start nextcloud-offsite-backup.service
sudo journalctl -u nextcloud-offsite-backup.service -f
```

Expect ntfy push on the `bestly-sysalert-7q2k9mx4` topic once it completes ("Nextcloud offsite backup OK").

Verify it landed in B2:

```bash
sudo -E bash -c 'set -a; . /etc/nextcloud-backup.env; set +a; restic snapshots'
```

### 7. Verify restore actually works (do this ONCE, then annually)

Restore-from-scratch drill — pick a small file from Nextcloud, restore just that path to `/tmp`, diff against the live copy.

```bash
sudo -E bash -c 'set -a; . /etc/nextcloud-backup.env; set +a; \
  restic restore latest \
    --target /tmp/restic-restore-test \
    --include "/var/lib/docker/volumes/nextcloud_config/_data/config/config.php"'

sudo diff \
  /var/lib/docker/volumes/nextcloud_config/_data/config/config.php \
  /tmp/restic-restore-test/var/lib/docker/volumes/nextcloud_config/_data/config/config.php \
  && echo "OK: restore matches live"

sudo rm -rf /tmp/restic-restore-test
```

## Full disaster-recovery procedure

You've lost the SSD. The Pi is bricked. You have a new machine and the Vaultwarden entry.

1. **Install Nextcloud** on the new host from the `docker-compose.yml` in the repo (or the fresh copy at `/opt/nextcloud/docker-compose.yml` restored below).
2. **Do not start** the Nextcloud container yet.
3. Install restic, populate `/etc/nextcloud-backup.env` from Vaultwarden (same values as before — the repo password is what unlocks everything).
4. Restore:
   ```bash
   sudo -E bash -c 'set -a; . /etc/nextcloud-backup.env; set +a; restic restore latest --target /'
   ```
   This restores `docker-compose.yml`, the `nextcloud_data` volume dir, the `nextcloud_config` volume dir, and the most recent `pgdump-*.sql.gz`.
5. Start Postgres only:
   ```bash
   cd /opt/nextcloud && docker compose up -d nextcloud-db-1
   ```
6. Restore the DB:
   ```bash
   PGDUMP=$(ls -t /mnt/ssd/backups/offsite-staging/pgdump-*.sql.gz | head -1)
   gunzip -c "$PGDUMP" | docker exec -i nextcloud-db-1 psql -U nextcloud -d postgres
   ```
7. Start Nextcloud:
   ```bash
   docker compose up -d
   docker exec -u www-data nextcloud-app-1 php occ maintenance:mode --off
   docker exec -u www-data nextcloud-app-1 php occ upgrade  # in case running a newer image
   ```
8. Point DNS back at the new host.

## Observability

- Success: ntfy push to `bestly-sysalert-7q2k9mx4` titled "Nextcloud offsite backup OK"
- Failure: ntfy push titled "Nextcloud offsite backup FAILED" + a `HOLD` file at `/mnt/ssd/backups/offsite-staging/HOLD` that prevents the next scheduled run from firing until an operator investigates and removes it.
- Weekly integrity check runs every Sunday (5% subset — full check takes hours).

## Costs

- Storage: ~15-30 GB × $0.006/GB/mo = **~$0.10-0.20/mo**
- Downloads (only during restore): $0.01/GB — a full-repo restore of 30 GB = $0.30 one-time
- API calls: negligible for daily backups
- Total: **under $0.50/mo** at current data volume

## What this does NOT cover

- **Deck boards / Talk rooms / Calendar items** — these live inside Postgres, so DB dump covers them.
- **Nextcloud app config with encrypted values** — these are in `oc_appconfig` and covered by the DB dump. The 4 apps flagged for HMAC-crash preemption (mail, libresign, integration_github, integration_openai) will be restored *including* their encrypted state — meaning the same HMAC problem could recur post-restore. Runbook for that: TODO — file separate `docs/nextcloud-hmac-preempt-runbook.md`.
- **Off-Nextcloud stuff on the Pi** — Cloudflared config, systemd overrides, etc. Add these to the backup by extending the paths list in the script if you want.
- **Vaultwarden vault itself** — Vaultwarden runs on the same Pi and stores its own SQLite DB in `/var/lib/docker/volumes/vaultwarden_data/_data`. **Add this path to the backup script's restic backup line before you rely on Vaultwarden for anything important.** Otherwise, losing the Pi loses the vault that holds the restic password. Chicken-and-egg. See open item below.

## Open items

- [ ] Add Vaultwarden data volume to the backup path list (once Vaultwarden is in daily use).
- [ ] Print the restic password to a paper card and store it in the Bestly office safe. Belt-and-suspenders.
- [ ] Consider a second target (Storj or a friend's Nextcloud) once we're > 100 GB.
- [ ] Write the HMAC-preempt runbook mentioned above.
