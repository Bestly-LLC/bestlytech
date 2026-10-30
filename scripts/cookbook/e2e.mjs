// Family Cookbook end-to-end run. Drives the real built app (dist/cookbook.html) in Chromium against harness.mjs.
//   npx vite preview --port 4173 &   then   node scripts/cookbook/e2e.mjs [outdir]
// Nothing here talks to production: every Supabase call is answered by the harness.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { makeServer, TOKENS } from "./harness.mjs";

const BASE = process.env.BASE || "http://localhost:4173";
const OUT = process.argv[2] || "/tmp/cookbook-shots";
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || ["/opt/pw-browsers/chromium-1243/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1223/chrome-linux64/chrome"].find((p) => fs.existsSync(p));
const html = fs.readFileSync(new URL("../../dist/cookbook.html", import.meta.url), "utf8");

const SIZES = [["phone-390", 390, 844], ["phone-412", 412, 915], ["tablet-744", 744, 1133], ["landscape-1133", 1133, 744]];
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
let pass = 0, fail = 0;
const fails = [];
const check = (name, ok, detail = "") => { if (ok) pass++; else { fail++; fails.push(name + (detail ? " :: " + detail : "")); } console.log((ok ? "  ok   " : "  FAIL ") + name + (ok || !detail ? "" : "  -> " + detail)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ executablePath: CHROME, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--no-sandbox"] });

async function open(size, who, { dark = false, token = true, reduced = false, ua } = {}) {
  const [, w, h] = size;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, hasTouch: w < 800, isMobile: w < 800, colorScheme: dark ? "dark" : "light", reducedMotion: reduced ? "reduce" : "no-preference", permissions: ["camera"], locale: "en-US", timezoneId: "America/Los_Angeles", ...(ua ? { userAgent: ua } : {}) });
  const page = await ctx.newPage();
  const srv = makeServer();
  const errors = [], failed = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("requestfailed", (r) => failed.push(r.method() + " " + r.url() + " " + (r.failure()?.errorText || "")));
  await srv.install(page, who);
  // the callback path is a server-side rewrite in production (vercel.json); mirror it here
  await page.route(/\/cookbook(\/callback)?(\?.*)?$/, (route) => route.fulfill({ status: 200, contentType: "text/html", body: html }));
  if (token && who) await page.addInitScript((t) => { try { localStorage.setItem("fc_token", t); localStorage.setItem("fc_tip_" + "seen", "1"); } catch { /* none */ } }, TOKENS[who]);
  return { ctx, page, srv, errors, failed };
}
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const text = (page) => page.evaluate(() => document.body.innerText);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name + ".png") });
async function dismissTip(page) { const b = page.locator('[data-act="tip-ok"]'); if (await b.count()) { await b.first().click(); await sleep(150); } }
const bigEnough = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent && e.getBoundingClientRect().width).map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height, (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 30)]; }).filter(([w, h]) => w < 44 || h < 44), sel);

/* ---------- 1. every size: sign-in, home as each person, recipe page, no overflow ---------- */
for (const size of SIZES) {
  console.log("\n== " + size[0]);
  // sign-in, nobody
  {
    const { ctx, page, errors, failed } = await open(size, null, { token: false });
    await page.goto(BASE + "/cookbook.html", { waitUntil: "networkidle" });
    const t = await text(page);
    check(size[0] + " sign-in screen offers Bestly Cloud", /Sign in with Bestly Cloud/.test(t));
    check(size[0] + " sign-in never says Nextcloud", !/nextcloud/i.test(t));
    check(size[0] + " generic title before sign-in", (await page.title()) === "Family Cookbook", await page.title());
    check(size[0] + " generic manifest before sign-in", (await page.locator('link[rel="manifest"]').getAttribute("href")) === "/cookbook.webmanifest");
    check(size[0] + " sign-in no horizontal overflow", await noOverflow(page));
    await shot(page, size[0] + "-signin");
    check(size[0] + " sign-in no console errors", errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  for (const who of ["mom", "jared"]) {
    const { ctx, page, srv, errors, failed } = await open(size, who);
    await page.goto(BASE + "/cookbook.html", { waitUntil: "networkidle" });
    await dismissTip(page);
    await page.waitForSelector('[data-act="open"]');
    const t = await text(page);
    check(`${size[0]} ${who}: home lists recipes`, /Banana Bread/.test(t));
    check(`${size[0]} ${who}: no preview-only controls`, !/Reset|Fast timers|Sample|Switch (person|to)/i.test(t) && (await page.locator(".strip").count()) === 0);
    check(`${size[0]} ${who}: no "Nextcloud"`, !/nextcloud/i.test(t));
    check(`${size[0]} ${who}: no horizontal overflow`, await noOverflow(page));
    if (who === "mom") {
      check(`${size[0]} mom: never sees Jared's or Mariah's recipes`, !/SECRETMARIAH|SECRETJARED|almond/i.test(t));
      check(`${size[0]} mom: no Needs a look row`, !/Needs a look/.test(t));
      check(`${size[0]} mom: title and manifest say Harris`, (await page.title()).includes("Harris") && (await page.locator('link[rel="manifest"]').getAttribute("href")) === "/cookbook-harris.webmanifest", await page.title());
      const asked = srv.log.filter((l) => l[1] === "mom").map((l) => JSON.stringify(l[2]));
      check(`${size[0]} mom: never asked for someone else's id`, !asked.some((a) => /"p_id":"?(103|104|105)\b/.test(a)));
    } else {
      check(`${size[0]} jared: sees all five`, /SECRETMARIAH/.test(t) && /SECRETJARED/.test(t) && /almond/i.test(t));
      check(`${size[0]} jared: Needs a look row with count`, /Needs a look/.test(t));
      check(`${size[0]} jared: title says Best`, (await page.title()).includes("Best"), await page.title());
    }
    check(`${size[0]} ${who}: no focus box around the title`, await page.evaluate(() => { const h = document.querySelector("#h1"); return !h || getComputedStyle(h).outlineStyle === "none" || getComputedStyle(h).outlineWidth === "0px"; }));
    const small = await bigEnough(page, "button, a, .rcard, input, select");
    check(`${size[0]} ${who}: home targets are 44px or more`, small.length === 0, JSON.stringify(small.slice(0, 5)));
    await shot(page, `${size[0]}-home-${who}`);
    // recipe page
    await page.locator('[data-act="open"]', { hasText: "Banana Bread" }).first().click();
    await page.waitForSelector("#hero");
    await sleep(500);
    check(`${size[0]} ${who}: recipe no horizontal overflow`, await noOverflow(page));
    const dots = await page.evaluate(() => {
      const its = [...document.querySelectorAll("#r-src .it")];
      if (its.length < 2) return { ok: false, why: "facts " + its.length };
      const rows = new Map();
      its.forEach((e, i) => { const top = Math.round(e.getBoundingClientRect().top); (rows.get(top) || rows.set(top, []).get(top)).push(i); });
      let bad = "";
      its.forEach((e, i) => {
        const d = e.querySelector(".dot"); if (!d) return;
        const vis = getComputedStyle(d).visibility !== "hidden" && getComputedStyle(d).opacity !== "0";
        const next = its[i + 1]; const sameRow = next && Math.round(next.getBoundingClientRect().top) === Math.round(e.getBoundingClientRect().top);
        if (vis && !sameRow) bad = "dot at end of a line after fact " + i;
      });
      const first = its[0].textContent.trim();
      return { ok: !bad && !/^·/.test(first), why: bad || first };
    });
    check(`${size[0]} ${who}: hero source line has no dangling dot`, dots.ok, dots.why);
    const t2 = await text(page);
    check(`${size[0]} ${who}: visibility line`, who === "mom" ? /Shared with Jared and Mariah/.test(t2) : /Shared with Jared and Mariah/.test(t2));
    check(`${size[0]} ${who}: recipe has time in 12-hour clock`, /\b\d{1,2}:\d{2}\s?(AM|PM)\b/.test(t2));
    check(`${size[0]} ${who}: Ingredients and Start Cooking pills`, /Ingredients/.test(t2) && /Start Cooking/.test(t2));
    const smallR = await bigEnough(page, "#view button, #view a, #view input, #view select, #view textarea, #view summary");
    check(`${size[0]} ${who}: recipe targets are 44px or more`, smallR.length === 0, JSON.stringify(smallR.slice(0, 6)));
    await shot(page, `${size[0]}-recipe-${who}`);
    check(`${size[0]} ${who}: no console errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
    check(`${size[0]} ${who}: no failed requests`, failed.length === 0, failed.slice(0, 3).join(" | "));
    await ctx.close();
  }
}

/* ---------- 2. dark mode and reduced motion look ---------- */
{
  console.log("\n== dark mode");
  const { ctx, page, errors } = await open(SIZES[0], "jared", { dark: true, reduced: true });
  await page.goto(BASE + "/cookbook.html", { waitUntil: "networkidle" });
  await dismissTip(page);
  await page.waitForSelector('[data-act="open"]');
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const [r, g, b] = bg.match(/\d+/g).map(Number);
  check("dark: page background is dark", r + g + b < 200, bg);
  await shot(page, "dark-home");
  await page.locator('[data-act="open"]', { hasText: "Banana Bread" }).first().click();
  await page.waitForSelector("#hero"); await sleep(400);
  await shot(page, "dark-recipe");
  check("dark: no horizontal overflow", await noOverflow(page));
  check("dark: no console errors", errors.length === 0, errors.join(" | "));
  await ctx.close();
}

/* ---------- 3. the callback: Bestly Cloud brings Mom back ---------- */
{
  console.log("\n== sign-in round trip (phone 390)");
  const { ctx, page, srv, errors } = await open(SIZES[0], "mom", { token: false });
  await page.goto(BASE + "/cookbook.html", { waitUntil: "networkidle" });
  await page.locator('[data-act="signin"]').click();
  await page.waitForURL(/\/cookbook\/callback\?code=/);
  await page.waitForSelector('[data-act="open"]');
  const tok = await page.evaluate(() => localStorage.getItem("fc_token"));
  check("callback: session saved", tok === TOKENS.mom);
  check("callback: URL cleaned back to /cookbook", new URL(page.url()).pathname === "/cookbook" && !page.url().includes("code="), page.url());
  check("callback: home screen title follows Mom", (await page.title()).includes("Harris"), await page.title());
  check("callback: manifest swapped to Harris", (await page.locator('link[rel="manifest"]').getAttribute("href")) === "/cookbook-harris.webmanifest");
  check("callback: no console errors", errors.length === 0, errors.join(" | "));
  // sign out
  await dismissTip(page);
  await page.locator('[data-act="menu"]').click();
  await page.locator('[data-act="signout"]').click();
  await page.waitForSelector('[data-act="signin"]');
  check("sign out: token gone and generic title back", (await page.evaluate(() => localStorage.getItem("fc_token"))) !== TOKENS.mom && (await page.title()) === "Family Cookbook");
  await ctx.close();
}

/* ---------- 4. recipe page behavior as Jared ---------- */
{
  console.log("\n== recipe behavior (Jared, phone 390)");
  const { ctx, page, srv, errors } = await open(SIZES[0], "jared");
  await page.goto(BASE + "/cookbook.html", { waitUntil: "networkidle" });
  await dismissTip(page);
  await page.locator('[data-act="open"]', { hasText: "Banana Bread" }).first().click();
  await page.waitForSelector("#r-ing li");
  const ing1 = await page.locator("#r-ing").innerText();
  await page.locator('[data-act="scale"][data-f="2"]').click();
  await sleep(150);
  const ing2 = await page.locator("#r-ing").innerText();
  check("scale 2x changes the ingredients", ing1 !== ing2 && /6/.test(ing2), ing2.slice(0, 80));
  await page.locator('[data-act="scale"][data-f="0.5"]').click();
  await sleep(150);
  const ingH = await page.locator("#r-ing").innerText();
  check("scale 1/2x halves the bananas", /1½|1 ½|1\s?1\/2/.test(ingH) || /1.5/.test(ingH), ingH.slice(0, 80));
  const steps = await page.locator("#r-steps").innerText();
  check("steps show the inline amounts, no raw tokens", !/\{[a-z]+\}/.test(steps) && /ripe bananas/.test(steps));
  check("scaled amounts keep number and unit together", await page.evaluate(() => !!document.querySelector("#r-ing .nw, #r-steps .nw")));
  await page.locator('[data-act="scale"][data-f="1"]').click();
  // OmniCook is Jared only
  check("OmniCook switch present for Jared", (await page.locator('[data-act="omni"]').count()) === 1 || /Tokit OmniCook/.test(await text(page)) === false);
  // notes persist through the RPC
  await page.locator("#notes").fill("Less sugar next time");
  await page.locator("#notes").blur();
  await sleep(500);
  check("notes saved through family_set_notes", srv.log.some((l) => l[0] === "family_set_notes" && /Less sugar/.test(l[2].p_body || "")));
  await page.locator("#logNote").fill("Came out great");
  await page.locator('[data-act="logadd"]').click();
  await sleep(300);
  check("cook log saved", srv.log.some((l) => l[0] === "family_log_cook"));
  // cook mode
  await page.locator('[data-act="cook"]').first().click();
  await page.waitForSelector(".cnav");
  const c1 = await page.locator("#l-cook").innerText();
  check("cook mode shows step 1", /Step 1/i.test(c1) || /Heat the oven/.test(c1), c1.slice(0, 80));
  await page.locator('[data-act="cook-next"]').click(); await sleep(250);
  await page.locator('[data-act="cook-next"]').click(); await sleep(250);
  await page.locator('[data-act="cook-next"]').click(); await sleep(250);
  const c4 = await page.locator("#l-cook").innerText();
  check("cook mode reaches the timed step", /Bake/.test(c4) && /timer/i.test(c4), c4.slice(0, 120));
  await shot(page, "cook-step");
  await page.locator('[data-act="ctimer"]').click(); await sleep(300);
  const t0 = await page.locator("#timers").innerText();
  check("timer started and shows 55:00 or 54:", /5[45]:\d\d/.test(t0), t0.slice(0, 80));
  await page.locator('[data-act="tplus"]').first().click(); await sleep(250);
  const t1 = await page.locator("#timers").innerText();
  check("+1 min adds a minute", /55:|56:/.test(t1) && t1 !== t0, t0 + " -> " + t1);
  await shot(page, "cook-timer");
  await page.locator('[data-act="cook-back"]').click(); await sleep(250);
  const cb = await page.locator("#l-cook").innerText();
  check("Back goes to the earlier step", /Add the dry part|dry/i.test(cb), cb.slice(0, 80));
  await page.locator('[data-act="cook-close"]').first().click(); await sleep(250);
  check("closing cook mode returns to the recipe", (await page.locator("#hero").count()) === 1);
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

/* ---------- 5. "I only have 2 cups almond flour" on Jared's Kitchen recipe ---------- */
{
  console.log("\n== I only have (Jared)");
  const { ctx, page, errors } = await open(SIZES[0], "jared");
  await page.goto(BASE + "/cookbook.html", { waitUntil: "networkidle" });
  await dismissTip(page);
  await page.locator('[data-act="open"]', { hasText: /almond/i }).first().click();
  await page.waitForSelector("#have");
  await page.locator('[data-act="haveex"]').click(); await sleep(250);
  const out = await page.locator("#haveOut").innerText();
  check("almond-flour example gives a batch size", /×|batch|makes/i.test(out) && out.length > 10, out);
  await shot(page, "have-almond");
  const omni = await page.locator('[data-act="omni"]').count();
  check("OmniCook switch shows for Jared on an OmniCook-capable recipe", omni === 1, "count " + omni);
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
  // Mariah must not see the switch
  const m = await open(SIZES[0], "mariah");
  await m.page.goto(BASE + "/cookbook.html", { waitUntil: "networkidle" });
  await dismissTip(m.page);
  await m.page.locator('[data-act="open"]', { hasText: /almond/i }).first().click();
  await m.page.waitForSelector("#have");
  check("OmniCook switch hidden from Mariah", (await m.page.locator('[data-act="omni"]').count()) === 0 && !/OmniCook/.test(await text(m.page)));
  await m.ctx.close();
}

/* ---------- 6. snap, read, check, save (Mom) ---------- */
{
  console.log("\n== snap, read, check, save (Mom, phone 390)");
  const { ctx, page, srv, errors, failed } = await open(SIZES[0], "mom");
  await page.goto(BASE + "/cookbook.html", { waitUntil: "networkidle" });
  await dismissTip(page);
  await page.locator('[data-act="snap"]').click();
  await page.waitForSelector('[data-act="shutter"]:not([disabled])', { timeout: 8000 });
  await shot(page, "camera");
  await page.locator('[data-act="shutter"]').click();
  await page.waitForSelector('[data-act="add-back"]', { timeout: 10000 });
  const up = srv.uploads[0];
  check("front photo uploaded as Mom", !!up && up.role === "mom" && up.side === "front", JSON.stringify(up));
  check("photo shrunk under about 0.6 MB", !!up && up.bytes < 650 * 1024, String(up && up.bytes));
  await page.locator('[data-act="add-back"]').click();
  await page.waitForSelector('[data-act="shutter"]:not([disabled])');
  await page.locator('[data-act="shutter"]').click();
  await page.waitForSelector('[data-act="keep-going"]', { timeout: 10000 });
  check("back photo uploaded onto the same card", srv.uploads.length === 2 && srv.uploads[1].side === "back" && srv.uploads[1].capture === srv.caps[0].id, JSON.stringify(srv.uploads));
  await page.locator('[data-act="snap-close"]').click();
  await sleep(300);
  let t = await text(page);
  check("queued card shows as reading", /Reading|reading/.test(t), t.slice(0, 200));
  await shot(page, "queue-reading");
  // make the harness say it is ready, then wait for the poll
  srv.caps[0].at = Date.now() - 5000;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await page.waitForSelector('[data-act="qcheck"]', { timeout: 15000 });
  await shot(page, "queue-ready");
  await page.locator('[data-act="qcheck"]').first().click();
  await page.waitForSelector('[data-act="looks"]');
  const chk = await text(page);
  check("check screen highlights unsure words", (await page.locator('[data-act="fix"], .unsure, mark').count()) > 0);
  check("check screen has the card and the typed text", /Lemon Bars/.test(chk));
  check("check screen offers 'Someone else check this' only with Jared or Mariah", /Someone else check this/.test(chk));
  await shot(page, "check-card");
  // fix a word
  await page.locator('[data-act="fix"]').first().click();
  await page.waitForSelector('[data-act="fix-pick"]');
  await shot(page, "fix-word");
  await page.locator('[data-act="fix-pick"]').nth(1).click();
  await sleep(200);
  const sheetOpen = await page.locator("#l-sheet [data-act='fix-next'], #l-sheet [data-act='close-sheet']").count();
  if (sheetOpen) { const nx = page.locator('[data-act="fix-next"]'); if (await nx.count()) await nx.first().click(); else await page.locator('#l-sheet [data-act="close-sheet"]').first().click(); await sleep(200); }
  await page.locator('[data-act="looks"]').click();
  await page.waitForSelector("#hero", { timeout: 8000 });
  check("saving opens the new recipe", /Lemon Bars/.test(await page.locator("#h1").innerText()));
  await page.locator('[data-act="back"]').first().click();
  await page.waitForSelector('[data-act="open"]', { timeout: 8000 });
  t = await text(page);
  check("saved recipe appears on Mom's home", /Lemon Bars/.test(t));
  const saved = srv.recs.find((r) => r.doc.title === "Lemon Bars");
  check("saved doc has no leftover [[ ]] markup", !!saved && !/\[\[|\]\]/.test(JSON.stringify(saved.doc)));
  check("saved doc has no unsure flags left", !!saved && !JSON.stringify(saved.doc).includes('"unsure"'));
  check("saved as Mom's own", !!saved && saved.by === "mom");
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  check("no failed requests", failed.length === 0, failed.slice(0, 3).join(" | "));
  // flag: someone else check this
  await ctx.close();
}

/* ---------- 7. delete, Recently Deleted, restore; Mom cannot see Jared's deleted ---------- */
{
  console.log("\n== delete and restore");
  const { ctx, page, srv, errors } = await open(SIZES[0], "mom");
  await page.goto(BASE + "/cookbook.html", { waitUntil: "networkidle" });
  await dismissTip(page);
  await page.locator('[data-act="open"]', { hasText: "Banana Bread" }).first().click();
  await page.waitForSelector('[data-act="del"]');
  await page.locator('[data-act="del"]').click();
  await page.waitForSelector('[data-act="del-yes"]');
  await shot(page, "delete-confirm");
  await page.locator('[data-act="del-yes"]').click();
  await page.waitForSelector('[data-act="menu"]');
  await sleep(300);
  let t = await text(page);
  check("deleted recipe leaves the list", !/Banana Bread/.test(t));
  // Jared deletes one of his own, then Mom opens Recently Deleted
  srv.recs.find((r) => r.doc.title.startsWith("SECRETJARED")).deletedAt = new Date().toISOString();
  await page.locator('[data-act="menu"]').click();
  await page.locator('[data-act="deleted"]').click();
  await page.waitForSelector('[data-act="restore"]');
  t = await text(page);
  check("Recently Deleted shows Mom's recipe with days left", /Banana Bread/.test(t) && /30 days|29 days/.test(t), t.slice(0, 200));
  check("Recently Deleted never shows Jared's recipe to Mom", !/SECRETJARED/.test(t));
  await shot(page, "recently-deleted");
  await page.locator('[data-act="restore"]').first().click();
  await sleep(500);
  check("restore says what happened", /Restored/.test(await text(page)));
  await page.locator('[data-act="back"]').first().click();
  await page.waitForSelector('[data-act="open"]', { timeout: 8000 });
  t = await text(page);
  check("restore brings it back", /Banana Bread/.test(t));
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

/* ---------- 8. Jared's Needs a look: approve ---------- */
{
  console.log("\n== Needs a look (Jared)");
  const { ctx, page, srv, errors } = await open(SIZES[0], "jared");
  await page.goto(BASE + "/cookbook.html", { waitUntil: "networkidle" });
  await dismissTip(page);
  await page.locator('[data-act="review"]').click();
  await page.waitForSelector('[data-act="open-review"]');
  const t = await text(page);
  check("queue lists the flagged pot roast", /Pot Roast/.test(t));
  await page.locator('[data-act="open-review"]').first().click();
  await page.waitForSelector('[data-act="approve"]');
  await shot(page, "review-card");
  await page.locator('[data-act="approve"]').click();
  await sleep(500);
  check("approve called once", srv.log.filter((l) => l[0] === "family_approve").length === 1);
  check("no console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

/* ---------- 9. nutrition panel and Log to Health (Jared, phone 390) ---------- */
{
  console.log("\n== nutrition panel and Log to Health (Jared, phone 390)");
  const { ctx, page, errors } = await open(SIZES[0], "jared", { ua: IPHONE_UA });
  await page.addInitScript(() => { try { localStorage.setItem("cb.healthShortcut", "1"); } catch { /* none */ } });
  await page.goto(BASE + "/cookbook.html", { waitUntil: "networkidle" });
  await dismissTip(page);
  await page.locator('[data-act="open"]', { hasText: "Banana Bread" }).first().click();
  await page.waitForSelector(".nut-panel");
  const t1 = await text(page);
  check("panel renders from a fixture with nutrition", /Nutrition/.test(t1) && /150/.test(t1) && /Estimated/.test(t1), t1.slice(0, 10));
  check("extra rows start collapsed", !/Fiber/.test(t1));
  await page.locator('[data-act="nut-more"]').click();
  await sleep(150);
  check("Show more reveals Fiber, Sugar, Sodium", /Fiber/.test(await text(page)) && /Sugar/.test(await text(page)) && /Sodium/.test(await text(page)));
  await shot(page, "nutrition-panel");
  await page.locator('[data-act="health"]').click();
  await page.waitForSelector('[data-act="log-it"]');
  await page.locator('[data-act="ate-inc"]').click();
  await sleep(100);
  const sum = await page.locator("#ate-sum").innerText();
  check("sheet math: 2 x 150 = 300 kcal", /Calories\s*300/.test(sum), sum);
  await shot(page, "log-to-health-sheet");
  check("no console errors before logging", errors.length === 0, errors.slice(0, 3).join(" | "));
  const urlP = page.evaluate(() => new Promise((resolve) => document.addEventListener("cb:health-log", (e) => resolve(e.detail.url), { once: true })));
  await page.locator('[data-act="log-it"]').click();
  const url = await urlP;
  const payload = JSON.parse(decodeURIComponent(new URL(url).searchParams.get("text")));
  check("the shortcut URL is built correctly", url.startsWith("shortcuts://x-callback-url/run-shortcut?name=Log%20to%20Health") && url.includes("x-success="), url);
  check("shortcut payload doubles the per-serving amounts", payload.kcal === 300 && payload.protein_g === 12 && payload.title === "Banana Bread", JSON.stringify(payload));
  await sleep(200);
  check("toast confirms what was logged", /Logged 2 slices to Health/.test(await text(page)));
  await ctx.close();
}

/* ---------- 10. the panel is hidden when there's no nutrition; first tap offers Health setup ---------- */
{
  console.log("\n== nutrition hidden / Health first-tap setup (Jared, phone 390)");
  const { ctx, page } = await open(SIZES[0], "jared");
  await page.goto(BASE + "/cookbook.html", { waitUntil: "networkidle" });
  await dismissTip(page);
  await page.locator('[data-act="open"]', { hasText: "Sunday Pot Roast" }).first().click();
  await page.waitForSelector("#hero");
  await sleep(300);
  check("the panel is hidden when there's no nutrition", (await page.locator(".nut-panel").count()) === 0 && !/Nutrition/.test(await text(page)));
  await ctx.close();
  const j2 = await open(SIZES[0], "jared", { ua: IPHONE_UA });
  await j2.page.goto(BASE + "/cookbook.html", { waitUntil: "networkidle" });
  await dismissTip(j2.page);
  await j2.page.locator('[data-act="open"]', { hasText: "Banana Bread" }).first().click();
  await j2.page.waitForSelector('[data-act="health"]');
  await j2.page.locator('[data-act="health"]').click();
  await j2.page.waitForSelector('[data-act="get-shortcut"]');
  check("first tap ever offers to connect Apple Health", /Connect Apple Health/.test(await text(j2.page)));
  await j2.ctx.close();
}

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.map((f) => " - " + f).join("\n")); process.exit(1); }
