#!/usr/bin/env bash
#
# migrate-pi-to-64bit.sh
#
# Remote, in-place migration of bestly-pi from 32-bit armhf userland to
# 64-bit arm64. Uses the existing NVMe (Samsung 970 EVO 1TB) — no SD swap,
# no USB stick, no physical contact required.
#
# End state:
#   /dev/nvme0n1p1   data       ext4  ~700 GB  /mnt/ssd (shrunk from 916 GB)
#   /dev/nvme0n1p2   boot       vfat   1 GB    /boot/firmware
#   /dev/nvme0n1p3   root       ext4 100 GB    /
#   SD card                                    untouched (fallback)
#
# Rollback path: bootloader BOOT_ORDER=0xf416 means NVMe→SD→USB. If NVMe
# boot fails for any reason, the Pi falls back to SD automatically and
# you're back exactly where you started. /mnt/ssd data is preserved
# regardless (the shrink only changes its boundary, not its contents).
#
# Usage:
#   bash migrate-pi-to-64bit.sh check                # pre-flight checks
#   bash migrate-pi-to-64bit.sh phase0               # EEPROM + boot-order prep (safe, no downtime)
#   bash migrate-pi-to-64bit.sh phase1-backup        # rsync state to Mac (no downtime)
#   bash migrate-pi-to-64bit.sh phase2-migrate       # THE MIGRATION (downtime starts)
#   bash migrate-pi-to-64bit.sh phase3-post-reboot   # run after reboot from new NVMe root
#
# Defaults: every destructive operation prompts for YES confirmation. Pass
# --yes to skip prompts. Pass --dry-run to print commands without running.
#
# Logs to /tmp/migrate-pi-to-64bit-YYYYmmdd-HHMMSS.log
#
# Author: Bestly LLC (with Claude). 2026-06.
# Companion docs:
#   docs/pi-64bit-migration-runbook.md
#   docs/pi-64bit-migration-execution-plan-2026-06.md

set -o errexit
set -o nounset
set -o pipefail

# ------------------------------------------------------------------ config
PI_HOST="${PI_HOST:-pi@192.168.0.211}"
SSH_OPTS="-o ConnectTimeout=10 -o ServerAliveInterval=30"

# Where Phase 1 backup lands on YOUR Mac. Override with BACKUP_DIR=...
BACKUP_DIR="${BACKUP_DIR:-$HOME/bestly-pi-backup-$(date +%Y%m%d)}"

# Partition sizes (GiB). Conservative defaults — 459 GB shrink margin.
NEW_DATA_SIZE_G="${NEW_DATA_SIZE_G:-700}"   # /mnt/ssd will be this big
NEW_BOOT_SIZE_G="${NEW_BOOT_SIZE_G:-1}"     # boot partition
NEW_ROOT_SIZE_G="${NEW_ROOT_SIZE_G:-100}"   # arm64 root

# Raspberry Pi OS Lite (arm64) image URL — Debian 13 Trixie base
PIOS_URL="${PIOS_URL:-https://downloads.raspberrypi.org/raspios_lite_arm64_latest}"

LOG="/tmp/migrate-pi-to-64bit-$(date +%Y%m%d-%H%M%S).log"
DRY_RUN=0
ASSUME_YES=0

# ------------------------------------------------------------------ helpers
log()  { echo "[$(date +%H:%M:%S)] $*" | tee -a "$LOG"; }
warn() { echo "[$(date +%H:%M:%S)] WARN: $*" | tee -a "$LOG" >&2; }
err()  { echo "[$(date +%H:%M:%S)] ERROR: $*" | tee -a "$LOG" >&2; exit 1; }

run() {
  # Run a command on the Pi via ssh, with dry-run support and logging.
  log "  pi$ $*"
  if [ "$DRY_RUN" = 1 ]; then
    log "    (dry-run, skipped)"
    return 0
  fi
  ssh $SSH_OPTS "$PI_HOST" "$@" 2>&1 | tee -a "$LOG"
}

run_sudo() {
  log "  pi# $*"
  if [ "$DRY_RUN" = 1 ]; then
    log "    (dry-run, skipped)"
    return 0
  fi
  ssh $SSH_OPTS "$PI_HOST" "sudo bash -c '$*'" 2>&1 | tee -a "$LOG"
}

run_local() {
  log "  local$ $*"
  if [ "$DRY_RUN" = 1 ]; then
    log "    (dry-run, skipped)"
    return 0
  fi
  eval "$@" 2>&1 | tee -a "$LOG"
}

confirm() {
  # Prompt the user before destructive actions. Skipped if --yes.
  local prompt="$1"
  if [ "$ASSUME_YES" = 1 ]; then
    log "  (auto-yes) $prompt"
    return 0
  fi
  echo
  echo "================================================================"
  echo "  $prompt"
  echo "================================================================"
  read -r -p "  Type YES to continue, anything else aborts: " ans
  if [ "$ans" != "YES" ]; then
    err "aborted by user"
  fi
}

# ------------------------------------------------------------------ phase: check
phase_check() {
  log "=== Pre-flight checks ==="

  log "1. SSH reachable to $PI_HOST"
  ssh $SSH_OPTS -o BatchMode=yes "$PI_HOST" "hostname && uname -m" \
    | tee -a "$LOG" \
    || err "cannot SSH to $PI_HOST"

  log "2. current arch (expect armhf userland on aarch64 kernel)"
  local arch krn
  arch=$(ssh $SSH_OPTS "$PI_HOST" "dpkg --print-architecture")
  krn=$(ssh $SSH_OPTS "$PI_HOST" "uname -m")
  log "   userland=$arch kernel=$krn"
  if [ "$arch" = "arm64" ]; then
    err "Pi already running arm64 — nothing to migrate"
  fi
  [ "$krn" = "aarch64" ] || warn "expected kernel aarch64, got $krn — proceed with caution"

  log "3. NVMe present + healthy"
  local nvme_model
  nvme_model=$(ssh $SSH_OPTS "$PI_HOST" "sudo lsblk -d -o NAME,MODEL /dev/nvme0n1 | tail -1")
  log "   $nvme_model"
  ssh $SSH_OPTS "$PI_HOST" "sudo lsblk /dev/nvme0n1" | tee -a "$LOG"

  log "4. /mnt/ssd usage vs new size"
  local used
  used=$(ssh $SSH_OPTS "$PI_HOST" "df -BG --output=used /mnt/ssd | tail -1 | tr -dc '0-9'")
  log "   used=${used} GiB, target=${NEW_DATA_SIZE_G} GiB"
  if [ "$used" -ge "$NEW_DATA_SIZE_G" ]; then
    err "/mnt/ssd is ${used} GiB used but you want to shrink to ${NEW_DATA_SIZE_G} — STOP."
  fi
  local margin=$((NEW_DATA_SIZE_G - used))
  log "   safety margin: ${margin} GiB (recommend >= 200 GiB)"
  if [ "$margin" -lt 200 ]; then
    warn "margin < 200 GiB — increase NEW_DATA_SIZE_G or free space first"
  fi

  log "5. EEPROM firmware up to date"
  ssh $SSH_OPTS "$PI_HOST" "sudo rpi-eeprom-update 2>&1 | head -5" | tee -a "$LOG"

  log "6. BOOT_ORDER (must include NVMe = 6)"
  ssh $SSH_OPTS "$PI_HOST" "sudo rpi-eeprom-config | grep BOOT_ORDER" | tee -a "$LOG"

  log "7. Image URL reachable"
  if ! curl -sI -o /dev/null -w '   %{http_code} %{size_header}\n' --max-time 10 "$PIOS_URL"; then
    warn "image URL not reachable — Phase 2 will fail until network works"
  fi

  log "8. docker container count (will be stopped during Phase 2)"
  ssh $SSH_OPTS "$PI_HOST" "sudo docker ps --format '{{.Names}}' | wc -l" | tee -a "$LOG"

  log "=== all checks passed. Read the output. Then run phase0. ==="
}

# ------------------------------------------------------------------ phase 0: EEPROM + BOOT_ORDER
phase0() {
  log "=== Phase 0: EEPROM update + BOOT_ORDER swap ==="
  log "Safe: NO data touched, NO downtime. Pi falls back to SD if NVMe boot misses."

  confirm "Update EEPROM to latest stable and set BOOT_ORDER=0xf416 (NVMe→SD→USB→repeat)?"

  log "0.1 Update EEPROM firmware"
  run_sudo "rpi-eeprom-update -a"

  log "0.2 Swap BOOT_ORDER to 0xf416 (NVMe first, SD fallback)"
  # rpi-eeprom-config --edit is interactive; use --apply with a config file instead
  run_sudo "rpi-eeprom-config --out /tmp/boot.conf"
  run_sudo "sed -i 's/^BOOT_ORDER=.*/BOOT_ORDER=0xf416/' /tmp/boot.conf"
  run_sudo "rpi-eeprom-config --apply /tmp/boot.conf"

  log "0.3 Verify"
  run_sudo "rpi-eeprom-config | grep BOOT_ORDER"

  log "0.4 Reboot to activate EEPROM changes"
  confirm "Reboot Pi now to apply EEPROM updates? (Pi will boot from SD as before — no risk yet)"
  run_sudo "shutdown -r +1 'EEPROM update'" || true
  log "Pi will reboot in ~1 min. Wait 3 min then re-SSH to confirm it came back."
  log "After reboot: run 'phase1-backup' next."
}

# ------------------------------------------------------------------ phase 1: backup
phase1_backup() {
  log "=== Phase 1: backup state to $BACKUP_DIR ==="
  mkdir -p "$BACKUP_DIR"/{scripts,etc,etc-sysctl,etc-systemd,etc-pihole,etc-dnsmasq.d,etc-nginx,etc-cloudflared,var-lib-tailscale,pg}

  log "1.1 rsync /home/pi/scripts"
  run_local "rsync -aH -e 'ssh $SSH_OPTS' \"$PI_HOST\":/home/pi/scripts/ \"$BACKUP_DIR/scripts/\""

  log "1.2 rsync /etc (the parts we'll definitely need)"
  for sub in sysctl.d/99-bestly-bbr.conf systemd/system/cake-shaper.service \
             systemd/system/cloudflared.service systemd/system/aircraft-alerts.service \
             pihole dnsmasq.d nginx cloudflared cron.d ssh; do
    run_local "rsync -aH -e 'ssh $SSH_OPTS' --ignore-missing-args \"$PI_HOST\":/etc/$sub \"$BACKUP_DIR/etc/$sub\" 2>/dev/null || true"
  done

  log "1.3 crontabs"
  run_local "ssh $SSH_OPTS \"$PI_HOST\" 'crontab -l' > \"$BACKUP_DIR/crontab-pi\" 2>/dev/null || true"
  run_local "ssh $SSH_OPTS \"$PI_HOST\" 'sudo crontab -l' > \"$BACKUP_DIR/crontab-root\" 2>/dev/null || true"

  log "1.4 tailscale state (so identity persists)"
  run_local "ssh $SSH_OPTS \"$PI_HOST\" 'sudo tar -czf - /var/lib/tailscale' > \"$BACKUP_DIR/var-lib-tailscale.tar.gz\""

  log "1.5 Postgres logical dump (Talk Transcripts settings + everything)"
  run_local "ssh $SSH_OPTS \"$PI_HOST\" 'sudo docker exec nextcloud-db pg_dumpall -U nextcloud' | gzip > \"$BACKUP_DIR/pg-dumpall.sql.gz\""

  log "1.6 manifest"
  run_local "du -sh \"$BACKUP_DIR\"/* | tee \"$BACKUP_DIR/manifest.txt\""

  log "=== Phase 1 done. Backup at: $BACKUP_DIR ==="
  log "Next: phase2-migrate (DOWNTIME starts when you run it)"
}

# ------------------------------------------------------------------ phase 2: migrate
phase2_migrate() {
  log "=== Phase 2: THE MIGRATION (downtime starts here) ==="
  confirm "This will: stop all services, shrink /mnt/ssd from 916G→${NEW_DATA_SIZE_G}G, create new boot+root partitions on NVMe, install 64-bit OS, reboot. Expected downtime ~60 min. CONTINUE?"

  log "2.1 Stop all services that use /mnt/ssd"
  run_sudo "systemctl stop docker containerd cloudflared cake-shaper nginx 2>/dev/null || true"
  run_sudo "systemctl stop pihole-FTL 2>/dev/null || true"

  log "2.2 Verify nothing holds /mnt/ssd open"
  run_sudo "lsof +D /mnt/ssd 2>/dev/null || true"

  log "2.3 Unmount NVMe-backed paths"
  run_sudo "umount /var/lib/docker /var/lib/containerd /mnt/ssd"

  log "2.4 Filesystem check (mandatory before shrink)"
  run_sudo "e2fsck -fy /dev/nvme0n1p1"

  confirm "fsck done. About to shrink ext4 filesystem to ${NEW_DATA_SIZE_G}G. THIS IS THE DANGEROUS STEP. CONTINUE?"

  log "2.5 Shrink filesystem"
  run_sudo "resize2fs /dev/nvme0n1p1 ${NEW_DATA_SIZE_G}G"

  log "2.6 Shrink partition table to match"
  local new_part_end_mib=$((NEW_DATA_SIZE_G * 1024))
  run_sudo "parted /dev/nvme0n1 --script resizepart 1 ${new_part_end_mib}MiB"

  log "2.7 Create new boot + root partitions"
  local boot_start=$((NEW_DATA_SIZE_G * 1024))
  local boot_end=$((boot_start + NEW_BOOT_SIZE_G * 1024))
  local root_end=$((boot_end + NEW_ROOT_SIZE_G * 1024))
  run_sudo "parted /dev/nvme0n1 --script mkpart bootfs fat32 ${boot_start}MiB ${boot_end}MiB"
  run_sudo "parted /dev/nvme0n1 --script set 2 esp on"
  run_sudo "parted /dev/nvme0n1 --script mkpart rootfs ext4 ${boot_end}MiB ${root_end}MiB"
  run_sudo "partprobe /dev/nvme0n1"

  log "2.8 Format new partitions"
  run_sudo "mkfs.vfat -F 32 -n bootfs /dev/nvme0n1p2"
  run_sudo "mkfs.ext4 -L rootfs /dev/nvme0n1p3"

  log "2.9 Download 64-bit Raspberry Pi OS Lite image"
  run_sudo "cd /tmp && curl -L --max-time 600 -o pios.img.xz '$PIOS_URL' && xz -d pios.img.xz"

  log "2.10 Loop-mount image + copy to NVMe"
  run_sudo "losetup -fP /tmp/pios.img"
  run_sudo "LOOP=\$(losetup -j /tmp/pios.img | head -1 | cut -d: -f1) && \
    mkdir -p /mnt/imgboot /mnt/imgroot /mnt/newboot /mnt/newroot && \
    mount \${LOOP}p1 /mnt/imgboot && \
    mount \${LOOP}p2 /mnt/imgroot && \
    mount /dev/nvme0n1p2 /mnt/newboot && \
    mount /dev/nvme0n1p3 /mnt/newroot && \
    rsync -aH /mnt/imgboot/ /mnt/newboot/ && \
    rsync -aH /mnt/imgroot/ /mnt/newroot/"

  log "2.11 Rewrite fstab + cmdline.txt on the new system"
  run_sudo "BOOT_UUID=\$(blkid -s UUID -o value /dev/nvme0n1p2) && \
    ROOT_UUID=\$(blkid -s UUID -o value /dev/nvme0n1p3) && \
    DATA_UUID=\$(blkid -s UUID -o value /dev/nvme0n1p1) && \
    echo \"UUID=\$ROOT_UUID  /                  ext4  defaults,noatime  0  1\" >  /mnt/newroot/etc/fstab && \
    echo \"UUID=\$BOOT_UUID  /boot/firmware     vfat  defaults          0  2\" >> /mnt/newroot/etc/fstab && \
    echo \"UUID=\$DATA_UUID  /mnt/ssd           ext4  defaults,noatime,nofail  0  2\" >> /mnt/newroot/etc/fstab && \
    sed -i \"s|root=PARTUUID=[^ ]*|root=UUID=\$ROOT_UUID|\" /mnt/newboot/cmdline.txt && \
    sed -i \"s| init=/usr/lib/raspberrypi-sys-mods/firstboot||g\" /mnt/newboot/cmdline.txt"

  log "2.12 Bake your SSH key into new system + enable SSH"
  run_sudo "mkdir -p /mnt/newroot/home/pi/.ssh && \
    cp /home/pi/.ssh/authorized_keys /mnt/newroot/home/pi/.ssh/ && \
    chmod 700 /mnt/newroot/home/pi/.ssh && chmod 600 /mnt/newroot/home/pi/.ssh/authorized_keys && \
    chown -R 1000:1000 /mnt/newroot/home/pi/.ssh && \
    touch /mnt/newboot/ssh && \
    mkdir -p /mnt/newroot/etc/sudoers.d && \
    echo 'pi ALL=(ALL) NOPASSWD: ALL' > /mnt/newroot/etc/sudoers.d/010_pi-nopasswd && \
    chmod 440 /mnt/newroot/etc/sudoers.d/010_pi-nopasswd"

  log "2.13 Pre-stage hostname + network so it comes back at 192.168.0.211"
  run_sudo "echo 'bestly-pi' > /mnt/newroot/etc/hostname && \
    echo '127.0.1.1  bestly-pi' >> /mnt/newroot/etc/hosts"

  log "2.14 Cleanup mounts"
  run_sudo "umount /mnt/newboot /mnt/newroot /mnt/imgboot /mnt/imgroot && \
    LOOP=\$(losetup -j /tmp/pios.img | head -1 | cut -d: -f1) && losetup -d \$LOOP"

  log "2.15 sync filesystems"
  run_sudo "sync; sync; sync"

  confirm "Migration complete. Ready to reboot? After reboot, Pi will boot from NVMe (arm64). If it fails, EEPROM auto-falls back to SD."
  run_sudo "shutdown -r +1 '64-bit migration reboot'" || true

  log "=== Pi rebooting. Wait ~3 min then SSH back in. ==="
  log "Verify with: ssh $PI_HOST 'uname -m && dpkg --print-architecture && getconf LONG_BIT'"
  log "Expect: aarch64 / arm64 / 64"
  log "If nothing answers after 5 min: bootloader fell back to SD — Pi is reachable as before, debug NVMe boot."
  log ""
  log "Then run: phase3-post-reboot"
}

# ------------------------------------------------------------------ phase 3: post-reboot
phase3_post_reboot() {
  log "=== Phase 3: install Docker + restore configs + bring stack back ==="

  log "3.1 confirm we're on 64-bit"
  local arch
  arch=$(ssh $SSH_OPTS "$PI_HOST" "dpkg --print-architecture")
  [ "$arch" = "arm64" ] || err "Pi is $arch, not arm64. Cannot proceed — check NVMe boot succeeded."

  log "3.2 Install Docker (Debian arm64 official)"
  run_sudo "apt-get update && apt-get install -y ca-certificates curl gnupg && \
    install -m 0755 -d /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg && \
    chmod a+r /etc/apt/keyrings/docker.gpg && \
    echo 'deb [arch=arm64 signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian trixie stable' > /etc/apt/sources.list.d/docker.list && \
    apt-get update && \
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin"

  log "3.3 Re-bind /var/lib/docker and /var/lib/containerd to /mnt/ssd"
  run_sudo "systemctl stop docker containerd && \
    rmdir /var/lib/docker /var/lib/containerd 2>/dev/null || (mv /var/lib/docker /var/lib/docker.fresh && mv /var/lib/containerd /var/lib/containerd.fresh) && \
    mkdir -p /var/lib/docker /var/lib/containerd && \
    echo '/mnt/ssd/docker  /var/lib/docker       none  bind  0  0' >> /etc/fstab && \
    echo '/mnt/ssd/containerd  /var/lib/containerd  none  bind  0  0' >> /etc/fstab && \
    mount /var/lib/docker && mount /var/lib/containerd && \
    systemctl start containerd docker"

  log "3.4 Restore /etc bits from backup"
  log "    (run these from your Mac:)"
  log "    rsync -aH \"$BACKUP_DIR/etc/sysctl.d/99-bestly-bbr.conf\" $PI_HOST:/tmp/"
  log "    rsync -aH \"$BACKUP_DIR/etc/systemd/system/cake-shaper.service\" $PI_HOST:/tmp/"
  log "    rsync -aH \"$BACKUP_DIR/etc/cloudflared/\" $PI_HOST:/tmp/cloudflared/"
  log "    rsync -aH \"$BACKUP_DIR/etc/pihole/\" $PI_HOST:/tmp/pihole/"
  log "    rsync -aH \"$BACKUP_DIR/scripts/\" $PI_HOST:/home/pi/scripts/"
  log "    Then on Pi: sudo mv /tmp/{bbr.conf,cake-shaper.service,...} to their /etc/ locations"

  log "3.5 Install Tailscale + restore identity"
  run_sudo "curl -fsSL https://tailscale.com/install.sh | sh"
  log "    From Mac: rsync \"$BACKUP_DIR/var-lib-tailscale.tar.gz\" $PI_HOST:/tmp/"
  log "    Then on Pi: sudo systemctl stop tailscaled && sudo tar -xzf /tmp/var-lib-tailscale.tar.gz -C / && sudo systemctl start tailscaled"

  log "3.6 Restore crontabs"
  log "    From Mac: rsync \"$BACKUP_DIR/crontab-pi\" $PI_HOST:/tmp/"
  log "    Then on Pi: crontab /tmp/crontab-pi  (as user pi, not sudo)"

  log "3.7 Bring containers back"
  log "    cd /mnt/ssd/apps/nextcloud && docker compose up -d"
  log "    cd /mnt/ssd/apps/talk-hpb && docker compose up -d"
  log "    docker start ollama vaultwarden uptime-kuma open-webui homeassistant n8n"

  log "3.8 Install + wire faster-whisper-server (now that arm64 works)"
  log "    docker run -d --name whisper --restart unless-stopped -p 8001:8000 \\"
  log "      -v /mnt/ssd/apps/whisper/cache:/root/.cache/huggingface \\"
  log "      -e WHISPER__MODEL=Systran/faster-distil-whisper-small.en \\"
  log "      fedirz/faster-whisper-server:latest-cpu"
  log "    Then via occ: config:app:set talk_transcripts whisper_endpoint http://172.17.0.1:8001/v1/audio/transcriptions"

  log "=== Done. Verify everything via runbook §5. ==="
}

# ------------------------------------------------------------------ argv
phase="${1:-}"
shift || true

while [ "${1:-}" != "" ]; do
  case "$1" in
    --yes) ASSUME_YES=1 ;;
    --dry-run) DRY_RUN=1 ;;
    *) err "unknown flag: $1" ;;
  esac
  shift
done

case "$phase" in
  check)              phase_check ;;
  phase0)             phase0 ;;
  phase1-backup)      phase1_backup ;;
  phase2-migrate)     phase2_migrate ;;
  phase3-post-reboot) phase3_post_reboot ;;
  "")
    cat <<USAGE
Pi 32→64-bit migration. Run phases in order.

  check               pre-flight checks (read-only, no risk)
  phase0              EEPROM update + BOOT_ORDER swap (safe, ~5 min downtime for reboot)
  phase1-backup       rsync state to your Mac (no downtime)
  phase2-migrate      THE MIGRATION (~60 min downtime starts here)
  phase3-post-reboot  after Pi reboots into arm64, install Docker + restore configs

Flags:
  --yes      skip confirmation prompts (NOT recommended)
  --dry-run  print commands without running them

Env vars:
  PI_HOST            ssh target (default: pi@192.168.0.211)
  BACKUP_DIR         where to put Phase 1 backup (default: ~/bestly-pi-backup-YYYYMMDD)
  NEW_DATA_SIZE_G    shrink /mnt/ssd to this many GiB (default: 700)
  NEW_BOOT_SIZE_G    new boot partition size (default: 1)
  NEW_ROOT_SIZE_G    new root partition size (default: 100)

Log file: /tmp/migrate-pi-to-64bit-YYYYmmdd-HHMMSS.log

Companion docs:
  docs/pi-64bit-migration-runbook.md
  docs/pi-64bit-migration-execution-plan-2026-06.md
USAGE
    exit 0
    ;;
  *) err "unknown phase: $phase" ;;
esac
