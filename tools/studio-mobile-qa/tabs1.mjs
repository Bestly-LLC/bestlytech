import { open, shot, goTab } from "./lib.mjs";
const slug = process.argv[2] || "centering-you", size = process.argv[3] || "390", tag = process.argv[4] || "live";
const build = process.argv[5] ? { index: process.argv[5], board: process.argv[6] } : undefined;
const { browser, page, log } = await open({ slug, size, build });
page.setDefaultTimeout(5000);
const cnt = () => page.evaluate(() => ({ vids: document.querySelectorAll("video:not(.orb)").length, withSrc: [...document.querySelectorAll("video:not(.orb)")].filter(v => v.getAttribute("src")).length, painted: [...document.querySelectorAll("video:not(.orb)")].filter(v => v.readyState >= 2).length, imgs: document.querySelectorAll("img").length }));
console.log("home", JSON.stringify(await cnt()));
for (const name of ["Asks", "Inbox", "Library", "Calendar", "Brand", "Settings", "Bank", "Their list"]) {
  try { const ok = await goTab(page, name); console.log(name, ok, JSON.stringify(await cnt())); await shot(page, `t1-${slug}-${size}-${tag}-${name.replace(/\W/g, "")}`); }
  catch (e) { console.log(name, "ERR", e.message.slice(0, 100)); }
}
try { await page.evaluate(() => (document.getElementById("bellTop") || document.getElementById("bell")).click()); await page.waitForTimeout(2000); console.log("bell", JSON.stringify(await cnt())); await shot(page, `t1-${slug}-${size}-${tag}-bell`); } catch (e) { console.log("bell ERR", e.message.slice(0, 80)); }
console.log(JSON.stringify(log));
await browser.close();
