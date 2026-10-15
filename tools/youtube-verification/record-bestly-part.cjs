// Records the Bestly-side clips of the Google OAuth verification demo (1280x720 webm), v2 (portal first, in order).
// Usage: NODE_PATH=<playwright> node record-bestly-part.cjs <A|C> <outDir> <boardUrlFile>
//  - boardUrlFile: a local file holding the sandbox client's portal URL (never committed, never on screen).
//  Clip A: title, home + footer, privacy policy, portal home (not connected yet), an approved video post,
//          Settings > Your accounts > YouTube tile (Connect), tap Connect > Bestly connect page. Ends BEFORE "Continue to Google".
//  Clip C: the same portal after the client connected: YouTube tile Connected, closing card.
// It never types credentials, never uploads, never flips studio_yt_live, never clicks "Continue to Google"
// (that is Jared's clip B), so the one-time connect link is not consumed.
const { chromium } = require("playwright"); const fs = require("fs");
const [,, CLIP, OUT, BOARD_FILE] = process.argv;
const BOARD = fs.readFileSync(BOARD_FILE, "utf8").trim();
const W = 1280, H = 720;
const sleep = (p, ms) => p.waitForTimeout(ms);
async function caption(p, text) {
  await p.evaluate((t) => { let d = document.getElementById("__cap"); if (!d) { d = document.createElement("div"); d.id = "__cap";
    d.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(10,10,10,.88);color:#fff;font:600 20px -apple-system,Segoe UI,Roboto,sans-serif;padding:14px 24px;text-align:center"; document.documentElement.appendChild(d); } d.textContent = t; }, text).catch(() => {});
}
async function nocap(p) { await p.evaluate(() => { const d = document.getElementById("__cap"); if (d) d.remove(); }).catch(() => {}); }
async function card(p, big, small) {
  await p.setContent(`<body style="margin:0;background:#0a0a0a;color:#fff;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:0 90px">
  <div style="font-size:60px;font-weight:700;letter-spacing:-1px">${big}</div><div style="font-size:26px;line-height:1.4;margin-top:24px;color:#d6d6d6;max-width:980px">${small}</div></body>`);
}
async function slowScroll(p, to, ms = 2500) {
  await p.evaluate(async ([to, ms]) => { const s = scrollY, t0 = performance.now(); await new Promise(r => { const f = (n) => { const k = Math.min(1, (n - t0) / ms); scrollTo(0, s + (to - s) * k); k < 1 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }); }, [to, ms]);
}
async function openPortal(p) {
  await p.goto(BOARD, { waitUntil: "networkidle" }); await sleep(p, 1500);
  // "Skip the link next time? / Face ID" popup: dismiss before filming.
  await p.getByRole("button", { name: "Not now" }).click({ timeout: 2500 }).catch(() => {});
  await sleep(p, 600);
}
async function openYouTubeTile(p) {
  await p.getByRole("button", { name: /^Settings/ }).click(); await sleep(p, 1500);
  await p.getByText("YouTube", { exact: true }).first().scrollIntoViewIfNeeded(); await sleep(p, 800);
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  const p = await ctx.newPage();
  if (CLIP === "A") {
    await card(p, "Bestly Studio", "Bestly Studio posts the short videos a client approves to the client's own YouTube channel. This video shows the app, its privacy policy, where the client uses YouTube in their portal, and how they connect their channel.<br><br><span style='font-size:20px;color:#999'>Part 1 of 3: the Bestly side. Part 2 is the Google consent screen. Part 3 is the connected portal.</span>");
    await sleep(p, 6000);
    // 2. Home page + footer link
    await p.goto("https://www.bestly.tech/", { waitUntil: "networkidle" }); await sleep(p, 1200);
    await p.getByRole("button", { name: "Accept" }).click().catch(() => {}); await sleep(p, 500);
    await caption(p, "Bestly home page: bestly.tech"); await sleep(p, 3500);
    await slowScroll(p, 99999, 3000); await sleep(p, 500);
    await caption(p, "The privacy policy is linked from the home page footer"); await sleep(p, 3000);
    // 3. Privacy policy, YouTube section
    await p.goto("https://www.bestly.tech/privacy-policy", { waitUntil: "networkidle" }); await sleep(p, 1500);
    await caption(p, "Bestly privacy policy: bestly.tech/privacy-policy"); await sleep(p, 2500);
    const top = await p.evaluate(() => { const e = document.getElementById("s-16c"); return e ? e.getBoundingClientRect().top + scrollY - 20 : -1; });
    if (top < 0) throw new Error("YouTube section #s-16c not live");
    await slowScroll(p, top, 3500); await caption(p, "Section: Bestly Studio, Connected YouTube Channels"); await sleep(p, 6000);
    await slowScroll(p, top + 420, 3500); await sleep(p, 7000);
    // 4. Client portal dashboard (sandbox client), before YouTube is connected
    await openPortal(p);
    await caption(p, "Client portal (test client): the client's dashboard"); await sleep(p, 4500);
    // 5. A video post the client approved
    await p.getByRole("button", { name: /^All posts/ }).click(); await sleep(p, 1500);
    await p.getByText("Needs your review").first().click().catch(() => {}); await sleep(p, 500);
    await p.getByText("Scheduled", { exact: true }).first().click(); await sleep(p, 1200);
    await caption(p, "A video post the client approved for YouTube. Posts go out only after the client approves them."); await sleep(p, 7000);
    await nocap(p); await p.locator("#sheet").getByRole("button", { name: "Close" }).last().click(); await sleep(p, 1000);
    // 6. Settings > Your accounts > YouTube tile (not connected)
    await openYouTubeTile(p);
    await caption(p, "Settings > Your accounts: the YouTube tile. YouTube is not connected yet. The client taps Connect."); await sleep(p, 7000);
    // 7. Tap Connect -> Bestly connect page (stop before Continue to Google)
    await nocap(p);
    const lnk = p.getByRole("link", { name: /^Connect YouTube$/ });
    await lnk.evaluate(e => e.removeAttribute("target")); // same tab, so one continuous recording is made
    await lnk.click(); const cp = p;
    await cp.waitForLoadState("networkidle").catch(() => {}); await sleep(cp, 2500);
    await caption(cp, "Bestly connect page. Next, the client taps Continue to Google (shown in part 2).");
    await sleep(cp, 6000);
    await cp.goto("about:blank");
    await card(cp, "End of part 1", "Part 2: Continue to Google, the consent screen with both scopes, Allow, and the private test video in YouTube Studio.");
    await sleep(cp, 4000);
  } else {
    await openPortal(p);
    await caption(p, "Back in the same client portal, after the client allowed access"); await sleep(p, 3500);
    await openYouTubeTile(p);
    await caption(p, "YouTube tile: Connected, with the client's channel name. Nothing goes out until you approve a post."); await sleep(p, 8000);
    await p.goto("about:blank");
    await card(p, "Scopes in use", "Uploads use youtube.upload only for approved posts; channel name via youtube.readonly.");
    await sleep(p, 6000);
  }
  await ctx.close(); await b.close();
  const f = fs.readdirSync(OUT).filter(x => x.endsWith(".webm") && !x.startsWith("bestly-part")).map(x => OUT + "/" + x)[0];
  const dest = OUT + "/bestly-part-" + CLIP.toLowerCase() + ".webm";
  fs.renameSync(f, dest); console.log("saved", dest);
})().catch(e => { console.error(e); process.exit(1); });
