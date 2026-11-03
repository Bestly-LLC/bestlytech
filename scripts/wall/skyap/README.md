# Sky airports, landing / taking-off planes, airline logos (SKYAP_20261102)

- `p_server.py` patches Hestia `aircraft_enrich.py` + `server.py` (ONT, `fz/fa/fm/al/ai` phase fields, sky-board `flow/flow_hdg/next_eta/count15/night`, `/logos/<ICAO>.png`, logo watchdog start).
- `skyap_logos.py` lazy logo cache (Jxck-S/airline-logos), watchdog key `wall.skysync.logos`.
- `p_wall.py wall.html sky.js sky.css` patches the wall page (refuses an already patched file).
- `skycheck.mjs` headless check against the Mac tunnel.
Undo: restore the `*.bak_skyap_*` files on Hestia, `sudo systemctl restart bestly-wall`, kickstart `tech.bestly.wall-mac`.
