# Opus plan: move Turo reading + scheduled jobs from the Mac mini to the Pi (2026-10-03)

Goal: the wall knows exactly what Jared's phone knows about Turo (new booking, guest message, trip changed,
trip cancelled), from a box that is always on. Move every Mac mini job that does not need the Mac.

## Findings that shaped the plan

- Turo blocks the old Pi profile (`/var/lib/bestly/turo-profile`) and anything Playwright launches
  ("You've been blocked", WAF 403). Same home IP as the Mac, so it is not an IP block.
- A **fresh profile in plain Chromium** (no Playwright, driven over raw CDP like the wall stream) is NOT blocked;
  it only needs a sign-in (401 `authorization_required`). So: new profile, plain Chromium, Jared signs in once.
- Message sending is off, so the Pi only needs to READ: `/api/v2/feeds/upcoming-trips?appMode=HOST` and
  `/api/v2/feeds/conversation?appMode=HOST`.
- iOS cannot hand a Shortcut the text of another app's notification. The shortcut stays as a "check now" nudge.

## Mac mini inventory (launchd)

| Job | Decision | Why |
|---|---|---|
| turo-sender (bookings sync, every 3 min) | **Move** → Pi Turo reader. Mac copy stays as automatic fallback (skips itself while the Pi is fresh) | Read-only now |
| tesla-worker (KeepAlive) | **Move** → systemd on Pi | Only macOS tie was the Keychain token lookup |
| wall-appstore (2 h) | Stay | Its App Store Connect private key is designed to never leave the Mac |
| mailbridge, sentsync, partner-mail | Stay | Mailbox passwords are designed to never leave the Mac Keychain |
| re-intake (2 min) | Stay | Renders slides in Chrome, uses Photos + Keychain |
| clips, meetingrec-agent, meetingrec-sync | Stay | Apple Speech binary, AirDrop to Downloads, recordings on the Mac |
| ollama, partner-ai | Stay | Local model on the Mac's hardware |
| wall-devices, wall-nowplaying | Stay | Read the Mac's own Bluetooth and Music app |
| vault-backup | Stay | Backs up ~/Brain, which lives on the Mac |
| watchdog, stay-awake | Stay (watchdog list updated) | Mac-local |

## Build

1. **Tesla worker on the Pi**: `/opt/bestly/tesla-worker` (venv: tesla-fleet-api, aiohttp, cryptography),
   token in `/etc/bestly/tesla-worker.token` (0600, piped from the Mac Keychain, never printed),
   `bestly-tesla-worker.service` (Restart=always). Verify a claim, then unload the Mac copy.
2. **Pi Turo reader** `bestly-turo-reader.service`: cage (headless Wayland) + plain Chromium, profile
   `/var/lib/bestly/turo-host`, CDP on 127.0.0.1:9334. Loop: every 2 min, or within 15 s of a ping:
   read trips → `turo-ingest` (source pi); read inbox → `turo_inbox_put`. Heartbeat each pass.
   One-time sign-in through a VNC view of that browser (wayvnc, LAN only), then VNC is turned off.
3. **Database**: `turo_inbox` (one row per guest message), `turo_reader_state` (heartbeat, signed-in, poke),
   trip update trigger (dates changed / cancelled → wall card), ping → poke the reader,
   `turo_reader_watchdog` → Scout (stale, signed out) every 5 min.
4. **Wall**: the booking card takes `eye` / `title` / `text`, so the same card shows
   "Message from Willie", "Trip changed", "Trip cancelled".
5. **Mac**: turo-sender skips its sync while the Pi ingested in the last 10 min (automatic fallback);
   tesla-worker unloaded and removed from the Mac watchdog list.

## Done when

- `tesla_fleet_settings.worker_seen_at` < 1 min old from the Pi; a key check completes.
- Pi reader heartbeat < 3 min old, signed in, trips ingested with source pi.
- A real guest message shows on the wall as "Message from …".
- Mac turo-sender logs "Pi is syncing, skipped".
- Pi reboot: both services back within 2 min.

## Rollback

Stop the Pi services; `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/tech.bestly.tesla-worker.plist`.
turo-sender falls back on its own once the Pi heartbeat is 10 min old.
