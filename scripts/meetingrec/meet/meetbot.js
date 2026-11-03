// meetbot.js - "Scout Notetaker (recording)" joins a Google Meet call as a visible guest, tells the room it is recording,
// records the call audio and scrapes Meet's live captions (who said what, when).
//
// usage: node meetbot.js <meetUrl> <outDir> [--end-at=<epoch ms>] [--knock-s=600] [--alone-s=90] [--show] [--name="..."]
// writes in <outDir>: audio.webm (everyone, mixed), captions.jsonl ({t, name, text} snapshots), meta.json, alive.json (heartbeat), bot.log,
//                     diag.json + diag.png when something goes wrong.
// Exit codes: 0 call ended / we left on purpose, 1 crashed, 2 bad usage, 3 never admitted (knocked until --knock-s ran out),
//             6 Meet will not let anonymous guests in ("You can't join this video call"), 7 told to stop (STOP file) before joining.
// Stops cleanly on SIGINT/SIGTERM or when <outDir>/STOP appears. Never speaks, camera and microphone are off (no device is ever opened).
// California is a two-party consent state: the guest name says "(recording)" and a chat message says the call is recorded.

const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const [meetUrl, outDir] = args.filter((a) => !a.startsWith("--"));
const opt = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
if (!meetUrl || !outDir || !/^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/.test(meetUrl)) {
  console.error("usage: node meetbot.js <https://meet.google.com/abc-defg-hij> <outDir>");
  process.exit(2);
}
const NAME = opt("name", "Scout Notetaker (recording)");
const END_AT = Number(opt("end-at", 0)) || Date.now() + 4 * 3600e3;
const KNOCK_S = Number(opt("knock-s", 600));
const ALONE_S = Number(opt("alone-s", 90));
// Meet turns a headless Chrome away ("You can't join this video call"), so the window is a real one (--headless is not offered).
const SHOW = true;
const START_AT = Number(opt("start-at", 0)) || Date.now();   // the call is not over just because nobody else is here before it has begun
const NOTICE = "Hi, I'm Bestly's notetaker. This call is being recorded and transcribed for meeting notes.";
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, "bot.log");
const log = (...a) => fs.appendFileSync(logFile, new Date().toISOString() + " " + a.join(" ") + "\n");
const stopAsked = () => fs.existsSync(path.join(outDir, "STOP"));
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const audioFile = path.join(outDir, "audio.webm");
const capFile = path.join(outDir, "captions.jsonl");
const metaFile = path.join(outDir, "meta.json");
let meta = { meetUrl, name: NAME, audio_t0: null, joined_at: null, left_at: null, notice_posted: false, captions_on: false, rejoins: 0, end_reason: null };
try { meta = { ...meta, ...JSON.parse(fs.readFileSync(metaFile, "utf8")) }; } catch (e) {}
const saveMeta = () => fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
let state = "starting";
const beat = () => fs.writeFileSync(path.join(outDir, "alive.json"), JSON.stringify({ at: Date.now(), state, pid: process.pid }));
setInterval(beat, 4000);
beat();

// Runs in the page before Meet loads: never open a mic/camera, and mix every remote audio track into one recording.
const INIT = () => {
  // Never open a microphone or camera: every getUserMedia is refused, so Meet offers "Continue without microphone and camera".
  // (enumerateDevices is left alone: replacing it made Meet turn the browser away.)
  const md = navigator.mediaDevices;
  if (md) {
    md.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
    if (md.getDisplayMedia) md.getDisplayMedia = () => Promise.reject(new DOMException("no screen share", "NotAllowedError"));
  }
  const Orig = window.RTCPeerConnection;
  const seen = new Set();
  let ctx = null, dest = null, mr = null;
  const toB64 = (blob) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(",")[1] || ""); fr.readAsDataURL(blob); });
  function ensure() {
    if (ctx) return;
    ctx = new AudioContext({ sampleRate: 48000 });
    dest = ctx.createMediaStreamDestination();
    mr = new MediaRecorder(dest.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 64000 });
    mr.ondataavailable = async (e) => { if (e.data && e.data.size) window.__mbChunk(await toB64(e.data)); };
    window.__mbStart(Date.now());
    mr.start(4000);
    window.__mbMr = mr;
  }
  function add(track, stream) {
    if (track.kind !== "audio" || seen.has(track.id)) return;
    seen.add(track.id);
    ensure();
    // Chrome only feeds a remote WebRTC stream into Web Audio when it is also attached to a media element.
    try { const a = new Audio(); a.srcObject = new MediaStream([track]); a.muted = true; a.play().catch(() => {}); } catch (e) {}
    try { ctx.createMediaStreamSource(new MediaStream([track])).connect(dest); } catch (e) {}
    ctx.resume().catch(() => {});
    window.__mbTracks = (window.__mbTracks || 0) + 1;
  }
  function Wrapped(...a) {
    const pc = new Orig(...a);
    pc.addEventListener("track", (e) => add(e.track, e.streams && e.streams[0]));
    return pc;
  }
  Wrapped.prototype = Orig.prototype;
  Object.setPrototypeOf(Wrapped, Orig);
  window.RTCPeerConnection = Wrapped;
  window.__mbStopRec = () => new Promise((r) => {
    if (!mr || mr.state === "inactive") return r();
    mr.onstop = () => r();
    try { mr.requestData(); mr.stop(); } catch (e) { r(); }
  });
};

// Caption scraper (runs in the page every second). Meet renders live captions in a region; each speaker block is
// [avatar][name][text]. We read the region's blocks and return [{name,text}].
const SCRAPE = () => {
  const region =
    document.querySelector('[role="region"][aria-label*="aption" i]') ||
    document.querySelector('div[aria-label*="aption" i][role="region"]') ||
    document.querySelector('[jsname="dsyhDe"]');
  if (!region) return null;
  const out = [];
  const blocks = [...region.querySelectorAll("div")].filter((d) => d.querySelector(":scope > img, :scope > div > img") && d.innerText && d.innerText.trim().includes("\n"));
  const seenTxt = new Set();
  for (const b of blocks) {
    const lines = b.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const key = lines.join("|");
    if (seenTxt.has(key)) continue;
    seenTxt.add(key);
    out.push({ name: lines[0], text: lines.slice(1).join(" ") });
  }
  if (!out.length) {
    const lines = region.innerText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length >= 2) out.push({ name: lines[0], text: lines.slice(1).join(" ") });
  }
  return out.filter((o, i) => !out.some((p, j) => j !== i && p.name === o.name && p.text.length > o.text.length && p.text.includes(o.text)));
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Real Chrome started normally and driven over CDP: Google Meet turns a Playwright-launched browser away ("You can't join this video call").
  const profile = path.join(__dirname, "profile");
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = require("child_process").spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,800",
    "--autoplay-policy=no-user-gesture-required", "--lang=en-US", "--deny-permission-prompts", "--window-position=40,40", "about:blank",
  ], { stdio: "ignore" });
  chrome.on("exit", () => log("chrome exited"));
  let browser = null;
  for (let i = 0; i < 30 && !browser; i++) {
    await sleep(1000);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
  }
  if (!browser) { log("could not reach chrome"); try { chrome.kill(); } catch (e) {} process.exit(1); }
  const ctx = browser.contexts()[0];
  ctx.close = async () => { await browser.close().catch(() => {}); try { chrome.kill(); } catch (e) {} };
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.exposeFunction("__mbStart", (t) => { if (!meta.audio_t0) { meta.audio_t0 = t; saveMeta(); } log("audio started"); });
  await page.exposeFunction("__mbChunk", (b64) => fs.appendFileSync(audioFile, Buffer.from(b64, "base64")));
  await page.addInitScript(INIT);

  const diag = async (what) => {
    try {
      const info = await page.evaluate(() => ({
        url: location.href, title: document.title,
        buttons: [...document.querySelectorAll("button")].map((b) => (b.getAttribute("aria-label") || b.innerText || "").trim()).filter(Boolean).slice(0, 60),
        text: document.body.innerText.slice(0, 600),
      }));
      await page.screenshot({ path: path.join(outDir, "diag.png") }).catch(() => {});
      fs.writeFileSync(path.join(outDir, "diag.json"), JSON.stringify({ what, at: new Date().toISOString(), ...info }, null, 1));
      log("DIAG", what);
    } catch (e) { log("diag failed", e.message.split("\n")[0]); }
  };
  let lastShot = 0;
  const shot = async () => { if (Date.now() - lastShot > 15000) { lastShot = Date.now(); log("page:", JSON.stringify(((await page.evaluate(() => document.body.innerText).catch(() => "")) || "").replace(/\s+/g, " ").slice(0, 200))); await page.screenshot({ path: path.join(outDir, "state.png") }).catch(() => {}); } };
  const devicesOff = async () => {
    for (const re of [/^turn off microphone/i, /^turn off camera/i]) {
      const b = page.getByRole("button", { name: re }).first();
      if (await b.count()) { await b.click({ timeout: 1500 }).catch(() => {}); log("turned off", String(re)); }
    }
  };
  const bodyText = async () => (await page.evaluate(() => document.body.innerText).catch(() => "")) || "";
  const inCall = async () => (await page.locator('button[aria-label*="Leave call" i]').count().catch(() => 0)) > 0;
  const BLOCKED = /can't join this video call|cannot join this video call|not allowed to join|Check your meeting code|invalid video call name/i;
  const DENIED = /denied your request|You can't join this call|request to join was denied|Your request to join was declined/i;
  const ENDED = /You left the meeting|You've been removed|You were removed|The meeting has ended|call has ended|Return to home screen|You've left the call|Rejoin/i;

  let finishing = false;
  const finish = async (reason, code) => {
    if (finishing) return;
    finishing = true;
    meta.end_reason = reason;
    meta.left_at = Date.now();
    state = "leaving";
    log("finishing:", reason);
    try {
      if (await inCall()) await page.locator('button[aria-label*="Leave call" i]').first().click({ timeout: 3000 }).catch(() => {});
      await page.evaluate(() => window.__mbStopRec && window.__mbStopRec()).catch(() => {});
      await sleep(1500);
    } catch (e) {}
    saveMeta();
    await ctx.close().catch(() => {});
    process.exit(code);
  };
  process.on("SIGINT", () => finish("signal", 0));
  process.on("SIGTERM", () => finish("signal", 0));

  // Join (with knocking). Returns "in", "blocked", "denied", "retry", "never" or "stop".
  const joinOnce = async () => {
    await page.goto(meetUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await sleep(2500);
    const t0 = Date.now();
    for (;;) {
      if (stopAsked()) return "stop";
      if (Date.now() > END_AT) return "never";
      if (await inCall()) return "in";
      await shot(); await devicesOff();
      const txt = await bodyText();
      if (BLOCKED.test(txt)) { await diag("blocked: " + (txt.match(BLOCKED) || [""])[0]); return "blocked"; }
      if (DENIED.test(txt)) { await diag("denied"); return "denied"; }
      for (const re of [/continue without microphone and camera/i, /^(got it|dismiss|ok)$/i]) {
        const b = page.getByRole("button", { name: re }).first();
        if (await b.count()) await b.click({ timeout: 1500 }).catch(() => {});
      }
      const nameBox = page.locator('input[aria-label="Your name"], input[placeholder="Your name"]').first();
      if (await nameBox.count()) {
        const cur = await nameBox.inputValue().catch(() => "");
        if (cur !== NAME) { await nameBox.fill(NAME).catch(() => {}); }
        const ask = page.getByRole("button", { name: /^(ask to join|join now|join)$/i }).first();
        if (await ask.count()) { await ask.click({ timeout: 3000 }).catch(() => {}); log("pressed ask/join"); state = "knocking"; await sleep(2000); }
      }
      if (Date.now() - t0 > 120000 && !/asking to be let in|someone will let you in|waiting for the host|Asking to join/i.test(txt)) return "retry";
      await sleep(1500);
    }
  };

  const post = async () => {
    for (let i = 0; i < 4 && !meta.notice_posted; i++) {
      const chatBtn = page.locator('button[aria-label*="Chat with everyone" i], button[aria-label*="Chat" i]').first();
      if (await chatBtn.count()) await chatBtn.click({ timeout: 3000 }).catch(() => {});
      await sleep(1200);
      const box = page.locator('textarea[aria-label*="Send a message" i], textarea[placeholder*="Send a message" i], textarea').first();
      if (await box.count()) {
        await box.click({ timeout: 2000 }).catch(() => {});
        await box.fill(NOTICE).catch(() => {});
        await page.keyboard.press("Enter").catch(() => {});
        await sleep(1000);
        if ((await bodyText()).includes("This call is being recorded")) { meta.notice_posted = true; saveMeta(); log("chat notice posted"); }
      }
      if (!meta.notice_posted) { await page.keyboard.press("Escape").catch(() => {}); await sleep(1500); }
    }
    const close = page.locator('button[aria-label="Close"]').first();
    if (await close.count()) await close.click({ timeout: 1500 }).catch(() => {});
  };
  const captionsOn = async () => {
    if (await page.locator('[role="region"][aria-label*="aption" i]').count()) { meta.captions_on = true; return; }
    const b = page.locator('button[aria-label*="Turn on captions" i]').first();
    if (await b.count()) await b.click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press("c").catch(() => {});
    await sleep(1500);
    meta.captions_on = (await page.locator('[role="region"][aria-label*="aption" i]').count()) > 0 || (await page.locator('button[aria-label*="Turn off captions" i]').count()) > 0;
    saveMeta();
  };

  const knockUntil = Date.now() + KNOCK_S * 1000;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    state = "joining";
    let r;
    try { r = await joinOnce(); } catch (e) { log("join error", e.message.split("\n")[0]); r = "retry"; }
    log("join attempt", attempt, "->", r);
    if (r === "in") break;
    if (r === "stop") await finish("stopped before joining", 7);
    if (r === "blocked") await finish("anonymous guests blocked", 6);
    if (Date.now() > knockUntil || Date.now() > END_AT) { await diag("never admitted"); await finish("never admitted", 3); }
    await sleep(r === "denied" ? 20000 : 3000);
  }
  state = "in_call";
  meta.joined_at = meta.joined_at || Date.now();
  saveMeta();
  log("in the call");
  await sleep(1500);
  await post();
  await captionsOn();
  log("captions on:", meta.captions_on);

  let lastSnap = "";
  let aloneSince = null;
  let seenOthers = false;
  let notInCallSince = null;
  let lastNoticeCheck = Date.now();
  for (;;) {
    if (stopAsked()) await finish("stopped", 0);
    if (Date.now() > END_AT) await finish("scheduled end passed", 0);
    await shot(); await devicesOff();
    const live = await inCall();
    const txt = await bodyText();
    if (!live) {
      if (ENDED.test(txt) || (notInCallSince && Date.now() - notInCallSince > 15000)) {
        if (/removed/i.test(txt) && !/ended/i.test(txt)) await finish("removed from the meeting", 0);
        meta.rejoins += 1; saveMeta(); log("not in the call any more, rejoin", meta.rejoins);
        if (meta.rejoins > 6) await finish("dropped too often", 0);
        state = "joining";
        const r = await joinOnce().catch(() => "retry");
        if (r !== "in") { if (r === "blocked" || r === "denied" || Date.now() > END_AT) await finish("call over (could not rejoin)", 0); continue; }
        state = "in_call"; notInCallSince = null; await sleep(1500); await captionsOn(); continue;
      }
      notInCallSince = notInCallSince || Date.now();
    } else notInCallSince = null;
    if (live) {
      if (/you're the only one here|you are the only one here|only one in this call/i.test(txt)) {
        aloneSince = aloneSince || Date.now();
        // alone for ALONE_S after somebody has been here, or 15 minutes past the scheduled start with nobody ever coming
        if (Date.now() - aloneSince > ALONE_S * 1000 && (seenOthers || Date.now() > START_AT + 15 * 60000)) await finish("alone for " + ALONE_S + " s", 0);
      } else { aloneSince = null; seenOthers = true; }
      if (!meta.notice_posted && Date.now() - lastNoticeCheck > 60000) { lastNoticeCheck = Date.now(); await post(); }
      if (!meta.captions_on) await captionsOn();
    }
    const snap = await page.evaluate(SCRAPE).catch(() => null);
    if (snap && snap.length) {
      const s = JSON.stringify(snap);
      if (s !== lastSnap) {
        lastSnap = s;
        const t = Date.now();
        fs.appendFileSync(capFile, snap.map((x) => JSON.stringify({ t, name: x.name, text: x.text })).join("\n") + "\n");
      }
    }
    await sleep(1000);
  }
}

main().catch(async (e) => {
  log("CRASH", e && e.stack ? e.stack.split("\n").slice(0, 4).join(" | ") : e);
  process.exit(1);
});
