# Wave A: Mac mini jobs moved to bestly-pi (2026-10-03)

| Job | Was (Mac launchd) | Now (Pi) |
|---|---|---|
| Mail bridge (bestly.tech + iCloud INBOX, watch folders) | tech.bestly.mailbridge, 5 min | cron `*/5` `run.sh mail_bridge` |
| Sent sync | tech.bestly.sentsync, 10 min | cron `2-59/10` `run.sh sent_sync` |
| Partner mail | tech.bestly.partner-mail, 10 min | cron `4-59/10` `run.sh partner_mail` |
| Tesla A/C helper | tech.bestly.tesla-worker (KeepAlive) | systemd `bestly-tesla-worker` (installed by a parallel session at /opt/bestly/tesla-worker; this chat added drop-in `10-vault-security.conf` for PATH) |

Scripts are copied unchanged to `/opt/bestly/mac-moved/{mail,partner}` (partner_mail.py: one line reads its worker key via `security`).
Their macOS Keychain calls are answered by **`/opt/bestly/bin/security`** (this folder): it reads Supabase Vault `pi:<service>:<account>`
through service-role RPC `pi_secret_get` (prefix `pi:` only). Nothing secret is on the Pi's disk beyond the existing service key in
`/home/pi/scripts/.env`. Vault items moved 2026-10-03: `pi:bestly-mail-bridge:jared@bestly.tech`, `pi:bestly-mail-bridge:jaredbest@icloud.com`,
`pi:bestly-tesla-worker:-`, `pi:bestly-partner-ai:worker_key`.

Watchdog: each run reports to `pi_jobs` (Scout pinged on failure); `pi_jobs_watch` alerts if silent (mail_bridge 20 min, others 40 min).
Tesla helper: systemd Restart=always + the existing "Tesla A/C helper offline" alert.
Mac plists kept as `*.plist.disabled-moved-to-pi` (rollback: rename back + `launchctl bootstrap`, then remove the Pi cron lines).
Known old noise: `queue unavailable (400 unknown action)` from mail_sync (logged 13,884 times on the Mac before the move).

DB (applied live 2026-10-03): `pi_secret_get(p_name)` and `pi_secret_put(p_name, p_value)`, SECURITY DEFINER, service_role only, `pi:` names only.
