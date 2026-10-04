# Home Assistant wall controls (generated)

`gen_wall_ha.py` turns `src/config/wall-controls.json` (the same list the admin follows) into:

- `bestly_wall_controls.yaml`: HA package. One REST sensor (`sensor.wall_state`, via `wall_ha_get`) holds the wall state;
  every control is a template switch/select/number/button that writes through `wall_ha_patch` / `wall_ha_power` /
  `wall_ha_command` (Home Hub agent key, kept in HA `secrets.yaml`). Same cleaning chain as the admin.
- `wall_views.json`: the Wall tab ("now" controls + a Settings list) and one subview per settings pane, following
  `now` and `panes` in the manifest.

On the Mac: `python3 gen_wall_ha.py wall-controls.json`, copy the package to the Pi
(`/mnt/ssd/apps/homeassistant/packages/`), and rebuild the Bestly Home dashboard with
`/opt/bestly/ha-dashboards/build_dash_v4.py` (it reads `wall_views.json`). Template entities reload with
`template.reload`; a new REST resource needs an HA restart.
