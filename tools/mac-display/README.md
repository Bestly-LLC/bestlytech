# Mac Display: the Home app switch for the Mac mini's monitor

"Hey Siri, turn off the Mac display" or the **Mac Display** tile in the Home app (added Oct 6, 2026).

- **Homebridge (Pi):** accessory "Mac Display" (`homebridge-http-switch`, stateful) calls the wall server on loopback:
  `GET /api/macdisplay/on|off|status`.
- **Wall server (Pi `server.py`):** keeps the wanted state (`MACDISP`) and the last state the Mac reported.
- **This agent (Mac mini):** `~/Bestly/macdisplay/macdisplay.py`, LaunchAgent `tech.bestly.macdisplay` (KeepAlive).
  Polls `127.0.0.1:18099/api/macdisplay/poll` every 2 s through the wall's SSH tunnel, so a new Mac IP never breaks it.
  Off = `pmset displaysleepnow`; on = `caffeinate -u -t 2`. Display state comes from `CGDisplayIsAsleep`.
- The wall keeps rendering at 60 fps with the display asleep.
- Checks in with Scout as `mac-display` every 10 min. Log: `~/Bestly/macdisplay/macdisplay.log`.
