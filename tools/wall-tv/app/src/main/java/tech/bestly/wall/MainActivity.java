package tech.bestly.wall;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.TextureView;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.FrameLayout;

import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.VideoSize;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DecoderCounters;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.exoplayer.source.ProgressiveMediaSource;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Bestly Wall for the projector (Oct 5, 2026). Plays the wall video (drawn at 60 fps by the Mac mini, or by the Pi as a
 * backup) straight onto the projector's video hardware: no browser, no on-screen controls, ever.
 * - Source: live fragmented MP4 from the wall server (http://PI:8099/wall.mp4), which relays go2rtc "wallmac" (the
 *   Mac, 60 fps) when it's arriving, else "wall" (the Pi). /api/stream_src says which; the app follows changes.
 * - Self-heal: no new frames for 8 s -> reconnect; nothing for 40 s -> hand the wall to Fully (the old page) so it
 *   never goes dark. The Pi watchdog brings this app back once video flows again.
 * - Health: posts the same player beat the browser player did (/api/player), so the watchdog and Scout keep working.
 */
@OptIn(markerClass = UnstableApi.class)
public class MainActivity extends Activity {
    static final String PI = "192.168.1.211";
    static final String WALL = "http://" + PI + ":8099";
    static final String VERSION = "1.1";

    final Handler ui = new Handler(Looper.getMainLooper());
    final ExecutorService net = Executors.newSingleThreadExecutor();
    TextureView surface;   // Oct 5: TextureView = graphics plane, same as the old web app (no video-plane noise reduction or scaler blur)
    ExoPlayer player;
    String src = "wallmac";
    long startedAt, lastFrameAt, lastGoodAt, firstFrameAt;
    long lastRendered = -1, lastBeatAt, beatRendered, lagBadSince, lastSrcCheck;
    int tries = 0, stalls = 0;
    double fps = 0;
    String err = null;
    boolean handedOff = false, resumed = false;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON | WindowManager.LayoutParams.FLAG_FULLSCREEN);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        surface = new TextureView(this);
        root.addView(surface, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        hideSystemUi();
    }

    void hideSystemUi() {
        View d = getWindow().getDecorView();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = d.getWindowInsetsController();
            if (c != null) {
                c.hide(WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            d.setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        handedOff = false;
        hideSystemUi();
        long now = SystemClock.elapsedRealtime();
        lastGoodAt = now;
        pickSourceThenPlay();
        ui.removeCallbacks(tick);
        ui.postDelayed(tick, 1000);
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        ui.removeCallbacks(tick);
        release();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        net.shutdownNow();
    }

    void release() {
        if (player != null) {
            try { player.release(); } catch (Exception ignored) {}
            player = null;
        }
        lastRendered = -1;
    }

    void pickSourceThenPlay() {
        net.execute(() -> {
            String s = fetchSrc();
            ui.post(() -> { if (s != null) src = s; play(); });
        });
    }

    void play() {
        if (!resumed) return;
        release();
        tries++;
        startedAt = SystemClock.elapsedRealtime();
        lastFrameAt = startedAt;
        DefaultLoadControl lc = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(1000, 3000, 250, 500)    // small cushion: live wall, not a movie
                .build();
        player = new ExoPlayer.Builder(this).setLoadControl(lc).build();
        player.setVideoTextureView(surface);
        player.addListener(new Player.Listener() {
            @Override public void onPlayerError(PlaybackException e) {
                err = (e.getErrorCodeName() + " " + (e.getMessage() == null ? "" : e.getMessage()));
                if (err.length() > 120) err = err.substring(0, 120);
                ui.postDelayed(MainActivity.this::reconnect, 2000);
            }
            @Override public void onRenderedFirstFrame() {
                long now = SystemClock.elapsedRealtime();
                firstFrameAt = now; lastFrameAt = now; lastGoodAt = now; err = null;
            }
            @Override public void onVideoSizeChanged(VideoSize v) { }
        });
        // Live fragmented MP4 from the wall server (it picks the Mac's 60 fps stream when it's arriving, else the Pi's).
        // go2rtc's RTSP leaves out the H.264 sprop parameters, which ExoPlayer's RTSP client requires.
        MediaItem item = MediaItem.fromUri(Uri.parse(WALL + "/wall.mp4?app=" + VERSION + "&t=" + startedAt));
        DefaultHttpDataSource.Factory http = new DefaultHttpDataSource.Factory()
                .setConnectTimeoutMs(5000).setReadTimeoutMs(8000).setUserAgent("BestlyWallTV/" + VERSION);
        player.setMediaSource(new ProgressiveMediaSource.Factory(http).createMediaSource(item));
        player.setPlayWhenReady(true);
        player.prepare();
    }

    void reconnect() {
        if (!resumed) return;
        stalls++;
        pickSourceThenPlay();
    }

    final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!resumed) return;
            long now = SystemClock.elapsedRealtime();
            long rendered = rendered();
            if (rendered >= 0 && rendered > lastRendered) { lastFrameAt = now; lastGoodAt = now; }
            lastRendered = rendered;
            // frozen: no new frame for 8 s -> reconnect (frames only stop when the link does; the Mac sends >= 1 fps)
            if (player != null && now - lastFrameAt > 8000 && now - startedAt > 8000) { err = "no new frames"; reconnect(); }
            // fell behind live by 3+ s for 5 s -> reconnect at the live edge (a jump once, instead of drifting further)
            long lag = lagMs();
            lagBadSince = lag > 3000 ? (lagBadSince == 0 ? now : lagBadSince) : 0;
            if (player != null && lagBadSince > 0 && now - lagBadSince > 5000) { lagBadSince = 0; err = "behind live " + lag + " ms"; reconnect(); }
            // the server picks the stream; if it now says something else (Mac back, or Mac gone), follow it
            if (now - lastSrcCheck > 10000) { lastSrcCheck = now; net.execute(() -> { String s = fetchSrc(); if (s != null && !s.equals(src)) ui.post(() -> { src = s; reconnect(); }); }); }
            // still nothing for 40 s -> give the wall back to Fully so it never stays dark
            if (!handedOff && now - lastGoodAt > 40000) { handedOff = true; handOffToFully(); return; }
            if (now - lastBeatAt >= 5000) beat(now, rendered);
            ui.postDelayed(this, 1000);
        }
    };

    long rendered() {
        try {
            if (player == null) return -1;
            DecoderCounters c = player.getVideoDecoderCounters();
            if (c == null) return -1;
            c.ensureUpdated();
            return c.renderedOutputBufferCount;
        } catch (Exception e) { return -1; }
    }

    long lagMs() {
        try { return player == null ? 0 : Math.max(0, player.getBufferedPosition() - player.getCurrentPosition()); }
        catch (Exception e) { return 0; }
    }

    int dropped() {
        try {
            DecoderCounters c = player == null ? null : player.getVideoDecoderCounters();
            if (c == null) return 0;
            c.ensureUpdated();
            return c.droppedBufferCount + c.skippedOutputBufferCount;
        } catch (Exception e) { return 0; }
    }

    void beat(long now, long rendered) {
        double dt = (now - lastBeatAt) / 1000.0;
        if (lastBeatAt > 0 && rendered >= 0 && beatRendered >= 0 && dt > 0) fps = Math.max(0, (rendered - beatRendered) / dt);
        lastBeatAt = now; beatRendered = rendered;
        boolean showing = player != null && now - lastFrameAt < 5000 && firstFrameAt > 0;
        try {
            JSONObject rtc = new JSONObject();
            rtc.put("app", VERSION); rtc.put("src", src); rtc.put("lag", Math.round(lagMs() / 100.0) / 10.0);
            rtc.put("tot", Math.max(0, rendered)); rtc.put("drop", dropped());
            if (player != null && player.getVideoSize().width > 0) { rtc.put("w", player.getVideoSize().width); rtc.put("h", player.getVideoSize().height); }
            JSONObject o = new JSONObject();
            o.put("showing", showing ? "stream" : "local");
            o.put("fps", Math.round(fps));
            o.put("frames", Math.max(0, rendered));
            o.put("stalls", stalls); o.put("tries", tries);
            o.put("age", firstFrameAt > 0 ? (now - firstFrameAt) / 1000 : 0);
            o.put("state", player == null ? "none" : String.valueOf(player.getPlaybackState()));
            o.put("audio", "on");
            if (err != null) o.put("err", "app: " + err);
            o.put("rtc", rtc);
            final String body = o.toString();
            net.execute(() -> post(WALL + "/api/player", body));
        } catch (Exception ignored) {}
    }

    void handOffToFully() {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(WALL + "/?from=app"));
            i.setPackage("de.ozerov.fully");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) { err = "handoff: " + e.getClass().getSimpleName(); }
    }

    String fetchSrc() {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(WALL + "/api/stream_src").openConnection();
            c.setConnectTimeout(3000); c.setReadTimeout(3000);
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                String line; while ((line = r.readLine()) != null) sb.append(line);
            }
            String s = new JSONObject(sb.toString()).optString("src", null);
            return ("wallmac".equals(s) || "wall".equals(s)) ? s : null;
        } catch (Exception e) { return null; } finally { if (c != null) c.disconnect(); }
    }

    void post(String url, String body) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(3000); c.setReadTimeout(3000);
            c.setRequestMethod("POST"); c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            try (OutputStream os = c.getOutputStream()) { os.write(body.getBytes(StandardCharsets.UTF_8)); }
            c.getResponseCode();
        } catch (Exception ignored) { } finally { if (c != null) c.disconnect(); }
    }
}
