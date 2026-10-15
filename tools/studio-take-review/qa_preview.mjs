import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
const D = "/tmp/claude-0/-home-user-bestlytech/85d97aee-caab-5c44-9352-d85e9756e44f/scratchpad/";
const TOK = fs.readFileSync(D + "ui/staff.tok", "utf8").trim();
const PREV = process.argv[2], SIZE = process.argv[3] || "desk";
const vp = SIZE === "mob" ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: SIZE === "mob", isMobile: SIZE === "mob", colorScheme: "dark" });
const page = await ctx.newPage();
const log = { pageerror: [], console: [], http: [] };
page.on("pageerror", e => log.pageerror.push(e.message.slice(0, 200)));
page.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) log.console.push(m.text().slice(0, 200)); });
page.on("response", r => { if (r.status() >= 400) log.http.push(r.status() + " " + r.url().replace(/\?.*/, "").slice(0, 110)); });
await page.addInitScript(([s, t]) => { try { localStorage.setItem("bestly.studio.client", s); localStorage.setItem("bestly.studio.session", t); } catch {} }, ["bestly-test", TOK]);
await page.goto(`https://studio.bestly.tech/?preview=${PREV}#s=${TOK}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(7000);
const out = {};
const clickTab = async (name) => page.evaluate((name) => { const re = new RegExp("^" + name); const b = [...document.querySelectorAll("button, a, [role=tab]")].find(b => re.test(b.textContent.trim()) && b.getBoundingClientRect().width > 0); if (b) { b.click(); return true; } return false; }, name);
out.tab = await clickTab("Asks"); await page.waitForTimeout(2500);
await page.screenshot({ path: D + `qa/staff-list-${SIZE}.png` });
const pick = async (title) => page.evaluate((t) => { const b = [...document.querySelectorAll("[data-ask]")].find(b => b.textContent.includes(t)); if (b) { b.click(); return true; } return false; }, title);
out.listPills = await page.evaluate(() => [...document.querySelectorAll("[data-ask]")].filter(b => b.textContent.includes("ZZ QA")).map(b => b.textContent.replace(/\s+/g, " ").trim().slice(0, 120)));
out.pickWaiting = await pick("ZZ QA: waiting take"); await page.waitForTimeout(1500);
out.waitingDetail = await page.evaluate(() => ({ approve: !!document.querySelector("[data-tkok]"), send: !!document.querySelector("[data-tksend]"), attach: !!document.querySelector("[data-attach]"), pill: (document.querySelector(".uprow .u1") || {}).textContent }));
await page.screenshot({ path: D + `qa/staff-waiting-${SIZE}.png`, fullPage: false });
await page.evaluate(() => { const d = document.querySelector(".tkrev details"); if (d) d.open = true; });
await page.screenshot({ path: D + `qa/staff-waiting-open-${SIZE}.png` });
await page.click("[data-tksend]"); await page.waitForTimeout(700);
await page.screenshot({ path: D + `qa/staff-sheet-${SIZE}.png` });
// too-short note shows an inline error
await page.fill("#tkNote", "x"); await page.evaluate(() => { const b = [...document.querySelectorAll(".sheet .btn")].find(b => /Send to her/.test(b.textContent)); b.click(); }); await page.waitForTimeout(500);
out.shortErr = await page.evaluate(() => (document.getElementById("tkErr") || {}).textContent);
await page.keyboard.press("Escape"); await page.waitForTimeout(300);
out.pickSent = await pick("ZZ QA: sent back"); await page.waitForTimeout(1500);
out.sentDetail = await page.evaluate(() => ({ approve: !!document.querySelector("[data-tkok]"), attach: !!document.querySelector("[data-attach]"), pill: (document.querySelector(".uprow .u1") || {}).textContent, thread: [...document.querySelectorAll(".tkround")].map(x => x.textContent.slice(0, 160)), staffLeak: document.body.innerText.includes("STAFFONLY") }));
await page.screenshot({ path: D + `qa/staff-sent-${SIZE}.png` });

// board, opened the way staff do (view-as)
const href = await page.evaluate(() => { const a = document.getElementById("openBoard") || document.getElementById("openBoardTop"); return a && a.href ? a.href : ""; });
out.boardLink = !!href;
if (href) {
  const url = href.replace(/^https?:\/\/[^/]+/, "https://studio.bestly.tech");
  const bp = await ctx.newPage();
  const blog = { pageerror: [], console: [], http: [] };
  bp.on("pageerror", e => blog.pageerror.push(e.message.slice(0, 200)));
  bp.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) blog.console.push(m.text().slice(0, 200)); });
  bp.on("response", r => { if (r.status() >= 400) blog.http.push(r.status() + " " + r.url().replace(/\?.*/, "").slice(0, 110)); });
  await bp.goto(url.includes("?") ? url + "&preview=" + PREV : url + "?preview=" + PREV, { waitUntil: "domcontentloaded", timeout: 60000 });
  await bp.waitForTimeout(7000);
  await bp.screenshot({ path: D + `qa/board-home-${SIZE}.png` });
  out.home = await bp.evaluate(() => ({ rec: (document.getElementById("pickRecSub") || {}).textContent, head: (document.getElementById("hHead") || {}).textContent, wn: (document.getElementById("whatsnew") || {}).textContent }));
  await bp.evaluate(() => { const b = document.getElementById("pickRec"); if (b) b.click(); });
  await bp.waitForTimeout(1800);
  await bp.screenshot({ path: D + `qa/board-record-${SIZE}.png` });
  out.board = await bp.evaluate(() => { const r = document.querySelector(".redo"); const btn = r && r.querySelector("[data-redorec]"); const bb = btn && btn.getBoundingClientRect(); return { secs: [...document.querySelectorAll(".s2sec")].map(x => x.textContent), redo: !!r, note: r && r.querySelector(".rnote").textContent.slice(0, 60), video: !!(r && r.querySelector("video")), btns: r ? r.querySelectorAll("[data-redorec]").length : 0, btnH: bb && Math.round(bb.height), btnW: bb && Math.round(bb.width), staffLeak: document.body.innerText.includes("STAFFONLY"), waitingTakeAsk: document.body.innerText.includes("ZZ QA: waiting take"), overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth, ellipsis: [...document.querySelectorAll(".redo *")].some(e => getComputedStyle(e).textOverflow === "ellipsis") }; });
  await bp.evaluate(() => { const r = document.querySelector(".redo"); if (r) r.scrollIntoView(); });
  await bp.waitForTimeout(400);
  await bp.screenshot({ path: D + `qa/board-redo-${SIZE}.png`, fullPage: true });
  await bp.evaluate(() => { const b = document.querySelector("[data-ask]"); });
  out.blog = blog;
}
if (process.argv[4] === "approve") {
  await page.bringToFront();
  out.pickWaiting2 = await pick("ZZ QA: waiting take"); await page.waitForTimeout(1500);
  await page.click("[data-tkok]"); await page.waitForTimeout(2500);
  out.afterApprove = await page.evaluate(() => ({ flash: (document.querySelector(".tkflash") || {}).textContent, pill: (document.querySelector(".uprow .u1") || {}).textContent, attach: !!document.querySelector("[data-attach]"), approveBtn: !!document.querySelector("[data-tkok]") }));
  await page.screenshot({ path: D + `qa/staff-approved-${SIZE}.png` });
}
out.log = log;
console.log(JSON.stringify(out, null, 1));
await browser.close();
