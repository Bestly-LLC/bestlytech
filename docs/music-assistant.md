# Music Assistant (bestly-pi)

Added 2026-10-02 (Jared): the wall's radio / ATC / spoken clips now play through
Music Assistant instead of Home Assistant + pyatv, so the Desk HomePod gets a real
AirPlay 2 session with metadata — iOS Control Center shows full now-playing controls
(artwork + title + transport) instead of the bare pyatv placeholder.

## Server

- Docker: `music-assistant` (`ghcr.io/music-assistant/server:latest`), `--network host`,
  volume `/mnt/ssd/apps/music-assistant:/data`, TZ America/Los_Angeles.
- Web UI: `http://<pi>:8095`. First-run admin: `jared` — password in
  `/opt/bestly/wall/.ma_creds` (600, Pi only, never in this repo).
- **Streams port is 8098, not the default 8097**: 8097 is held by
  `/opt/bestly/voice/voice.py`. Seeded in `settings.json`:
  `core.streams.values.bind_port = 8098` (backup: `settings.json.bak_port1_*`).
- Wall token: `/opt/bestly/wall/.ma_key` (long-lived, created via `auth/token/create`,
  name `bestly-wall`, scopes = admin).

## API pattern (HTTP JSON-RPC, no websocket needed)

```
POST http://127.0.0.1:8095/api
Authorization: Bearer <.ma_key>
{"message_id": "1", "command": "<cmd>", "args": {...}}
```

Response: `{"message_id", "result"}` (errors: HTTP 400/403/501 with text).
Note: some commands use multi-line `@api_command(` decorators and are easy to miss
in a grep (e.g. `player_queues/play_media`).

Commands the wall uses:

| Command | Args | Used for |
|---|---|---|
| `players/all` | — | find the Desk player (`player_id`) |
| `players/get` | `player_id` | state + `volume_level` (0..100) |
| `player_queues/play_media` | `queue_id, media: <uri>, option: "replace"` | start a station (raw URL, MA transcodes) |
| `player_queues/get` | `queue_id` | confirm `state: playing`, `current_item.name` |
| `player_queues/stop` | `queue_id` | radio off |
| `players/cmd/play_announcement` | `player_id, url, pre_announce, volume_level (0..100)` | spoken replies / clips (homepod_play) |
| `players/cmd/volume_set` | `player_id, volume_level (0..100)` | clip volume duck/restore |

`QueueOption` values: `play`, `replace`, `next`, `replace_next`, `add`.

## Wall integration (server.py)

Radio/ATC/clips moved to MA in `server.py.bak_ma1_*` patch (2026-10-02):

- `_ma_cmd(command, args, timeout)` — POST /api with `.ma_key`.
- `_radio_find()` → `players/all`, prefers available AirPlay "Desk" (queue id == player id).
- `_radio_play(r)` → `player_queues/play_media` with the **raw station URL** (no relay,
  no `_radio_source` pre-check — MA handles codecs/playlists; `_radio_source` is now dead code).
- `_radio_entity_state()` → `player_queues/get` (`playing`/`paused`/`idle` + title).
- radio stop → `player_queues/stop`; `homepod_play` → `players/cmd/play_announcement`
  (relay still used for clip URLs); `_radio_entity_vol` → `players/get.volume_level`.

Discovered players: **Desk** (`apce82848a2691`, AirPlay), **Studio**, the projector
("Start Nebula Cast on your projector"), Jared's Mac mini + MacBook Air (universal).

State source of truth is still Supabase (`wall_admin_set` is admin-session-only; the
Pi cannot flip wall state itself — `wall_admin_set` returns 42501 for publishable).

## Frosted Glass theme (Home Assistant, same day)

- Themes: `config/themes/*.yaml` (wessamlauf/homeassistant-frosted-glass-themes, 6 variants).
- Styling engine: **card-mod** (not UIX) — `config/www/card-mod.js` +
  `frontend.extra_module_url: ["/local/card-mod.js"]` in `configuration.yaml`.
  Install exactly one engine (README warns against both).
- Jared's profile theme set via ws `frontend/set_user_data` key `theme` → `Frosted Glass Dark`.
- MA's own UI only has light/dark (no themes) — set Dark in MA → Settings → User interface.

## Gotchas

- Migration between MA restarts: settings.json holds `encryption_key` — back it up
  before wiping `/data` (wiping = losing provider creds + server_id).
- Do not change 8095/8098 without updating `MA_URL` in server.py and any proxy rules.
- HA integration for MA is **not** installed (wall talks to MA directly; HA keeps
  controlling the HomePod natively via HomeKit).
