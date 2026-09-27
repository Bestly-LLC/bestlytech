# Wall feedback — opusplan (2026-09-27, 3:10 PM PT)

Jared's list, grouped by the system it touches so parallel workers never edit the same file.
Status legend: [ ] todo · [x] done · [~] partial / needs Jared

## Shared contracts (every workstream codes against these)

**New `wall_state.state` keys** (server.py DEFAULT_STATE + `wall_clean_toggles`/`wall_clean_patch` + admin Wall.tsx):
| key | type | default | meaning |
|---|---|---|---|
| `airLabelsSmall` | bool | true | name tags on small planes + helicopters. false = tags only on commercial (airline) flights. `airLabels` stays the master on/off. |
| `airCardPin` | bool | false | big flight card stays up, rotates through planes in view; closest plane gets its own color. |
| `leftDate` | bool | false | left rotating text field shows today's date instead of rotating. |
| `radio` | object\|null | null | `{on, name, url, favicon, ts}` — admin picks a station; Pi server plays it on HA media_player for the **Desk** HomePod over AirPlay; wall shows now-playing. |

**Trip extras on the wall** — `wall_pi_trips(p_token)` trip objects gain `extras: string[]` (e.g. "Phone mount", "EV recharge", "Unlimited miles", "Prepaid refuel") and `flags: string[]` (anything unusual: mileage limit, delivery, extra driver, young driver, pet, long trip, first-time guest). Empty arrays when nothing special.

**Emoji graffiti** — table `wall_emojis(id, emoji unique, x 0..1, y 0..1, size, created_at, placed_by)`. Pi reads `wall_pi_emojis(p_token)` (same token check as `wall_pi_trips`); new ones also broadcast on the wall's Realtime channel as event `emoji`. Wall renders them on the sign wall.

**Plane-tags shortcut** — RPC `wall_quick_set(p_token, p_key, p_value)` (allow-listed keys only: airLabels, airLabelsSmall, airCardPin, leftDate, sound), called by Home Assistant `rest_command`; exposed as an HA switch so Siri/Control Center/iOS Shortcuts can flip it.

## A. Wall display (Pi: wall.html, server.py, watchdog.py) — one worker
- [ ] A1 Plane name tags: `airLabelsSmall` (commercial-only mode).
- [ ] A2 `airCardPin`: big flight card always up, rotates planes, closest one in a distinct color.
- [ ] A3 Sky key moves to the sign wall, left of the plane card; signatures reflow below; works when signage + aircraft card are both active.
- [ ] A4 Hourly chime: audio breaks up → fix; during the chime the time overrides that part of the screen.
- [ ] A5 Ambient upgrade (find what happened to it) + show sunset while the sun is up, sunrise while it is down.
- [ ] A6 10-day forecast highlight outline → thin white.
- [ ] A7 Remove the sign-wall QR code (NFC coasters now).
- [ ] A8 Demo/show improvements (house/wall/show-for-friends ideas) + `leftDate` toggle.
- [ ] A9 Black mode must not run the sleep animation / go to sleep.
- [ ] A10 Turo trip card: bordered box (Apple HIG) listing `extras` + `flags`.
- [ ] A11 Radio now-playing + `radio` state → HA play_media on Desk HomePod (AirPlay).
- [ ] A12 Render emoji graffiti.
- [ ] A13 New keys in DEFAULT_STATE + DB clean functions; watchdog/Scout coverage; measure fps after.

## B. Home Assistant (Pi docker) — one worker
- [x] B1 Hue motion sensor: no alerts while Jared is home. — pushes came from Pi `home-narrator.py` (not HA); motion skipped unless away (`presence_lib.py`: person home OR home Wi-Fi); `security-monitor.py` uses the same rule.
- [x] B2 Two-way sync: Jared's Bestly to-dos ⇄ an HA to-do list. — `todo.bestly` ⇄ RPC `ha_todo_sync` via `/opt/bestly/ha-todo-sync` (timer, 1 min); watchdog cron → Scout `ha.todo_sync`.
- [x] B3 Radio Browser integration + Desk HomePod media_player via AirPlay; record entity ids. — `media_player.desk` (play_media, MP3 streams, type `music`); bestly_memory `house/ha/entities`.
- [~] B4 AirPlay lag/connectivity: diagnose + fix. — fixed mDNS host-name fight (Homebridge's own avahi), avahi eth0-only, lower-latency relay (small VBV, no-buffer input, announce after go2rtc ready). Not yet measured with a real phone cast; wall.html jitterBufferTarget=0 left for A.
- [x] B5 Plane-tags shortcut (HA switch → `wall_quick_set`), Siri/Shortcuts-ready. — `switch.wall_plane_tags` + `script.wall_plane_tags_toggle`; no HA HomeKit Bridge, so Siri = an iOS Shortcut running the script.

## C. Tesla + Turo — one worker
- [ ] C1 Car-moving protection: don't alert when it's Jared driving the car back after a trip (e.g. LAX → home), confirmed via Tesla/TezLab data.
- [ ] C2 Admin "Cool it down" + guest/demo A/C buttons: triage and fix end to end (actually turns on climate / reads the car).
- [ ] C3 `extras` + `flags` in `wall_pi_trips`.

## D. Admin + meetings (bestly repo) — one worker
- [ ] D1 Wall.tsx: switches for `airLabelsSmall`, `airCardPin`, `leftDate`; radio picker (Radio Browser search → `radio` state) — Apple HIG.
- [ ] D2 Remove the manual "one thing" text box; Scout fills it automatically.
- [ ] D3 Scout's image in Talk meetings (notetaker) — verify/fix.
- [ ] D4 Start/stop meeting buttons missing on desktop — fix.

## E. Sign page (bestly.tech/sign) — one worker
- [ ] E1 Access only from the NFC coasters (tag token in the URL; plain visits get "tap a coaster").
- [ ] E2 Landscape only; portrait shows "turn your phone".
- [ ] E3 Take-home badge (Kings Road × WeHo, not Bestly-branded): download + email to self.
- [ ] E4 One emoji per guest, unique across the board (taken = pick another or make your own); Scout places it.

## Rules for every worker
12-hour times, US units, number never wraps from its unit, Apple HIG for UI, self-healing watchdog tied to Scout for anything new, secrets only in Supabase Vault, short guest links, backups before Pi edits (`*.bak_<tag>`), `node --check` on wall.html script, bump `wall_state.version` after wall changes, record decisions in `bestly_memory`, commit trailer per repo convention.
