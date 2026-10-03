# FreeLLMAPI on bestly-pi

Moved from the Mac mini 2026-10-03 (the Mac mini sleeps and its Tailscale got switched off).

- App: `/mnt/ssd/freellmapi` (NVMe). Data: `server/data/freeapi.db` + `.encryption-key` (17 provider keys, all healthy at the move).
- Service: systemd `bestly-freellm` -> `/mnt/ssd/freellmapi/start.sh` (exports ENCRYPTION_KEY from the key file; production mode needs it).
- Self-heal: systemd timer `bestly-freellm-watch.timer` every 5 min -> `watch.sh`: restart app, `tailscale up`, restore Funnel `/v1`. Log `/mnt/ssd/freellmapi/watch.log`.
- Public path: Tailscale Funnel `/v1` ONLY -> https://bestly-pi.taile42611.ts.net/v1 (Vault `freellm_base_url`). Root and `/api` are 404 publicly; `/v1` needs the FreeLLM key (Vault `Scout-FreeLLM`).
- Admin UI: http://100.79.2.74:3001 (Tailscale only).
- Cloud alarm: `freellm_watch()` every 10 min; two misses -> `ai.freellm` + 11-minute cooldown so Scout skips it instantly.
- Mac mini copy kept as a cold backup: `~/freellmapi`, launchd plists renamed `*.disabled-moved-to-pi`.

Updating FreeLLMAPI: rsync from a fresh build (exclude `node_modules`, `server/data`, `desktop`, `.git`, `/docs`), then `npm ci --omit=dev` on the Pi and `sudo systemctl restart bestly-freellm`.
