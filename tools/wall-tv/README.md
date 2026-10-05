# Bestly Wall TV app (projector)

Native Android TV player for the Bestly Wall on the Nebula Capsule 3 (Android 14, 32-bit ARM). It plays the wall video on the projector's hardware video layer (ExoPlayer on a SurfaceView), so there is no browser and no on-screen controls.

## How it fits together

- **Drawing.** The Mac mini draws the wall at 60 fps (`~/Bestly/wall-mac/agent.mjs`) and publishes it to go2rtc `wallmac` on the Pi. The Pi's own copy (`wall`) is the backup.
- **Playback.** The app plays `http://192.168.1.211:8099/wall.mp4`, a live fragmented MP4. The wall server picks `wallmac` when it's arriving, else `wall`.
  - The app checks `/api/stream_src` every 10 s and follows changes.
  - RTSP isn't used: go2rtc omits the H.264 sprop parameters, which ExoPlayer's RTSP client requires.
- **Self-heal:**
  - No new frames for 8 s → reconnect.
  - More than 3 s behind live for 5 s → reconnect.
  - Nothing for 40 s → hand the wall to Fully (the old page), so it never stays dark.
- **Health.** The app posts `/api/player` beats (same schema as the browser player), so the Pi watchdog and Scout keep working.
- **Pi watchdog:**
  - The flag `/opt/bestly/stream/APP` makes `launch_wall()` start this app, and `top_app()` treats it as the wall being in front.
  - If the app is missing, the watchdog reinstalls it from `/opt/bestly/stream/bestly-wall-tv.apk`.
  - Delete the flag to go back to Fully.

## Build

Copy this folder to the Mac (`~/Bestly/wall-tv`) and run `./build.sh` (JDK 17 from Homebrew, Android SDK 34, Gradle 8.11.1, AGP 8.7.3, Media3 1.4.1). Bump `versionCode` for each update.

**Measured Oct 5, 2026:** 60 fps, 0.2% dropped frames, 1.5 s behind live. The app uses about 30% CPU, versus about 120% for Fully playing the same video.
