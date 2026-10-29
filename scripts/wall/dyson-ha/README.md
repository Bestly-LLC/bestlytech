# Dyson via Home Assistant (2026-10-29)

The wall's Devices card sat on "Sign in once in Homebridge" because the Homebridge Dyson plugin was never signed in.
Home Assistant already holds the Studio Dyson locally (Dyson Connector, Pi job `dyson_connect`), so the wall server
(`/opt/bestly/wall/server.py` on Hestia) now reads and drives the purifier through HA whenever Homebridge doesn't list it.

- `ha_block.py` is inserted before `def w5_take(` and wraps `w5_dyson_read` / `w5_purifier_on`. Homebridge still wins if it ever has the Dyson.
- HA token is read at runtime from `/home/pi/scripts/.env` (`HA_TOKEN`), never copied.
- `patch_dyson_ha.py server.py ha_block.py` is re-runnable (replaces its own block).
- The deploy job also turns on the purifier's Continuous Monitoring in HA, so air readings keep coming while the fan is off.
