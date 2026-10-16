// YouTube prep on her board settings. Usage: node qa_yt.mjs <previewId|live> <mob|desk>
import { chromium } from "/opt/node-tools/node_modules/playwright/index.mjs";
import fs from "node:fs";
const D = process.env.QA_DIR || "/tmp/w/";
const TOK = fs.readFileSync(D + "bt.tok", "utf8").trim();
const PREV = process.argv[2], SIZE = process.argv[3] || "desk";
const vp = SIZE === "mob" ? { width: 375, height: 812 } : { width: 1280, height: 900 };
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: SIZE === "mob", isMobile: SIZE === "mob" });
const p = await ctx.newPage(); const errs = [];
p.on("pageerror", e => errs.push(e.message.slice(0, 160))); p.on("console", m => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await p.goto(`https://studio.bestly.tech/bestly-test?c=${TOK}${PREV === "live" ? "" : "&preview=" + PREV}`, { waitUntil: "domcontentloaded", timeout: 60000 });
await p.waitForTimeout(8000);
await p.click("#pickSet"); await p.waitForTimeout(1500);
const out = await p.evaluate(() => { const t = document.querySelector("[data-acct=youtube]"); return { modal: !!document.getElementById("rcModal"), text: t ? t.innerText.replace(/\n+/g, " | ") : null, steps: t ? [...t.querySelectorAll(".csteps > li")].map(l => l.innerText.replace(/\n+/g, " / ")) : [], trouble: t ? [...t.querySelectorAll(".tbody b")].map(x => x.textContent) : [] }; });
await p.evaluate(() => { const t = document.querySelector("[data-acct=youtube]"); if (t) t.scrollIntoView({ block: "center" }); });
await p.waitForTimeout(500);
await p.screenshot({ path: D + `qa/yt-${process.argv[4] || "x"}-${SIZE}.png` });
console.log(JSON.stringify({ ...out, errs }, null, 1)); await b.close();
