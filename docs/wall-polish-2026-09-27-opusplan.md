# Wall polish — opusplan (2026-09-27, 5:00 PM PT)

## 0. Strip moved by accident — DONE 5:00 PM
The top two strip corners were dragged. Restored from `state.geometryBeforeMove` (the bottom two still matched it exactly). The accidental corners are kept in `state.cornersAccident`.

## 1. Undo / redo for wall geometry (admin + DB) — worker G — DONE 5:25 PM
- DB: `wall_geometry_history` (RLS on, no grants, last 50). BEFORE UPDATE trigger `wall_geometry_track` on `wall_state` records the geometry from before any change to `corners`, `mask`, `air`, `wing`, `airAspect`, `airRot`, `airFlip`, `airBearing` — from ANY writer. Writes < 3 s apart that touch the same keys fold into one step (one drag = one Undo). Labels in plain words ("Moved strip", "Moved sky", "Moved sign wall", "Added/Changed/Removed blocked area", "Moved everything"). A script can set its own label with `set_config('wall.geo_reason', '...', true)`. The trigger can never block a wall write (errors go to Scout as `wall.geometry_track`).
- RPCs (admin only): `wall_geometry_undo()`, `wall_geometry_redo()`, `wall_geometry_history_list()`. Each step bumps `version` + `updated_at`, so the Pi reloads; the admin also pushes it over the live channel. A new change clears Redo.
- Admin (Advanced > Alignment): **Edit layout / Done** lock (dots, nudges, Bigger/Smaller, Reset are off until you tap Edit; relocks after 2 quiet minutes; locked pad lets the page scroll). Undo / Redo buttons (44 pt+, disabled when empty, show what they'll do: "Moved strip · 4:59 PM"), ⌘Z / ⇧⌘Z (Ctrl on Windows), toast after each step with the opposite action.
- Seed: one step "Accidental move 4:59 PM (restored)". Today's restored layout is the present; Undo would go back to the slipped strip, Redo returns. Leave it alone unless you want to see the slip.
- Watchdog `wall_geometry_watchdog()` (cron `wall-geometry-watchdog`, every minute): `wall.geometry_churn` if > 20 steps in 2 min or one step running > 5 min; `wall.geometry_invalid` self-heals a broken strip from the newest good step; `wall.geometry_history` if the trigger goes missing.
- Verified: rollback test (drag burst = 1 step, undo/redo exact, redo cleared by new change, anon refused) and a real undo + redo: corners came back bit-for-bit and the Pi's state.json matched within 1 s both ways.

## 2. Wall display (Pi) — worker F
- [ ] F1 Apple-design pass over the wall itself (type scale, spacing, color, motion, hierarchy on projection).
- [ ] F2 Debugging + performance + speed + reliability (board mode was 27–31 fps; target ≥ 40), watchdog coverage.
- [ ] F3 10-day forecast cycles through all 10 days; the right panel shows more for the highlighted day.
- [ ] F4 A plane name tag / highlight only ever points at a plane that is actually in view in the sky.
- [ ] F5 A blue dot on the closest aircraft at all times.
- [ ] F6 Ambient: no moving icons unless something needs Jared.
