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
