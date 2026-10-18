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
//   <outDir>/alive.json           a heartbeat every few seconds; the agent restarts us if it goes stale
//
// It only ever JOINS a call that is going on, with another person really in it (Talk says they are in the call and have pinged in
// the last 30 s). It never starts one (on Oct 6 it pressed "Start call" just after the call had ended and started a second call):
// it only presses a button that says Join, and only after asking Talk. If it is dropped from the call it gets back in; if it can't,
// it exits so the agent can start it again (the Sep 29 dropout left a process that sat there recording nothing).
// Exit codes: 0 stopped cleanly (also: told to stop by the STOP file before it had joined), 1 crashed, 2 bad usage, 3 could not join,
//             4 no call is going on (nothing was started), 5 was dropped from the call and could not get back in.
// The agent starts us a few seconds BEFORE its recording does (so the call's first seconds are not lost) and calls us back with the
// STOP file if the recording never starts; we look for it before pressing Join as well as once we are in the call.
// NT_TEST_DROP_S=<n> (testing only): leave the call by ourselves <n> seconds after joining, to prove the rejoin works.

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
const stopAsked = () => fs.existsSync(path.join(outDir, "STOP"));
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
  // Scout never has a camera. Chrome's fake camera is a green test pattern with a
  // spinning pie, and Talk turns it back on after reconnects. So hide every camera
  // and strip video out of every media request: Talk then shows Scout's avatar.
  const md = navigator.mediaDevices;
  if (md) {
    const gum = md.getUserMedia.bind(md);
    md.getUserMedia = (c = {}) => {
      if (!c.audio) return Promise.reject(new DOMException("Scout has no camera", "NotFoundError"));
      return gum({ audio: c.audio });
    };
    const enumDev = md.enumerateDevices.bind(md);
    md.enumerateDevices = async () => (await enumDev()).filter((d) => d.kind !== "videoinput");
    if (md.getDisplayMedia) md.getDisplayMedia = () => Promise.reject(new DOMException("no screen share", "NotAllowedError"));
  }
  const Orig = window.RTCPeerConnection;
  const seen = new Set();
  window.__ntRecs = [];
  window.__ntPcs = [];
  // Belt and braces: if any video ever gets sent anyway, cut it. Returns how many.
  window.__ntKillVideo = () => {
    let n = 0;
    for (const pc of window.__ntPcs) {
      if (pc.connectionState === "closed") continue;
      for (const s of pc.getSenders()) {
        if (s.track && s.track.kind === "video") {
          s.track.stop();
          s.replaceTrack(null).catch(() => {});
          n++;
        }
      }
    }
    return n;
  };
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
    window.__ntPcs.push(pc);
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
  if (stopAsked()) {
    log("told to stop before the page loaded - not joining");
    await ctx.close().catch(() => {});
    process.exit(0);
  }
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
  // Retry up to 3 times: ERR_NETWORK_CHANGED is a transient Chromium hiccup.
  for (let gotoAttempt = 1; ; gotoAttempt++) {
    try {
      await page.goto(`${BASE}/login?redirect_url=/call/${token}`, { waitUntil: "domcontentloaded" });
      break;
    } catch (e) {
      if (gotoAttempt >= 3) throw e;
      log(`page.goto attempt ${gotoAttempt} failed (${e.message.split('\n')[0]}), retrying...`);
      await page.waitForTimeout(2000);
    }
  }
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
  const callUrl = `${BASE}/call/${token}`;
  const inCall = async () => (await page.getByRole("button", { name: /leave call|end call/i }).count()) > 0;
  const clearOverlays = async () => {
    await page.keyboard.press("Escape").catch(() => {});
    await page.evaluate(() => document.querySelectorAll("#firstrunwizard, .first-run-wizard").forEach((e) => e.remove())).catch(() => {});
  };
  // Is a call going on in this room right now? true / false, or null when Talk could not say. Asked from inside the page as
  // our own user (a member of the room). A room we are not in answers 404, and Nextcloud locks a source out after a handful
  // of those, so after two of them we stop asking.
  let denied = 0;
  const callLive = async () => {
    if (denied >= 2) return null;
    try {
      const r = await page.evaluate(async (tok) => {
        const res = await fetch(`/ocs/v2.php/apps/spreed/api/v4/room/${tok}`, {
          headers: { "OCS-APIRequest": "true", Accept: "application/json" },
          credentials: "same-origin",
        });
        if (!res.ok) return { status: res.status };
        const j = await res.json();
        return { status: 200, hasCall: !!(j.ocs && j.ocs.data && j.ocs.data.hasCall) };
      }, token);
      if (r.status === 200) return r.hasCall;
      if (r.status === 404 || r.status === 403) denied += 1;
      log("call state unknown, HTTP", r.status);
    } catch (e) {
      log("call state unknown:", e.message.split("\n")[0]);
    }
    return null;
  };
  // How many people other than us are really in the call: a count, or null when Talk could not say. Talk keeps a room's call flag
  // up for a while after the last browser died, and the page can still say "Join call" for a few seconds after a call has ended,
  // so before pressing anything we want somebody who is in the call and has pinged Talk in the last 30 seconds.
  const othersInCall = async () => {
    try {
      const r = await page.evaluate(async (tok) => {
        const res = await fetch(`/ocs/v2.php/apps/spreed/api/v4/room/${tok}/participants`, {
          headers: { "OCS-APIRequest": "true", Accept: "application/json" },
          credentials: "same-origin",
        });
        if (!res.ok) return { status: res.status };
        const j = await res.json();
        return { status: 200, rows: ((j.ocs && j.ocs.data) || []).map((p) => ({ type: p.actorType, id: p.actorId, inCall: p.inCall || 0, ping: p.lastPing || 0 })) };
      }, token);
      if (r.status !== 200) return null;
      const now = Date.now() / 1000;
      return r.rows.filter((p) => !(p.type === "users" && p.id === USER) && (p.inCall & 1) && (!p.ping || now - p.ping < 30)).length;
    } catch (e) {
      log("people in the call unknown:", e.message.split("\n")[0]);
      return null;
    }
  };
  // The same button says "Start call" when nobody is in a call. We only press one that says Join.
  const isJoin = async (b) => {
    const label = [await b.getAttribute("aria-label").catch(() => ""), await b.innerText().catch(() => ""), await b.getAttribute("title").catch(() => "")]
      .join(" ")
      .toLowerCase();
    return /join|enter call/.test(label) && !/start/.test(label);
  };
  const strategies = [
    ["button.join-call", () => page.locator("button.join-call").first()],
    ["role join call", () => page.getByRole("button", { name: /^join call$/i }).first()],
    ["text join call", () => page.locator("button", { hasText: /join call/i }).first()],
    ["aria-label join", () => page.locator("button[aria-label*='join' i]").first()],
    ["data-testid join", () => page.locator("[data-testid*='join'], [data-testid*='enter-call']").first()],
    ["text join now", () => page.locator("button", { hasText: /join now|enter call/i }).first()],
  ];
  // Wait for something to become true, looking every `step` ms for at most `ms`; true when it did. Fixed waits cost the first seconds
  // of every call (Talk is usually ready long before them), and those seconds are in nobody's recording.
  const until = async (fn, ms, step = 150) => {
    const end = Date.now() + ms;
    for (;;) {
      if (await fn().catch(() => false)) return true;
      if (Date.now() >= end) return false;
      await page.waitForTimeout(step);
    }
  };
  // Talk's call page is ready when it shows a Join button (or we are in the call already, after a restart).
  const pageReady = (ms) =>
    until(async () => {
      if (await inCall()) return true;
      for (const [, get] of strategies) {
        const b = get();
        if ((await b.count().catch(() => 0)) && (await b.isVisible().catch(() => false)) && (await isJoin(b))) return true;
      }
      return false;
    }, ms, 200);
  // The heartbeat the agent watches (alive.json). It is also written while we are still trying to join, so a slow join is
  // not mistaken for a hung process.
  const beat = (here) => {
    try {
      fs.writeFileSync(path.join(outDir, "alive.json"), JSON.stringify({ at: Date.now(), inCall: here, tracks: Object.keys(tracks).length }));
    } catch (e) {}
  };
  // Press Join until we are in the call. "joined", "not-live" (there is no call to join: nothing was pressed), "cancelled" (the agent
  // asked us to stop before we pressed anything) or "failed".
  const joinCall = async () => {
    for (let attempt = 0; attempt < 3 && !(await inCall()); attempt++) {
      beat(false);
      if (stopAsked()) return "cancelled";
      if ((await callLive()) === false || (await othersInCall()) === 0) return "not-live";
      if (attempt > 0) {
        await page.goto(callUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
        await page.waitForTimeout(3000);
      }
      await clearOverlays();
      for (const [how, get] of strategies) {
        beat(false);
        const b = get();
        if (!(await b.count().catch(() => 0))) continue;
        if (!(await isJoin(b))) {
          log("not a Join button, left alone:", how);
          continue;
        }
        // Last look at Talk, right before the press: a Join button can outlive the call it was for by a few seconds, and pressing
        // it then would start a new call and ring everyone in the room.
        if ((await callLive()) === false) return "not-live";
        if (stopAsked()) return "cancelled";
        await b.click({ timeout: 8000 }).catch(() => {});
        log("tried join:", how);
        // The device-check dialog (or the call itself) comes up within a second or two: look every 150 ms for up to 2.5 s.
        const dlg = page.locator(".modal-container, [role=dialog]").getByRole("button", { name: /join call/i });
        await until(async () => (await inCall()) || (await dlg.count().catch(() => 0)) > 0, 2500);
        // a device-check dialog may need its own confirm (Join only)
        if (await dlg.count().catch(() => 0)) {
          await dlg.last().click({ timeout: 8000 }).catch(() => {});
          log("confirmed in dialog");
          await until(inCall, 3000);
        }
        if (await inCall()) break;
      }
      if (!(await inCall())) await page.waitForTimeout(5000);
    }
    return (await inCall()) ? "joined" : "failed";
  };
  // Mute our own (silent) mic and camera if Talk turned them on.
  const muteSelf = async () => {
    for (const label of [/mute audio/i, /disable video/i, /turn off camera/i]) {
      const b = page.getByRole("button", { name: label });
      if (await b.count()) await b.first().click().catch(() => {});
    }
  };
  let leaving = false; // we are closing the browser on purpose
  const bail = async (code) => {
    leaving = true;
    writeManifest();
    await ctx.close().catch(() => {});
    process.exit(code);
  };
  ctx.on("close", () => {
    if (!leaving) {
      log("the browser closed by itself");
      process.exit(5);
    }
  });
  page.on("crash", () => {
    log("the page crashed");
    process.exit(5);
  });
  if (stopAsked()) {
    log("told to stop before joining - not joining");
    await bail(0);
  }
  await pageReady(3000);
  const first = await joinCall();
  if (first === "cancelled") {
    log("told to stop before joining - not joining");
    await bail(0);
  }
  if (first === "not-live") {
    log("no call is going on in this room - not joining, and not starting one");
    await bail(4);
  }
  if (first !== "joined") {
    await diag("could not join the call");
    process.exit(3);
  }
  await muteSelf();
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
    leaving = true;
    await ctx.close().catch(() => {});
    log("done");
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  let videoKills = 0;
  let debugDumped = false;
  let namingWarned = false;
  const closeOpenTracks = () => {
    const now = Date.now();
    for (const t of Object.values(tracks)) if (!t.t1) t.t1 = now;
    writeManifest();
  };
  const joinedAt = Date.now();
  const dropAfter = Number(process.env.NT_TEST_DROP_S || 0) * 1000;
  let dropped = false;
  let lostAt = 0;
  let rejoinTries = 0;
  let nextRejoin = 0;
  let overLogged = false;
  while (!stopping) {
    let here = true;
    try {
      here = await inCall();
      if (dropAfter && !dropped && here && Date.now() - joinedAt > dropAfter) {
        dropped = true;
        log("TEST: leaving the call by ourselves to prove the rejoin");
        await page.getByRole("button", { name: /leave call/i }).first().click().catch(() => {});
        here = false;
      }
      if (here) {
        if (lostAt) {
          log("back in the call after", Math.round((Date.now() - lostAt) / 1000), "s");
          lostAt = 0;
          rejoinTries = 0;
          overLogged = false;
          await muteSelf();
        }
      } else {
        if (!lostAt) {
          lostAt = Date.now();
          log("not in the call any more");
        }
        if (Date.now() - lostAt > (dropped ? 2000 : 8000) && Date.now() >= nextRejoin && !fs.existsSync(path.join(outDir, "STOP"))) {
          nextRejoin = Date.now() + 15000;
          closeOpenTracks(); // whatever was recording stopped with the call
          if ((await callLive()) === false || (await othersInCall()) === 0) {
            if (!overLogged) log("the call is over - waiting; never starting one");
            overLogged = true;
          } else {
            overLogged = false;
            rejoinTries += 1;
            log("rejoining the call, try", rejoinTries);
            const r = await joinCall();
            log("rejoin:", r);
            if (r === "not-live" || r === "cancelled") rejoinTries -= 1; // the call ended (or we were told to stop) while we were trying: not a failure to get back in
            if (r === "failed" && rejoinTries >= 4 && Date.now() - lostAt > 60000) {
              await diag("dropped from the call and could not get back in");
              await bail(5);
            }
          }
        }
      }
    } catch (e) {
      log("call check error", e.message.split("\n")[0]);
    }
    beat(here);
    try {
      const killed = await page.evaluate(() => (window.__ntKillVideo ? window.__ntKillVideo() : 0));
      if (killed) {
        videoKills += killed;
        log("camera was sending video - cut it", killed, "total", videoKills);
        const off = page.getByRole("button", { name: /disable video|turn off camera/i });
        if (await off.count()) await off.first().click().catch(() => {});
      }
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
