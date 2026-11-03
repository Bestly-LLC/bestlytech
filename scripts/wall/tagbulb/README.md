TAGBULB_20261103: sky plane tags + edge pills ~60% size; keep-clear zones (state.avoid) for the hanging bulb; numbered calibration grid (state.calNums, NOT calGrid = old mapping grid, auto-hides 5 min after it turns on).
Apply: p_server.py <server.py> (DEFAULT_STATE avoid/calNums + validation), p_tagbulb.py <wall.html> <out.html>. DB: wall_clean_avoid(jsonb) + wall_apply_patch with it + calNums in wall_clean_toggles allow-list.
Use: python3 set_avoid.py 14 15 24 25  -> prints SQL for wall_apply_patch. --clear removes zones, --grid on|off shows/hides the grid.
Undo: restore Hestia server.py.bak_tagbulb_084646 and www/wall.html.bak_tagbulb_085107, restart bestly-wall, CDP reload.
