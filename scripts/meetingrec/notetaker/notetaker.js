// notetaker.js — "Scout (notetaker)" joins a Nextcloud Talk call and records
// every participant's audio on its own track, named by who it is.
//
// Talk (without a media server) sends each person's audio to every other
// participant as a separate WebRTC stream. So a participant that simply
// listens gets a clean, separate recording per person - no voice guessing.
//
// usage: node notetaker.js <roomToken> <outDir> [--debug]
// Stops cleanly on SIGINT/SIGTERM (or when <outDir>/STOP appears), writes:
//   <outDir>/track-<n>.webm       one per remote audio track
//   <outDir>/manifest.json        [{file, name, actor, t0, t1}] (t in epoch ms)
//   <outDir>/notetaker.log

const { chromium } = require("playwright-core");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const BASE = "https://cloud.bestly.tech";
const USER = "scout-notetaker";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

const [token, outDir] = process.argv.slice(2);
const DEBUG = process.argv.includes("--debug");
if (!token || !outDir) {
  console.error("usage: node notetaker.js <roomToken> <outDir>");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });
const logFile = path.join(outDir, "notetaker.log");
const log = (...a) => {
  const line = new Date().toISOString() + " " + a.join(" ");
  fs.appendFileSync(logFile, line + "\n");
  if (DEBUG) console.log(line);
};

const tracks = {}; // trackId -> {n, file, t0, t1, streamId, names: {name: count}}
const manifestPath = path.join(outDir, "manifest.json");
// If we were restarted mid-call, keep what the last run recorded.
let prior = [];
try {
  prior = JSON.parse(fs.readFileSync(manifestPath, "utf8")).tracks || [];
  const end = Date.now();
  for (const t of prior) if (!t.t1) t.t1 = end;
} catch (e) {}
let counter = prior.length;
function writeManifest() {
  const rows = Object.entries(tracks).map(([id, t]) => {
    const names = Object.entries(t.names).sort((a, b) => b[1] - a[1]);
    return { file: path.basename(t.file), trackId: id, name: names[0]?.[0] ?? null, seen: t.names, t0: t.t0, t1: t.t1 };
  });
  fs.writeFileSync(manifestPath, JSON.stringify({ token, tracks: [...prior, ...rows] }, null, 1));
}

// Runs in the page before Talk loads: record every remote audio track.
const INIT = () => {
  const Orig = window.RTCPeerConnection;
  const seen = new Set();
  window.__ntRecs = [];
  const toB64 = (blob) =>
    new Promise((r) => {
      const fr = new FileReader();
      fr.onload = () => r(String(fr.result).split(",")[1] || "");
      fr.readAsDataURL(blob);
    });
  function record(track, stream) {
    if (track.kind !== "audio" || seen.has(track.id)) return;
    seen.add(track.id);
    const mr = new MediaRecorder(new MediaStream([track]), { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 64000 });
    window.__ntRecs.push(mr);
    window.__ntStart(track.id, stream ? stream.id : null, Date.now());
    mr.ondataavailable = async (e) => {
      if (e.data && e.data.size) window.__ntChunk(track.id, await toB64(e.data));
    };
    mr.onstop = () => window.__ntEnd(track.id, Date.now());
    track.addEventListener("ended", () => {
      try { mr.state !== "inactive" && mr.stop(); } catch (e) {}
    });
    mr.start(4000);
  }
  function Wrapped(...a) {
    const pc = new Orig(...a);
    pc.addEventListener("track", (e) => record(e.track, e.streams && e.streams[0]));
    return pc;
  }
  Wrapped.prototype = Orig.prototype;
  Object.setPrototypeOf(Wrapped, Orig);
  window.RTCPeerConnection = Wrapped;
  window.__ntStopAll = () =>
    Promise.all(
      window.__ntRecs.map(
        (mr) =>
          new Promise((r) => {
            if (mr.state === "inactive") return r();
            const done = mr.onstop;
            mr.onstop = () => { done && done(); r(); };
            mr.requestData();
            mr.stop();
          }),
      ),
    );
};

// Who is each audio track? Talk renders a tile per participant with their name
// and plays their stream through a media element; match track ids to names.
const WHO = () => {
  const out = {};
  const els = [...document.querySelectorAll("video, audio")];
  for (const el of els) {
    const s = el.srcObject;
    if (!s || !s.getAudioTracks) continue;
    let name = null;
    let node = el;
    for (let i = 0; i < 8 && node && !name; i++) {
      node = node.parentElement;
      if (!node) break;
      const n = node.querySelector(
        ".participant-name, .nameIndicator, [class*=name-indicator], [class*=nameIndicator], .bottom-bar__nameIndicator, [class*=participant-name], [class*=displayName], [class*=display-name], [class*=user-name], [class*=username]",
      );
      if (n && n.textContent.trim()) name = n.textContent.trim();
    }
    for (const t of s.getAudioTracks()) if (name) out[t.id] = name;
  }
  return out;
};

let diag = async (what) => fs.writeFileSync(path.join(outDir, "diag.json"), JSON.stringify({ what }));

async function main() {
  const pw = execSync(`security find-generic-password -s nextcloud-notetaker -a ${USER} -w`).toString().trim();
  const ctx = await chromium.launchPersistentContext(path.join(__dirname, "profile"), {
    channel: "chrome",
    headless: !process.argv.includes("--show"),
    userAgent: UA,
    viewport: { width: 1400, height: 900 },
    permissions: ["microphone"],
    args: [
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${path.join(__dirname, "silence.wav")}`,
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  // Everything someone (or Scout) needs to fix a break, in one place.
  diag = async (what) => {
    try {
      const info = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        buttons: [...document.querySelectorAll("button")].map((b) => (b.getAttribute("aria-label") || b.innerText || "").trim()).filter(Boolean).slice(0, 80),
        dialogs: [...document.querySelectorAll("[role=dialog]")].map((d) => d.innerText.slice(0, 300)),
        mediaEls: document.querySelectorAll("video, audio").length,
      }));
      await page.screenshot({ path: path.join(outDir, "diag.png") }).catch(() => {});
      fs.writeFileSync(path.join(outDir, "diag.json"), JSON.stringify({ what, at: new Date().toISOString(), ...info }, null, 1));
      log("DIAG", what);
    } catch (e) {
      fs.writeFileSync(path.join(outDir, "diag.json"), JSON.stringify({ what, error: e.message }));
    }
  };

  await page.exposeFunction("__ntStart", (id, streamId, t0) => {
    counter += 1;
    const file = path.join(outDir, `track-${counter}.webm`);
    tracks[id] = { n: counter, file, t0, t1: null, streamId, names: {} };
    log("track start", counter, id);
    writeManifest();
  });
  await page.exposeFunction("__ntChunk", (id, b64) => {
    const t = tracks[id];
    if (t) fs.appendFileSync(t.file, Buffer.from(b64, "base64"));
  });
  await page.exposeFunction("__ntEnd", (id, t1) => {
    if (tracks[id]) tracks[id].t1 = t1;
    log("track end", id);
    writeManifest();
  });
  await page.addInitScript(INIT);

  // Log in (the profile usually already is).
  await page.goto(`${BASE}/login?redirect_url=/call/${token}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("input[name=password], .join-call, #talk, .app-talk", { timeout: 30000 }).catch(() => {});
  if (await page.$("input[name=password]")) {
    log("logging in");
    await page.fill("input[name=user], #user", USER);
    await page.fill("input[name=password]", pw);
    await page.keyboard.press("Enter");
    await page.waitForURL(/\/call\//, { timeout: 30000 });
  }

  // Join. Talk's page changes between versions, so try several ways and
  // check we really are in the call (a Leave call button) before going on.
  const inCall = async () => (await page.getByRole("button", { name: /leave call|end call/i }).count()) > 0;
  const clearOverlays = async () => {
    await page.keyboard.press("Escape").catch(() => {});
    await page.evaluate(() => document.querySelectorAll("#firstrunwizard, .first-run-wizard").forEach((e) => e.remove())).catch(() => {});
  };
  const strategies = [
    ["button.join-call", () => page.locator("button.join-call").first()],
    ["role join/start call", () => page.getByRole("button", { name: /^(join call|start call)$/i }).first()],
    ["text join/start call", () => page.locator("button", { hasText: /join call|start call/i }).first()],
  ];
  await page.waitForTimeout(3000);
  for (let attempt = 0; attempt < 3 && !(await inCall()); attempt++) {
    await clearOverlays();
    for (const [how, get] of strategies) {
      const b = get();
      if (!(await b.count().catch(() => 0))) continue;
      await b.click({ timeout: 8000 }).catch(() => {});
      log("tried join:", how);
      await page.waitForTimeout(2500);
      // a device-check dialog may need its own confirm
      const dlg = page.locator(".modal-container, [role=dialog]").getByRole("button", { name: /join call|start call/i });
      if (await dlg.count().catch(() => 0)) {
        await dlg.last().click({ timeout: 8000 }).catch(() => {});
        log("confirmed in dialog");
        await page.waitForTimeout(3000);
      }
      if (await inCall()) break;
    }
    if (!(await inCall())) await page.waitForTimeout(5000);
  }
  if (!(await inCall())) {
    await diag("could not join the call");
    process.exit(3);
  }
  // Mute our own (silent) mic and camera if Talk turned them on.
  for (const label of [/mute audio/i, /disable video/i, /turn off camera/i]) {
    const b = page.getByRole("button", { name: label });
    if (await b.count()) await b.first().click().catch(() => {});
  }
  log("in call");
  if (DEBUG) await page.screenshot({ path: path.join(outDir, "joined.png") });

  // Keep naming tracks while the call runs.
  let stopping = false;
  const stop = async (why) => {
    if (stopping) return;
    stopping = true;
    log("stopping:", why);
    try {
      await page.evaluate(() => window.__ntStopAll && window.__ntStopAll());
      await page.waitForTimeout(1500);
      const leave = page.getByRole("button", { name: /leave call|end call/i });
      if (await leave.count()) await leave.first().click().catch(() => {});
      await page.waitForTimeout(1500);
    } catch (e) {
      log("stop error", e.message);
    }
    const now = Date.now();
    for (const t of Object.values(tracks)) if (!t.t1) t.t1 = now;
    writeManifest();
    await ctx.close().catch(() => {});
    log("done");
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  let debugDumped = false;
  let namingWarned = false;
  while (!stopping) {
    try {
      const who = await page.evaluate(WHO);
      for (const [id, name] of Object.entries(who)) {
        if (tracks[id]) tracks[id].names[name] = (tracks[id].names[name] || 0) + 1;
      }
      writeManifest();
      const unnamed = Object.values(tracks).filter((t) => !Object.keys(t.names).length && Date.now() - t.t0 > 30000);
      if (unnamed.length && !namingWarned) {
        namingWarned = true;
        await diag(`${unnamed.length} track(s) have no name from the page after 30s`);
      }
      if (DEBUG && !debugDumped && Object.keys(tracks).length) {
        debugDumped = true;
        const html = await page.evaluate(() =>
          [...document.querySelectorAll("video, audio")].map((el) => {
            let n = el;
            for (let i = 0; i < 4 && n.parentElement; i++) n = n.parentElement;
            return n.outerHTML.slice(0, 3000);
          }),
        );
        fs.writeFileSync(path.join(outDir, "tiles.html"), html.join("\n\n-----\n\n"));
      }
    } catch (e) {
      log("who error", e.message);
    }
    if (fs.existsSync(path.join(outDir, "STOP"))) await stop("STOP file");
    await new Promise((r) => setTimeout(r, 3000));
  }
}

main().catch(async (e) => {
  log("fatal", e.stack || e.message);
  await diag("crashed: " + e.message).catch(() => {});
  writeManifest();
  process.exit(1);
});
