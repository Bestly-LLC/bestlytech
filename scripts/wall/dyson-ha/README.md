# Dyson via Home Assistant (2026-10-29)

The wall's Devices card sat on "Sign in once in Homebridge" because the Homebridge Dyson plugin was never signed in.
Home Assistant already holds the Studio Dyson locally (Dyson Connector, Pi job `dyson_connect`), so the wall server
(`/opt/bestly/wall/server.py` on Hestia) now reads and drives the purifier through HA whenever Homebridge doesn't list it.

- `ha_block.py` is inserted before `def w5_take(` and wraps `w5_dyson_read` / `w5_purifier_on`. Homebridge still wins if it ever has the Dyson.
- HA token is read at runtime from `/home/pi/scripts/.env` (`HA_TOKEN`), never copied.
- `patch_dyson_ha.py server.py ha_block.py` is re-runnable (replaces its own block).
- The deploy job also turns on the purifier's Continuous Monitoring in HA, so air readings keep coming while the fan is off.

## Round 2 (1:40 PM): the Dyson's local port 1883 is closed
Home Assistant keeps the last fan state but gets no air data (`DysonNotConnected`), so the wall must not show it as live.
- `ha_block.py` now raises "isn't answering" when every air sensor is blank, so the card dims to "Last seen" instead of fake live numbers.
- `patch_card_text.py` swaps the card's "Sign in once in Homebridge" for "Not answering on Wi-Fi" / "Not connected yet".
- `remote_dyson2.sh` (Hestia) applies both, then waits up to 6 min for port 1883, reloads the HA `dyson_local` entry and turns on continuous monitoring.
- The real cure is a power cycle of the purifier (unplug 10 s); nothing in the house can do that remotely (no smart plug on it).
