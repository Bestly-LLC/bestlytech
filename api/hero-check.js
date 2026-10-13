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

const SITE = "https://www.bestly.tech";
const SCENES = 30;

async function photosOk() {
  const urls = [];
  for (let n = 1; n <= SCENES; n++) {
    const k = String(n).padStart(2, "0");
    urls.push(`${SITE}/hero-scenes/${k}.webp`, `${SITE}/hero-scenes/${k}-m.webp`);
  }
  const bad = [];
  await Promise.all(urls.map(async (u) => {
    try {
      const r = await fetch(u, { method: "HEAD" });
      if (r.status !== 200) bad.push(`${u.split("/").pop()} HTTP ${r.status}`);
    } catch (e) {
      bad.push(`${u.split("/").pop()} ${e.message}`);
    }
  }));
  return bad;
}

async function heroOk() {
  const problems = [];
  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    defaultViewport: { width: 1440, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: "shell",
  });
  try {
    const page = await browser.newPage();
    await page.goto(`${SITE}/?hero-check=${Date.now()}`, { waitUntil: "load", timeout: 25000 });
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
    if (!moved) problems.push(`Hero stuck on scene ${first} for 11 seconds`);
  } finally {
    await browser.close();
  }
  return problems;
}

export default async function handler(req, res) {
  const started = Date.now();
  let problems = [];
  try {
    const [hero, photos] = await Promise.all([heroOk(), photosOk()]);
    problems = [...hero, ...(photos.length ? [`${photos.length} scene photo(s) missing: ${photos.slice(0, 5).join(", ")}`] : [])];
  } catch (e) {
    problems = [`Check could not run: ${e.message}`];
  }
  const ok = problems.length === 0;
  res.setHeader("Cache-Control", ok ? "public, s-maxage=900, stale-while-revalidate=3600" : "public, s-maxage=120");
  res.status(ok ? 200 : 503).json({
    ok,
    owner: "System Monitor",
    checked_at: new Date().toISOString(),
    took_ms: Date.now() - started,
    problems,
  });
}
