# Wall v5 (Oct 29, 2026)

Jared: "Do 1-5 but fix all broken, don't hide. The clock is still overlapping the middle widget."

- Left panel fit (`leftFit`): the clock and whatever the panel rotates to scale down just enough to stay inside the 500 px panel.
- Scrolling lines (`.wmq`): wide soft fade on both edges, so mid-scroll text reads as scrolling, never cut off.
- Roads and traffic 25% dimmer; plane name tags bold white.
- Freeway shields: only the 4 nearest Home, and they steer around plane tags and alert dots.
- City names: far-edge stretch capped at 1.5x (was 3x).

Needs v4. `patch_wall_v5.py wall.html v5_css.txt v5_js.txt` (re-runnable). `cdp_check.py` reloads and checks the Mac mini wall tab.
Undo: copy `/opt/bestly/wall/www/wall.html.bak_v5_<stamp>` back on Hestia, reload the wall tab.
