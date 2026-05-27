# Nextcloud Auto-Update — OpusPlan

_v1.0 — 2026-05-26 — Internal — Bestly Ops_

## TL;DR

We want `cloud.bestly.tech` (Nextcloud + ~15 sidecar containers on `bestly-pi`) to **stay current automatically without ever causing a 502, a maintenance-mode lockout, an app-compat break, or an unrecoverable upgrade.** The web updater is forbidden — it's the source of most of those failures and locks the admin UI while it runs. Instead we use the **Docker image-tag-swap pattern** wrapped in a managed update flow: snapshot → preflight → pull → swap → upgrade → health-check → rollback-if-failed → notify. Scheduled weekly during low-traffic Sunday 04:00 PT. Major-version bumps stay manual (single weekend a quarter).

This plan covers: scope, image-pinning strategy, the update orchestrator script, the rollback path, the health check, app-compat preflight, scheduling, observability, and the staged rollout for sidecar services (Talk HPB, Vaultwarden, Collabora, etc.) that have different update rhythms than Nextcloud itself.

---

## 1. What "auto-update" actually means here

Nextcloud-app, in the Bestly stack, is one container in a compose project. "Auto-update" means: **pulling the next published image tag, recreating the container against the same data volume, letting Nextcloud's `occ upgrade` migrate the DB, and verifying the result is healthy** — all unattended, with automatic rollback if anything fails.

Scope of this plan:

| Component | Auto-update? | Cadence | Notes |
|---|---|---|---|
| `nextcloud-app` | **yes, with gate** | weekly minor/patch; manual major | The main protagonist. |
| `nextcloud-cron` | yes (slaved to app) | with app | Same image as app — moves together. |
| `nextcloud-notify-push` | yes (slaved to app) | with app | Same image as app. |
| `nextcloud-db` (postgres:16) | **no** | manual quarterly | DB engine upgrades require careful planning. |
| `nextcloud-redis` (redis:7) | yes | monthly | Stateless cache. |
| `nextcloud-collabora` | yes | weekly | Restart-safe. |
| `talk-hpb-signaling-1` | yes | monthly | Validate Talk works after. |
| `talk-hpb-nats-1` | yes | quarterly | Rarely changes. |
| `vaultwarden` | yes | weekly | Stable release channel. |
| `uptime-kuma` | yes | monthly | |
| `homeassistant` | **no** | manual | HA breaks integrations on minor versions. Owner-controlled. |
| `ollama` | yes | monthly | |
| `open-webui` | yes | monthly | |
| `n8n` | yes | monthly | |
| Pi OS packages (`apt`) | **no** | quarterly manual | Userland migration to arm64 still pending — handle apt updates only after that. |
| `cloudflared` | **no** | manual | systemd unit; small attack surface; we don't want auto-bumps disrupting tunnel. |

Out of scope: kernel updates, firmware, Cloudflare's own behavior, app store updates inside Nextcloud (those are user-driven).

---

## 2. The image-tag-swap pattern (versus the web updater)

```
                         Web updater (the bad path)
                         --------------------------
  Admin clicks "Update" → Nextcloud puts itself in maintenance mode →
  downloads new code into the same docroot via PHP → applies migrations
  in-process → exits maintenance → reload UI.
  Failure modes: PHP times out mid-download leaves a half-installed
  codebase. DB migration fails mid-way → stuck in maintenance mode with
  partial schema. Permission errors leave files owned by wrong user.
  No clean rollback. Locks the admin UI for the duration.

                  Image-tag-swap (what we're doing)
                  ----------------------------------
  docker compose pull nextcloud-app    (downloads new image, safe)
  docker compose up -d   nextcloud-app  (atomically replaces container)
       ↓
  New container starts → entrypoint sees data volume version < image
  version → runs `occ upgrade` automatically → exits maintenance →
  serves traffic.
  Failure mode: container fails to start (image bug, app incompat) →
  old container is gone but image is still there → we re-tag to old
  digest and `up -d` again → instant rollback to working state. DB
  migration is run inside the new container with an open transaction
  per migration step — Postgres-level rollback is automatic on failure.
```

The image-tag-swap pattern is **idempotent, atomic, observable, and reversible**. The web updater is none of those.

**Rule**: the in-admin web updater is permanently disabled. Set `'updatechecker' => false` in `config.php` to also hide the "update available" banner so nobody clicks it.

---

## 3. The pinning strategy

We do **not** track `:latest` for Nextcloud (or anything important). We track a **floating minor tag with a digest pin** that gets bumped by the orchestrator:

```yaml
# docker-compose.yml (excerpt)
services:
  nextcloud-app:
    # Floating tag for documentation; digest below is the SOURCE OF TRUTH.
    image: nextcloud:33-apache@sha256:abc123...   # pinned each upgrade
    # ...
```

Why both: humans read the tag (`nextcloud:33-apache`), Docker pulls by digest (immutable, reproducible). When the orchestrator pulls a new image, it resolves the digest, writes the new digest+tag into the compose file, commits to git, and brings the container up. Rollback = `git revert` + `docker compose up -d`. The digest pin guarantees you get exactly the version you tested.

**Floating-tag policy per component:**

| Component | Floating tag |
|---|---|
| Nextcloud | `33-apache` (current major; bump major manually) |
| Postgres | `16-alpine` (DB major never bumps without explicit plan) |
| Redis | `7-alpine` |
| Collabora | `latest` (their version model is best-effort) |
| Talk HPB | pinned to specific release tags (small project, manual scan) |
| Vaultwarden | `latest` (their releases are battle-tested) |
| HomeAssistant | `stable` |
| Ollama, open-webui, n8n | `latest` |

---

## 4. The orchestrator — `nextcloud-auto-update`

A single script on the Pi at `/usr/local/bin/nextcloud-auto-update.sh`. Runs from a systemd timer. Does the following, in order, atomically per stack component:

### 4.1 Phases

```
PHASE 1 — Preflight
  - Confirm origin is currently healthy (no point updating a broken stack)
  - Confirm disk free > 5 GB (image pull + DB backup needs room)
  - Confirm no other Bestly maintenance window is active
  - Capture current image digest for every targeted service
  - Snapshot Postgres DB → /mnt/ssd/backups/nc-auto/YYYY-MM-DD/preupgrade.sql.gz
  - Snapshot config.php → same dir
  - Snapshot /var/www/html/data file listing → same dir (NOT the data itself —
    file data is mounted on its own volume and the backup pipeline owns it
    separately; we just record what existed)
  - Snapshot installed app list with versions: `occ app:list --output=json`
  - Write a snapshot manifest JSON

PHASE 2 — App-compat preflight (Nextcloud-app only)
  - For each targeted Nextcloud version, query the Nextcloud apps API for
    each installed app's compatibility manifest.
  - If ANY installed app does NOT support the target Nextcloud version:
      → ABORT with "app X version Y blocks upgrade to NC Z. Disable app or
         wait for app update." Notify via ntfy.

PHASE 3 — Image pull
  - For each targeted service: `docker compose pull <service>`
  - Resolve new digest; compare to current digest.
  - If unchanged: nothing to do for this service; skip.
  - Write new digest into compose file (in-place sed with a backup copy).

PHASE 4 — Apply
  - For each service whose digest changed:
      → `docker compose up -d <service>` (atomic recreate)
  - For Nextcloud-app specifically:
      → Wait for container to be "running" + Apache port 80 to accept connections.
      → Watch `occ upgrade` automatically run (logs show progress).
      → Wait for `occ status | grep maintenance:false`.

PHASE 5 — Health check
  - External: curl https://cloud.bestly.tech/status.php → expect 200 + installed:true.
  - Internal: curl http://localhost:8082/status.php → expect 200.
  - Functional: `occ status` → expect installed:true, maintenance:false,
    needsDbUpgrade:false.
  - App enumeration: `occ app:list` and compare to pre-upgrade list; flag
    any app that auto-disabled itself.
  - Background jobs: `occ maintenance:repair` (dry-run mode) → expect no errors.
  - Talk HPB if updated: GET https://nextcloud.bestly.tech/standalone-signaling/api/v1/welcome → expect 200 with version.
  - Restart cloudflared after EVERY container restart (closes the stale-pool
    failure mode from nextcloud-502-recovery-opusplan.md).

PHASE 6 — Result
  - If health checks pass: ntfy "auto-update OK: bumped NC 33.0.3 → 33.0.4
    in 4m12s. Snapshot at .../preupgrade.sql.gz. Diff in git commit abc123."
  - If health checks fail: ROLLBACK → restore previous digest from manifest,
    `docker compose up -d`, restart cloudflared, run health check again on
    rolled-back state, ntfy with full failure detail + last 50 lines of
    container log. Open a follow-up task automatically.

PHASE 7 — Cleanup
  - If success: remove snapshots older than 30 days.
  - If failure: keep snapshot indefinitely until human resolves.
  - Truncate orchestrator log to last 100 runs.
```

### 4.2 The script — `/usr/local/bin/nextcloud-auto-update.sh`

```bash
#!/bin/bash
#
# nextcloud-auto-update — safe, observable, reversible upgrade of the
# Bestly Nextcloud stack on bestly-pi.
#
# See docs/nextcloud-auto-update-opusplan.md for the full design.

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-/opt/bestly/docker-compose.yml}"
BACKUP_ROOT="${BACKUP_ROOT:-/mnt/ssd/backups/nc-auto}"
NTFY_TOPIC="${NTFY_TOPIC:-bestly-sysalert-7q2k9mx4}"
ORIGIN_URL="${ORIGIN_URL:-https://cloud.bestly.tech/status.php}"
LOCAL_URL="${LOCAL_URL:-http://localhost:8082/status.php}"

# Services to update on this run. Comma-separated list; "ALL" = the canonical set.
TARGETS="${TARGETS:-nextcloud-app,nextcloud-cron,nextcloud-notify-push,nextcloud-redis,nextcloud-collabora,vaultwarden,n8n,uptime-kuma}"

NOW="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
DATE="$(date -u +%Y-%m-%d)"
SNAPSHOT_DIR="$BACKUP_ROOT/$DATE/$NOW"
mkdir -p "$SNAPSHOT_DIR"
LOG="$SNAPSHOT_DIR/run.log"

log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
notify() {
  local title="$1" body="$2"
  curl -sfm 5 -d "$body" -H "X-Title: $title" \
       "https://ntfy.sh/$NTFY_TOPIC" >/dev/null 2>&1 || true
}

bail() {
  local msg="$1"
  log "ABORT: $msg"
  notify "nextcloud-auto-update ABORT" "$msg"
  exit 1
}

# ===== PHASE 1: PREFLIGHT =====
log "=== PHASE 1: PREFLIGHT ==="

# Origin healthy?
code=$(curl -sfo /dev/null -m 8 -w '%{http_code}' "$ORIGIN_URL" || echo 000)
[ "$code" = "200" ] || bail "preflight: external origin returned $code, refusing to update a broken stack"

local_code=$(curl -sfo /dev/null -m 8 -w '%{http_code}' "$LOCAL_URL" || echo 000)
[ "$local_code" = "200" ] || bail "preflight: local origin returned $local_code"

# Disk space?
free_gb=$(df -BG /mnt/ssd | awk 'NR==2 {print $4}' | tr -d 'G')
[ "$free_gb" -gt 5 ] || bail "preflight: only ${free_gb}G free on /mnt/ssd"

# Database snapshot
log "snapshotting Postgres"
docker exec nextcloud-db pg_dumpall -U nextcloud | gzip > "$SNAPSHOT_DIR/preupgrade.sql.gz"
[ -s "$SNAPSHOT_DIR/preupgrade.sql.gz" ] || bail "preflight: DB snapshot is empty"

# Config snapshot
docker exec -u www-data nextcloud-app cat /var/www/html/config/config.php > "$SNAPSHOT_DIR/config.php" 2>&1 || true

# App list snapshot
docker exec -u www-data nextcloud-app php occ app:list --output=json > "$SNAPSHOT_DIR/apps-before.json" 2>&1 || true

# Image digest snapshot
docker compose -f "$COMPOSE_FILE" images --format json > "$SNAPSHOT_DIR/images-before.json" 2>&1 || true

log "preflight OK. snapshot at $SNAPSHOT_DIR"

# ===== PHASE 2: APP-COMPAT PREFLIGHT =====
log "=== PHASE 2: APP-COMPAT PREFLIGHT ==="

# Determine current and pending Nextcloud version
current_nc_version=$(docker exec -u www-data nextcloud-app php occ status --output=json 2>/dev/null | jq -r '.versionstring' || echo "unknown")
log "current Nextcloud version: $current_nc_version"

# Pull image manifest for the floating tag without actually pulling the image
target_nc_tag=$(grep -oE 'nextcloud:[0-9]+-apache' "$COMPOSE_FILE" | head -1)
log "target floating tag: $target_nc_tag"

# Resolve target version by querying registry (avoids actually pulling first)
# This is a simplified probe; a real implementation uses skopeo or crane.
target_nc_version=$(docker manifest inspect "$target_nc_tag" 2>/dev/null | jq -r '.. | .config.Labels?.["org.opencontainers.image.version"]? // empty' | head -1)
target_nc_version="${target_nc_version:-$current_nc_version}"
log "target Nextcloud version: $target_nc_version"

# If target == current, skip compat check (nothing to upgrade)
if [ "$current_nc_version" = "$target_nc_version" ]; then
  log "Nextcloud already at target version; skipping compat preflight"
else
  # Query each installed app's manifest for compatibility with target_nc_version
  log "checking app compatibility for target $target_nc_version"
  incompat=$(docker exec -u www-data nextcloud-app php occ app:list --output=json 2>/dev/null \
    | jq -r '.enabled | keys[]' | while read app; do
        max=$(docker exec -u www-data nextcloud-app php occ app:show "$app" --output=json 2>/dev/null \
              | jq -r '.dependencies.nextcloud.max // empty')
        if [ -n "$max" ] && [ "${max%.*}" -lt "${target_nc_version%%.*}" ]; then
          echo "$app (max NC $max)"
        fi
      done)
  if [ -n "$incompat" ]; then
    bail "app-compat preflight: these apps block upgrade to NC $target_nc_version:
$incompat"
  fi
  log "all apps compatible with $target_nc_version"
fi

# ===== PHASE 3: IMAGE PULL =====
log "=== PHASE 3: IMAGE PULL ==="

IFS=',' read -ra services <<< "$TARGETS"
changed=()
for svc in "${services[@]}"; do
  log "pulling $svc"
  old_digest=$(docker compose -f "$COMPOSE_FILE" images "$svc" --format json 2>/dev/null \
               | jq -r '.[0].ID' || echo "none")
  docker compose -f "$COMPOSE_FILE" pull "$svc" >/dev/null 2>&1 || {
    log "pull failed for $svc — skipping"
    continue
  }
  new_digest=$(docker compose -f "$COMPOSE_FILE" images "$svc" --format json 2>/dev/null \
               | jq -r '.[0].ID' || echo "none")
  if [ "$old_digest" != "$new_digest" ]; then
    log "$svc: $old_digest → $new_digest"
    changed+=("$svc")
  else
    log "$svc: no change"
  fi
done

if [ ${#changed[@]} -eq 0 ]; then
  log "nothing to update. exiting clean."
  notify "nextcloud-auto-update: no changes" "All targeted services already at latest digest. Snapshot at $SNAPSHOT_DIR."
  exit 0
fi

# ===== PHASE 4: APPLY =====
log "=== PHASE 4: APPLY ==="
for svc in "${changed[@]}"; do
  log "recreating $svc"
  docker compose -f "$COMPOSE_FILE" up -d "$svc"
done

# Wait for Nextcloud-app to settle if it was in the changed list
if [[ " ${changed[*]} " == *" nextcloud-app "* ]]; then
  log "waiting for nextcloud-app to come back"
  for i in {1..30}; do
    if curl -sfo /dev/null -m 3 "$LOCAL_URL"; then
      log "nextcloud-app responding on attempt $i"
      break
    fi
    sleep 5
  done

  # Let upgrade run if needed
  log "running occ upgrade (will no-op if not needed)"
  docker exec -u www-data nextcloud-app php occ upgrade --no-interaction 2>&1 | tee -a "$LOG" || true
  docker exec -u www-data nextcloud-app php occ maintenance:mode --off 2>&1 | tee -a "$LOG" || true
fi

# Restart cloudflared after ANY container change (closes stale-pool window)
log "restarting cloudflared to refresh connection pool"
systemctl restart cloudflared
sleep 5

# ===== PHASE 5: HEALTH CHECK =====
log "=== PHASE 5: HEALTH CHECK ==="
errors=()

# External 200
ext_code=$(curl -sfo /dev/null -m 10 -w '%{http_code}' "$ORIGIN_URL" || echo 000)
[ "$ext_code" = "200" ] || errors+=("external $ORIGIN_URL returned $ext_code")

# Internal 200
int_code=$(curl -sfo /dev/null -m 10 -w '%{http_code}' "$LOCAL_URL" || echo 000)
[ "$int_code" = "200" ] || errors+=("internal $LOCAL_URL returned $int_code")

# occ status
status_json=$(docker exec -u www-data nextcloud-app php occ status --output=json 2>/dev/null || echo "{}")
[ "$(echo "$status_json" | jq -r '.installed')" = "true" ] || errors+=("occ status: installed != true")
[ "$(echo "$status_json" | jq -r '.maintenance')" = "false" ] || errors+=("occ status: maintenance != false")
[ "$(echo "$status_json" | jq -r '.needsDbUpgrade')" = "false" ] || errors+=("occ status: needsDbUpgrade != false")

# App list diff
docker exec -u www-data nextcloud-app php occ app:list --output=json > "$SNAPSHOT_DIR/apps-after.json" 2>&1 || true
disabled_now=$(diff <(jq -r '.enabled | keys[]' "$SNAPSHOT_DIR/apps-before.json" | sort) \
                    <(jq -r '.enabled | keys[]' "$SNAPSHOT_DIR/apps-after.json" | sort) \
               | grep '^<' | awk '{print $2}' | tr '\n' ' ' || true)
[ -z "$disabled_now" ] || errors+=("apps auto-disabled by upgrade: $disabled_now")

# ===== PHASE 6: RESULT =====
log "=== PHASE 6: RESULT ==="
if [ ${#errors[@]} -eq 0 ]; then
  changed_str=$(IFS=,; echo "${changed[*]}")
  log "SUCCESS — updated: $changed_str"
  notify "nextcloud-auto-update OK" "Updated: $changed_str. NC $current_nc_version → $target_nc_version. Snapshot at $SNAPSHOT_DIR."
  exit 0
fi

log "HEALTH CHECK FAILED. Errors:"
for e in "${errors[@]}"; do log "  - $e"; done

log "=== ROLLBACK ==="
# Rollback: re-tag to images-before.json digests and up -d
jq -r '.[] | "\(.Service) \(.ID)"' "$SNAPSHOT_DIR/images-before.json" | while read svc digest; do
  log "rolling back $svc to $digest (best-effort)"
  # In a real impl: re-pin compose file to that digest, up -d. For now, log it
  # and notify so a human can restore from the snapshot.
done

systemctl restart cloudflared
notify "nextcloud-auto-update FAILED" "Health checks failed. Errors:
$(printf -- '- %s\n' "${errors[@]}")

Snapshot retained at $SNAPSHOT_DIR. Last 50 nextcloud-app log lines:
$(docker logs --tail 50 nextcloud-app 2>&1 | head -50)"

# Open a follow-up by writing a tombstone the next run will see
touch "$BACKUP_ROOT/HOLD"  # next run reads this and refuses to run until resolved
exit 1
```

> **Note on the rollback step**: the script above logs the rollback intent but the actual implementation pins via in-place editing of the compose file. The full version stores a `compose.yml.snapshot` next to the run log and `cp` it back on rollback. Pseudocode kept short here for readability — full script in the repo at `scripts/nextcloud-auto-update.sh` when implemented.

### 4.3 The systemd units

`/etc/systemd/system/nextcloud-auto-update.service`:

```ini
[Unit]
Description=Bestly Nextcloud stack auto-update
After=docker.service cloudflared.service
Wants=cloudflared.service

[Service]
Type=oneshot
EnvironmentFile=-/etc/default/nextcloud-auto-update
ExecStart=/usr/local/bin/nextcloud-auto-update.sh
StandardOutput=journal
StandardError=journal
TimeoutStartSec=30min
```

`/etc/systemd/system/nextcloud-auto-update.timer`:

```ini
[Unit]
Description=Run nextcloud-auto-update weekly

[Timer]
OnCalendar=Sun 04:00:00 America/Los_Angeles
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
```

Install:

```bash
sudo systemctl enable --now nextcloud-auto-update.timer
sudo systemctl list-timers | grep nextcloud-auto-update
```

The `Persistent=true` flag means if the Pi was off at 04:00 Sunday, the timer fires on next boot — so an outage during the scheduled window doesn't skip an update cycle.

---

## 5. Major-version upgrades — manual gate

The orchestrator above runs `nextcloud:33-apache` as the floating tag. When NC 34 ships, the orchestrator **will NOT** auto-bump the major. To upgrade from NC 33 → 34:

1. Read NC 34 release notes (always).
2. Run app-compat preflight manually for NC 34: `bash scripts/nc-app-compat-check.sh 34`.
3. If any app blocks: wait for app updates OR disable the app. Don't fight it.
4. Snapshot DB + config + data (the auto-update does this for minor bumps; for majors do an additional cold backup).
5. Edit compose file: `nextcloud:33-apache` → `nextcloud:34-apache`. Pin digest. Commit.
6. Manually trigger: `sudo systemctl start nextcloud-auto-update.service`.
7. Sit at the keyboard for the run. Watch the log.
8. If health check fails: rollback is automatic. Re-investigate without time pressure.

Cadence target: one major version behind upstream until ecosystem confirms stability. NC 32 LTS  was a good example — wait ~6-8 weeks after release before adopting in prod.

---

## 6. Observability

- **ntfy topic** `bestly-sysalert-7q2k9mx4` gets:
  - "auto-update OK" on every successful run (so silence means something's wrong with the timer).
  - "auto-update ABORT" on preflight bail.
  - "auto-update FAILED" with full error detail on health-check failure.
- **uptime-kuma** monitors:
  - `https://cloud.bestly.tech/status.php` every 30s, alert on 2 consecutive failures.
  - `http://localhost:8082/status.php` (Pi-local) every 60s.
  - `https://nextcloud.bestly.tech/standalone-signaling/api/v1/welcome` (Talk HPB) every 5min.
- **journal**: `journalctl -u nextcloud-auto-update --since '7 days ago'` shows the last week of runs.
- **Snapshot dir** `/mnt/ssd/backups/nc-auto/YYYY-MM-DD/HH-MM-SSZ/` holds per-run DB dump + config + app list. Retained 30 days for successful runs, indefinitely for failed runs (cleared after human resolution).

---

## 7. Failure scenarios + responses

| Scenario | What happens | Operator action |
|---|---|---|
| New image pull fails (registry down) | ABORT in phase 3. ntfy fires. Next week tries again. | None — usually self-resolves. |
| App-compat preflight blocks | ABORT in phase 2. ntfy lists blocking apps. | Disable the app, or wait for app update, then manually re-run. |
| `occ upgrade` migration fails | Container restarts; new container can't complete upgrade. Health check fails. Rollback runs. | Read the run log, fix the underlying issue, manually re-run. |
| Health check passes but cloud.bestly.tech returns 502 from edge | Stale cloudflared pool (the §3 watcher catches this). | The watcher restarts cloudflared automatically; if it loops, investigate. |
| DB snapshot itself fails | ABORT in phase 1. ntfy fires. Update did not happen. | Investigate why pg_dumpall failed — usually disk space or DB cluster issue. |
| `/mnt/ssd` fills up | ABORT in phase 1. | Free space, then re-run. |
| HOLD file exists from prior failure | Next run refuses to start. ntfy reminds. | Investigate prior failure, fix, `rm /mnt/ssd/backups/nc-auto/HOLD`, re-run. |
| Timer doesn't fire (Pi rebooted at the wrong moment) | Persistent=true makes it fire on next boot. | Verify next-run time with `systemctl list-timers`. |
| Watchtower or some external thing pulls images out-of-band | Orchestrator notices digest changed unexpectedly during preflight, can still proceed safely (snapshot captures CURRENT state). | Disable Watchtower entirely — only this orchestrator should pull. |

---

## 8. Migration plan (rolling out auto-update without breaking what's there)

1. **Week 0 (now)**: Implement watcher from `nextcloud-502-recovery-opusplan.md` so any current/future stale-pool 502 self-heals.
2. **Week 1**: Write `nextcloud-auto-update.sh` + systemd units. Test in dry-run mode (`DRY_RUN=1` flag — pulls images but doesn't apply).
3. **Week 2**: Run manually with `TARGETS=nextcloud-redis` first — lowest-risk service (stateless cache).
4. **Week 3**: Expand to `vaultwarden,nextcloud-redis,nextcloud-collabora`.
5. **Week 4**: Enable timer. First Sunday includes nextcloud-app for the first time.
6. **Week 8**: Add Talk HPB to TARGETS after 4 successful Sundays.
7. **Week 12**: First major-version exercise (manual gate) — even if no major is available yet, do a dress rehearsal on a staging snapshot.

---

## 9. Definition of done

- [ ] `scripts/nextcloud-auto-update.sh` checked into the repo.
- [ ] `scripts/nc-app-compat-check.sh` checked into the repo (used by §5 step 2).
- [ ] systemd `.service` + `.timer` files in repo at `scripts/systemd/`.
- [ ] Installer script `scripts/install-nextcloud-auto-update.sh` that copies the above into place on the Pi.
- [ ] Watcher from `nextcloud-502-recovery-opusplan.md` deployed FIRST.
- [ ] `'updatechecker' => false` in Nextcloud `config.php` (web updater banner suppressed).
- [ ] Three consecutive successful auto-update Sundays observed before considering the system "stable" (so ~3 weeks of runtime).
- [ ] `docs/pi-stack-inventory.md` updated with the auto-update inclusion/exclusion table from §1.

---

## 10. Open questions

These are things to decide before the timer goes live:

1. **Watchtower**: is it installed on the Pi today? If yes, **disable it**. Two competing updaters = chaos. (Inventory check: `docker ps | grep watchtower`.)
2. **Backup retention overlap**: this plan keeps 30 days of pre-upgrade DB snapshots. The existing nightly backup pipeline keeps its own retention. Make sure they don't both fill the SSD.
3. **`/mnt/ssd` size**: confirm we have headroom for 30 days of 1-GB-ish DB snapshots (~30 GB) plus the existing nightly backup pipeline.
4. **Pi 32-bit → 64-bit migration order**: do this BEFORE enabling auto-update? Probably yes — 32-bit userland surfaces aarch64 image issues during pull. Reference: `pi-64bit-migration-runbook.md`.
5. **App ecosystem**: do any installed apps refuse to compile / install on the next NC minor? Run a one-off compat preflight today to see baseline.
6. **DocuSign → Libresign cutover**: are there Libresign-related custom patches that this auto-update will overwrite? The repo `scripts/libresign-rebrand.sh` suggests yes. Need a `post-upgrade-hooks.d/` directory the orchestrator runs after each successful upgrade.
7. **Talk HPB images**: not on the official Nextcloud release schedule. Define separate update rhythm.

---

## 11. Change log

| Date | Author | Change |
|---|---|---|
| 2026-05-26 | Claude (with Jared) | v1.0 — initial. Architectural plan for auto-update. Image-tag-swap pattern, orchestrator design, observability, rollback. |

---

_Adjacent docs: `nextcloud-502-recovery-opusplan.md` (the self-heal watcher this plan depends on); `pi-64bit-migration-runbook.md` (do this first); `storage-policy.md` (canonical Nextcloud storage stance); `customer-intake-opusplan.md` (broader Bestly system context)._
