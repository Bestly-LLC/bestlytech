# Home Hub agent

## Why this exists

Every Home Hub control button used to be a stub: `await delay(500); return {success:true}`.
Nothing left the browser. The UI toasted "Pi-hole disabled" and "Homebridge restarted
successfully" regardless, and `Update Gravity` returned `domainsOnBlocklist: 0`, which the
page wrote into state — zeroing the blocklist figure on screen while claiming it worked.
The Home Hub Overview also showed hardcoded Home Assistant and Homebridge numbers
(`devicesOnline: 34`, `accessories: 5`) and a fabricated activity feed, with green status
dots and a 30-second poll around them.

## The shape of the fix

The Pi has no inbound route from the internet — it only pushes outbound, which is how
`ingest-pihole-stats` already works. So control is a **queue**, not a call:

```
admin UI  ──insert──>  home_hub_commands (pending)
                             │
on-prem agent ──poll──>  home-hub-agent edge fn  ──claim──> (running)
      │
      ├─ executes against Pi-hole / HA / Homebridge on the LAN
      │
      └──result──>  home-hub-agent edge fn  ──write──> (done | failed)
                             │
admin UI  <──realtime────────┘
```

Nothing in the browser touches the LAN, and nothing inbound is opened on the Pi.

## Pieces

| Piece | Where |
|---|---|
| `home_hub_commands`, `home_hub_agent_state` | `supabase/migrations/20260907174507_*.sql` |
| Realtime publication (was empty) | `supabase/migrations/20260907174517_*.sql` |
| Shared secret, generated into Vault | `supabase/migrations/20260907174547_*.sql` |
| Edge function (`x-api-key`, `verify_jwt = false`) | `supabase/functions/home-hub-agent/` |
| On-prem agent + installer | `scripts/home-hub-agent/` |
| Client API | `src/services/homeHubApi.ts` |

## Command contract

| target | action | payload |
|---|---|---|
| `pihole` | `enable` | — |
| `pihole` | `disable` | `{seconds?}` (0 / omitted = indefinite) |
| `pihole` | `update_gravity` | — |
| `homebridge` | `restart` | — |
| `homebridge` | `refresh` | — (take a snapshot now) |
| `homeassistant` | `toggle_automation` | `{automation_id: "automation.<id>", enabled}` |
| `homeassistant` | `refresh` | — |
| `agent` | `update` | `{version, sha256}` (agent >= 1.1.0) |
| `agent` | `test_alert` | — (agent >= 1.2.0) |
| `agent` | `run_maintenance` | `{steps?: ["agent","homeassistant","homebridge","pihole","os","housekeeping"]}` (agent >= 1.2.0) |

After `update_gravity` completes the UI re-reads `home_hub_pihole_stats` rather than
trusting the command's return value — that was the original bug.

## Snapshots, access backup and secret backup (agent 1.1.0, 2026-09-16)

Other edge-function ops besides `poll` / `result` / `heartbeat`:

| op | what | stored in |
|---|---|---|
| `snapshot` | `{source: homeassistant\|homebridge\|host, ok, error, data}`. HA + Homebridge every 60s, host every 5 min | `home_hub_snapshots` via `home_hub_ingest_snapshot()` |
| `backup_secrets` | HA token, Homebridge user + password, sent when the config file changes. Names are fixed server-side | Vault `home_hub_ha_token`, `home_hub_homebridge_user`, `home_hub_homebridge_password` |
| `release` | `{version}` → the source for `agent.update` | `home_hub_agent_releases` |

- **`home_hub_inventory`** is the access backup behind `/admin/home-hub/access`: IPs, Tailscale,
  ports, URLs, SSH alias/user/key location, paths, and *where* each secret lives. Never a value.
  The host snapshot keeps the `bestly-pi` row (and the services on it) current: an IP change is
  written with the old value in `history` and raises an admin notification.
- Notifications (`admin_notifications`, kind `home_hub`): HA or Homebridge failing 3 reads in a row,
  recovering, the Pi changing address, and the agent going quiet for 10 minutes (pg_cron
  `home-hub-agent-offline-check`).
- Secrets are write-only from the admin (`home_hub_vault_put`, names `home_hub_*`, agent key
  excluded). To recover one, read `vault.decrypted_secrets` by name with the service role.

### Shipping a new agent version (no SSH)

1. Bump `VERSION` in `scripts/home-hub-agent/agent.py`, commit.
2. Insert the release: `insert into home_hub_agent_releases (version, sha256, source, notes)` with
   `sha256` = hex SHA-256 of the exact file bytes (UTF-8).
3. Admin → Home Hub → Access backup → More → *Update agent*. The Pi downloads the release, checks
   the sha256 queued with the command, compiles it, swaps the file (old one kept as `agent.py.prev`)
   and exits; systemd restarts it on the new version.

1.0.0 → 1.1.0 is the one upgrade that still needs SSH, because 1.0.0 predates `agent.update`.

## Self-managing (agent 1.2.0, 2026-09-16)

The Pi heals, updates and cleans up after itself, and only pushes to Jared's phone (ntfy topic
`bestly-sysalert-7q2k9mx4`, the same one Blue Steel uses) when something needs him.

### Health loop (every minute)

| check | automatic fix | if the fix doesn't work |
|---|---|---|
| Home Assistant, Homebridge (snapshot + light probe; 4 min boot grace) | `docker restart`, 2 tries, 3 min apart | error push; quiet retry hourly |
| Home Assistant / Homebridge rejecting the agent's login (401/403) | none (a restart can't fix a token) | warning push |
| Pi-hole: `pihole-FTL` active **and** a raw DNS query to 127.0.0.1 answers | `systemctl restart pihole-FTL` | error push |
| Docker | `systemctl restart docker` once | error push |
| Tailscale online (only when the internet is up) | `systemctl restart tailscaled` | warning push |
| `/mnt/ssd` mounted | `mount -a` once | error push |
| Disk `/` and `/mnt/ssd` under 90% | cleanup (below) | warning push |
| Power/heat (`vcgencmd get_throttled`, CPU ≥ 80 °C), 5 min | — | warning push |
| RAM available ≥ 5%, 10 min | — | warning push |
| Failed systemd units | reset-failed + restart once | warning push |

Three automatic restarts of the same thing in 24 hours raises a separate "keeps failing" warning.
Everything the loop sees goes up every minute as the `health` row in `home_hub_snapshots`.
A watchdog thread exits the agent if the main loop hangs for 30 minutes; systemd restarts it
(the Pi's hardware watchdog, `RuntimeWatchdogSec=1min`, covers a frozen kernel).

### Nightly maintenance (3–5 AM, Pi local time)

In order; each step is recorded in the agent state, so a restart resumes rather than repeats:

1. **agent**: newest row in `home_hub_agent_releases` (op `release_latest`) → self-update. `launch.sh`
   restores `agent.py.prev` if the new version fails to start 3 times or can't reach the server for
   5 minutes, and the restored agent raises a warning and skips that version.
2. **homeassistant**: the latest stable core release once it has been out 3 days
   (`ha_min_release_age_days`). Pull the pinned tag, stop, tar `/mnt/ssd/apps/homeassistant`, recreate the
   container with the same run args (derived from `docker inspect`), wait up to 15 min for
   `/api/config` state RUNNING. Otherwise: restore the directory, start the previous image (tagged
   `bestly-rollback/homeassistant:<stamp>`), push, and skip that version. Then HACS `update.*` entities,
   one restart, same rollback for `custom_components`.
3. **homebridge**: `npm outdated` in `/homebridge`; same-major updates are installed and verified
   (`/api/status/homebridge`), rolled back on failure. Major updates are never automatic; they push
   once per version. Then the `homebridge/homebridge:latest` image, same backup/rollback as HA.
4. **pihole**: `pihole -up` when `pihole -v` shows a newer version; verify DNS; restart FTL if needed.
   There is no rollback, so a failure pushes (error if DNS is down).
5. **os** (Sundays only): waits for `nextcloud-update.sh` / `backup-server.py` to finish, then
   `apt-get upgrade --with-new-pkgs` (confold). Reboots at the end if a newer kernel is installed or
   `/run/reboot-required` exists; 7 minutes after boot it reports whether everything came back.
6. **housekeeping**: dangling images, rollback images and backups older than 14 days (newest 3 always
   kept), `*.failed-*` directories, journal over 500 MB, any `/home/pi/scripts/*.log` over 200 MB.

Backups: `/mnt/ssd/backups/home-hub/`. State: `/var/lib/bestly-home-hub/state.json`.
Knobs (all optional) go in the config under `"manage"`: `heal`, `updates`, `window_start_hour`,
`window_end_hour`, `os_update_weekday`, `reboot`, `ha_min_release_age_days`, `backup_keep_days`,
`ignore` (e.g. `["homebridge"]` to leave it alone while you work on it).

### What reaches the phone

The agent sends events (op `event`) to `home_hub_raise()`; the server side raises its own.
`home_hub_issues` holds one row per problem key, `home_hub_events` the history.

- A **problem** pushes when it opens, again only after `repush_hours` (6) if still open, or when it
  escalates to error. Its **all-clear** pushes only if the problem did.
- error → priority 5, rings immediately. warning → 4, info → 3. Between 22:00 and 08:00 anything
  below 5 is scheduled by ntfy for 08:00 (`home_hub_settings`).
- Fixes that worked, update summaries and heal attempts go to the admin bell / event log only.
- Server-side (pg_cron `home-hub-agent-offline-check`, every 5 min): agent silent 10 min (error),
  Pi-hole stats older than 15 min (warning), agent ≥ 1.2.0 online but no health snapshot for 10 min.
- The Pi changing address pushes a warning (the SSH alias on the Mac needs updating).

Commands: `agent.test_alert` sends a test push; `agent.run_maintenance {steps?}` runs maintenance now
(outside the window; `os` included only if listed or no steps given).

To publish a new agent for self-update: bump `VERSION`, commit, copy the file to the Pi and run
`python3 scripts/home-hub-agent/publish-release.py <path to agent.py> "notes"` there (it uses the
service key already in `/home/pi/scripts/.env`). The Pi picks it up the next night.

### Legacy jobs handed over (2026-09-16)

- `pi-manager.py` no longer checks or restarts Home Assistant, Homebridge, Pi-hole, Tailscale, disk,
  temperature or memory (added to `SKIP_CHECKS`; `open_webui` too — it probed Pi-hole's :8080). It still
  covers internet, containers, Nextcloud, the tunnel and swap. Backup: `pi-manager.py.bak-20260916-homehub`.
- The weekly `home-stack-update.sh` cron line is commented out (it had no rollback).
- `/etc/logrotate.d/bestly-pihole-push` removed: it duplicated `bestly-scripts` and made logrotate fail
  every night from Sep 14.

## Agent connectivity

The agent heartbeats into `home_hub_agent_state` on every poll. The UI treats
`last_seen_at` within **3 minutes** as connected. When it isn't, the controls are
disabled with the last-seen time shown — never hidden, and never silently faked.
Commands nothing claims within 10 minutes, and commands claimed but not finished within
15 minutes (the Pi died mid-run), are marked `expired` by `expire_stale_home_hub_commands()`,
which runs on every agent poll and from pg_cron every 5 minutes. The edge function fails any
command outside the contract table above before the agent sees it.

## The Pi

| | |
|---|---|
| Host | `bestly-pi` (aarch64, Python 3.13) |
| LAN | `192.168.1.211` — **not** `192.168.0.211`, which is stale and still appears in old comments and known_hosts |
| Tailscale | `bestly-pi-1` / `100.79.2.74` (Tailscale SSH is in "check" mode and prompts for browser re-auth; the LAN path uses key auth and doesn't) |
| Also runs | the Nextcloud stack behind `cloud.bestly.tech`, coturn, and (since 2026-09-09) Home Assistant on :8123 and Homebridge on :8581, both in Docker |
| HA config | `/mnt/ssd/apps/homeassistant` (container `homeassistant`, network host) |

Pi-hole v6 serves its API on **:8080**, not :80.

### Why the stats stopped

`/home/pi/scripts/push_pihole_stats.py` runs every minute from cron and was pointed at
`http://localhost/api` — port 80, where nothing listens. Every run failed with
`Connection refused`, silently, into a log that had grown to 76 MB. Fixed by pointing
`PIHOLE_BASE` at `http://localhost:8080/api`; rows resumed immediately
(354,799 domains on the blocklist, so gravity was fine all along).

### Why Pi-hole control uses the CLI, not the API

Pi-hole v6 gates every write behind an authenticated session, and unauthenticated
writes return a misleading `404`. The agent already runs on the box with passwordless
sudo, so it shells out to `pihole enable` / `pihole disable` / `pihole -g` instead.
That keeps the web password out of the agent config entirely.

## Installing on the Pi

```bash
scp -r scripts/home-hub-agent bestly-pi-lan:/tmp/
ssh bestly-pi-lan 'sudo bash /tmp/home-hub-agent/install.sh'
```

The config at `/etc/bestly/home-hub-agent.json` needs `agent_key`. The Pi can fetch it
itself using the service-role key it already holds in `/home/pi/scripts/.env`, so the
secret never passes through a chat context:

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/get_home_hub_agent_key" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY"
```

The config has `pihole`, `homeassistant` (token) and `homebridge` (user `jared`) sections as of
2026-09-10. A missing section makes those commands and snapshots fail with a clear message.
