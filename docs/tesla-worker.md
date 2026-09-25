# The Tesla worker

`worker.py` runs on the Mac mini at `~/.bestly/tesla-worker/worker.py`, kept alive by launchd. It
polls `tesla_worker_claim` every few seconds and runs whatever job comes back — key invites and
removals, the driver list, health reads, drives, charges, nearby Superchargers.

**It is not in this repo and cannot be deployed from the cloud.** The file lives on that Mac.

## Shipping a change

1. Edit `~/.bestly/tesla-worker/worker.py` on the Mac (keep a `worker.py.bak-<old version>`).
2. Bump `VERSION` at the top.
3. `update tesla_fleet_settings set min_worker_version = '<new version>' where id = 1;`

The running copy then fails its poll — `tesla_worker_claim` raises for a version below the floor —
counts twenty failures over about ten minutes, exits, and launchd restarts it on the new file.
`tesla_worker_version_watchdog` (:08 and :38) raises to Scout if it has not come back after 25
minutes, and says how to recover: start it by hand, or clear `min_worker_version`.

## What the health read carries (1.8.0)

One `vehicle_data(["vehicle_state","charge_state"])` call per health job. From it:

- tyre pressures and warnings, `tpms_at`
- `fd_window` / `fp_window` / `rd_window` / `rp_window` — 0 shut, above 0 open
- `doors_open` (df/pf/dr/pr), `trunk_open`, `frunk_open`, `locked`
- pending software update, sentry, odometer, battery, charge limit, charging state

The window keys are deliberately flat: `car_raw_find` matches on key name, so `fd_window` is found
and a nested `windows: {fd: 0}` would not be. Any result carrying a window key is filed into
`car_status_raw` row 2 (the Fleet source) by `trg_car_raw_from_command`, which is what makes
`car_windows_open()` answer true or false instead of null.
