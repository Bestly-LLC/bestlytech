// Hero watchdog probe (owner: System Monitor, reports to Ares). Built 2026-10-12.
//
// Loads the live homepage in a real headless browser and checks the 30-scene hero the
// way a visitor sees it, because a plain URL check missed the Oct 12 bug (photos loaded,
// rotation frozen):
//   1. the hero carousel renders
//   2. the current scene photo actually loaded
//   3. the scene advances on its own within 11 s (rotation is every 8 s), mouse parked on it
//   4. all 60 scene photos (desktop + phone) answer 200
// 200 {ok:true} when healthy, 503 {ok:false, problems:[...]} when not.
//
// It is listed in Supabase external_health ("bestly.tech hero"), so probe-external polls it
// every 5 min and monitor_tick raises a problem for Scout after 2 failed checks in a row.
// The answer is cached at the edge (15 min, served stale while refreshing) so the 8 s probe
// never waits on a browser launch and the browser only runs a few times an hour.
// Read-only: it only loads our own public homepage. No secrets, no writes.

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

// Vercel origin, not www.bestly.tech: Cloudflare bot protection stalls a headless browser from a data center.
// The Cloudflare layer itself is already watched by the "www.bestly.tech" uptime row.
const SITE = "https://bestlytech.vercel.app";
const SCENES = 30;
const T0 = () => Date.now();
let t0 = T0();
const log = (step) => console.log(JSON.stringify({ heroCheck: step, ms: Date.now() - t0 }));

async function photosOk() {
  const urls = [];
  for (let n = 1; n <= SCENES; n++) {
    const k = String(n).padStart(2, "0");
    urls.push(`${SITE}/hero-scenes/${k}.webp`, `${SITE}/hero-scenes/${k}-m.webp`);
  }
  const bad = [];
  const one = async (u) => {
    for (let tryN = 0; tryN < 2; tryN++) {
      try {
        const r = await fetch(u, { headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(6000) });
        if (r.status === 200 || r.status === 206) return null;
        if (tryN === 1) return `${u.split("/").pop()} HTTP ${r.status}`;
      } catch (e) {
        if (tryN === 1) return `${u.split("/").pop()} ${e.name === "TimeoutError" ? "timed out" : e.message}`;
      }
    }
    return null;
  };
  // 6 at a time: 60 parallel requests to our own CDN stalled a few of them
  for (let i = 0; i < urls.length; i += 6) {
    const out = await Promise.all(urls.slice(i, i + 6).map(one));
    bad.push(...out.filter(Boolean));
  }
  log("photos-checked");
  return bad;
}

async function heroOk() {
  const problems = [];
  log("launch");
  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    defaultViewport: { width: 1440, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: "shell",
  });
  try {
    log("launched");
    const page = await browser.newPage();
    await page.goto(`${SITE}/?hero-check=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 20000 });
    log("loaded");
    const sel = 'section[aria-roledescription="carousel"]';
    try {
      await page.waitForSelector(`${sel} span.tabular-nums`, { timeout: 12000 });
    } catch {
      problems.push("Hero carousel did not render");
      return problems;
    }
    await page.mouse.move(900, 400); // the Oct 12 bug froze rotation under a parked mouse
    const counter = () => page.$eval(`${sel} span.tabular-nums`, (el) => el.textContent.trim());
    const photoLoaded = () =>
      page.$$eval(`${sel} img`, (imgs) => imgs.some((i) => i.complete && i.naturalWidth > 0));

    const first = await counter();
    if (!(await photoLoaded())) {
      await new Promise((r) => setTimeout(r, 2500));
      if (!(await photoLoaded())) problems.push("Hero photo did not load");
    }
    let moved = false;
    for (let t = 0; t < 22 && !moved; t++) {
      await new Promise((r) => setTimeout(r, 500));
      moved = (await counter()) !== first;
    }
    log("rotation-checked");
    if (!moved) problems.push(`Hero stuck on scene ${first} for 11 seconds`);
  } finally {
    // close can hang in the serverless sandbox: give it 3 s, then move on
    await Promise.race([browser.close().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
    log("closed");
  }
  return problems;
}

export default async function handler(req, res) {
  const started = Date.now();
  t0 = started;
  let problems = [];
  try {
    const deadline = new Promise((_, rej) => setTimeout(() => rej(new Error("took over 45 s")), 45000));
    const [hero, photos] = await Promise.race([Promise.all([heroOk(), photosOk()]), deadline]);
    problems = [...hero, ...(photos.length ? [`${photos.length} scene photo(s) missing: ${photos.slice(0, 5).join(", ")}`] : [])];
  } catch (e) {
    problems = [`Check could not run: ${e.message}`];
  }
  const ok = problems.length === 0;
  log(ok ? "ok" : "fail: " + problems.join(" | "));
  res.setHeader("Cache-Control", ok ? "public, s-maxage=900, stale-while-revalidate=3600" : "public, s-maxage=120");
  res.status(ok ? 200 : 503).json({
    ok,
    owner: "System Monitor",
    checked_at: new Date().toISOString(),
    took_ms: Date.now() - started,
    problems,
  });
}
