# Wall polish — opusplan (2026-09-27, 5:00 PM PT)

## 0. Strip moved by accident — DONE 5:00 PM
The top two strip corners were dragged. Restored from `state.geometryBeforeMove` (the bottom two still matched it exactly). The accidental corners are kept in `state.cornersAccident`.

## 1. Undo / redo for wall geometry (admin + DB) — worker G
- DB keeps a geometry history automatically: any change to `corners`, `mask`, `air`, `wing` (or their aspect keys) pushes the previous set onto `wall_geometry_history` (last 50), from ANY writer (admin drag, nudges, recalibration).
- RPCs `wall_geometry_undo()` / `wall_geometry_redo()` (admin only) move through it; the redo stack clears on a new change.
- Admin Layout tool: Undo / Redo buttons (Apple HIG: clear, 44 pt, disabled when empty, shows what it will undo — "Undo: moved strip, 4:59 PM"), plus ⌘Z / ⇧⌘Z on desktop.
- Seed the history with the accidental move so Redo/Undo works right away.

## 2. Wall display (Pi) — worker F
- [ ] F1 Apple-design pass over the wall itself (type scale, spacing, color, motion, hierarchy on projection).
- [ ] F2 Debugging + performance + speed + reliability (board mode was 27–31 fps; target ≥ 40), watchdog coverage.
- [ ] F3 10-day forecast cycles through all 10 days; the right panel shows more for the highlighted day.
- [ ] F4 A plane name tag / highlight only ever points at a plane that is actually in view in the sky.
- [ ] F5 A blue dot on the closest aircraft at all times.
- [ ] F6 Ambient: no moving icons unless something needs Jared.
