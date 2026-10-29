# Local alerts v4 (wall)

Oct 29, 2026. Jared: alerts "below the air, like the plane card on the sign wall", no Sky Sync tag, and a cleaner sky.

- `v4_css.txt` + `v4_js.txt`, applied by `patch_wall_v4.py` (needs v3; re-runnable).
- Sky: alert dots only (no labels, no notes stack), smaller halo, dots nudged off Home.
- Sign wall: `#wingAlerts` card under the flight card (or in its slot when no plane is close), 2 rows + "+N more", hides when nothing is near home.
- Declutter: plane name tags never stack; place names skip anything that would cover Home, a plane tag, an alert dot or another name.
- `cdp_check.py` (run on the Mac mini): reloads the "Bestly Wall" tab and prints the checks.

Deploy: Mac job (needs Jared's Run tap). Backup on Hestia: `/opt/bestly/wall/www/wall.html.bak_v4_<stamp>`.
Undo: copy that backup over `wall.html`, then reload the wall tab.
