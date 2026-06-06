# Pi 64-bit migration — execution plan (June 2026)

**Companion to** `docs/pi-64bit-migration-runbook.md` (the 479-line mechanics doc). This is the **schedule + go/no-go gates + delta from current state**.

## TL;DR

The Pi 5's architecture makes this much easier than expected:
- **SD card** (58 GB) holds only the OS — 17 GB used, mostly disposable.
- **NVMe** (1 TB, `/mnt/ssd`) holds 100% of state: all 20+ docker containers' data, Nextcloud Files, Postgres, Ollama models (incl. our new gemma3:12b 8 GB), `/var/lib/docker`, `/var/lib/containerd`.

**Translation**: pop the SD, flash a 64-bit OS to a new one, boot, re-install Docker (auto-finds the NVMe data), `docker compose up -d`, done.

**Path B (cold-swap) is the right pick.** Path A (in-place apt cross-grade) is documented but riskier — multi-arch on Raspbian has corner cases (especially with snap/flatpak-style apps and pinned `armhf` deps).

## What's NEW since runbook was written (May 17 → June)

These need to survive the migration. The runbook didn't know about them.

| Item | Where it lives | Migration story |
|---|---|---|
| **Talk Transcripts** Nextcloud app | `/mnt/ssd/apps/nextcloud/html/custom_apps/talk_transcripts/` (cloned from GitHub) | Survives (on NVMe). Re-enable via `occ app:enable talk_transcripts` after Nextcloud back up. |
| **gemma3:12b** model (8.1 GB) | Ollama volume (NVMe) | Survives. Ollama container re-starts → model auto-loaded from volume. |
| **Talk Transcripts → gemma3:12b** wiring (4 occ config:app:set keys) | Stored in Nextcloud Postgres `oc_appconfig` table | Survives via DB. |
| **CAKE qdisc + BBR + TCP buffer tuning** | `/etc/sysctl.d/99-bestly-bbr.conf` + `/etc/systemd/system/cake-shaper.service` | Needs explicit backup → restore. NOT on NVMe. |
| **n8n** workflows | `/mnt/ssd/apps/n8n/database.sqlite` | Survives (NVMe). |
| **ntfy** data dir (currently unused — container removed) | `/mnt/ssd/apps/ntfy/` | Survives. Kept around in case we revive self-hosted ntfy. |
| **airwatch.py + alertlib.py fixes** | `/home/pi/scripts/airwatch.py`, `/home/pi/scripts/alertlib.py` | **Risk: lives on SD card root, NOT on NVMe.** Must back up before SD swap. |
| **/home/pi/scripts/.env** (AIRWATCH coords + NTFY_TOPIC + SMTP creds + etc.) | SD card | **Critical to back up** — lots of secrets. |
| **cloudflared token + service** | `/etc/systemd/system/cloudflared.service` (token embedded in ExecStart) | Must back up. |
| **Pi-hole TOML config + cache** | `/etc/pihole/` | Must back up. |
| **Cron jobs** (`crontab -l` for `pi`, root) | SD card | Must back up. |
| **SSH host keys** | `/etc/ssh/ssh_host_*` | Back up — keeps `~/.ssh/known_hosts` valid post-migration. |

This means **Step 1.4 of the runbook gets expanded** — see the "Add to runbook §1.4" patch below.

## Patches to the runbook before executing

### Patch 1: Step 1.4 expanded — additional SD backup targets

After the runbook's existing list (`/boot/firmware`, `/etc/`, crontabs, etc.) add:

```bash
# Bestly-specific persistent state on SD root
sudo cp -av /home/pi/scripts               $BACKUP/pi-scripts/
sudo cp -av /etc/sysctl.d/99-bestly-bbr.conf  $BACKUP/etc-sysctl/
sudo cp -av /etc/systemd/system/cake-shaper.service $BACKUP/etc-systemd/
sudo cp -av /etc/systemd/system/cloudflared.service $BACKUP/etc-systemd/
sudo cp -av /etc/pihole                    $BACKUP/etc-pihole/
sudo cp -av /etc/dnsmasq.d                 $BACKUP/etc-dnsmasq.d/
sudo cp -av /etc/nginx                     $BACKUP/etc-nginx/
sudo cp -av /etc/cloudflared               $BACKUP/etc-cloudflared/ 2>/dev/null || true

# All crontabs (user pi, root, system)
sudo crontab -u pi -l > $BACKUP/crontab.pi
sudo crontab -l > $BACKUP/crontab.root
sudo tar czf $BACKUP/etc-cron.tar.gz /etc/cron.d /etc/cron.daily /etc/cron.hourly /etc/cron.weekly /etc/cron.monthly /etc/crontab

# Tailscale state (so the same machine identity comes back)
sudo cp -av /var/lib/tailscale $BACKUP/var-lib-tailscale/
```

### Patch 2: Step 3.3 — re-enable Talk Transcripts app

After Nextcloud is back up, before validation:

```bash
sudo docker exec -u www-data nextcloud-app php /var/www/html/occ app:enable talk_transcripts
sudo docker exec -u www-data nextcloud-app php /var/www/html/occ app:list | grep talk_transcripts
```

The config (gemma3:12b endpoint + provider + model + enabled) survives via Postgres — no need to re-set.

### Patch 3: Step 3.3 — restore tuning

```bash
# CAKE qdisc + BBR
sudo cp $BACKUP/etc-sysctl/99-bestly-bbr.conf /etc/sysctl.d/
sudo cp $BACKUP/etc-systemd/cake-shaper.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cake-shaper.service
sudo sysctl --system

# Verify
sysctl net.ipv4.tcp_congestion_control  # expect: bbr
sudo tc qdisc show dev eth0 | head -1   # expect: cake bandwidth 11500Kbit
```

### Patch 4: Step 4.4 (NEW) — install faster-whisper-server (the whole reason for this migration)

```bash
# Now that we're on arm64, the previous-blocked image works
mkdir -p /mnt/ssd/apps/whisper/cache
sudo docker run -d \
  --name whisper \
  --restart unless-stopped \
  -p 8001:8000 \
  -v /mnt/ssd/apps/whisper/cache:/root/.cache/huggingface \
  -e WHISPER__MODEL=Systran/faster-distil-whisper-small.en \
  -e WHISPER__COMPUTE_TYPE=int8 \
  -e WHISPER__INFERENCE_DEVICE=cpu \
  fedirz/faster-whisper-server:latest-cpu

# Wait for model download (~3-5 min first boot)
# Then wire into Talk Transcripts
sudo docker exec -u www-data nextcloud-app php /var/www/html/occ \
  config:app:set talk_transcripts whisper_endpoint --value="http://172.17.0.1:8001/v1/audio/transcriptions"
sudo docker exec -u www-data nextcloud-app php /var/www/html/occ \
  config:app:set talk_transcripts whisper_model --value="Systran/faster-distil-whisper-small.en"

# Smoke test
docker exec nextcloud-app curl -s --max-time 30 \
  -F "file=@/path/to/test-audio.wav" \
  -F "model=Systran/faster-distil-whisper-small.en" \
  http://172.17.0.1:8001/v1/audio/transcriptions
```

End state: **100% local pipeline** — Whisper on Pi + gemma3:12b on Pi. No external API calls for transcription or summarization.

## Execution timeline (recommended)

This is a 3-evening project. Don't try to do it all in one go.

### Evening 1 (~2 hrs) — Buy + prep + backup
- [ ] Buy: a 64 GB+ microSD (Samsung Pro Endurance is good) AND a 500 GB+ USB SSD if you don't have one. ~$50 total.
- [ ] Run runbook §1 (Pre-flight) + Patch 1 (expanded SD backup) + §1.5 (Postgres dump).
- [ ] Verify backup size matches expectations.
- [ ] Copy backup to a second location (your Mac, Backblaze, Wasabi — anywhere off the Pi).
- [ ] Flash 64-bit Raspberry Pi OS Lite to the spare SD on your Mac.
- [ ] **Test the new SD card first**: boot the Pi from it WITHOUT the NVMe attached (or with NVMe attached but with a different `fstab`) just to confirm 64-bit boots cleanly. Then power down and reattach.
- [ ] **GATE**: backup verified + new SD boots → proceed. If not, STOP and debug.

### Evening 2 (~1 hr) — Schedule + announce
- [ ] Pick a ~60-minute window when cloud.bestly.tech downtime is acceptable. Sunday 6-7am PT is the lowest-traffic window for most users.
- [ ] Set Uptime Kuma to a maintenance window (so you don't get 100 alerts).
- [ ] Post a brief note to anyone who uses cloud.bestly.tech ("brief maintenance window…").
- [ ] Send the Cloudflare maintenance-splash worker a heads-up notice (mentioned somewhere in `docs/`).
- [ ] **GATE**: backup is still valid + window scheduled → ready for migration day.

### Migration day (~60 min) — Execute Path B
- [ ] T-5: power down. (`sudo shutdown -h now`)
- [ ] T+0: swap SD card. NVMe stays in place.
- [ ] T+1: power on. Wait for first-boot resize + reboot (~2 min).
- [ ] T+3: SSH in. Verify `uname -m == aarch64`, `dpkg --print-architecture == arm64`, `getconf LONG_BIT == 64`.
- [ ] T+5: install Docker per runbook §2B.6.
- [ ] T+10: restore /etc bits per Patch 1 + Patch 3.
- [ ] T+20: re-create `/etc/fstab` entry for NVMe + reboot.
- [ ] T+22: SSH in. Verify NVMe mounted at `/mnt/ssd` with all data intact.
- [ ] T+25: install Tailscale → `tailscale up` (uses preserved state, no re-auth needed).
- [ ] T+30: `cd /mnt/ssd/apps/nextcloud && docker compose up -d` (or however the Nextcloud compose is structured).
- [ ] T+40: bring up Talk HPB stack, n8n, vaultwarden, HA, Ollama, Open WebUI, Pi-hole (host service), cloudflared, nginx.
- [ ] T+50: validate per runbook §5: `cloud.bestly.tech` loads, Talk room joinable, Vaultwarden login works, Pi-hole resolving, cloudflared tunnel healthy.
- [ ] T+55: re-enable Talk Transcripts + verify gemma3:12b summary path → POSTed Hello = working.
- [ ] T+60: announce all-clear.
- [ ] **GATE**: all services green → done. If anything red → Path B's rollback (swap old SD back, NVMe data untouched).

### Evening after migration (~30 min) — Pay down debt
- [ ] Run Patch 4 — stand up faster-whisper-server, wire into Talk Transcripts.
- [ ] Test end-to-end: drop a real Talk recording, confirm `.transcript.md` appears.
- [ ] Run the 3 Libresign patch removals per runbook §4.
- [ ] Re-run `bestly-bootstrap.sh` from scratch in dry-run to confirm it's now ~70 lines shorter.
- [ ] Commit the cleaner `bestly-bootstrap.sh` + delete now-stale armhf workarounds.
- [ ] Update `docs/pi-stack-inventory.md` with talk_transcripts, gemma3:12b, whisper.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| New SD card has a bad block / fails on first boot | Low | Pre-flight test (Evening 1, last step) catches this. Buy 2 SDs if paranoid. |
| NVMe doesn't auto-mount on the new 64-bit OS (different kernel module, different `/etc/fstab` UUID format) | Medium | Patch 1 backs up `/etc/fstab`; restore + reboot; or re-detect UUID via `blkid` and re-write. |
| Talk HPB shared secret mismatch after migration | Low | Secret is in Nextcloud config (Postgres) + HPB config (`/mnt/ssd/apps/talk-hpb/.env`), both survive. |
| Cloudflared token re-registers as a new tunnel | Low | Token is in `/etc/systemd/system/cloudflared.service` ExecStart — back up + restore that file specifically. |
| Pi-hole rules / custom DNS records lost | Low | `/etc/pihole/pihole.toml` (the dns.hosts array) is backed up in Patch 1. |
| Postgres Trixie → arm64 binary mismatch on first start | Low | We're using `postgres:16-alpine` arm64 container, which the kernel was already running. Should be no different post-migration. |
| Home Assistant DB corruption from unclean shutdown | Low | Stop HA cleanly before shutdown in Step 1.1. HA SQLite is on NVMe — survives. |
| Aircraft alerts stop firing because crontab not restored | Medium | `crontab.pi` backup. Restore with `crontab -u pi backup/crontab.pi`. **Verify with `tail -f /home/pi/scripts/airwatch.log` post-migration.** |
| Self-signed nginx cert for `cloud.bestly.tech` (the LAN-fast path we set up + reverted) is orphaned | Low | `/etc/nginx/ssl/` backed up in Patch 1. Even if we don't restore — we already decided that path is broken for backend calls; no loss. |

## What I (Claude) can do remotely vs what's hands-on

### I can do remotely:
- Run the inventory + verification commands
- Take + verify the SD/NVMe backups (rsync, pg_dump)
- Pre-stage the new container images
- Drive the `occ` re-enable + `app:set` config restoration

### YOU must do hands-on (or via PiKVM if you have one):
- Physically swap the SD card
- Watch the boot console on the first boot (in case it can't get a DHCP lease / something off)
- Be ready to power-cycle if something hangs

## My recommendation

**Schedule this for the weekend of June 21-22 or June 28-29.** Don't do it on a weeknight — too easy to get stuck and end up with prod down at 11 PM. Spend Evening 1 / Evening 2 the preceding week.

If you want, I can:
- Generate the actual backup commands as a ready-to-paste script tonight
- Pre-stage anything that can be pre-staged
- Be on standby during the migration window

Tell me which evening to start the backup prep.
