// Records the Bestly-side half of the Google OAuth verification demo (1280x720 webm).
// Usage: NODE_PATH=<playwright> node record-bestly-part.cjs <outDir> <boardUrlFile> <connectLink>
//  - boardUrlFile: a local file holding the sandbox client's board URL (never committed).
//  - connectLink:  the sandbox client's https://www.bestly.tech/c/<code> YouTube connect link.
// It stops at Google's sign-in page. It never types credentials, never uploads, never flips studio_yt_live.
const { chromium } = require("playwright"); const fs = require("fs");
const [,, OUT, BOARD_FILE, CONNECT] = process.argv;
const BOARD = fs.readFileSync(BOARD_FILE, "utf8").trim();
const W = 1280, H = 720;
const sleep = (p, ms) => p.waitForTimeout(ms);
async function caption(p, text) {
  await p.evaluate((t) => { let d = document.getElementById("__cap"); if (!d) { d = document.createElement("div"); d.id = "__cap";
    d.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:rgba(10,10,10,.88);color:#fff;font:600 20px -apple-system,Segoe UI,Roboto,sans-serif;padding:14px 24px;text-align:center"; document.documentElement.appendChild(d); } d.textContent = t; }, text).catch(() => {});
}
async function card(p, big, small) {
  await p.setContent(`<body style="margin:0;background:#0a0a0a;color:#fff;font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;text-align:center;padding:0 90px">
  <div style="font-size:60px;font-weight:700;letter-spacing:-1px">${big}</div><div style="font-size:26px;line-height:1.4;margin-top:24px;color:#d6d6d6;max-width:980px">${small}</div></body>`);
}
async function slowScroll(p, to, ms = 2500) {
  await p.evaluate(async ([to, ms]) => { const s = scrollY, t0 = performance.now(); await new Promise(r => { const f = (n) => { const k = Math.min(1, (n - t0) / ms); scrollTo(0, s + (to - s) * k); k < 1 ? requestAnimationFrame(f) : r(); }; requestAnimationFrame(f); }); }, [to, ms]);
}
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } } });
  const p = await ctx.newPage();
  // 1. Title card
  await card(p, "Bestly Studio", "Bestly Studio posts the short videos a client approves to the client's own YouTube channel. This video shows the app, its privacy policy, and how a client connects their channel.<br><br><span style='font-size:20px;color:#999'>Part 1 of 2: the Bestly side. Part 2 is the Google consent screen.</span>");
  await sleep(p, 5500);
  // 2. Home page
  await p.goto("https://www.bestly.tech/", { waitUntil: "networkidle" }); await sleep(p, 1200);
  await p.getByRole("button", { name: "Accept" }).click().catch(() => {}); await sleep(p, 500);
  await caption(p, "Bestly home page: bestly.tech"); await sleep(p, 3500);
  await slowScroll(p, 99999, 3000); await sleep(p, 500);
  await caption(p, "The privacy policy is linked from the home page footer"); await sleep(p, 3000);
  // 3. Privacy policy, scrolled to the YouTube section
  await p.goto("https://www.bestly.tech/privacy-policy", { waitUntil: "networkidle" }); await sleep(p, 1500);
  await caption(p, "Bestly privacy policy: bestly.tech/privacy-policy"); await sleep(p, 2500);
  const top = await p.evaluate(() => { const e = document.getElementById("s-16c"); return e ? e.getBoundingClientRect().top + scrollY - 20 : -1; });
  if (top < 0) throw new Error("YouTube section #s-16c not live yet");
  await slowScroll(p, top, 3500); await caption(p, "Section: Bestly Studio, Connected YouTube Channels"); await sleep(p, 6000);
  await slowScroll(p, top + 420, 3500); await sleep(p, 7000);
  // 4/5. Client portal: Settings > Your accounts > YouTube tile (sandbox client)
  await p.goto(BOARD, { waitUntil: "networkidle" }); await sleep(p, 1500);
  await p.getByRole("button", { name: "Not now" }).click().catch(() => {});
  await caption(p, "Client portal (test client): the client's home screen"); await sleep(p, 3000);
  await p.getByRole("button", { name: /^Settings/ }).click(); await sleep(p, 1500);
  await caption(p, "Settings > Your accounts"); await sleep(p, 1500);
  await p.getByText("YouTube", { exact: true }).first().scrollIntoViewIfNeeded(); await sleep(p, 800);
  await caption(p, "YouTube tile: channel connected (test channel). Nothing is posted until the client approves a post."); await sleep(p, 6500);
  // 6. Connect link -> Google
  await p.goto(CONNECT, { waitUntil: "networkidle" }); await sleep(p, 2000);
  await caption(p, "Connect page. The client taps Continue to Google."); await sleep(p, 4500);
  await Promise.all([p.waitForURL(/accounts\.google\.com/), p.getByRole("link", { name: "Continue to Google" }).click()]);
  await sleep(p, 2500);
  await caption(p, "Google sign-in for Bestly Studio. Part 2 (Google consent screen) continues on the next clip.").catch(() => {});
  await sleep(p, 5000);
  await p.goto("about:blank");
  await card(p, "End of part 1", "Part 2: sign in with Google, the consent screen with both scopes, Allow, and the connected channel back in Bestly.");
  await sleep(p, 4000);
  await ctx.close(); await b.close();
  const f = fs.readdirSync(OUT).filter(x => x.endsWith(".webm")).map(x => OUT + "/" + x)[0];
  fs.renameSync(f, OUT + "/bestly-part.webm"); console.log("saved", OUT + "/bestly-part.webm");
})().catch(e => { console.error(e); process.exit(1); });
