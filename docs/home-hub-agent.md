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
| `homeassistant` | `toggle_automation` | `{automation_id, enabled}` |

After `update_gravity` completes the UI re-reads `home_hub_pihole_stats` rather than
trusting the command's return value — that was the original bug.

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
| Also runs | the Nextcloud stack behind `cloud.bestly.tech`, and coturn |
| Does **not** run | Home Assistant or Homebridge — nothing is listening on 8123 or 8581 |

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

Home Assistant and Homebridge have no host yet, so those commands fail with a clear
"no section in the agent config" message rather than pretending to work. Add the
sections once those services exist somewhere.
