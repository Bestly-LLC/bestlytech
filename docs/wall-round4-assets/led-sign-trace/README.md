# LED sign trace (W8, wall round 4, 2026-09-28)

Vector trace of the neon sign on the sign wall, registered to projector space. Pipeline (Python, OpenCV):
`trace.py` (tube mask + skeleton from `led-sign-on-purple.jpg`) → `graph.py` / `merge.py` (skeleton → 14 strokes; the
grip fingers are drawn by hand in `build.py`) → `reg.py` (purple photo → grid photo homography by chamfer fit) →
`proj.py` (grid photo → projector: grid C6/C7 dots and line fits; horizontal scale = 1.20 × vertical, measured from
the 3 px / 1.5 px grid stroke widths) → `build.py` (smoothed paths, polyline samples, acrylic plate, `lsign_geo.json`).

`lsign_geo.json`: `cx, cy` = sign center (0..1 of the screen), coordinates in ref px of a 960×540 viewport relative
to the center; `paths` (SVG), `pts` (polylines every ~1.5 ref px), `lens`, `plate` (acrylic outline), `box`.
The live copy is embedded in the Pi's `wall.html` (block "W8 round 4 … LED sign projection mapping");
`wall-lsign-block.template.js` is that block with `__LSG__` in place of the JSON.
