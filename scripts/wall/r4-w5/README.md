# Wall round 4 — W5 Pi patch sources

Source pieces for the anchored edits W5 applied to the Pi's live wall files (`/opt/bestly/wall`): live signatures,
"Motivate me", the fresh-air takeover + Dyson rule, the UFO skit, and their watchdog. `mkspec.py` turns them into an
edit list; `w5apply.py` applies it under `flock /opt/bestly/wall/.edit.lock` (anchors must match the live file exactly once,
backups `*.bak_r4w5_<time>`). The page script is syntax-checked with node on the Mac before the page reloads.
