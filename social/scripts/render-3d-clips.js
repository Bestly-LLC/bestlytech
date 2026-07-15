/**
 * Bestly Cloud — 3D device video kit builder (Phase 5 / v4)
 *
 * Uses Playwright + headless Chromium to record the CloudScrollHero
 * three.js scene at multiple scroll positions and camera angles, and
 * encodes each capture into a short MP4 clip suitable for LinkedIn/X
 * feed attachment.
 *
 * Output: 12 MP4s at 1200x1200, 8-15s each, h264, ~1MB target.
 * Location: /Users/jared/Developer/bestlytech/social/kit/videos/
 *
 * Rebuild quarterly OR when the marketing hero design changes.
 *
 * PREREQUISITES:
 *   cd /Users/jared/Developer/bestlytech
 *   npm i -D playwright @ffmpeg-installer/ffmpeg
 *   npx playwright install chromium
 *
 * RUN:
 *   node social/scripts/render-3d-clips.js
 *
 * NOTES:
 *   - CloudScrollHero.tsx exposes dev hooks (__heroSetP, __sealSetP, __dockSetP)
 *     that let this script set scroll progress p ∈ [0,1] directly.
 *   - The hero pin height is 520vh — full scroll span is 0 -> 1.
 *   - Recording is done via CDP screencasting at ~30fps then ffmpeg-muxed to MP4.
 *   - Headless GPU is finicky for WebGL. If a clip renders black, retry with
 *     --enable-features=Vulkan,VaapiVideoDecoder or fall back to headed:true.
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { spawn } = require('child_process');

const CONFIG = {
  url: 'https://bestly.tech/cloud',
  viewportW: 1200,
  viewportH: 1200,
  outDir: path.resolve(__dirname, '..', 'kit', 'videos'),
  clips: [
    { name: 'hero-01_closed',        p: 0.00,  duration: 8 },
    { name: 'hero-02_lifting',       p: 0.15,  duration: 8 },
    { name: 'hero-03_open',          p: 0.30,  duration: 8 },
    { name: 'hero-04_open_topdown',  p: 0.45,  duration: 8 },
    { name: 'hero-05_arcing',        p: 0.55,  duration: 8 },
    { name: 'hero-06_birdseye',      p: 0.70,  duration: 8 },
    { name: 'hero-07_drift_back',    p: 0.80,  duration: 8 },
    { name: 'hero-08_reseat',        p: 0.90,  duration: 8 },
    { name: 'hero-09_final_parallel',p: 1.00,  duration: 8 },
    { name: 'hero-10_scroll_sweep',  scroll: 'sweep_0_100', duration: 15 },
    { name: 'hero-11_scroll_lift',   scroll: 'sweep_0_30',  duration: 10 },
    { name: 'hero-12_scroll_arc',    scroll: 'sweep_40_100',duration: 10 },
  ],
  fps: 30,
};

async function main() {
  fs.mkdirSync(CONFIG.outDir, { recursive: true });
  console.log('[render-3d-clips] launching Chromium (headed=false, GPU on)…');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle',
      '--enable-webgl',
      '--enable-features=Vulkan',
      '--ignore-gpu-blocklist',
    ],
  });
  const context = await browser.newContext({
    viewport: { width: CONFIG.viewportW, height: CONFIG.viewportH },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  console.log(`[render-3d-clips] loading ${CONFIG.url}…`);
  await page.goto(CONFIG.url, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(3_000); // let GLB decode + first frame

  for (const clip of CONFIG.clips) {
    const outPath = path.join(CONFIG.outDir, `${clip.name}.mp4`);
    console.log(`[render-3d-clips] recording ${clip.name} (${clip.duration}s)…`);

    if (typeof clip.p === 'number') {
      // static scroll position, camera drift only
      await page.evaluate((p) => window.__heroSetP && window.__heroSetP(p), clip.p);
      await page.waitForTimeout(600); // allow lerp to settle
    }

    const cdp = await context.newCDPSession(page);
    const frames = [];
    cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
      frames.push(Buffer.from(data, 'base64'));
      await cdp.send('Page.screencastFrameAck', { sessionId });
    });
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 85,
      everyNthFrame: 1,
    });

    if (clip.scroll === 'sweep_0_100') {
      const steps = clip.duration * CONFIG.fps;
      for (let i = 0; i < steps; i++) {
        const p = i / (steps - 1);
        await page.evaluate((p) => window.__heroSetP && window.__heroSetP(p), p);
        await page.waitForTimeout(1000 / CONFIG.fps);
      }
    } else if (clip.scroll === 'sweep_0_30') {
      const steps = clip.duration * CONFIG.fps;
      for (let i = 0; i < steps; i++) {
        const p = (i / (steps - 1)) * 0.30;
        await page.evaluate((p) => window.__heroSetP && window.__heroSetP(p), p);
        await page.waitForTimeout(1000 / CONFIG.fps);
      }
    } else if (clip.scroll === 'sweep_40_100') {
      const steps = clip.duration * CONFIG.fps;
      for (let i = 0; i < steps; i++) {
        const p = 0.40 + (i / (steps - 1)) * 0.60;
        await page.evaluate((p) => window.__heroSetP && window.__heroSetP(p), p);
        await page.waitForTimeout(1000 / CONFIG.fps);
      }
    } else {
      // static scroll — just record N seconds of ambient rotation
      await page.waitForTimeout(clip.duration * 1000);
    }

    await cdp.send('Page.stopScreencast');
    await cdp.detach();

    // Encode captured frames -> MP4 via ffmpeg (piped)
    await new Promise((resolve, reject) => {
      const ff = spawn(ffmpegPath, [
        '-y',
        '-f', 'image2pipe',
        '-framerate', String(CONFIG.fps),
        '-i', '-',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outPath,
      ]);
      ff.on('error', reject);
      ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
      for (const f of frames) ff.stdin.write(f);
      ff.stdin.end();
    });

    const size = fs.statSync(outPath).size;
    console.log(`[render-3d-clips]   → ${outPath}  (${(size / 1024).toFixed(0)} KB, ${frames.length} frames)`);
  }

  await browser.close();
  console.log(`[render-3d-clips] done — ${CONFIG.clips.length} clips in ${CONFIG.outDir}`);
}

main().catch((err) => {
  console.error('[render-3d-clips] FAILED:', err);
  process.exit(1);
});
