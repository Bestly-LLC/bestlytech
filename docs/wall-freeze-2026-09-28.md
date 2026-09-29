# Wall freezing - 2026-09-28

**Cause:** the projector (Nebula Capsule 3, 2 GB RAM) ran out of memory. Fully's WebView held ~255 MB of GPU memory while ~800 MB of
Google TV background apps (launcher, YouTube TV, Assistant, Play services) shared the rest. MemAvailable fell to ~50-360 MB, ~3 GB went to
swap since boot, and the GPU logged thousands of `eglCreateImage failed 0x3003`. The page's own fps counter kept saying 30-50 while the screen stalled.
The Pi (load 0.6, 48 C, not throttled) was healthy. Android load average sits at ~57 all the time - ignore it.

**Fix (Pi `watchdog.py`, `freeze_watch`, backup `.bak_frz_*`):**
- MemAvailable < 300 MB for 3 checks -> force-stop YouTube TV, its recommendations, Assistant, keyboard (max every 15 min).
- Still < 200 MB 5 min later -> restart Fully (max once per 3 h) and tell Scout (`wall.freeze_mem`).
- Screen frozen: identical raw frame in 3 captures 2 min apart while the page reports live -> restart Fully, tell Scout (`wall.freeze_screen`).
- Permanent: `pm disable-user --user 0 com.google.android.katniss` (undo: `pm enable com.google.android.katniss`).

**Result:** free memory 50-360 MB -> ~500 MB. fps still swings 19-35 (the page is heavy for this GPU): next lever is a lighter mode / fewer planes.

## Update 9:18 PM - it froze again (memory was fine)
Real symptom is **hitches**: frames stalling 0.35-0.8 s, 2-6 a minute, while fps averages 25-35. The old auto-lite needed fps < 16 six times in a row, so it never fired.
- Page: `HIT` counter (frames > 350 ms, rolling 60 s) sent in the heartbeat as `hit {n,max}`. `autoLite` now trips at >= 4 hitches a minute and only recovers at fps >= 30 with < 2 hitches.
- Watchdog: `freeze_watch` tells Scout (`wall.hitch`) after 5 minutes of >= 6 hitches a minute. `launch_wall()` now logs who asked for every wall-app restart.
- Lead: each new aircraft adds ~100 DOM nodes (planes 12 -> 17, nodes 1235 -> 1640) and hitches line up with planes appearing. Next lever: cheaper per-plane tag/route layers.
- Backups on the Pi: `wall.html.bak_hit_*`, `server.py.bak_hit_*`, `watchdog.py.bak_hit_*`, `watchdog.py.bak_lw_*`.

## Update 9:40 PM: the real freeze (graphics memory)
- **Symptom:** at 9:32 the wall clock still said 9:26. The sky kept moving and the page kept ticking, but the clock and cards stopped repainting.
- **Cause:** the projector's GPU ran out of memory. logcat showed `eglCreateImage failed 0x3003` (EGL_BAD_ALLOC) about 8 times a second.
  - There are zero errors right after a fresh start of the wall app. They build up over minutes.
- **Why nothing caught it:** the whole-frame check could never fire, because the sky is always moving.
- **Detector:**
  - The heartbeat now carries `clk` (the page's clock text and its last tick time).
  - The watchdog hashes the strip band (rows 380-700 of the raw screencap) every minute.
  - 3 identical strip hashes while `clk` changed, or >= 150 BAD_ALLOC a minute for 2 checks, restarts the wall app (at most once every 4 minutes).
  - It reports `wall.repaint` to Scout, and pushes an alert after 3 in an hour.
- **Trace:** `/opt/bestly/wall/gpu_trace.log` logs one line a minute to find what eats GPU memory.
- **Next:** cut GPU memory use (full-screen canvases at 2x, composited layers per plane).
