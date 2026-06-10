# Pi 64-bit migration — handoff (2026-06-06, ~midnight BST)

## TL;DR — what to do tomorrow

1. **New Pi 5 kit arrives Sun Jun 7, 10am–3pm** (Amazon order #112-0479600-4238601, $411.55, Vemico kit). DON'T cancel it.
2. When it arrives: pop the existing SD card out of the broken Pi, drop the new Pi 5 board into the existing Argon NEO 5 case (with the new FFC ribbon Jared already installed + existing 970 EVO 1TB NVMe). Power on.
3. Verify PCIe link comes up: `ssh pi@192.168.0.211 'ls /dev/nvme*'` — should show `/dev/nvme0n1` + `/dev/nvme0n1p1`.
4. Mount NVMe: `sudo mount /dev/nvme0n1p1 /mnt/ssd`.
5. Restore configs + crontabs from `/Users/jared/bestly-pi-backup-20260605/` (see "Restore checklist" below).
6. Bring containers back: `cd /mnt/ssd/docker-compose-projects/<each>/ && docker compose up -d`.
7. Verify cloud.bestly.tech, Pi-hole DNS, Vaultwarden, Ollama, Home Assistant.

## Current Pi state

- **Host:** bestly-pi at 192.168.0.211 (static via NetworkManager, persistent)
- **OS:** Pi OS Lite arm64 (Debian 13 Trixie), 64-bit — migrated from 32-bit armhf earlier this session
- **Boot:** SD only (BOOT_ORDER=0xf41 in EEPROM, EEPROM is Apr 14 2026 latest channel)
- **NVMe:** unreachable — PCIe link is DOWN at `1000110000.pcie` every boot
- **HAT:** Argon NEO 5 M.2 NVME PCIE Case for Pi 5
- **Drive:** Samsung 970 EVO 1TB, data 100% safe (was cleanly unmounted before all this)
- **SSH:** `ssh pi@192.168.0.211` works with ed25519 key (passwordless sudo enabled)
- **Docker, Tailscale:** installed but no containers / not authenticated yet

## What broke

- The **Pi 5 board's PCIe FFC connector retaining clamp physically snapped off** during ribbon reseating during this session's debugging.
- Without the clamp, the ribbon cannot be pressed firmly enough onto the contacts → no electrical link → kernel reports `brcm-pcie 1000110000.pcie: link down` deterministically at 2.33s every boot.
- **Confirmed not a ribbon issue:** Jared swapped in a fresh ribbon, same exact failure. The Pi 5 board itself is the failed component.
- **Confirmed not a software issue:** tried gen3/gen2/gen1, dtoverlay=nvme, dtparam=pciex1, dtoverlay=pcie-32bit-dma, usb_max_current_enable=1, latest EEPROM. All produce identical "link down" trace.

## What was done tonight on the Amazon / warranty side

- **Amazon CS:** escalated through bot → Kakheli → Kepler Williams (specialist team) → Shreyash (Leadership Team). All three declined — return window closed May 8, no exception possible per their system. Directed to manufacturer warranty.
- **Vemico US warranty claim filed via email** from `jared@bestly.tech` → `support@vertue.cn`, subject "Warranty claim — Vemico Pi 5 16GB Kit (Amazon order 111-8874988-7221815)". Vemico publishes a 1-year warranty on their products. Awaiting reply (their hours: Mon-Fri 9AM-6PM PST).
- **Replacement Pi 5 kit already ordered:** Amazon order #112-0479600-4238601, $411.55, arriving Sun Jun 7 10am-3pm. This is what gets the home server back online.
- Vemico contact info: phone `0086-1511-602-0598` (international, needs Skype/Google Voice), email `support@vertue.cn`.

## Backup location (everything we need to restore)

`/Users/jared/bestly-pi-backup-20260605/` (Mac) — 225 MB total:
- `crontab-pi` — pi user crontab
- `crontab-root` — root crontab
- `pg-dumpall.sql.gz` (7.6 MB) — full Postgres dump (Nextcloud DB)
- `var-lib-tailscale.tar.gz` — Tailscale identity / state
- `scripts/` (58 MB) — all custom Pi scripts
- `etc/pihole/` (244 MB) — Pi-hole gravity.db + config
- `etc/nginx/` — nginx site configs
- `etc/ssh/` — host keys (so existing known_hosts entries still work)
- `etc/sysctl.d/` — BBR + qdisc tuning
- `etc/systemd/system/` — cake-shaper.service, cloudflared.service, etc.

On the Pi, in bash terms these are at `/sessions/magical-sweet-mayer/mnt/bestly-pi-backup-20260605/`.

## Restore checklist (in order)

After NVMe mounts at /mnt/ssd:

1. **Confirm /mnt/ssd structure intact:** `ls /mnt/ssd/docker /mnt/ssd/containerd /mnt/ssd/postgres`.
2. **fstab entries:** add `/dev/nvme0n1p1 /mnt/ssd ext4 defaults,nofail 0 2`. Plus bind mounts: `/mnt/ssd/docker /var/lib/docker none bind 0 0` and `/mnt/ssd/containerd /var/lib/containerd none bind 0 0`. Then `sudo mount -a`.
3. **Restore /etc bits** that don't survive a fresh OS: rsync sysctl.d, systemd/system (cake-shaper.service, cloudflared.service), pihole, nginx from backup → Pi.
4. **Restore crontabs:** `crontab /tmp/crontab-pi` (as pi), `sudo crontab /tmp/crontab-root`.
5. **Restore Tailscale identity:** stop tailscaled, untar var-lib-tailscale.tar.gz to /var/lib/tailscale, start tailscaled. Verify `tailscale status` shows the existing node name.
6. **Restore Postgres** if needed: `gunzip -c pg-dumpall.sql.gz | docker exec -i postgres psql -U postgres` (only if /mnt/ssd/postgres is empty — should not be).
7. **Bring containers back:** `cd /mnt/ssd/docker-compose-projects/` → for each subdir `docker compose up -d`.
8. **Verify services:**
   - Pi-hole: 192.168.0.211 (DNS works for home network)
   - cloud.bestly.tech: external HTTPS via cloudflared tunnel
   - Vaultwarden, Talk HPB, Ollama (gemma3:12b), Home Assistant, n8n
9. **Re-enable Talk Transcripts app:** `docker exec --user www-data nextcloud-app php occ app:enable talk_transcripts`.
10. **Verify cake-shaper + BBR** are loaded: `sysctl net.ipv4.tcp_congestion_control` should be `bbr`; `tc qdisc show dev eth0` should mention `cake`.

## Mempalace state (canonical)

Drawer: `bestly-llc/infrastructure/pi-64bit-migration-CRITICAL-state-2026-06-05` — has all UUIDs, partition layout, EEPROM file paths, network state, container list. Read this first if anything is unclear.

## Open issues

- **HOAscope rename, ParentIQ public surface** — unrelated, see CLAUDE.md.
- **Libresign / DocuSign migration** — phase 2 + 4 pending, unrelated to tonight.
- **Vemico warranty reply** — check `jared@bestly.tech` inbox in 1-2 business days. If silent after 3 days, follow up with photos of the broken connector + dmesg log attached.

## Communication style

- ADHD mode: terse, top-loaded, scannable. No preamble.
- Skip the Jun 6 replacement order in conversations with Amazon/Vemico (already mentioned to Amazon, don't bring it up again — the agents will use it as a reason to deny help).
- Always commit + push without asking when finishing work on `bestlytech` repo (see CLAUDE.md "rules of the road").
