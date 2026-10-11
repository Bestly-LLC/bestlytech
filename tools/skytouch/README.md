# SkyTouch on the Pi

Moves the two SkyTouch Claude scheduled tasks to the Pi. Free (stdlib Python, no AI, no Claude), and shipped PAUSED.

| Old (Claude task, left disabled as the fallback) | New (Pi cron) | When |
|---|---|---|
| `trig_01Fp91TUjwpmZ6afXKQLWMUZ` SkyTouch text auto-responder | `skytouch_triage` | `:03` every hour |
| `trig_01KvqCmUx3AEbEYnpkTrNWfP` SkyTouch morning availability check | `skytouch_morning` | 8:11 AM daily |

Controls: `/admin/skytouch` (master switch, per-job switches, "send the first reply by itself", "text me each morning", stale hours,
and the two write-only connection fields). Settings live in `skytouch_settings`; both jobs call `skytouch_gate()` first.

## Rules (carried over unchanged)
- The only thing the bot may send to a client is the fixed first intake reply, and only when "send the first reply by itself" is on.
  Everything else becomes a card on `/admin/skytouch` with a suggested reply for Jared.
- Never sent: the address, anything about sexual services (flagged, no reply), price talk, roofing/property texts (RoofGuard).
- Jared's own cell (816) 500-7236 is instructions, never a client. Rates are fixed and never negotiated.
- Gmail labels `SkyTouch/Handled` and `SkyTouch/Flagged` track thread status.

## Connection (Jared supplies, on /admin/skytouch)
- Gmail app password for jareds.mac@gmail.com (16 letters) -> Vault `pi:skytouch:gmail_app_password`
- Optional: Google Calendar "Secret address in iCal format" links, one per line -> Vault `pi:skytouch:calendar_urls`
Until the app password is saved the jobs report `skip: Gmail not connected yet`.

## Install / test
    sh install.sh                       # on the Pi
    python3 tools/skytouch/test_skytouch.py   # offline tests, sends nothing
    /opt/bestly/cron/run.sh skytouch_triage   # while paused: writes one "paused" heartbeat only
To read-only test the real Gmail after the password is saved: `python3 -c "import sys; sys.path.insert(0,'/opt/bestly/cron'); from jobs.skytouch_triage import main; print(main(['--force-on']))"`
(`--force-on` implies `--dry`: reads only, never writes, labels or sends).

## Undo
Switch the master off on `/admin/skytouch`, then re-enable the Claude task if wanted. To remove the cron lines: `crontab -e`, delete the two `skytouch_` lines (backup at `/home/pi/scripts/crontab.bak-*-skytouch`).
