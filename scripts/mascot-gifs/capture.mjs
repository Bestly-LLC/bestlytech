// Frame capture for the welcome-email mascot GIFs (see build.sh).
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
const [, , url, outDir, fpsArg] = process.argv;
const FPS = Number(fpsArg || 15), PERIOD = 3200, N = Math.round((PERIOD / 1000) * FPS);
mkdirSync(outDir, { recursive: true });
const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" }).catch(() => chromium.launch());
const p = await b.newPage({ viewport: { width: 1056, height: 900 }, deviceScaleFactor: 2 });
p.on("pageerror", (e) => console.error("page error:", e.message));
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForSelector(".tile svg");
await p.evaluate(() => document.body.classList.add("freeze"));
const boxes = await p.$$eval(".tile", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { icon: e.dataset.icon, x: r.x, y: r.y, w: r.width, h: r.height }; }));
writeFileSync(`${outDir}/boxes.json`, JSON.stringify({ boxes, fps: FPS, frames: N, scale: 2 }));
for (let i = 0; i < N; i++) {
  await p.evaluate((t) => document.documentElement.style.setProperty("--t", `${t}ms`), (i * PERIOD) / N);
  await p.waitForTimeout(30);
  await p.screenshot({ path: `${outDir}/f${String(i).padStart(3, "0")}.png`, fullPage: true });
}
await b.close();
console.log(`captured ${N} frames of ${boxes.length} mascots`);
