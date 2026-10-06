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

## Oct 5, 3:40 PM: the Bestly Wall TV app replaces the browser player on the projector

- **The bug:** Jared saw a "pause/play" control and a spinning loading ring glitching over the middle widget. Those were the browser's own video controls in Fully, which showed whenever the player caught up after falling behind. At 60 fps, Fully needed about 120% CPU just to composite the video.
- **Quick fix (still in `player.html` for the Fully fallback):** CSS hides every `::-webkit-media-controls*` part, plus `controlslist` and `disablepictureinpicture`. The fullscreen-on-tap was removed, because it brought the controls back and didn't help speed.
- **Real fix:** the native app `tech.bestly.wall`. Source and README are in `tools/wall-tv/`; it's built on the Mac and installed with adb from the Pi.
  - Result: 60 fps, 0.2% drops, delay steady at 1.5 s, about 30% CPU.
  - It self-healed through a relay restart (Mac feed gone about 35 s) without falling back to Fully.
- **Pi changes:**
  - `server.py`: `GET /api/stream_src`.
  - `watchdog.py`: app mode (`/opt/bestly/stream/APP`), a `top_app()` wrapper, and reinstall-if-missing.
  - Backups `.bak_app_*` and `.bak_app2_*`.
  - go2rtc RTSP was briefly opened to the LAN with a firewall, then closed again; the app doesn't use RTSP.
- **Radio truth:** `server.py` now sets `data_cache.radio.on` only while the HomePod reports `playing`. Before, the wall showed "Dance Wave" while Music Assistant was idle. Retries and the Scout alert are unchanged.

## Oct 5, 4:05 PM: the Roads and Traffic switches are independent now

- **Two bugs:**
  - `wall.html` `geoTraffic()` also required `skyRoads`, so turning Roads off hid traffic too.
  - `server.py` never had `skyTraffic` in `DEFAULT_STATE`, and the Pi's sync drops unknown keys. The page never saw the Traffic switch and treated it as always on. The database side was already fixed Oct 3 (the never-applied `skyRoads`/`skyTraffic`/`skyLandmarks` cleaner).
- **Fix:** `geoTraffic` gates only on `skyTraffic` (backup `.bak_trfsep_*`), and `DEFAULT_STATE` gained `skyTraffic: True` (backup `.bak_trfkey_*`).
- **Verified** with screenshots of the Mac copy: Roads off + Traffic on shows only the colored flow; Roads on + Traffic off shows plain gray roads. Restored both on.
- **Mac agent:**
  - Something had opened a Turo inbox tab inside the wall's hidden Chrome on CDP port 9333 (Turo blocked it).
  - The agent now uses port **47333** and closes any tab that isn't the wall.
- **Lesson:** a new wall switch needs **three** places: the DB cleaner, `server.py` `DEFAULT_STATE`, and `wall.html`.

## Oct 5, 4:30 PM: the sky map lines up with Kings Rd (measured, not eyeballed)

- **Problem.** The streets ran about 20 degrees off the balcony door. The first fix (a shear on Oct 3) only fixed one axis.
- **How it was measured.** Turned on `calGrid`, took one photo of the ceiling and the door, and marked the 26 ceiling grid dots. Fit a homography from the projector image to the photo. Took the wall direction from the wall/ceiling line, the curtain rod and the door glass. Took the horizon height from the heights of those three lines (ceiling, rod, door top), assuming a 1x iPhone lens. Then rectified the ceiling plane.
- **What it found.** The old sky box was a skewed shape on the ceiling: its top edge ran about 20 degrees off the wall and its sides were 55 degrees apart. Kings Rd runs along the box's x axis (`airBearing` 90 puts north on the left), so the streets followed that tilt.
- **Fix.** A new `air` quad that is a true rectangle on the ceiling. Its bottom edge is on the wall line and its sides are perpendicular to the wall. It covers about 94% of the ceiling the projector reaches. Corners are limited to -0.5..1.5 by `wall_clean_patch`, so the far left end of the wall line is outside the box. `airAspect` is 1.71. `homePos` moved so the home pin stays on the same spot of the ceiling.
  - New values: `air` = `[[-0.499884,0.186466],[1.294368,-0.181155],[1.00209,0.27064],[0.112732,0.393815]]`, `airAspect` 1.71, `homePos` {x:0.505, y:0.177}.
  - Undo: `air` = `[[-0.1154,0.001476],[0.9165,0.017125],[0.998913,0.269387],[0.00593,0.400064]]`, `airAspect` 1.98, `homePos` {x:0.3, y:0.35}. Apply it with `select wall_ha_patch(get_home_hub_agent_key(), '{...}'::jsonb)`.
- **Side effect.** The box is larger on screen, and `airFit` caps the sky's logical width at 4000. Labels and planes in the sky draw about 1.3x larger.
- **Lesson.** Map alignment on an oblique ceiling is a plane-rectification problem. Measure it from a photo with the calibration grid on; eyeballing it was off by about 18 degrees.

## Oct 5, 4:45 PM: road map follows view distance, sky edge fade, sharper sky

- **Roads/traffic ignored the view distance.** The redraw keys in `geoRoads` and `geoTraffic` left out the zoom (`AF.ppn`), so changing `airRadiusMi` moved the planes but not the roads. Fix: `AF.ppn` added to both keys. Verified at 8 mi and 25 mi. Backup: `.bak_roadzoom_*`.
- **Edge fade.** `#airFade` is a fixed, screen-space overlay with z-index 5 (above the sky at 4). It is clipped to the ceiling, above the strip's top line extended across the screen from `S.corners`. Black gradients on the top (42% of the ceiling height) and both sides (11% of the width) fade the sky into the ceiling. It is hidden in mapping mode and rebuilt in `airFit`. Backup: `.bak_skyfade_*`, `.bak_skyhi_*`.
- **Sharper sky on the Mac.** `SKYHI` (a Mac user agent) renders the sky layer up to 3600 px wide instead of 1800, and the roads/traffic canvases at 0.9 resolution instead of 0.5. The Pi copy keeps 1800 / 0.5 because of its GPU layer budget.
- **Stream bitrate.** In `agent.mjs` the bitrate pins went up to min 12, start 16, max 24 Mbps (backup `agent.mjs.bak_br_*`). Checked afterward at 59 fps with VideoToolbox.
- **Known.** `fitVisible` does not find a rectangle with the new `air` quad: the screen's bottom corners fall past the box's vanishing line. So `AF` covers the whole box and the 25 mi radius spans the box width, not just the visible part.
- **Mac disk.** On Oct 5 the Mac's data volume hit 100% (115 MB free) and screenshots failed. The iCloud Drive cache (`~/Library/Caches/CloudKit/com.apple.bird`, about 25 GB) was growing by about 0.4 GB a minute. Cleared Homebrew and esphome caches, which gave about 3 GB. Jared needs to decide on iCloud Drive (turn on Optimize Mac Storage, or pause what's syncing).

## Oct 5, 5:10 PM: roads redesigned ("spaghetti" at 25 mi and zoomed in)

- **Why it looked bad.**
  - Traffic was TomTom *raster* tiles (z10 for the basin, z12 at home) stretched onto the warped sky. That gave thick, blurry red/green doubled lines on every road, free flow included.
  - Every primary road plus the dense home grid drew at every zoom. At 25 mi the grid collapsed into a blob.
- **Traffic is vector now.**
  - `server.py` `traffic_loop` pulls TomTom *vector* flow tiles (`/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.pbf`, same 16 tiles and same quota) and decodes them with `mvt.py` (no dependencies; repo copy in `scripts/wall/mvt.py`).
  - It publishes only slowed or closed stretches to `cache/traffic/flow.json`, served at `/traffic/flow.json`. Each segment carries `l` = relative speed, `c` = 0 freeway / 1 arterial / 2 local, `x` = closure, `p` = flat lat,lon list.
  - The wall draws them as crisp lines on the same projection as the roads, in Apple colors: heavy (`l` < .42) `#FF453A`, slow (`l` < .70) `#FF9F0A`.
  - Free flow is not colored (Apple Maps style). Arterials only show heavy stretches longer than about 1/8 mi; locals only at 6 mi or less; closures only on freeways.
- **Base roads thin out by zoom.** The `roads.json` v2 bake (`scripts/wall/roads-bake.py`) splits classes into `fwy`, `link`, `art`, `sec` and `dense`.
  - `geoRoads` fades each class by radius: freeways always (.5 alpha); arterials up to 18 mi; secondary up to 15 mi, drawn together with arterials so streets don't break into dashes where their class changes; ramps up to 11 mi; local grid up to 6 mi.
  - Backups: `.bak_roadsv2*`, `roads.json.bak_v1_*`, `server.py.bak_trafvec_*`.
- **Checked** at 10 mi and 25 mi during rush hour: clean street grid, red only on real jams. Jared had switched Roads and Traffic off at 4:53 PM; they're back on.

## Oct 5, 6:15 PM: sky drawn at 4K, new Apple-style Turo calendar

- **Sky quality.** The Mac copy now renders the page at `deviceScaleFactor: 2` (3840x2160) and captures at 1920x1080 (`max` constraints in `agent.mjs`, backup `agent.mjs.bak_dsf_*`). The 1080p projector gets a supersampled frame, the sharpest it can show. Checked steady at 58 to 60 fps.
- **Turo calendar v2** (`wall.html` `w2bTcal`, CSS block "Turo calendar v2"; backups `.bak_tcal2_*`, `.bak_tcal3_*`):
  - Apple Calendar month view: Sunday-first weekday row and 5 full weeks starting this Sunday. Past days are dim, and so are days after the 30-day window. Today is a red circle.
  - Trips are capsules behind the dates: purple `#6A4FD8` for LAX pickups (the LAX trip page's purple, brightened) and teal `#2E8F86` for home pickups (the home trip page's teal, brightened). A guest's name shows only when a trip spans 2 or more days in a row, and is never cut off. The key reads Home, LAX, Open.
  - Data: migration `20261006010000_wall_turo_calendar_where.sql` adds `where` (`lax` when there's an `airport_code` or the pickup address is an airport) and always returns 36 or more days.
- **Preview tool.** `~/Bestly/wall-mac/cardshot.mjs <cardId> <out.png> [guest-to-tint-LAX]` renders one card flat, without the projector warp.
- **HIG pass (6:28 PM, ui-ux-pro-max).** Backup `.bak_tcal4_*`:
  - Weekday letters raised to .6 alpha for small-text contrast.
  - 4 pt row rhythm (25 px rows, 4 px gaps); medium-weight tabular dates; 12 px minimum (month tag).
  - Today circle inset to 24 px.
  - Non-color cue on named trips: a house glyph for home pickups, an airplane for LAX.
  - Every key item has a swatch, including a hollow ring for Open, and zero counts are dimmed.

## Oct 5, 7:42 PM: sky HD (screen-space lines), Turo card tightened

Plan: `docs/wall-sky-hd-opusplan.md`.

- **Cause.** A frame grab of `/wall.mp4` was sharp, so the stream is fine. The roads were hairlines inside the CSS-warped sky layer, shrunk 2 to 4 times without mipmaps, which broke them into dashes. Then the ceiling's defocus blurred whatever was left.
- **Roads and traffic now draw in screen space.**
  - Two full-screen device-resolution canvases, `#airScrR` and `#airScrT` (z 3, under `#air`). Each vertex goes through the sky's projection: rotate `th`, then `homo(AW, AH, q)`.
  - Lines are clipped to the sky box so they never cross the strip.
  - Widths are fixed screen pixels: freeway 3.0 to 3.4, arterial 2.2, secondary 1.8, local 1.5, traffic 4.2 freeway and 2.8 arterial.
  - The canvases copy `#air`'s opacity every 100 ms. The old `#airRoads` and `#airTraffic` are hidden.
  - Backups: `.bak_skyhd_*`, `.bak_skyhd2_*`.
- **Sky text.** Landmark labels went to 32 px at .5 alpha (was 30 px, .26); the Home label to .85 alpha.
- **Turo card.** Backup `.bak_tcal5_*`:
  - Trips continue across week rows with square ends, Apple Calendar style.
  - The guest's name sits on the longest piece of each trip.
  - The weekday row is closer to the dates and the key has more room above it.
  - Weekday letters are 13 px with no tracking.
- **Checked.** A new frame grab shows solid, continuous roads, and the stream holds 60 fps.

## Oct 5, 8:05 PM: "still soft compared to the web app": sharper path end to end

- **What was measured.**
  - The stream was only about 5 Mbps. Chrome's bandwidth estimate ignored the SDP `x-google-min-bitrate`, and VideoToolbox QP was about 17.
  - The 2x supersample (set at 6:15 PM) blurred text, because downscaling loses pixel snapping.
  - The TV app played video on a SurfaceView, which is the projector's video plane. That's a different path from the old web app, which drew on the graphics plane, and the video plane gets the SoC's video processing.
- **Fixes.**
  - `agent.mjs` (backups `agent.mjs.bak_q_*`, `agent.mjs.bak_vt`):
    - Back to `deviceScaleFactor: 1`.
    - `contentHint 'detail'`.
    - `maxBitrate` 40 Mbps.
    - Chrome flag `--force-fieldtrials=WebRTC-Video-MinVideoBitrate/Enabled,br:20000kbps/`, which raises the target bitrate to 20 Mbps.
    - Tried OpenH264 for lower QP: worse (QP about 26), so it stays on VideoToolbox.
  - Wall TV app 1.2 (versionCode 3): `TextureView` instead of `SurfaceView`, so frames composite on the graphics plane like the web app did. Installed on the projector and set as `/opt/bestly/stream/bestly-wall-tv.apk` (1.1 kept as `.bak_1.1`). The projector reports 56 fps with 1 dropped frame in 1,626. CPU is higher: app about 57%, surfaceflinger about 36%.
- **Projector facts.** Keystone is held flat in game mode (see `house/wall/projector-geometry-recovery`). Panel is 1920x1080. `picture_sharpness` is 6.

## Update Oct 5, 8:20-8:40 PM: crisp sky text, road signs, home sync (Sky Sync)
- **Sky text:** place and star names are drawn upright on a screen canvas (`#airScrL`, `scrLabels()` every 1.5 s, positions taken
  from the hidden SVG text). Roads got brighter and thicker (freeways .8 alpha, 3.4-3.8 px). Backup `wall.html.bak_skyhd3_*`.
- **Road signs (`#airScrS`, `drawSigns()` inside `geoRoads`):** `roads.json` v3 adds `lab` rows
  `[class, kind, text, lat, lon, dlat, dlon]` baked by `scripts/wall/roads-bake.py` (1,280 signs). Interstate / US / CA shields
  at every zoom; arterial names at 14 mi and in; secondary at 8; local streets at 4. Names run along the road, kept upright;
  overlaps (with each other, place names, spots and the Home tag) are dropped. Backup `roads.json.bak_v2_*`.
- **Move-home bug:** moving home moved only the planes and Home tag; roads, traffic and city names waited for the next
  `airFit()`, and `airFit()` itself placed home last. Now `airFit()` places home first, and the 0.9 s glide redraws
  roads, signs, traffic and landmarks every 60 ms, then runs `airFit()`. Backups `wall.html.bak_skysync_*`, `.bak_skysync2_*`.
- **Sky Sync (employee `wall-sky-sync`, Mac mini, every 5 min):** each layer stamps the home/zoom/bearing it drew with;
  `window.__skyAudit()` reports the gap per layer; the page heals itself, Sky Sync reloads and then alerts (`wall.skysync`),
  flags unregistered layers, and runs a move-home test after each `wall.html` change. See `tools/wall-sky-sync/README.md`.
  **Any new sky layer must be stamped and added to `SKYLAYERS`.**
- **8:45 PM, label orientation (Jared: "read it from the desk facing east, like the Home tag"):** sky labels, star names,
  road signs and the Home tag are no longer upright on the projector's screen. Each is drawn in the sky's own frame at its
  spot (`scrFrame()`: local inner->screen axes from `scrProj`, inverse via `unmap` in `scrInner()`), so it reads parallel to
  Kings Rd like paint on the ceiling. The frame is normalized so glyphs keep >= 80% pixel height, with stretch capped at 3x
  near the wall. Road names are 500-weight mixed case in see-through blue-gray (`rgba(150,182,218,.56-.72)`) so they don't
  read as places (bold white caps). The Home tag (`#airYou`) is redrawn sharp on `#airScrL`; the warped one is hidden.
  Backups `wall.html.bak_skyframe*_*`.
- **9:30 PM, planes in screen space:** `#airPlanes` now lives in a fixed screen layer `#airScrP` (moved there at load by
  `scrPlanesInit()`, clipped to the sky quad, opacity mirrored from `#air`). The one plane writer (`o.el.style.transform`)
  calls `skyPt(x,y)`, which returns a 2D `matrix()` from the sky frame at that spot, so rings, beacons, rotors and tags
  keep all their CSS and animation but paint at the projector's resolution. Scale `PJ.kp` = max(true size at home, enough
  for the 50 px tag to get ~14 projector rows), which makes planes about 2x larger on the ceiling (at true size a tag was
  ~7 rows: unreadable). Trails moved to screen canvas `#airScrTr` (old `#airCv` hidden by `body.scrtr`, its display and
  opacity still drive the trails). 61 fps on the Mac. Backups `wall.html.bak_skyplanes*_*`.

## Oct 6, 12:15 AM: Siri on/off + sleep without deep standby ("picture off")
- **Why:** deep standby (`KEYCODE_SLEEP`) still makes the Capsule 3 shut itself off ~2.5 h later every night (power_log:
  reach goes false ~9,000 s after each midnight sleep), and only the remote can revive it.
- **Picture off:** `settings put global Anker_ProjectorSettings_PictureOff 1` turns the DLP light off while Android stays awake;
  `0` lights it again instantly (Nebula projector-settings observer -> `setDlpProjectionMode(17/16)`; found by decompiling
  `com.zhixin.projector.settings`). Verified by Jared's eyes at 12:10 AM both ways.
- **Watchdog (`watchdog.py`, backup `.bak_picoff_*`):** schedule sleep = sleep show + picture off; wake = clear picture off
  (+ `KEYCODE_WAKEUP` only if Android is asleep). The 7 AM clean reboot still runs. power_log lines now carry `dark`.
  Heat and battery-heat guards still use real standby on purpose.
- **Server (`server.py`, backup `.bak_picoff_*`):** `proj_dark()`, `proj_lit()`, `proj_power()`; admin Wake/Sleep, Restart,
  alarm prep and the counting-sheep finish use picture off. Loopback-only `GET /api/projector/{status,on,off}`.
- **Siri:** Homebridge accessory "Projector" (`homebridge-http-switch`, stateful, polls status every 30 s;
  `/mnt/ssd/apps/homebridge/config.json`, backup `config.json.bak_projector_*`). "Hey Siri, turn off/on the projector."
  Off holds until the next schedule boundary (midnight or 7 AM), same as the admin buttons.
- **Watch next:** whether Android stays awake all night in picture off (power_log `awake` should stay true with `dark` true).
