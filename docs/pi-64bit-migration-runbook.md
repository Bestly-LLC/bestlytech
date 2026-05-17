# Pi 64-bit migration runbook

**Target:** swap the `bestly-pi` userland from 32-bit Raspbian (`armhf`) to 64-bit Raspberry Pi OS (`arm64`), preserving every container, every byte of customer data, and Nextcloud Files / Postgres / Vaultwarden / Talk HPB / Ollama / Home Assistant in place.

**Why we're doing this.** The Pi's kernel is already `aarch64`, but the userland is `armhf`. Every container we run is `arm64` (postgres:16-alpine, nextcloud:apache, etc.) — they work because the kernel can run 64-bit ELF — but anything we install on the *host* via apt is 32-bit. That mismatch is the root cause of three ongoing patches in `bestly-bootstrap.sh`:

1. `openjdk-21-jre-headless` apt install — Libresign's pinned JDK is `aarch64`, can't run on `armhf` userland, so we route around it with the system package.
2. `SerialNumberService.php` patch — the `9223372036854775807` constant overflows 32-bit `PHP_INT_MAX`; we sed it to use `PHP_INT_MAX` directly.
3. `ConfigureCheckService.php` patch — Libresign's hash check expects the exact aarch64 JDK that won't run here; we python-patch the verifier to accept any Java 21+.

After this migration: **all three patches go away.** The bootstrap script gets ~70 lines shorter, future Libresign upgrades stop breaking, and we no longer have to worry about the AppleDouble / `_*` files family of cross-arch reflection bugs.

**Customer impact.** 30–60 minutes of `cloud.bestly.tech` downtime, scheduled. Everything comes back exactly as it was — same UUIDs, same data, same TLS certs, same Talk rooms, same vaultwarden vaults.

**Rollback.** Two independent paths: (a) the full SSD image we take in Step 1 (instant boot back to old state), or (b) the cold spare SD card with a known-good 32-bit image (slower, but works if the SSD itself died).

---

## Pre-flight (do this the day before)

### 1. Confirm current state

```bash
ssh pi@bestly-pi
uname -a                          # expect: Linux ... 6.x ... aarch64
dpkg --print-architecture         # expect: armhf  (← the thing we're fixing)
dpkg --print-foreign-architectures # expect: arm64
getconf LONG_BIT                  # expect: 32     (← also the thing we're fixing)
cat /etc/os-release | head -3     # expect: Raspbian GNU/Linux 13 (trixie)
df -h /mnt/ssd                    # confirm: still have plenty of free space
free -m                           # confirm: 16 GB RAM, swap available
```

You should see `armhf` + `32` + `aarch64` kernel. That's the mismatched state we're leaving.

### 2. Inventory what's running

```bash
sudo docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'
```

Expected (as of 2026-05-17 — keep this list current in `docs/pi-stack-inventory.md` if anything's added):

| Container | Image | Purpose |
|---|---|---|
| nextcloud-app | nextcloud:apache | Nextcloud frontend |
| nextcloud-cron | nextcloud:apache | Cron worker |
| nextcloud-notify-push | nextcloud:apache | Push notifications |
| nextcloud-db | postgres:16-alpine | Nextcloud DB |
| nextcloud-redis | redis:7-alpine | Nextcloud cache |
| nextcloud-collabora | collabora/code:latest | Office editing |
| talk-hpb-signaling-1 | talk-hpb-signaling | Video signaling |
| talk-hpb-nats-1 | nats:2.10-alpine | Talk message bus |
| vaultwarden | vaultwarden/server:latest | Team passwords |
| uptime-kuma | louislam/uptime-kuma:1 | Uptime dashboard |
| ollama | ollama/ollama | Local LLM runtime |
| open-webui | ghcr.io/open-webui/open-webui:main | LLM UI |
| homeassistant | ghcr.io/home-assistant/home-assistant:stable | Home automation |
| nomad_kiwix_server | ghcr.io/kiwix/kiwix-serve:latest | Offline wiki |
| nomad_dozzle | amir20/dozzle:latest | Container logs UI |
| nomad_kolibri | treehouses/kolibri:0.12.8 | Offline learning |
| nomad_redis | redis | Nomad cache |
| nomad_cyberchef | (custom) | Crypto tooling |

### 3. Prep the spare hardware

You'll need:

- **A spare microSD card** (32 GB minimum, 64 GB ideal). This will hold the fresh 64-bit Raspberry Pi OS Lite (arm64) and become the new boot device.
- **An external USB-SSD or USB-stick** (≥ 200 GB free) for the full `/mnt/ssd` backup. We're at 145 GB used so 200 GB headroom is comfortable.
- **A Mac or laptop** with [Raspberry Pi Imager](https://www.raspberrypi.com/software/) installed.

Image the spare SD card from your laptop (NOT the Pi):

1. Open Raspberry Pi Imager.
2. Device: **Raspberry Pi 4**.
3. OS: **Raspberry Pi OS (other) → Raspberry Pi OS Lite (64-bit)** — Debian 13 Trixie base.
4. Storage: the spare SD card.
5. Click the gear/⚙ → set:
   - hostname `bestly-pi` (same as current — easier reuse)
   - enable SSH with the **same authorized public key** you use today (paste from `~/.ssh/authorized_keys` on the current Pi)
   - user `pi` with a *temporary* password (you'll rotate it on first boot)
   - WiFi off — wired only
   - locale `America/Detroit` (match current)
6. Write. Eject. Set aside in a labelled bag: `Bestly Pi — 64-bit fresh, $(date)`.

**Do not put this card in the Pi yet.** It's an emergency-rollback card if the in-place migration fails.

### 4. Schedule the downtime

```text
Subject: cloud.bestly.tech scheduled maintenance — 30–60 min
When:    <pick a Sunday morning 7–9 AM ET>
Why:     Operating system upgrade (no feature changes, no data changes).
What you'll notice: cloud.bestly.tech, Talk, Vaultwarden, files unreachable.
What stays: every file, every chat, every password, every calendar event.
```

Send via Bestly Talk to the Bestly LLC team room + email any external Talk users.

---

## Migration day — Step 1 of 5: full backup

### 1.1 Pause every container

```bash
ssh pi@bestly-pi
sudo docker compose --project-directory /mnt/ssd/project-nomad down  # if project-nomad uses compose
sudo docker stop $(sudo docker ps -q)                                  # everything else
sudo docker ps                                                         # confirm: empty
```

Containers must be stopped to get a consistent Postgres + filesystem snapshot. Live containers + rsync = corrupt DB.

### 1.2 Mount the external USB-SSD

Plug in the external USB. Find it:

```bash
lsblk
# Look for a new sdX device with a partition, e.g. /dev/sda1
sudo mkdir -p /mnt/backup
sudo mount /dev/sda1 /mnt/backup
df -h /mnt/backup    # confirm: ≥ 200 GB free
```

### 1.3 Snapshot `/mnt/ssd` whole

```bash
DATE=$(date +%Y%m%d-%H%M)
sudo mkdir -p /mnt/backup/pre-64bit-$DATE
sudo rsync -aHAXv --info=progress2 --numeric-ids \
  /mnt/ssd/ /mnt/backup/pre-64bit-$DATE/ssd/
```

`-aHAX` preserves perms, hardlinks, ACLs, xattrs. `--numeric-ids` keeps UID/GID intact across the userland switch. **This is the rollback.** Expect 30–45 min for 145 GB on USB 3.

### 1.4 Also snapshot the boot partition + SD card root

```bash
# Boot config
sudo cp -a /boot /mnt/backup/pre-64bit-$DATE/boot
# Root /etc (network, ssh, systemd units, user accounts)
sudo rsync -aHAX --numeric-ids /etc/ /mnt/backup/pre-64bit-$DATE/etc/
# Crontabs
sudo cp -a /var/spool/cron /mnt/backup/pre-64bit-$DATE/cron 2>/dev/null || true
# Docker config (daemon.json, registry creds)
sudo cp -a /etc/docker /mnt/backup/pre-64bit-$DATE/etc-docker 2>/dev/null || true
# List of currently-installed apt packages — for re-install reference later
dpkg --get-selections > /tmp/dpkg-selections.txt
sudo cp /tmp/dpkg-selections.txt /mnt/backup/pre-64bit-$DATE/
# List of docker images — for re-pull reference later
sudo docker image ls --format '{{.Repository}}:{{.Tag}}' > /tmp/docker-images.txt
sudo cp /tmp/docker-images.txt /mnt/backup/pre-64bit-$DATE/
```

### 1.5 Take a logical Postgres dump too (belt + suspenders)

The rsync of `/mnt/ssd/apps/nextcloud/db` IS the postgres data dir, so a clean shutdown + rsync is correct. But a logical `pg_dumpall` gives us a portable restore path if the on-disk format ever bites us.

```bash
# Start ONLY postgres temporarily
sudo docker start nextcloud-db
sleep 5
sudo docker exec -u postgres nextcloud-db pg_dumpall > /tmp/nextcloud-pgdump.sql
sudo gzip -9 /tmp/nextcloud-pgdump.sql
sudo mv /tmp/nextcloud-pgdump.sql.gz /mnt/backup/pre-64bit-$DATE/
sudo docker stop nextcloud-db
```

### 1.6 Verify the backup is real

```bash
sudo du -sh /mnt/backup/pre-64bit-$DATE/*
# Expect: ssd/ ~145 GB; pgdump ~150-500 MB; everything else tiny
sudo sha256sum /mnt/backup/pre-64bit-$DATE/nextcloud-pgdump.sql.gz
ls -la /mnt/backup/pre-64bit-$DATE/etc/ssh/ssh_host_*  # must exist
```

Sync to a third location for paranoia (optional but recommended):

```bash
# To another bestly server, S3, or just your laptop:
rsync -aHAX --numeric-ids /mnt/backup/pre-64bit-$DATE/ jared@laptop:~/bestly-pi-backup-$DATE/
```

**Do not proceed past this step until Step 1.6 verifies clean.**

---

## Step 2 of 5: do the migration

There are two paths. Pick one, not both.

### Path A (recommended — in-place, ~30 min downtime)

Use the official `rpi-update`-adjacent path. Raspberry Pi OS supports in-place upgrade by switching the apt repos and forcing the arm64 package set. This is the fast, low-risk path because the SD card never leaves the slot.

```bash
# 2A.1 — Enable arm64 as the primary arch
sudo dpkg --add-architecture arm64
sudo apt-get update

# 2A.2 — Switch the Raspbian apt sources to point at the arm64 archive
sudo sed -i 's|^deb |deb [arch=arm64] |' /etc/apt/sources.list /etc/apt/sources.list.d/*.list

# 2A.3 — Install the arm64 kernel + base image first (the kernel was already
# aarch64 but we want the matching userland kernel package)
sudo apt-get install -y --no-install-recommends \
  libc6:arm64 libc-bin:arm64 \
  raspberrypi-kernel:arm64 raspberrypi-bootloader:arm64

# 2A.4 — Pre-stage every essential package as arm64 (downloads only, doesn't
# remove armhf yet — this keeps the system bootable if power dies mid-step)
sudo apt-get install -y --no-install-recommends --download-only \
  $(dpkg --get-selections | awk '$2=="install"{print $1":arm64"}')

# 2A.5 — Now do the actual cross-grade. apt will pull arm64 versions and
# remove armhf duplicates atomically per package.
sudo apt-get install -y --no-install-recommends \
  $(dpkg --get-selections | awk '$2=="install" && !/i386|armhf/{print $1":arm64"}')

# 2A.6 — Remove leftover armhf packages now that arm64 equivalents exist
sudo apt-get autoremove --purge -y
sudo dpkg --remove-architecture armhf

# 2A.7 — Reboot
sudo reboot
```

After reboot:

```bash
ssh pi@bestly-pi
dpkg --print-architecture       # MUST be: arm64
getconf LONG_BIT                # MUST be: 64
uname -m                        # arch64
sudo docker version             # confirm docker still works
```

If any of those don't show `arm64` / `64` — **stop here, jump to rollback** (Step 5).

### Path B (cold-swap — slower, safer for first-time migrations)

If you don't trust the in-place crossgrade (this codebase has been on the same SD card for 18+ months — fair concern), do a fresh install on the spare SD card and reuse `/mnt/ssd`.

```bash
# 2B.1 — Power down cleanly
sudo shutdown -h now

# 2B.2 — Physically swap the SD card for the prepared 64-bit one from
#       pre-flight Step 3. Leave the SSD on /dev/nvme0n1 alone.

# 2B.3 — Power on. First boot will resize the rootfs and reboot.

# 2B.4 — SSH in (same hostname, same key)
ssh pi@bestly-pi

# 2B.5 — Confirm 64-bit
dpkg --print-architecture && getconf LONG_BIT   # arm64 / 64

# 2B.6 — Install docker (matches existing setup)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker pi
newgrp docker

# 2B.7 — Restore /etc bits that mattered
sudo rsync -aHAX --numeric-ids \
  /mnt/backup/pre-64bit-$DATE/etc/docker/ /etc/docker/
sudo systemctl restart docker

# 2B.8 — Re-create the /mnt/ssd auto-mount
sudo blkid                                       # find UUID of nvme0n1p1
echo "UUID=<paste> /mnt/ssd ext4 defaults,noatime 0 2" | sudo tee -a /etc/fstab
sudo mkdir -p /mnt/ssd && sudo mount -a
df -h /mnt/ssd                                   # confirm: 916G mounted

# 2B.9 — Install other essentials (Tailscale, occ helper, etc.)
sudo apt-get update
sudo apt-get install -y --no-install-recommends \
  rsync curl jq python3 python3-pip git tailscale htop
sudo tailscale up --authkey <from your Tailscale admin console>
```

---

## Step 3 of 5: bring the stack back up

Same on both paths.

### 3.1 Re-pull every image (they're all `arm64` anyway, but tags may have moved)

```bash
xargs -L1 sudo docker pull < /mnt/backup/pre-64bit-$DATE/docker-images.txt
```

### 3.2 Start the containers in dependency order

```bash
# DB first
sudo docker start nextcloud-db nextcloud-redis
sleep 10
sudo docker logs nextcloud-db --tail 5    # expect: "database system is ready"

# Nextcloud + workers
sudo docker start nextcloud-app nextcloud-cron nextcloud-notify-push
sudo docker start nextcloud-collabora

# Talk HPB
sudo docker start talk-hpb-nats-1
sleep 5
sudo docker start talk-hpb-signaling-1

# Everything else
sudo docker start vaultwarden uptime-kuma ollama open-webui homeassistant
sudo docker start nomad_kiwix_server nomad_dozzle nomad_kolibri nomad_redis nomad_cyberchef
```

### 3.3 Wait for Nextcloud to finish whatever upgrade it wants to do

```bash
sudo docker logs nextcloud-app -f
# Look for: "Nextcloud is now installed/upgraded" or the apache start line.
# Ctrl-C when stable.
```

---

## Step 4 of 5: remove the three patches

Now that we're on `arm64`, the workarounds in `bestly-bootstrap.sh` are not just unnecessary — they're potentially harmful (they patch the *actual* binaries in custom_apps/libresign on every container start). Delete them.

### 4.1 Edit the bootstrap script

```bash
sudo nano /mnt/ssd/apps/nextcloud/custom-config/bestly-bootstrap.sh
```

Remove these blocks (they're all clearly labelled with the comments `# ── 1.`, `# ── 2.`, `# ── 3.`):

- **Block 1**: the `apt-get install openjdk-21-jre-headless` section. *Why it's safe to remove:* on arm64, Libresign's pinned `aarch64` JDK now matches the host arch and installs cleanly via the in-app installer.
- **Block 2**: the `SerialNumberService.php` sed patch. *Why it's safe to remove:* `PHP_INT_MAX` is now `9223372036854775807` natively (64-bit ints) — the original constant doesn't overflow.
- **Block 3**: the `ConfigureCheckService.php` python patch. *Why it's safe to remove:* the hash check now succeeds against the matching aarch64 binaries.

Keep:
- **Block 4** (UI rebrand — logo + "using Bestly Cloud" string)
- **Bestly Multi-AI self-heal** at the bottom (separate concern, still needed)

After editing, the bootstrap should be ~60 lines instead of ~130.

### 4.2 Re-run Libresign's own installer to get the real JDK

```bash
sudo docker exec -u www-data nextcloud-app bash -c \
  'cd /var/www/html && php occ libresign:install --java && \
   php occ libresign:install --pdftk && \
   php occ libresign:install --jsignpdf'
```

This downloads the proper `aarch64` JDK into `data/appdata_*/libresign/java/` and registers it. The `bestly-bootstrap.sh` `config:app:set libresign java_path` line can also be removed now.

### 4.3 Restart the container to confirm clean boot

```bash
sudo docker restart nextcloud-app
sudo docker logs nextcloud-app --tail 50 | grep -i 'bestly-bootstrap\|libresign\|error'
```

Expected: no `WARNING`, no `patching SerialNumberService`, no `patching ConfigureCheckService`. Just the rebrand line and the multi-AI line.

---

## Step 5 of 5: validate end-to-end

Walk through every customer-visible surface. Do this *yourself*, before declaring done.

| Check | How | Pass criteria |
|---|---|---|
| cloud.bestly.tech loads | https://cloud.bestly.tech in browser | Nextcloud login page, no TLS warning |
| Login works | Sign in as `jared` | Lands on Files |
| Files render | Open `/Bestly/Clouds/` | Folder tree visible, thumbnails generated |
| Talk works | Open a Talk room, start a call | Video + audio both directions |
| Mail works | Open Mail app | Inbox refreshes |
| Calendar works | Open Calendar | Events show, can create new event |
| Libresign works | Open Libresign, create test envelope | PDF preview generates, no Java error |
| Vaultwarden | vault.bestly.tech (or whatever route) | Vaults unlock |
| Multi-AI Assistant | Open Assistant chat | Model picker shows, send msg, get response |
| Backups still run | `crontab -l -u root` | Lines still present |
| Uptime Kuma | uptime.bestly.tech | All monitors green |
| Home Assistant | ha.bestly.tech / Home app | Devices online |
| Customer status pages | open a recent `/intake/<token>` URL | Page renders, auto-refresh works |

If anything fails: **don't try to fix it forward.** Roll back per Step 5b. Diagnose calmly later from the backup.

### 5a. Smoke-test from the bestlytech monitoring

```bash
# Run from your laptop, not the Pi
curl -fsS https://cloud.bestly.tech/status.php | jq
# Expect: "installed":true, "maintenance":false, plus versionstring
```

### 5b. Rollback procedure (only if validation fails)

**If you took Path A (in-place):**

```bash
# Boot from the cold-spare SD card (the one labelled "Bestly Pi — 64-bit fresh")
# Then restore from /mnt/backup/pre-64bit-$DATE/ssd → /mnt/ssd
# Then swap back the original SD card (the upgrade is reversible only via SD swap
# — that's why we keep the cold spare AND the SSD-resident rsync backup)

# Power down
sudo shutdown -h now
# Physically swap to the cold-spare SD card
# Power on
# SSH in, restore /mnt/ssd from /mnt/backup:
ssh pi@bestly-pi
DATE=<paste from your earlier export>
sudo rsync -aHAX --delete --numeric-ids \
  /mnt/backup/pre-64bit-$DATE/ssd/ /mnt/ssd/
# Re-run Step 3 to start containers
```

**If you took Path B (cold-swap):**

```bash
# Power down. Put the original (32-bit) SD card back. Power on. You're back
# exactly where you started — /mnt/ssd was never touched.
```

---

## Post-migration cleanup (within the week)

1. Update `bestly-bootstrap.sh` in this repo if we keep a tracked copy (`docs/bestly-bootstrap.sh.tracked`?). The live version on the Pi is the source of truth, but we should commit the simplified post-migration version somewhere.
2. Open a follow-up to retire `bestly-multi-ai/scripts/bootstrap-snippet.sh` if its self-heal logic is now redundant with the in-bootstrap version.
3. Re-run the Libresign smoke test (`docs/libresign-handoff.md` Step 7) to confirm everything signs properly without the patches.
4. Take a fresh full backup (`sudo rsync -aHAX /mnt/ssd /mnt/backup/post-64bit-$(date +%Y%m%d)/ssd`) and label it as the new baseline.
5. Schedule a recurring monthly `sudo apt-get update && sudo apt-get -y upgrade && sudo reboot` window now that we're on a long-supported arch.
6. Mark the rollback SD card "stale — pre-64bit baseline" and store it in the safe, not the desk.

---

## Time budget

| Phase | Time |
|---|---|
| Pre-flight (the day before) | 30 min |
| Step 1 — backup + verify | 45 min (mostly rsync) |
| Step 2 — migration | 20–30 min (Path A) or 15 min (Path B) |
| Step 3 — bring stack back | 10 min |
| Step 4 — remove patches | 10 min |
| Step 5 — validation | 15 min |
| **Total downtime window** | **~60 min** (steps 2–5) |
| **Total operator time** | **~2.5 hours** including pre-flight |

---

## What removing these patches buys us, long-term

- `bestly-bootstrap.sh` shrinks from 130 lines to ~60.
- Libresign upstream upgrades stop breaking us — every release ships an arm64 JDK we can use unmodified.
- The AppleDouble (`._*`) family of bugs goes away: those are caused by macOS bsdtar emitting xattrs that confuse the 32-bit PHP reflection cache. On a 64-bit native userland those files still get extracted, but the reflection cache no longer crashes — the bsdtar workaround in `bestly-multi-ai/scripts/install-on-cloud.sh` (`COPYFILE_DISABLE=1` + `xattr -c`) can stay as belt-and-suspenders but stops being load-bearing.
- Container startup gets ~20s faster because the bootstrap stops doing apt-get update + python patches every boot.
- Adding a second Pi (e.g. for replication when we go from ≤50 users to ≤100) becomes trivial — we image one card and they match.
- Performance: 64-bit ARM can address registers fully, which on PHP/Postgres workloads is a measurable (~10–15%) throughput win on the same silicon.

---

## Cross-references

- `docs/storage-policy.md` — what lives on `/mnt/ssd` and why
- `docs/libresign-handoff.md` — Libresign install + smoke test
- `docs/blackhole-minutes-setup.md` — recording pipeline (unaffected)
- `docs/customer-intake-opusplan.md` — sales funnel (unaffected)
- `/Users/jared/Developer/bestly-multi-ai/scripts/bootstrap-snippet.sh` — Multi-AI self-heal (unaffected, stays in)
- `/mnt/ssd/apps/nextcloud/custom-config/bestly-bootstrap.sh` — the file we're trimming in Step 4
