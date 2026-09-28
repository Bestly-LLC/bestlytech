# Wall round 4 — worker brief (read fully before starting)

You are one of 8 parallel workers (W1–W8) on round 4 of Jared's **Bestly Wall**: an Anker Nebula Capsule 3 projector running a
Fully Kiosk page served by a Raspberry Pi, plus the bestly.tech admin (this repo) and Scout (the admin AI). The plan with every
workstream is `docs/wall-round4-2026-09-28-opusplan.md`; Jared's photos are in `docs/wall-round4-assets/` (view them with Read).

## Context to load
- bestly_memory (Supabase project `rcqfqhguwpmaarseifqg`, `mcp__Supabase__execute_sql`):
  `select key,title,left(body,400) from bestly_memory where key like 'house/%' order by updated_at desc limit 30`.
- Earlier plans: `docs/wall-round3-2026-09-27-opusplan.md`, `docs/wall-polish-2026-09-27-opusplan.md`, `docs/wall-feedback-2026-09-27-opusplan.md`.

## Access
- **Pi** (192.168.1.211) through Jared's Mac mini: `mcp__remote-devices__Desktop_Commander__start_process` running
  `ssh -o ConnectTimeout=8 bestly-pi-lan '<cmd>'`. Load tools with ToolSearch
  `select:mcp__remote-devices__Desktop_Commander__start_process,mcp__remote-devices__Desktop_Commander__write_file,mcp__remote-devices__Desktop_Commander__read_process_output`.
  To move a script: write it on the Mac (Desktop_Commander write_file, `/tmp/r4<w>_x.py`), then `scp -q /tmp/r4<w>_x.py bestly-pi-lan:/tmp/`.
  Keep each call under ~60 s (the bridge times out); run long jobs with `nohup` and poll.
- **Wall code on the Pi:** `/opt/bestly/wall` (`server.py`, `watchdog.py`, `www/wall.html`), service `bestly-wall`
  (`sudo systemctl restart bestly-wall`), watchdog cron every minute (`watchdog.log`), page heartbeat `http://127.0.0.1:8099/api/health`.
- **Projector:** `adb -s 192.168.1.209:5555` from the Pi. NEVER send KEYCODE_BACK. Screenshot:
  `adb -s 192.168.1.209:5555 exec-out screencap -p > /tmp/x.png` (scp to the Mac; to view it here use `mcp__remote-devices__device_stage_files` if available).
  The projector sleeps midnight–7 AM (it can crash in deep standby since a Sep 27 update — see `house/wall/projector-overnight-poweroff`).
- **Home Assistant:** docker `homeassistant` on the Pi (config `/mnt/ssd/apps/homeassistant`); HomePod = `media_player.desk`.
  Homebridge also runs on the Pi. Reuse existing token helpers in server.py; never print secrets.
- **Supabase:** `wall_state` (id=1).state = wall settings; admin writes go `wall_admin_set` → `wall_clean_patch` / `wall_clean_toggles`
  (new keys go there AND in server.py `DEFAULT_STATE`/`ALLOWED`). Pi reads data via token RPCs like `wall_pi_trips(p_token)` / `wall_pi_feeds(p_token)`.
  Migrations are append-only: new file in `supabase/migrations/` + `apply_migration`.
- **Repo:** clone `https://github.com/Bestly-LLC/bestlytech` to `/home/claude/ws-r4-<w>` (or `cp -r /home/claude/bestlytech` then pull). Admin UI:
  Vite + React + TS + Tailwind + shadcn; `npx tsc --noEmit -p tsconfig.app.json` (2 known WowButton.tsx errors), `npm run build`.

## Pi editing rule (8 workers share wall.html / server.py / watchdog.py today)
Every edit = a small **anchored** string replace, by a script run under `flock /opt/bestly/wall/.edit.lock`, that re-reads the live file,
asserts each anchor matches exactly once, backs up to `*.bak_r4<w>_<time>`, then `node --check` on the extracted page script (wall.html) /
`python3 -m py_compile` (py), restarts `bestly-wall`, and bumps the page version the way previous rounds did (check). Never write a whole file
from an old copy. Audible tests only before 10:45 PM Pacific, short and at moderate volume (Jared is home).

## Rules (Jared's standing rules)
- 12-hour times; US units (mi, ft, mph, °F); a number never wraps away from its unit (U+00A0 / `white-space:nowrap`).
- Apple HIG for any UI: load the skill `anthropic-skills:ui-ux-pro-max` with the Skill tool before UI work.
- Everything new gets a **self-healing watchdog tied to Scout** (`watchdog.py` `report(mem, key, kind, severity, title, body)`).
- Secrets only in Supabase Vault. Short guest links. Workarounds must need zero effort from Jared.
- Record decisions/learnings in `bestly_memory` (columns: area, key `house/wall/round4-<topic>`, title, body, kind `decision`, tags,
  source `cowork`, written_by `claude-cowork`; short SHAs only — 40-char SHAs are rejected).
- Commit + push to `main` (`git pull --rebase origin main` first). Every commit message ends with exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013UzuCP9Dh71YD4XgjM7JGY
  ```
- Stay in your lane (see the plan's workstreams); if you must touch another worker's file, keep it tiny and anchored.

## Finish
Tick your items in the plan doc with a one-line note each (commit it), then reply with a concise summary: done + how verified on the real
system, not done + why, anything Jared must do (plain words, ideally nothing), commit short SHAs.
