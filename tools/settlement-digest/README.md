# settlement-digest (Nickel lock-screen "Yes, file all")

INSTALLED on bestly-pi 2026-10-10 as `bestly-settle-actions` (systemd, Restart=always, RestartSec=10, User=pi).
Tap flow and the sworn-statement rule: header of supabase/migrations/20261011003000_settlements_digest_push.sql.
Tapping the notification body or Open still lands on https://bestly.tech/admin/settlements?digest=<id> (one big confirm button), which needs no listener.

What runs
- Code on the Pi: `/opt/bestly/settlement-digest/ha_action_listener.py` (this folder's copy is the source of truth; copy it over and restart).
- Unit: `/etc/systemd/system/bestly-settle-actions.service` (copy: `bestly-settle-actions.service` here).
- It subscribes to the Home Assistant websocket event `mobile_app_notification_action` (python3-websockets, already on the Pi) and, only for
  `SETTLE_YES_<digest uuid>`, calls `settlement_digest_action_t(token, uuid, 'yes')` once (deduped in memory; the RPC is idempotent anyway).
  Reconnects with backoff (5 s up to 60 s) if HA restarts.

Credentials (nothing new was created; nothing is printed)
- Home Assistant token: `HA_TOKEN=` line in `/home/pi/scripts/.env` (the same file the wall server and hapush.py use).
- Supabase token: `/home/pi/.bestly/db_watchdog_token` (mode 600).
- Heartbeat: `/opt/bestly/cron/lib.py` `rpc("pi_job_report")` with the service key in `/home/pi/scripts/.env`, like every Pi job.

Watchdog (Scout)
- Beats `pi_job_report('settle-actions')` every 10 min, `ok` only while the HA websocket is connected. `pi_jobs.max_gap_min = 30`, so a dead
  or disconnected listener alerts Scout. Team card `settle-actions` ("Yes Button", tool of Nickel) from migration
  `20261011004000_settle_actions_listener.sql`.

Operate
- Status: `systemctl status bestly-settle-actions`; logs: `journalctl -u bestly-settle-actions -f`.
- Safe test (approves nothing, there is no such digest): from the Pi, POST `{"action":"SETTLE_YES_00000000-0000-0000-0000-000000000000"}` to
  `http://127.0.0.1:8123/api/events/mobile_app_notification_action` with the HA token; the log shows `-> {'n': 0, 'state': 'missing'}`.
- The alternative of a `SETTLE_YES_` branch inside the wall's `ha_events_loop` was NOT used on purpose (server.py is critical and edited elsewhere).
