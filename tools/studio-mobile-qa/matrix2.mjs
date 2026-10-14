import { open, shot } from "./lib.mjs";
const slug = process.argv[2] || "bestly-cloud", size = process.argv[3] || "390", tag = process.argv[4] || "live";
const build = process.argv[5] ? { index: process.argv[5], board: process.argv[6] } : undefined;
const { browser, page, log } = await open({ slug, size, build });
const out = []; const P = (k, v) => out.push(k + ": " + JSON.stringify(v));
const vids = () => page.$$eval("video:not(.orb)", vs => vs.map(v => ({ w: v.closest(".vth") ? "theatre" : v.classList.contains("pvid") ? "pvid" : "inline", t: +v.currentTime.toFixed(1), p: v.paused, m: v.muted, rs: v.readyState })));
const playing = () => page.$$eval("video:not(.orb)", vs => vs.filter(v => !v.paused).length);
await page.tap("#list [data-id]"); await page.waitForTimeout(1500);
// 1 theatre from still
await page.tap(".vplay"); await page.waitForTimeout(1500); P("theatre open", await vids());
// 2 scrub: tap on the range at 80%
const sc = page.locator(".vth .vscrub"); const bb = await sc.boundingBox(); P("scrub box", bb && [Math.round(bb.width), Math.round(bb.height)]);
if (bb) { await page.touchscreen.tap(bb.x + bb.width * 0.8, bb.y + bb.height / 2); await page.waitForTimeout(800); P("after scrub", await vids()); }
// 3 background: emulate visibilitychange hidden then visible
await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
await page.waitForTimeout(500);
await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
await page.waitForTimeout(1500); P("after bg", { vids: await vids(), vth: !!(await page.$(".vth")) });
// 4 rotate
await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(800); await shot(page, `m2-${slug}-${tag}-landscape-theatre`);
P("landscape vstage", await page.$eval(".vth video", v => { const r = v.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
const bar = await page.$eval(".vth .vbar", b => { const r = b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), innerHeight]; }); P("landscape vbar top/bottom/H", bar);
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
// 5 close
await page.tap("#vthX"); await page.waitForTimeout(800); P("closed", await vids()); P("playing count", await playing());
// 6 switch posts while playing (phone preview mode)
await page.locator(".pmodes button", { hasText: /^TikTok$/ }).first().tap(); await page.waitForTimeout(1200);
await page.tap(".ptap"); await page.waitForTimeout(1500); P("tiktok playing", await vids());
await page.tap("#mBack, .mback, button:has-text('Queue')").catch(() => {}); await page.waitForTimeout(1000);
await page.locator("#list [data-id]").nth(1).tap(); await page.waitForTimeout(1500);
P("after switch post", await vids()); P("playing after switch", await playing());
console.log(out.join("\n")); console.log(JSON.stringify(log));
await browser.close();
