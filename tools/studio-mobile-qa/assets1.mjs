import { open, shot, goTab } from "./lib.mjs";
const W = "/tmp/claude-0/sp/mobile/work";
const useNew = process.argv[2] === "new";
const { browser, page, log } = await open({ slug: "centering-you", size: "390", build: useNew ? { index: W + "/index.new.html", board: W + "/board.live.html" } : undefined });
page.setDefaultTimeout(8000); page.on("requestfailed", r => console.log("FAILED", r.url().slice(-100), r.resourceType(), r.failure().errorText));
await goTab(page, "Library");
await page.evaluate(() => { const b = [...document.querySelectorAll("button")].find(b => b.textContent.trim().startsWith("Assets") && b.getBoundingClientRect().width > 0); b && b.click(); });
await page.waitForTimeout(3500);
let max = 0, mounted = 0;
const scroller = await page.evaluate(() => { const l = document.getElementById("list"); return l ? l.scrollHeight + "/" + l.clientHeight : "?"; });
console.log("list", scroller);
for (let i = 0; i < 30; i++) {
  await page.evaluate(() => { document.getElementById("detail").scrollBy(0, 700); });
  await page.waitForTimeout(500);
  const n = await page.evaluate(() => document.querySelectorAll("video:not(.orb)[src]").length);
  max = Math.max(max, n);
}
const tot = await page.evaluate(() => ({ tiles: document.querySelectorAll(".tthumb").length, vids: document.querySelectorAll("video:not(.orb)").length, withSrc: document.querySelectorAll("video:not(.orb)[src]").length }));
console.log(useNew ? "NEW" : "OLD", "maxSimultaneousVideoSrc", max, JSON.stringify(tot));
await shot(page, `assets-${useNew ? "new" : "old"}`);
console.log(JSON.stringify(log));
await browser.close();
