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
scp -r scripts/home-hub-agent pi@192.168.1.211:/tmp/
ssh pi@192.168.1.211 'sudo /tmp/home-hub-agent/install.sh'
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
