# Moving the Tesla worker off the Mac mini to the Pi (plan, 2026-09-28)

Why: the Mac mini worker stopped at 10:52 AM PT Sep 28 and guest keys hung. The Pi is always on.

## What can move, what cannot

| Piece | Moves to Pi? | Why |
|---|---|---|
| Tesla worker (`~/.bestly/tesla-worker/worker.py`): key invites/removals, key checks, health reads | Yes, probably | Polls Supabase `tesla_worker_claim` and calls Tesla. Needs: worker.py, its Tesla credentials/signing key, Python deps, a systemd unit. Unknown until worker.py is read: any macOS-only calls (Keychain, `security`), a Go/`tesla-http-proxy` binary that needs an ARM build. |
| Turo sender / Turo feed push | No | Uses Jared's logged-in Turo browser session. A headless Pi cannot hold that. |
| partner-ai (Ollama qwen3:8b), iMessage read, meeting recorder | No | Need the Mac's hardware / Full Disk Access. |
| Watchdog + Scout alert (`tesla_worker_alive_watch`) | Already always-on | Runs in Supabase cron. |

## Steps (a Claude session ON the Mac mini, or SSH into it, is required; the cloud cannot reach either machine)

1. Read worker.py; list every macOS-only dependency. Stop and report if there is a blocker.
2. Copy `~/.bestly/tesla-worker/` to the Pi (`~/.bestly/tesla-worker/`), keep secrets mode 0600. Do NOT commit them anywhere.
3. On the Pi: create a venv, install the deps, run once in the foreground, confirm one `tesla_worker_claim` succeeds and `tesla_fleet_settings.worker_seen_at` updates.
4. Add `tech.bestly.tesla-worker.service` (systemd, `Restart=always`, `RestartSec=10`), enable it.
5. Stop and unload the Mac copy (`launchctl bootout gui/$(id -u)/tech.bestly.tesla-worker`) so two workers never claim jobs. Remove it from KEEP_AGENTS in `scripts/mac/bestly-watchdog.py`.
6. Extend `docs/tesla-worker.md` (Pi paths, how to ship a version bump).

## Checks before calling it done

- `worker_seen_at` is under 1 minute old, `tesla-worker-alive-watch` reports `alive: true`.
- Queue a test key on a scheduled trip: status goes `creating` -> `ready` with a share link.
- Reboot the Pi; the worker is back within 2 minutes without anyone touching it.
- Scout has no open `tesla.worker.down`.

## Rollback

`launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/tech.bestly.tesla-worker.plist` on the Mac and stop the Pi service.
