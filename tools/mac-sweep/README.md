# Sweep: the Mac mini janitor

Bestly AI employee `mac-sweep` (Team page; reports to Ares, Head of Security & IT). Hired Oct 5, 2026, after the Mac mini's disk hit 100%. Jared has had to erase that machine three times because tools filled it up.

## Where it runs

- **Script:** `~/Bestly/sweep/sweep.py` on the Mac mini. This folder holds the repo copy.
- **Schedule:** LaunchAgent `~/Library/LaunchAgents/tech.bestly.sweep.plist`, every 10 min, at low CPU and disk priority.
- **Config:** `~/Bestly/sweep/config.json` (Supabase URL and publishable key). The Home Hub agent key is in the Keychain under `bestly-home-hub-agent`.
- **Records:**
  - `sweep.log`: the run log.
  - `ledger.jsonl`: every file it deletes, moves or trims.
  - `state.json`: alert state and folder sizes.

## What it does

| When | What |
|---|---|
| Every run | Measures free space. If 3 GB or more disappears between runs, it pushes an alert naming the folders that grew, then runs an emergency cleanup. |
| Every run | Deletes files of its own in `/private/tmp` older than 2 days (screenshots, renders, logs, archives). Trims any log over 200 MB to its last 20 MB. |
| Daily | Prunes the uv cache, runs `brew cleanup`, and clears the npm cache when it's over 2 GB and the pip cache when it's over 1 GB. Deletes Xcode build caches older than 7 days. Weekly, deletes Xcode simulators that are no longer available. |
| Every 6 h | Moves files to Nextcloud on the Pi over the LAN, through `/mnt/ssd/staging-mac`. Each copy is checked by SHA-256 and found in Nextcloud before the Mac copy is deleted. |
| Under 12 GB free | Emergency mode: `uv cache clean`, npm cache clean, and clears the Playwright, Chrome and Codex caches. Sends an urgent push. |

What it moves to Nextcloud:

- Meeting audio older than 7 days goes to `Meeting Recordings/<date>`. If a copy with the same name and size is already there, the Mac copy is just deleted.
- Downloads older than 14 days and over 20 MB go to `Mac Mini Archive/Downloads/<month>`. Installers older than 14 days are deleted.
- `~/meetings` audio older than 30 days goes to `Mac Mini Archive/meetings-wav`.

Alerts go through the `home-hub-agent` `event` op with titles starting "Sweep:". It owns the `mac.disk*` and `mac.sweep*` alert keys:

- Under 25 GB free: warning.
- Under 12 GB free: urgent push.
- Over 35 GB free: clears the alert.

It checks in through `agent_beat` every run. Its pulse gap is 30 min, so Scout notices if it stops.

## Never touched

Photos, iCloud Drive and its cache, Documents, Desktop, `~/Developer` code, Claude app data, Ollama models, the Keychain, and anything holding secrets (for example the signing keys in `~/cy-ship`).

## Commands

```bash
python3 ~/Bestly/sweep/sweep.py --dry-run   # show what it would do
python3 ~/Bestly/sweep/sweep.py --force     # emergency clean now
launchctl kickstart -k gui/$(id -u)/tech.bestly.sweep
```
