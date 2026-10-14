import { chromium, devices } from "/tmp/claude-0/sp/node_modules/playwright/index.mjs";
import fs from "node:fs";
export const TOK = fs.readFileSync("/tmp/claude-0/sp/mobile/tok.txt", "utf8").trim();
export const STAND = fs.readFileSync("/tmp/claude-0/sp/vids/74dba136-a7d7-4420-b58c-7946d679c0dd.webm");
export const SIZES = { "390": { width: 390, height: 844 }, "430": { width: 430, height: 932 } };
export async function open({ slug = "bestly-cloud", size = "390", build, board = false, scheme = "light", extraRoutes } = {}) {
  const browser = await chromium.launch({ args: ["--autoplay-policy=document-user-activation-required"] });
  const vp = SIZES[size];
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, isMobile: true, colorScheme: scheme,
    userAgent: devices["iPhone 14"].userAgent });
  const page = await ctx.newPage();
  const log = { pageerror: [], console: [], http: [], reqfail: [] };
  page.on("pageerror", e => log.pageerror.push(e.message.slice(0, 240)));
  page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.console.push(m.text().slice(0, 240)); });
  page.on("response", r => { if (r.status() >= 400) log.http.push(r.status() + " " + r.url().replace(/\?.*/, "").slice(0, 130)); });
  page.on("requestfailed", r => { const f = r.failure() && r.failure().errorText; if (!/ERR_ABORTED/.test(f || "")) log.reqfail.push(r.url().slice(0, 120) + " " + f); });
  // VP9 stand-in with real byte-range support for every review/*.mp4
  await page.route(/\/public\/review\/.*\.mp4(\?.*)?$/, r => {
    const h = r.request().headers()["range"]; const n = STAND.length;
    if (h) { const m = /bytes=(\d+)-(\d*)/.exec(h); const a = +m[1], b = m[2] ? Math.min(+m[2], n - 1) : n - 1;
      return r.fulfill({ status: 206, headers: { "content-type": "video/webm", "accept-ranges": "bytes", "content-range": `bytes ${a}-${b}/${n}` }, body: STAND.subarray(a, b + 1) }); }
    return r.fulfill({ status: 200, headers: { "content-type": "video/webm", "accept-ranges": "bytes" }, body: STAND });
  });
  if (build) await page.route(/review\/app\/(index|board)\.[0-9a-f]{10}\.html$/, r => { const isB = /board\./.test(r.request().url()); const f = isB ? build.board : build.index; return f ? r.fulfill({ status: 200, contentType: "text/html", body: fs.readFileSync(f) }) : r.continue(); });
  if (extraRoutes) await extraRoutes(page);
  await page.addInitScript(([s, t]) => { try { localStorage.setItem("bestly.studio.client", s); localStorage.setItem("bestly.studio.session", t); } catch {} }, [slug, TOK]);
  const url = board ? `https://studio.bestly.tech/${slug}` : "https://studio.bestly.tech/#s=" + TOK;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  return { browser, ctx, page, log };
}
export const shot = (page, name) => page.screenshot({ path: `/tmp/claude-0/sp/mobile/${name}.png` });
export async function goTab(page, name) {
  const ok = await page.evaluate((name) => {
    const re = new RegExp("^" + name);
    const find = () => [...document.querySelectorAll("button, a, [role=tab]")].find(b => re.test(b.textContent.trim()) && b.getBoundingClientRect().width > 0);
    let b = find();
    if (!b) { const more = [...document.querySelectorAll("nav button")].find(b => /^More/.test(b.textContent.trim())); if (more) more.click(); return "more"; }
    b.click(); return "ok";
  }, name);
  if (ok === "more") { await page.waitForTimeout(600); const ok2 = await page.evaluate((name) => { const re = new RegExp("^" + name); const b = [...document.querySelectorAll("button, a, [role=tab]")].find(b => re.test(b.textContent.trim()) && b.getBoundingClientRect().width > 0); if (!b) return false; b.click(); return true; }, name); await page.waitForTimeout(1800); return ok2; }
  await page.waitForTimeout(1800); return true;
}
// Open a client's board the way the staff app does: "Open their board" (view-as, read-only, marked as staff)
export async function openBoardAsStaff(page, opts = {}) {
  const href = await page.evaluate(() => { const a = document.getElementById("openBoard") || document.getElementById("openBoardTop"); return a && a.href && !a.hidden ? a.href : ""; });
  if (!href) throw new Error("no board link");
  const url = href.replace(/^https?:\/\/[^/]+/, "https://studio.bestly.tech");
  const p2 = await page.context().newPage();
  const log = { pageerror: [], console: [], http: [], reqfail: [] };
  p2.on("pageerror", e => log.pageerror.push(e.message.slice(0, 240)));
  p2.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.console.push(m.text().slice(0, 240)); });
  p2.on("response", r => { if (r.status() >= 400) log.http.push(r.status() + " " + r.url().replace(/\?.*/, "").slice(0, 130)); });
  await p2.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p2.waitForTimeout(7000);
  return { page: p2, log };
}
