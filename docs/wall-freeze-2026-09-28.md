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

## Update 11:02 PM: root cause found (browser auto-update)
- **Cause:** the projector's Android WebView auto-updated on **Sep 27 at 11:14 AM**, from 148.0.7778.215 to 155.0.8059.16. Version 155 hits the EGL_BAD_ALLOC storms roughly every 10 minutes.
- **Rollback:** `adb shell cmd package uninstall-system-updates com.google.android.webview`. `pm uninstall-updates` doesn't exist on this Android 14. There are zero EGL errors on 148.
- **Pin (`webview_pin()`):** checks every hour and rolls the WebView back again if Play updates it (`wall.webview`).
- **My bad edit:** the moon-once-a-day change put a `//` comment mid-line and commented out `const im=new Image()`. The page crashed on start and showed the blank skeleton ("Saturday, September 26"). Fixed.
- **Bad-edit guard:**
  - `pagetest.py` loads the page in the Pi's own Chromium, with heartbeats blocked, and reports script errors.
  - `page_start_guard()` runs it after 3 dead-page restarts in 10 minutes and restores the newest backup that starts cleanly (`wall.bad_edit`, with a push alert).
  - **Rule:** run `pagetest.py` after every `wall.html` edit.
- **Pi-renders-it test:** headless Chromium on the Pi falls back to software rendering (SwiftShader) and gets **15 fps**, worse than the projector. The real options are an HDMI cable from the Pi to the projector, or a GPU compositor plus a stream.

## Update 11:21 PM: projector reboot, and the Pi-render experiment
- **Trigger:** the trouble started after the projector woke from its 7:14 PM scheduled sleep (at 8:01 PM; first crash 8:15 PM). Freezes also happened on WebView 148 (11:00-11:03, with no EGL errors).
- **Fix:** a full `adb reboot` of the projector cleared it.
- **Escalation:** the watchdog now reboots the projector on the 3rd repaint freeze in an hour (at most once every 6 hours).
- **Pi-render experiment (rejected by Jared, now dormant):**
  - How it worked: `renderer.py` plus the `bestly-wall-render` service took a Pi Chromium screenshot of a transparent strip PNG every 3 s. The projector overlaid it (`body.thin` hides `#stage`).
  - Jared's rule: the wall must look and animate identically, whatever runs behind it.
  - The service is disabled. The page only switches to thin mode when `/render/strip.json` is fresh.

## Sep 29, 4 AM: overnight Scout alerts
- **"Plane Live Activity can't reach the phone": false alarm.**
  - Why: no phone is registered yet (the Bestly Sky app isn't installed). Network blips at 2:23 AM and 3:13 AM set `fail_since`, and only a successful push could clear it.
  - Fix: a good health call now clears it. The watchdog only alerts once a phone is registered.
- **"The hourly chime isn't playing":**
  - Why: the page only chimed within the first 5 seconds of the hour, and a wall-app restart wiped `chime_at`.
  - Fix: a 45-second window, plus the server keeps the last chime across heartbeats.
- **Hitching / freezes:**
  - Pattern: after the reboot, the page ran at 30+ fps for 2 to 5 minutes after each restart, then dropped to 7-9 fps even with 2 planes.
  - Test: a 6-minute profile in the Pi's Chromium, forced into daytime board mode, stayed steady. So the slowdown is on the projector's side.
  - Diagnostics: `slow_diag()` writes `slow_diag.log` (CPU frequency, thermal, per-thread CPU, graphics memory) whenever the wall slows. Follow-up scheduled after the 7 AM wake.

## Sep 29, 8:20 AM: hitching cause (the sound engine) and early wake
- **Cause:**
  - The live WebAudio bus (compressor + 2.4 s convolver reverb) costs the projector about 10 fps even in silence. Measured: 41-44 fps with sound locked, 26-37 with it unlocked.
  - The wall collapsed to about 13 fps right after the 8 AM chime.
- **Fix (`sndIdleHook`):**
  - Suspends the AudioContext after 20 s with no active sources.
  - Any new buffer source or oscillator resumes it instantly, so sounds are unchanged.
  - `sndRunning()` handles the can-play checks. `sndState()` reports idle as running, so the watchdog doesn't tap.
- **Early wake:**
  - Before, the page ignored the Pi's power override and stayed black before 7 AM.
  - Now: `/api/hold` plus a page poll mean off-hours with a hold show the board.
  - The watchdog's `manual_wake_check()` holds the projector awake until 7 AM after a hand wake. A crash reboot still goes back to sleep.

## Sep 29, 9:15 AM: the projector's GPU hangs, plus self-heals
- **The underlying failure:** the projector's Mali GPU hangs.
  - 9:03 AM: `mali JOB_READ_FAULT`.
  - 8:25 AM: `ANR in de.ozerov.fully: stuck fence. Indicates GPU hang`, with `mali-mem-purge` at 92% CPU.
- **The watchdog gap:** it stood back silently for 20 minutes during the 8:25 hang.
  - Fix: `hang_check()` runs before those early returns. It triggers on an ANR window or a heartbeat dead for 3+ minutes, restarts the wall app, and reports `wall.hang`.
  - The "in use" return now logs.
- **Sun/moon SVG image swaps:** the sun swapped every 30 minutes and the moon hourly, and the freezes clustered at :00 and :30.
  - Now the new picture is decoded off-screen first, the sun swaps every 3 hours and the moon daily. Same look.
- **Daily clean reboot:** the first 7 AM wake each day is an `adb reboot`, for a fresh GPU driver.

## Sep 29, 12:15 PM: graphics memory is spiky, not leaking
- **Pattern:** normal is 190-240 MB. Spikes add 60-70 MB (about 8 full-screen layers) and last about a minute. The 10:43 spike stuck at 274-290 MB and froze the wall (restarted 10:46).
- **Tracing:** the heartbeat now carries `cls` (the page's body classes, i.e. which effects are running), and the trace logs it, so each spike names its effect.
- **Guard:** the watchdog restarts the wall app early when graphics stays at 270+ MB for 2 checks (at most every 10 minutes).

## Graphics-memory spikes: what the trace shows (3:15 PM, Sep 29)
- **No spike since the 12:14 PM trace started.** Graphics memory stayed at 175 to 256 MB for 3 hours, never 270+. Page classes stayed the same throughout (`key-on sky-home fl-on`), and scenes made no difference: Board about 210 MB, Daily about 221 MB, Hourly about 211 MB.
- **Today's spikes happened before the trace** (10:43 to 10:46 AM at 274 to 290 MB, 11:19 AM at 282 MB, 11:32 AM at 284 MB). The 10:43 spike came with "projector memory low (261 MB)", then a repaint stall and a restart. So the pressure seems to come from Android system memory (TV apps in the background), not from a page effect.
- **The 12:16 PM stall** (7 fps, restart at 12:20) came right after a fresh page load, with graphics memory only at 212 to 240 MB. That's start-up load, not a spike.
- **Nothing changed on the page.** No effect was implicated, and the rule is that the wall must look and animate exactly the same.
- **Added** `ram=` (projector free system memory, MB) to every `gpu_trace.log` line (`watchdog.py`, backup `.bak_gfxram_151744`), so the next spike can be tied to system memory or to page classes. First line: `gfx=207 ram=306`, which is close to the 300 MB trim threshold.
- **Still guarded:** the watchdog restarts early when graphics memory is 270+ twice in a row, and trims background apps when system memory is under 300 MB for 3 checks.

## Evening graphics spikes (9:30 PM check, Sep 29)
- **Not projector free memory.** From 5:07 PM, graphics memory ran at 250 to 440 MB with projector free memory at 250 to 460 MB. There were 10 early app restarts between 5:22 and 9:47 PM, and fps dropped to 7 to 9. Each restart only helped for a few minutes.
- **The Halloween theme (`hw`) came on at 5:07 PM**, exactly when the spikes started. But the spikes continued after the theme was turned off at 9:42 PM (441 MB at 9:50 PM in ambient mode), so the theme isn't the only cause.
- **The projector itself was worn out:** load around 58, swap 80% full (421 of 524 MB), and a video decoder plus Widevine DRM service active in the background.
- **Changed with no visual change:**
  - `wall.html`: Halloween bats canvas (`#hwDecor`, always `display:none`) no longer draws while hidden and shrinks to 1x1 (backup `.bak_hwcv_213233`, passed `pagetest`).
  - `watchdog.py`: the 3rd graphics-memory restart within an hour now reboots the projector (at most every 6 h, shared `proj_reboot_at`). `gpu_trace` now logs `swap=`. Backup `.bak_gfxesc_215348`.
- **Manual projector reboot at 9:54 PM:** afterward graphics memory was 241 to 249 MB at 35 to 43 fps. Swap refilled to about 78% within 7 minutes, so watch `swap=` next to spikes.
- **10:08 PM: Google TV "Autoplay video" turned OFF** (Settings > Accounts & Profiles > Jared), done over adb from the Pi (DPAD navigation plus `uiautomator dump` to read the screen). That stops the home-screen trailers that the `wall.autoplay` guard kept pulling the wall back from. It was probably also the source of the background video decoding and Widevine activity seen during the evening graphics spikes. If a Google TV update turns it back on, the same adb path works: Settings, 4 down, OK, OK, right, down, OK.
- **Morning check (9:12 AM, Sep 30):**
  - **Swap isn't the trigger.** Swap was about 64% whether graphics memory was normal or spiking, so FRZ_BLOAT was not changed.
  - **After the 9:54 PM projector reboot there were still 3 graphics restarts** (10:14, 10:50 and 11:04 PM, in ambient mode). The new escalation correctly held off because of the 6-hour reboot cap.
  - **After 11:04 PM it was steady** at 212 to 217 MB and 44 fps until the trace stopped at 11:16 PM.
  - **Overnight the projector shut itself off in standby** again: unreachable since 1:34 AM, ping silent, and Wake-on-LAN every 15 minutes had no effect. The Pi raised `wall.offline` at 6:59 AM ("press the power button on the Nebula remote"). This is still the known deep-standby crash, and it needs someone to press the button.

## Oct 3, 10 PM: the Pi now draws the wall, and the projector only plays video

**Why.** Every freeze traced back to the projector drawing the page itself. It has 2 GB RAM, a weak GPU, and Google TV running alongside. Graphics memory sat at 200–440 MB, and the GPU hangs start at about 270 MB. Jared's goal: stable, with the same look and the same connection.

**How it works now.**
- `bestly-wall-stream.service` on the Pi (user pi) runs `/opt/bestly/stream/stream.sh`:
  - cage (headless Wayland, V3D GPU) runs Chromium in kiosk mode at `http://127.0.0.1:8099/?src=pi`. It's the exact same wall page, unchanged.
  - wf-recorder captures it with x264 (ultrafast, zerolatency, 25 fps), and ffmpeg adds the page sound (from the snd-aloop "Loopback" card, encoded as opus).
  - The result is published over RTSP to go2rtc as stream `wall`.
- The projector's Fully kiosk opens `http://192.168.1.211:8099/stream` (`www/player.html`):
  - It plays `/wall.mp4` through MediaSource. `server.py` proxies go2rtc's `stream.mp4`.
  - It keeps itself near live: it plays at 1.12x when more than 0.7 s behind, and seeks when more than 3 s behind.
- **Fallback is automatic.** If the player gets no video for 25 s, it loads the normal wall page, so the projector draws it again, exactly like before. `stream_watch` brings the projector back to the stream once the stream has been healthy for 2 minutes.
- **Switch:** the file `/opt/bestly/stream/ON`. Delete it to go back to the old method; the watchdog's `WALL_URL` follows the file.
- WebRTC was tried and dropped: about 30% RTP loss on the projector and 0 decoded frames. Plain progressive MP4 also played, but drifted about 4 minutes behind.

**Results at the first check (9:53 PM):**

| | Before (projector draws) | Now (stream) |
|---|---|---|
| Projector graphics memory | 200–440 MB | 62 MB |
| Frame rate on the wall | 10–28 fps | 24–28 fps |
| Delay | — | about 1 s (lag 0.8–2 s) |
| Sound | — | plays |

- Pi CPU is about 50% for the whole pipeline.

**Watchdog (`watchdog.py`, Oct 3 10 PM patch, backup `.bak_streammode_*`):**
- `stream_mode(hb)` is true when the flag exists and the player reports `showing=stream`. In that mode the heartbeat's fps and clock come from the Pi's copy of the page.
- `hang_check` and the main "page heartbeat stale" check use the player's beat (`stream.player_age_s`) for projector liveness. A stale Pi page is `stream_watch`'s job.
- `stream_slow_check`:
  - Pi copy under 12 fps for 3 checks → reload just that page over CDP (`pi_tap.py reload`). The stream keeps running and the projector isn't touched.
  - Player under 12 fps for 3 checks → restart Fully.
  - Max 2 fixes an hour each, then it tells Scout.
- `slow_diag` (which records projector CPU and GPU) is skipped in stream mode.
- **Night:** when the projector sleeps, the watchdog stops the stream service, and starts it again on wake. During that minute the projector shows its own copy, then the watchdog moves it back to the stream.
- These still apply unchanged, since they watch the projector itself: the graphics-memory guard, the repaint-stall and frozen-screen checks, and memory trimming.
- `stream.sh` heals itself:
  - It restarts the encoder if it dies.
  - It exits (and systemd restarts the service) if the Pi page heartbeat stays over 90 s for 3 checks.
  - It clicks to unlock the Pi page's sound when that sound is locked.
  - It refreshes the page daily at 4:10 AM.
- Scout key: `wall.stream`.

## Oct 4, 11 AM: stream smoothness (choppy and laggy)

**Causes (measured):**
- **Uneven frame timing.** 25 fps on the projector's 60 Hz screen holds frames for 2 or 3 refreshes unevenly, which shows as judder.
- **The player chased a 0.3 s delay.** It sped up to 1.12x and jumped, so motion lurched.
- **The Pi's CPU was contended.** The x264 encoder uses about 1.5 to 1.7 cores. Ollama (`llama-server` in the docker container `ollama`) could take 3 cores when asked something, and voice.py spikes to about 70%. That made the Pi's copy of the page dip to 22 fps.

**Fixes:**

| Change | Where | Backup |
|---|---|---|
| Capture at 30 fps, keyframe every 2 s (`-r 30`, `g=60`) | `stream.sh` | `.bak_smooth_*` |
| Player holds a steady ~1.2 s cushion at 1x speed: 1.03x only past 2 s behind, a jump only past 5 s | `player.html` | `.bak_smooth_*` |
| `CPUWeight=1000` (the stream wins CPU contention) | `bestly-wall-stream` via `systemctl set-property` | — |
| `docker update --cpus 2 --cpu-shares 256` | `ollama` container | — |

- **Result:** player steady at 30 fps, 2 dropped frames in about 3,400, 0 stalls, delay about 1.1 s.
- **Watchdog `stream_smooth_watch`** (every minute while the projector plays the stream):
  - More than 90 dropped frames a minute, or the Pi copy under 24 fps, for 5 minutes → reload the Pi copy (max 2 an hour) and tell Scout (key `wall.smooth`).
  - It re-applies the Ollama cap hourly if the container was recreated.
- **Also Oct 4:** the Pi had no emoji font, so the sign wall's 🔥 showed as a box. Fixed by installing `fonts-noto-color-emoji` and restarting the stream (Chromium reads fonts only at startup).

## Oct 4, 1 PM: the Mac mini draws the wall at 60 fps ("butter smooth")

**Why the Mac:** the Pi has no H.264 encoder chip. It drew the page at 21–27 fps and spent about 1.5 cores on software x264. Jared asked for butter-smooth and chose the Mac mini (M4, wired, always on via `tech.bestly.stay-awake`).

**How it works:**
- **The agent.** `~/Bestly/wall-mac/agent.mjs` (Node 22, no dependencies), run by LaunchAgent `tech.bestly.wall-mac`.
  - It starts hidden Chrome (`--headless=new`, window 1922×1224 so the captured page is exactly 1920×1080) and opens the wall at `http://127.0.0.1:18099/?src=pi`.
  - That address is an SSH tunnel to the Pi's 127.0.0.1:8099, so the Pi's wall server treats this copy exactly like the Pi's own copy.
- **Capture and encode.** The agent captures the tab (`--auto-accept-this-tab-capture`) and sends WebRTC to go2rtc `wallmac` through a tunnel to 127.0.0.1:1984. Media goes direct to the Pi on port 8555.
  - H.264 **High** profile is preferred. The Mac's VideoToolbox chip handles only High; constrained baseline falls back to software OpenH264.
  - The answer is rewritten with `x-google-min-bitrate=8000` (go2rtc sends no bandwidth feedback, so Chrome's estimate sat at about 60 Kbps).
  - Encoding uses `maintain-resolution`, because a mid-stream size change breaks the projector's MSE player.
- **Results.** Mac page: 60 fps of animation, VideoToolbox, 1920×1080, up to 60 fps sent.
  - Frames are only sent when something moves, so the rate varies.
  - The sky planes used to step every 50 ms (20 Hz). `wall.html` now steps them every frame when the page runs at 55+ fps, which only happens on the Mac (backup `.bak_sky60_*`).
- **The Pi:**
  - `server.py` `wall_src()`: `/wall.mp4` plays `wallmac` whenever it is arriving, else `wall`.
  - `airplay.py` and `go2rtc.yaml` define the `wallmac` stream.
  - `watchdog.py` `mac_arbiter`: when Mac video has been rising for 2 checks, it stops `bestly-wall-stream` (the Pi copy). When the Mac stops for 2 checks, it starts the Pi copy and tells Scout (key `wall.mac`).
- **Self-heal (Mac):**
  - Tunnel, Chrome, a crashed page, and a link that says "connected" but sends no bytes for 15 s each trigger a restart or republish.
  - Daily fresh page at 4:10 AM.
  - Status in `~/Bestly/wall-mac/status.json`; log in `agent.log`.
  - Create the file `~/Bestly/wall-mac/OFF` to pause it, and the Pi takes over.
- **Projector player:** goes fullscreen on the first tap (the watchdog taps after every launch).
- **Still open:** at 60 fps the projector plays about 55 and drops frames in bursts. Fully (WebView compositing) uses about 120% CPU; its hardware decoder is only at 18%.
  - The next lever is Fully's native video player (`fully.playVideo`, a hardware overlay). It needs Fully's JavaScript Interface turned on in its settings, which is off today.
  - **Lesson:** never change `maxFramerate` live with `setParameters`; it stalled the encoder (12:51 PM). Republish instead.
