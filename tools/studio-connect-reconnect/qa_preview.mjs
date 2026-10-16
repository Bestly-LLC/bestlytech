// Playwright check for the reconnect pop-up on the preview build. Usage: node qa_preview.mjs <previewId> <mob|desk> <step>
// Needs the bestly-test client token in <dir>/bt.tok (never committed). Steps: modal | stop | reload | yt
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
const D = process.env.QA_DIR || "/tmp/w/";
const TOK = fs.readFileSync(D + "bt.tok", "utf8").trim();
const PREV = process.argv[2], SIZE = process.argv[3] || "desk", STEP = process.argv[4] || "modal";
const vp = SIZE === "mob" ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: SIZE === "mob", isMobile: SIZE === "mob", colorScheme: "light" });
const page = await ctx.newPage();
const log = { pageerror: [], console: [], http: [] };
page.on("pageerror", e => log.pageerror.push(e.message.slice(0, 200)));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.console.push(m.text().slice(0, 200)); });
page.on("response", r => { if (r.status() >= 400) log.http.push(r.status() + " " + r.url().replace(/\?.*/, "").slice(0, 110)); });
const url = `https://studio.bestly.tech/bestly-test?c=${TOK}${PREV === "live" ? "" : "&preview=" + PREV}`;
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(8000);
const out = { step: STEP, size: SIZE };
const modal = () => page.evaluate(() => { const m = document.getElementById("rcModal"); if (!m) return null; const r = m.querySelector(".rcn-card").getBoundingClientRect(); return { title: document.getElementById("rcTitle").textContent, body: document.getElementById("rcBody").textContent, go: document.getElementById("rcGo").textContent, ask: document.getElementById("rcAsk").textContent, chk: m.querySelector(".rcn-chk span").textContent, stopDisabled: document.getElementById("rcStop").disabled, x: r.x, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight, overflowX: document.documentElement.scrollWidth > innerWidth, hasClose: !!m.querySelector("[aria-label*=lose],.x,.close") }; });
const P = D + `qa/${STEP}-${SIZE}`;
if (STEP === "modal") {
  out.modal = await modal();
  await page.screenshot({ path: P + "-1.png" });
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  out.afterEsc = !!(await modal());
  await page.mouse.click(5, 5); await page.waitForTimeout(500);
  out.afterBackdrop = !!(await modal());
  // Tab stays inside
  for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
  out.focusInside = await page.evaluate(() => document.getElementById("rcModal").contains(document.activeElement));
  // ask us
  await page.click("#rcAsk"); await page.waitForTimeout(900);
  out.askSheet = await page.evaluate(() => ({ up: document.getElementById("sheet").classList.contains("up"), title: document.getElementById("sheetTitle").textContent, note: (document.getElementById("ideaBox") || {}).value, sheetAbove: (() => { const s = document.getElementById("sheet"); return +getComputedStyle(s).zIndex > +getComputedStyle(document.getElementById("rcModal")).zIndex; })() }));
  await page.screenshot({ path: P + "-ask.png" });
  await page.keyboard.press("Escape"); await page.waitForTimeout(700);
  out.afterSheetEsc = { sheetUp: await page.evaluate(() => document.getElementById("sheet").classList.contains("up")), modal: !!(await modal()) };
  // reconnect opens the connect flow in a new tab
  const [pop] = await Promise.all([ctx.waitForEvent("page", { timeout: 15000 }).catch(() => null), page.click("#rcGo")]);
  await page.waitForTimeout(1500);
  out.reconnect = { popup: pop ? pop.url().replace(/\/c\/.*/, "/c/<code>") : null, btn: await page.evaluate(() => document.getElementById("rcGo").textContent), modalStill: !!(await modal()) };
  await page.screenshot({ path: P + "-2.png" });
  // checkbox gate
  out.stopBefore = await page.evaluate(() => document.getElementById("rcStop").disabled);
  await page.check("#rcChk"); out.stopAfter = await page.evaluate(() => document.getElementById("rcStop").disabled);
  await page.screenshot({ path: P + "-3.png" });
}
if (STEP === "stop") {
  out.modal = !!(await modal());
  await page.check("#rcChk");
  await page.click("#rcStop"); await page.waitForTimeout(2500);
  out.afterStop = { modal: !!(await modal()), toast: await page.evaluate(() => document.getElementById("toast").textContent) };
  await page.screenshot({ path: P + "-1.png" });
}
if (STEP === "reload") {
  out.modal = !!(await modal());
  out.tile = await page.evaluate(() => { const t = document.querySelector("[data-acct=instagram]"); return t ? t.textContent.replace(/\s+/g, " ").slice(0, 160) : "(settings not open)"; });
}
await page.waitForTimeout(300);
out.log = log;
console.log(JSON.stringify(out, null, 1));
await browser.close();
