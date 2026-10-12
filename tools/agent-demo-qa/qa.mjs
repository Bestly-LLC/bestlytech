#!/usr/bin/env node
/**
 * Functional QA for the /agent demo stage. Plain Playwright, no test runner, exits 1 if anything fails.
 *
 *   npm run build && npx vite preview --port 4173 --host 127.0.0.1 &
 *   node tools/agent-demo-qa/qa.mjs --viewport=1440x900
 *   node tools/agent-demo-qa/qa.mjs --viewport=390x844
 *
 * Options
 *   --url=http://127.0.0.1:4173   where the built site is served (or QA_URL)
 *   --viewport=WxH               one browser size per run (default 1440x900). Under 768 wide it runs as a phone (touch).
 *   --only=matrix,seek           run only these groups (names are the keys of GROUPS below)
 *   --shots=DIR                  also save a few screenshots into DIR
 *   --browser=/path/to/chrome    override the browser binary (or PW_CHROMIUM)
 *
 * What it covers: every call x sound on/off x play/pause/resume/replay, seeking (click, drag, arrows, Page keys, Home, End),
 * switching calls mid-call (old audio stops, nothing overlaps, no leftovers from the old call), the end card and both its
 * buttons, the industry cards, ?call= restore, the hero button, the phone's sticky transport, the Space key, Maya's launcher
 * and maya:open, Reduce Motion, a hidden tab, an audio interruption from the system, rapid clicking, tap-target size, focus
 * rings, wrapped numbers, "..." truncation, emoji, broken images and failed requests. Every group also fails on console
 * errors and on sideways page scroll.
 */
import { chromium } from "playwright";
import fs from "node:fs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
  }),
);
const BASE = String(args.url || process.env.QA_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
const [W, H] = String(args.viewport || "1440x900").split("x").map(Number);
const PHONE = W < 768;
const ONLY = args.only ? String(args.only).split(",") : null;
const SHOTS = args.shots ? String(args.shots) : null;
const TAG = `${W}x${H}`;

const CALLS = [
  { id: "saas-support", chip: "Software support" },
  { id: "dental", chip: "Dental office" },
  { id: "plumbing", chip: "Home services" },
  { id: "real-estate", chip: "Real estate" },
  { id: "restaurant", chip: "Restaurant" },
];

/** Console noise that is expected on a bare preview origin and says nothing about the demo. */
const IGNORE_CONSOLE = [
  /maya-session/i, // the live Maya edge function is not reachable from a preview origin (403)
  /getUserMedia|NotFoundError|NotAllowedError.*(microphone|Permission)|Requested device not found/i,
  /Failed to load resource.*(supabase|functions\/v1)/i,
  /device-web-split/i,
];

function findBrowser() {
  if (args.browser || process.env.PW_CHROMIUM) return String(args.browser || process.env.PW_CHROMIUM);
  try {
    const root = "/opt/pw-browsers";
    const dirs = fs.readdirSync(root).filter((d) => d.startsWith("chromium_headless_shell-")).sort().reverse();
    for (const d of dirs) {
      const p = `${root}/${d}/chrome-headless-shell-linux64/chrome-headless-shell`;
      if (fs.existsSync(p)) return p;
    }
  } catch {
    /* use Playwright's own browser */
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------------
// tiny assertion layer

const results = [];
let group = "";
function check(name, cond, detail = "") {
  results.push({ group, name, ok: !!cond, detail: cond ? "" : String(detail) });
  if (!cond) console.log(`  FAIL  [${group}] ${name}${detail ? "  -> " + detail : ""}`);
}
const j = (o) => JSON.stringify(o);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));


/** Page-side helpers for the colour and spacing audits (WCAG contrast, 8px between tap targets). Passed to evaluate as text. */
const AUDIT_JS = `(() => {
  const parse = (s) => {
    let m = s.match(/^rgba?\\((.+)\\)$/);
    if (m) { const p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
    m = s.match(/^#([0-9a-f]{3,8})$/i);
    if (m) { let h = m[1]; if (h.length < 6) h = h.split('').map((x) => x + x).join(''); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length > 6 ? parseInt(h.slice(6, 8), 16) / 255 : 1 }; }
    return null;
  };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // Possible opaque backgrounds behind an element: a solid colour, or (for a gradient) each of its stops, worst case wins.
  const backdrops = (el) => {
    let below = [{ r: 255, g: 255, b: 255, a: 1 }];
    const chain = [];
    for (let e = el; e; e = e.parentElement) chain.push(e);
    for (const e of chain.reverse()) {
      const c = getComputedStyle(e);
      const layers = [];
      if (c.backgroundImage && c.backgroundImage !== 'none') {
        const stops = (c.backgroundImage.match(/rgba?\\([^)]+\\)|#[0-9a-f]{3,8}/gi) || []).map(parse).filter((x) => x && x.a >= 0.9); // glows and fades are not the surface text sits on
        for (const st of stops) layers.push(st);
      }
      const bc = parse(c.backgroundColor);
      if (bc && bc.a > 0) layers.unshift(bc);
      if (layers.length) {
        const next = [];
        for (const b of below) for (const l of (bc && bc.a >= 1 ? [bc] : layers)) next.push(over(l, b));
        below = next.slice(0, 24);
      }
    }
    return below;
  };
  const opacityOf = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  window.__qaContrast = (root) => {
    const bad = [];
    const seen = new Set();
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const txt = n.textContent.trim();
      if (!txt) continue;
      const el = n.parentElement;
      if (el.closest('.sr-only, [aria-hidden="true"] svg, script, style, header, footer')) continue;
      if (el.closest('.ad-w') && !el.closest('.ad-w-on')) continue; // words not yet spoken are dim on purpose
      const r = el.getBoundingClientRect();
      const c = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || c.visibility === 'hidden' || c.display === 'none') continue;
      const op = opacityOf(el);
      if (op < 0.05) continue;
      const fg = parse(c.color);
      if (!fg) continue;
      const size = parseFloat(c.fontSize);
      const bold = Number(c.fontWeight) >= 700;
      const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
      let worst = 99;
      for (const b of backdrops(el)) {
        const f = over({ ...fg, a: fg.a * op }, b);
        worst = Math.min(worst, ratio(f, b));
      }
      if (worst < need) {
        const key = txt.slice(0, 30) + '|' + c.color;
        if (!seen.has(key)) { seen.add(key); bad.push(txt.slice(0, 34) + ' ' + worst.toFixed(2) + ' (<' + need + ') ' + c.color); }
      }
    }
    return bad;
  };
  window.__qaGaps = (sel) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; });
    const tight = [];
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      const a = els[i], b = els[j];
      if (a.contains(b) || b.contains(a)) continue;
      const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
      const dx = Math.max(0, Math.max(p.left, q.left) - Math.min(p.right, q.right));
      const dy = Math.max(0, Math.max(p.top, q.top) - Math.min(p.bottom, q.bottom));
      const gap = Math.max(dx, dy);
      if (gap < 7.5) tight.push(((a.getAttribute('aria-label') || a.textContent).trim().slice(0, 18)) + ' / ' + ((b.getAttribute('aria-label') || b.textContent).trim().slice(0, 18)) + ' = ' + Math.round(gap) + 'px');
    }
    return tight;
  };
})();`;

// ---------------------------------------------------------------------------------------------------------------------
// page helpers

/** Tracks how many media elements are playing at once, and every play() call, so an overlap can never hide. */
const MEDIA_SPY = `(() => {
  const m = (window.__media = { maxPlaying: 0, plays: 0 });
  const orig = HTMLMediaElement.prototype.play;
  const count = () => {
    const n = [...document.querySelectorAll('audio,video')].filter((x) => !x.paused && !x.ended).length;
    if (n > m.maxPlaying) m.maxPlaying = n;
  };
  HTMLMediaElement.prototype.play = function () {
    m.plays++;
    const p = orig.apply(this, arguments);
    [30, 200, 600].forEach((d) => setTimeout(count, d));
    return p;
  };
  window.__mayaOpen = 0;
  window.addEventListener('maya:open', () => { window.__mayaOpen++; });
})();`;

async function newPage(browser, { w = W, h = H, reduce = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width: w, height: h },
    reducedMotion: reduce ? "reduce" : "no-preference",
    hasTouch: w < 768,
    deviceScaleFactor: 1,
  });
  await ctx.addInitScript(MEDIA_SPY);
  const page = await ctx.newPage();
  page.__errs = [];
  page.__quiet = false; // true while the real Maya widget is being poked, which logs its own errors
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const txt = m.text();
    if (page.__quiet || IGNORE_CONSOLE.some((r) => r.test(txt))) return;
    page.__errs.push(txt);
  });
  page.on("pageerror", (e) => page.__errs.push("pageerror: " + e.message));
  page.on("response", (r) => {
    const u = r.url();
    if (!page.__quiet && r.status() >= 400 && u.startsWith(BASE) && !/version\.json/.test(u)) page.__errs.push(`HTTP ${r.status()} ${u.replace(BASE, "")}`);
  });
  return page;
}

async function go(page, search = "", hash = "") {
  await page.goto(`${BASE}/agent${search}${hash}`, { waitUntil: "load" });
  await page.waitForSelector("#demo .ad-play");
  await page.waitForTimeout(500);
  const decline = page.getByRole("button", { name: /decline/i });
  if (await decline.count()) await decline.first().click({ force: true }).catch(() => {});
  await page.waitForTimeout(250);
}

/** One snapshot of everything the checks care about. */
const st = (page) =>
  page.evaluate(() => {
    const d = document.getElementById("demo");
    const sl = d.querySelector(".ad-seek");
    const a = d.querySelector("audio");
    const win = d.querySelector(".ad-grid")?.children[1];
    return {
      chip: d.querySelector('[role="radio"][aria-checked="true"]')?.textContent.trim() ?? "",
      playing: d.dataset.playing === "1",
      busy: d.getAttribute("data-busy"),
      t: Number(sl.getAttribute("aria-valuenow")),
      dur: Number(sl.getAttribute("aria-valuemax")),
      soundOn: d.querySelector(".ad-sound").getAttribute("aria-pressed") === "true",
      soundLabel: d.querySelector(".ad-sound").textContent.trim(),
      audio: a ? { src: a.getAttribute("src") || "", paused: a.paused, t: a.currentTime, ended: a.ended } : null,
      mediaPlaying: [...document.querySelectorAll("audio,video")].filter((m) => !m.paused && !m.ended).length,
      toasts: [...d.querySelectorAll(".ad-toast")].filter((e) => Number(getComputedStyle(e).opacity) > 0.05).length,
      tools: d.querySelectorAll(".ad-tool").length,
      ended: !!d.querySelector(".ad-outcome"),
      pill: d.querySelector(".ad-callpill")?.textContent.trim() ?? "",
      callerName: d.querySelector(".ad-caller-id b")?.textContent.trim() ?? "",
      windowText: win ? win.innerText.replace(/\s+/g, " ").trim() : "",
      search: location.search,
      hash: location.hash,
      hist: history.length,
      scrollY: Math.round(window.scrollY),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      maxPlaying: window.__media?.maxPlaying ?? 0,
    };
  });

const chip = (page, i) => page.locator("#demo-chips [role=radio]").nth(i);
const playBtn = (page) => page.locator("#demo .ad-play");
const replayBtn = (page) => page.locator("#demo .ad-iconbtn");
const soundBtn = (page) => page.locator("#demo .ad-sound");
const slider = (page) => page.locator("#demo .ad-seek");

async function setSound(page, on) {
  const s = await st(page);
  if (s.soundOn !== on) await soundBtn(page).click();
  await page.waitForTimeout(120);
}

async function pickCall(page, i, wait = 450) {
  await chip(page, i).click();
  await page.waitForTimeout(wait);
}

/** Click the slider at a fraction of its width. */
async function seekTo(page, frac) {
  await slider(page).scrollIntoViewIfNeeded();
  const b = await slider(page).boundingBox();
  await page.mouse.click(b.x + b.width * frac, b.y + b.height / 2);
  await page.waitForTimeout(160);
}

async function dragSeek(page, from, to) {
  await slider(page).scrollIntoViewIfNeeded();
  const b = await slider(page).boundingBox();
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + b.width * from, y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * ((from + to) / 2), y, { steps: 5 });
  await page.mouse.move(b.x + b.width * to, y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(160);
}

async function scrollToStage(page, where = "scene") {
  await page.evaluate((w) => {
    const sel = w === "chips" ? "#demo-chips" : w === "scene" ? "#demo-scene" : w;
    const el = document.querySelector(sel);
    const hd = document.querySelector("header");
    const barH = hd && getComputedStyle(hd).position !== "static" ? hd.getBoundingClientRect().height : 0;
    window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - barH - 14, behavior: "instant" });
  }, where);
  await page.waitForTimeout(350);
}

async function noOverflow(page, label) {
  const s = await st(page);
  check(`${label}: no sideways scroll`, s.overflow <= 0, `scrollWidth - clientWidth = ${s.overflow}`);
}

/** The audio element and the stage must tell the same story. */
function consistent(label, s) {
  if (s.soundOn && !s.audio?.src) return; // sound on but never loaded (a primed call): nothing to compare
  if (s.soundOn && s.soundLabel === "Captions only") return;
  if (s.soundOn && s.audio) check(`${label}: stage and audio agree (playing=${s.playing}, audio paused=${s.audio.paused})`, s.playing === !s.audio.paused || s.ended, j(s.audio));
}

async function shot(page, name) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/qa-${name}-${TAG}.png` });
}

// ---------------------------------------------------------------------------------------------------------------------
// groups

const GROUPS = {
  /** Every call x sound on/off: play, pause, resume, replay. */
  async matrix(browser) {
    const page = await newPage(browser);
    await go(page);
    check("five calls in the chip row", (await page.locator("#demo-chips [role=radio]").count()) === 5);
    for (const sound of [true, false]) {
      for (let i = 0; i < CALLS.length; i++) {
        const L = `${CALLS[i].id} sound ${sound ? "on" : "off"}`;
        await pickCall(page, i);
        await setSound(page, sound);
        let s = await st(page);
        check(`${L}: right chip selected`, s.chip === CALLS[i].chip, s.chip);
        check(`${L}: starts idle`, !s.playing && s.busy === null && s.t === 0, j({ p: s.playing, b: s.busy, t: s.t }));

        await playBtn(page).click();
        await page.waitForTimeout(2300);
        s = await st(page);
        check(`${L}: plays and is marked busy`, s.playing && s.busy === "true", j({ p: s.playing, b: s.busy }));
        check(`${L}: clock advances`, s.t >= 1, `t=${s.t}`);
        if (sound) {
          check(`${L}: right audio file`, s.audio?.src.endsWith(`/${CALLS[i].id}.mp3`), s.audio?.src);
          check(`${L}: audio really playing`, s.audio && !s.audio.paused && s.audio.t > 0.8, j(s.audio));
          check(`${L}: not stuck on captions only`, s.soundLabel !== "Captions only", s.soundLabel);
          if (s.audio) check(`${L}: stage clock follows audio`, Math.abs(s.audio.t - s.t) <= 1.2, `audio ${s.audio.t.toFixed(2)} stage ${s.t}`);
        } else {
          check(`${L}: no audio playing`, s.mediaPlaying === 0, `${s.mediaPlaying} playing`);
        }

        await playBtn(page).click(); // pause
        await page.waitForTimeout(250);
        const p1 = await st(page);
        await page.waitForTimeout(900);
        const p2 = await st(page);
        check(`${L}: pause stops the clock`, !p2.playing && p2.busy === null && Math.abs(p2.t - p1.t) <= 1, j({ a: p1.t, b: p2.t, playing: p2.playing, busy: p2.busy }));
        check(`${L}: pause stops the sound`, p2.mediaPlaying === 0, `${p2.mediaPlaying} playing`);
        check(`${L}: pill says paused`, /^Paused/.test(p2.pill), p2.pill);

        await playBtn(page).click(); // resume
        await page.waitForTimeout(1300);
        const r = await st(page);
        check(`${L}: resume carries on from where it stopped`, r.playing && r.t >= p2.t + 0.5 && r.t <= p2.t + 4, j({ before: p2.t, after: r.t }));
        consistent(L, r);

        await replayBtn(page).click();
        await page.waitForTimeout(1000);
        const rp = await st(page);
        check(`${L}: replay restarts from the top`, rp.playing && rp.t <= 3, j({ t: rp.t, p: rp.playing }));
        if (sound && rp.audio?.src) check(`${L}: replay restarts the audio`, rp.audio.t <= 3.2 && !rp.audio.paused, j(rp.audio));
        await playBtn(page).click(); // leave paused
        await page.waitForTimeout(200);
      }
      await noOverflow(page, `matrix sound ${sound ? "on" : "off"}`);
    }
    const end = await st(page);
    check("never more than one sound playing at once", end.maxPlaying <= 1, `max ${end.maxPlaying}`);
    check("no console or network errors", page.__errs.length === 0, page.__errs.join(" | "));
    await page.context().close();
  },

  /** Seeking: click, drag, arrows, Page keys, Home, End. While playing and while paused, sound on and off. */
  async seek(browser) {
    const page = await newPage(browser);
    await go(page);
    for (const sound of [true, false]) {
      for (const [i, playingFirst] of [[1, false], [2, true]]) {
        const L = `${CALLS[i].id} sound ${sound ? "on" : "off"} ${playingFirst ? "playing" : "paused"}`;
        await pickCall(page, i);
        await setSound(page, sound);
        if (playingFirst) {
          await playBtn(page).click();
          await page.waitForTimeout(800);
        }
        let s = await st(page);
        const dur = s.dur;
        check(`${L}: has a duration`, dur > 20, `dur=${dur}`);

        await seekTo(page, 0.5);
        s = await st(page);
        check(`${L}: click seeks to the middle`, Math.abs(s.t - dur * 0.5) <= 2.5, j({ t: s.t, want: dur / 2 }));
        if (sound && s.audio?.src && playingFirst) check(`${L}: audio followed the click`, Math.abs(s.audio.t - dur * 0.5) <= 2.5, j(s.audio));
        check(`${L}: a seek keeps playing/paused as it was`, s.playing === playingFirst, `playing=${s.playing}`);

        await dragSeek(page, 0.2, 0.75);
        s = await st(page);
        check(`${L}: drag seeks`, Math.abs(s.t - dur * 0.75) <= 2.5, j({ t: s.t, want: dur * 0.75 }));

        // keyboard (paused, so the numbers are exact)
        if (playingFirst) {
          await playBtn(page).click();
          await page.waitForTimeout(250);
        }
        await slider(page).focus();
        await seekTo(page, 0.4);
        await slider(page).focus();
        const base = (await st(page)).t;
        await page.keyboard.press("ArrowRight");
        let k = await st(page);
        check(`${L}: right arrow = +5s`, Math.abs(k.t - (base + 5)) <= 1.2, j({ base, now: k.t }));
        await page.keyboard.press("ArrowLeft");
        await page.keyboard.press("ArrowLeft");
        k = await st(page);
        check(`${L}: left arrow = -5s`, Math.abs(k.t - (base - 5)) <= 1.2, j({ base, now: k.t }));
        await page.keyboard.press("PageUp");
        k = await st(page);
        check(`${L}: Page Up = +15s`, Math.abs(k.t - (base - 5 + 15)) <= 1.2, j({ base, now: k.t }));
        await page.keyboard.press("Home");
        k = await st(page);
        check(`${L}: Home goes to the start`, k.t === 0, `t=${k.t}`);
        check(`${L}: start shows no leftovers (toasts, tools, end card)`, k.toasts === 0 && k.tools === 0 && !k.ended, j({ toasts: k.toasts, tools: k.tools, ended: k.ended }));
        await page.keyboard.press("End");
        k = await st(page);
        check(`${L}: End goes to the end`, k.t >= dur - 1 && k.ended, j({ t: k.t, ended: k.ended }));
        check(`${L}: the end is not "playing"`, !k.playing && k.busy === null, j({ p: k.playing, b: k.busy }));
        await page.keyboard.press("Home");
        k = await st(page);
        check(`${L}: back from the end clears the end card and the tool lines`, !k.ended && k.tools === 0 && k.toasts === 0, j({ ended: k.ended, tools: k.tools, toasts: k.toasts }));
        // seeking back and forth must be a pure function of time: the window at 55% is the same both times
        await seekTo(page, 0.55);
        const a1 = (await st(page)).windowText;
        await page.keyboard.press("End");
        await seekTo(page, 0.55);
        const a2 = (await st(page)).windowText;
        check(`${L}: window at the same moment looks the same after scrubbing away and back`, a1 === a2, `${a1.slice(0, 80)} || ${a2.slice(0, 80)}`);

        // play from the end starts over
        await page.keyboard.press("End");
        await playBtn(page).click();
        await page.waitForTimeout(1100);
        k = await st(page);
        check(`${L}: Play at the end starts the call over`, k.playing && k.t <= 3, j({ t: k.t, p: k.playing }));
        await playBtn(page).click();
      }
    }
    await noOverflow(page, "seek");
    check("no console or network errors", page.__errs.length === 0, page.__errs.join(" | "));
    await page.context().close();
  },

  /** Switching calls mid-call must leave nothing of the old call behind. */
  async switching(browser) {
    const page = await newPage(browser);
    await go(page);
    // what each window looks like fresh, before any call has played
    const fresh = {};
    for (let i = 0; i < CALLS.length; i++) {
      await pickCall(page, i, 600);
      fresh[i] = (await st(page)).windowText;
    }
    await pickCall(page, 0, 300);
    await setSound(page, true);
    for (const [from, to] of [[0, 1], [1, 3], [3, 2], [2, 4], [4, 0]]) {
      const L = `${CALLS[from].id} -> ${CALLS[to].id}`;
      await chip(page, from).click();
      await playBtn(page).click();
      await page.waitForTimeout(3500);
      const before = await st(page);
      check(`${L}: was playing before the switch`, before.playing && before.toasts + before.tools >= 0, j({ p: before.playing }));
      await chip(page, to).click();
      await page.waitForTimeout(350);
      const s = await st(page);
      check(`${L}: old audio stopped`, s.mediaPlaying === 0 && (s.audio?.paused ?? true), j({ playing: s.mediaPlaying, audio: s.audio }));
      check(`${L}: new call is idle at 0:00`, !s.playing && s.busy === null && s.t === 0 && !s.ended, j({ p: s.playing, b: s.busy, t: s.t }));
      check(`${L}: no old toasts, tool lines or end card`, s.toasts === 0 && s.tools === 0, j({ toasts: s.toasts, tools: s.tools }));
      check(`${L}: window is exactly the fresh window of the new call`, s.windowText === fresh[to], `${s.windowText.slice(0, 90)} || ${fresh[to].slice(0, 90)}`);
      check(`${L}: caller is the new call's`, s.callerName !== "" && s.callerName !== before.callerName, `${before.callerName} -> ${s.callerName}`);
      check(`${L}: URL remembers the new call`, to === 0 ? !s.search.includes("call=") : s.search.includes(`call=${CALLS[to].id}`), s.search);
      check(`${L}: audio file (if loaded) is the new call's`, !s.audio?.src || s.audio.src.endsWith(`/${CALLS[to].id}.mp3`), s.audio?.src);
      check(`${L}: sound did not drop to captions only`, s.soundLabel !== "Captions only", s.soundLabel);
      await page.waitForTimeout(1200);
      const later = await st(page);
      check(`${L}: stays silent and still after the switch`, !later.playing && later.mediaPlaying === 0 && later.t === 0, j({ p: later.playing, m: later.mediaPlaying, t: later.t }));
    }
    // play on the new call right after the switch, both through the end card path and a plain click
    await pickCall(page, 0, 300);
    await playBtn(page).click();
    await page.waitForTimeout(1500);
    await chip(page, 1).click();
    await playBtn(page).click();
    await page.waitForTimeout(2000);
    let s = await st(page);
    check("switch then play: plays the new call", s.playing && s.audio?.src.endsWith("/dental.mp3") && !s.audio.paused, j(s));
    check("switch then play: its clock starts at zero, not where the old call was", s.t <= 4, `t=${s.t}`);
    const end = await st(page);
    check("never more than one sound playing at once", end.maxPlaying <= 1, `max ${end.maxPlaying}`);
    await noOverflow(page, "switching");
    check("no console or network errors", page.__errs.length === 0, page.__errs.join(" | "));
    await page.context().close();
  },

  /** The end card and both its buttons. */
  async endcard(browser) {
    const page = await newPage(browser);
    await go(page);
    await setSound(page, false);
    for (let i = 0; i < CALLS.length; i++) {
      const L = `${CALLS[i].id} end card`;
      await pickCall(page, i);
      await playBtn(page).click();
      await page.waitForTimeout(600);
      await slider(page).focus();
      await page.keyboard.press("End");
      await page.waitForTimeout(700);
      let s = await st(page);
      check(`${L}: shows`, s.ended && /Call ended/.test(s.pill), j({ ended: s.ended, pill: s.pill }));
      check(`${L}: not playing, not busy`, !s.playing && s.busy === null);
      const btns = page.locator("#demo .ad-outcome-btns button");
      check(`${L}: has two buttons`, (await btns.count()) === 2);
      const labels = await btns.allTextContents();
      check(`${L}: button names`, /^Play .* call$/.test(labels[0].trim()) && /Talk to Maya live/.test(labels[1]), j(labels));
      const bx = await btns.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
      check(`${L}: buttons are at least 44px tall`, bx.every(([, h]) => h >= 44), j(bx));
      await shot(page, `endcard-${CALLS[i].id}`);

      await btns.nth(0).click();
      await page.waitForTimeout(1500);
      const next = (i + 1) % CALLS.length;
      s = await st(page);
      check(`${L}: "Play next" selects and plays the next call`, s.chip === CALLS[next].chip && s.playing && s.t >= 0.5, j({ chip: s.chip, p: s.playing, t: s.t }));
      check(`${L}: next call starts clean`, !s.ended, "");
      await playBtn(page).click(); // pause
    }
    // Talk to Maya live: fires maya:open and the scripted call stops
    await pickCall(page, 0);
    await playBtn(page).click();
    await page.waitForTimeout(500);
    await slider(page).focus();
    await page.keyboard.press("End");
    await page.waitForTimeout(500);
    page.__quiet = true;
    const before = await page.evaluate(() => window.__mayaOpen);
    await page.locator("#demo .ad-outcome-btns button").nth(1).click();
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => window.__mayaOpen);
    check('"Talk to Maya live" asks the real Maya to open', after === before + 1, `${before} -> ${after}`);
    page.__quiet = false;
    await noOverflow(page, "endcard");
    check("no console or network errors", page.__errs.length === 0, page.__errs.join(" | "));
    await page.context().close();
  },

  /** Industry cards, ?call= restore, hero button, address bar behaviour. */
  async links(browser) {
    const page = await newPage(browser);
    await go(page);
    await setSound(page, false);

    // address bar
    const h0 = (await st(page)).hist;
    await scrollToStage(page, "chips");
    const y0 = (await st(page)).scrollY;
    await pickCall(page, 2, 300);
    let s = await st(page);
    check("choosing a call writes ?call= (no new history entry, no scroll jump)", s.search === "?call=plumbing" && s.hist === h0 && Math.abs(s.scrollY - y0) <= 2, j({ search: s.search, hist: s.hist, h0, y: s.scrollY, y0 }));
    await pickCall(page, 0, 300);
    s = await st(page);
    check("choosing the first call leaves the address bar clean", s.search === "", s.search);
    await pickCall(page, 3, 300);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#demo .ad-play");
    await page.waitForTimeout(700);
    s = await st(page);
    check("reload lands on the same call", s.chip === "Real estate" && s.search === "?call=real-estate", j({ chip: s.chip, search: s.search }));
    check("a restored call waits for Play (no autoplay, no audio fetched)", !s.playing && s.busy === null && !s.audio?.src && s.mediaPlaying === 0, j({ p: s.playing, audio: s.audio }));
    await playBtn(page).click();
    await page.waitForTimeout(1800);
    s = await st(page);
    check("a restored call plays on the first press", s.playing && s.t >= 1, j({ p: s.playing, t: s.t }));
    await playBtn(page).click();

    for (const [q, want, label] of [["?call=restaurant", "Restaurant", "shared link"], ["?call=nope", "Software support", "invalid id"], ["?call=", "Software support", "empty id"], ["?call=DENTAL", "Software support", "wrong-case id"]]) {
      await go(page, q);
      s = await st(page);
      check(`${label} (${q}) -> ${want}`, s.chip === want, s.chip);
      if (want === "Software support") check(`${label}: address bar is tidied`, !/call=/.test(s.search) || s.search === "", s.search);
    }
    await go(page, "?utm=a&call=plumbing", "#demo");
    await pickCall(page, 1, 300);
    s = await st(page);
    check("other query params and the hash survive", s.search.includes("utm=a") && s.search.includes("call=dental") && s.hash === "#demo", j({ search: s.search, hash: s.hash }));

    // hero button plays the selected call
    await go(page, "?call=dental");
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("button", { name: /Watch a call/ }).first().click();
    await page.waitForTimeout(1800);
    s = await st(page);
    check('hero "Watch a call" plays the call that is selected (dental), not software support', s.chip === "Dental office" && s.playing && s.t >= 0.5, j({ chip: s.chip, p: s.playing, t: s.t }));
    const sceneTop = await page.evaluate(() => document.querySelector("#demo-scene").getBoundingClientRect().top);
    check("hero button scrolls the stage into view", sceneTop > 0 && sceneTop < H * 0.4, `scene top ${sceneTop}`);
    await playBtn(page).click(); // pause
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.getByRole("button", { name: /Watch a call/ }).first().click();
    await page.waitForTimeout(900);
    s = await st(page);
    check('hero button again resumes the paused call', s.playing && s.chip === "Dental office", j({ chip: s.chip, p: s.playing }));

    // industry cards
    await go(page);
    await setSound(page, false);
    const cards = page.locator("#industries button");
    check("six industry cards (five calls and Yours)", (await cards.count()) === 6, String(await cards.count()));
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => document.querySelector("#industries").scrollIntoView({ behavior: "instant" }));
      await page.waitForTimeout(250);
      await cards.nth(i).click();
      await page.waitForTimeout(1300);
      s = await st(page);
      const top = await page.evaluate(() => document.querySelector("#demo-scene").getBoundingClientRect().top);
      check(`industry card ${CALLS[i].chip} selects that call`, s.chip === CALLS[i].chip && !s.playing, j({ chip: s.chip, p: s.playing }));
      check(`industry card ${CALLS[i].chip} scrolls to the stage`, PHONE || (top > 0 && top < H * 0.45), `scene top ${top}`);
      check(`industry card ${CALLS[i].chip} updates the address`, i === 0 ? !/call=/.test(s.search) : s.search.includes(CALLS[i].id), s.search);
    }
    await page.evaluate(() => document.querySelector("#industries").scrollIntoView({ behavior: "instant" }));
    await page.waitForTimeout(250);
    const mo = await page.evaluate(() => window.__mayaOpen);
    page.__quiet = true;
    await cards.nth(5).click();
    await page.waitForTimeout(500);
    check('"Yours" card opens Maya', (await page.evaluate(() => window.__mayaOpen)) === mo + 1);
    page.__quiet = false;

    await noOverflow(page, "links");
    check("no console or network errors", page.__errs.length === 0, page.__errs.join(" | "));
    await page.context().close();
  },

  /** Space only works inside the stage, never while typing elsewhere. */
  async keys(browser) {
    const page = await newPage(browser);
    await go(page);
    await setSound(page, false);
    await scrollToStage(page);
    await page.evaluate(() => {
      const i = document.createElement("input");
      i.id = "qa-input";
      i.style.cssText = "position:fixed;top:60px;left:8px;z-index:99999";
      document.body.appendChild(i);
      const t = document.createElement("textarea");
      t.id = "qa-text";
      t.style.cssText = "position:fixed;top:100px;left:8px;z-index:99999";
      document.body.appendChild(t);
    });
    await page.focus("#qa-input");
    await page.keyboard.type("a b");
    await page.focus("#qa-text");
    await page.keyboard.type("c d");
    let s = await st(page);
    const vals = await page.evaluate(() => [document.querySelector("#qa-input").value, document.querySelector("#qa-text").value]);
    check("typing a space in a field outside the stage keeps the space and does not start the call", !s.playing && vals[0] === "a b" && vals[1] === "c d", j({ vals, p: s.playing }));

    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Space");
    await page.waitForTimeout(250);
    s = await st(page);
    check("Space with focus outside the stage does not play", !s.playing);

    await slider(page).focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(500);
    s = await st(page);
    check("Space on the scrubber plays", s.playing);
    await page.keyboard.press("Space");
    await page.waitForTimeout(250);
    s = await st(page);
    check("Space again pauses", !s.playing);

    await page.keyboard.press("Space");
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      const e = new KeyboardEvent("keydown", { key: " ", code: "Space", repeat: true, bubbles: true, cancelable: true });
      document.querySelector("#demo .ad-seek").dispatchEvent(e);
    });
    await page.waitForTimeout(150);
    s = await st(page);
    check("holding Space (auto-repeat) does not flicker the call", s.playing);

    await chip(page, 0).focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    s = await st(page);
    check("Space on a chip is the chip's own press, the call keeps playing", s.playing && s.chip === "Software support");

    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(500);
    s = await st(page);
    check("arrow keys on the chips move to the next call and stop the old one", s.chip === "Dental office" && !s.playing && s.mediaPlaying === 0, j({ chip: s.chip, p: s.playing }));
    const focusedIsChip = await page.evaluate(() => document.activeElement?.getAttribute("role") === "radio" && document.activeElement.textContent.includes("Dental"));
    check("focus follows the arrow onto the new chip", focusedIsChip);
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(300);
    s = await st(page);
    check("arrow keys wrap around the chip row", s.chip === "Restaurant", s.chip);

    // Space on links and buttons elsewhere on the page must be untouched too
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("Tab");
    await noOverflow(page, "keys");
    check("no console or network errors", page.__errs.length === 0, page.__errs.join(" | "));
    await page.context().close();
  },

  /** Maya launcher steps aside over the stage; maya:open and maya:call-start stop the scripted call. */
  async maya(browser) {
    const page = await newPage(browser);
    await go(page);
    await setSound(page, false);
    const launcher = page.locator(".maya-launcher-wrap, .maya-pill");
    const hasLauncher = (await launcher.count()) > 0;
    const vis = () => launcher.first().evaluate((e) => { const c = getComputedStyle(e); return c.visibility !== "hidden" && Number(c.opacity) > 0.05; });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(500);
    const stageTop = await page.evaluate(() => document.querySelector("#demo .ad-grid").getBoundingClientRect().top / innerHeight);
    const yielding = () => page.evaluate(() => document.documentElement.classList.contains("maya-yield"));
    // the pill lives in the bottom 10% of the screen; the call and window must reach it before the pill steps aside
    if (stageTop > 0.92) check("the pill stays on the hero while the demo is still below the fold", !(await yielding()), `demo top at ${stageTop.toFixed(2)} of the screen`);
    else if (stageTop < 0.88) check("the pill steps aside once the demo reaches its corner", await yielding(), `demo top at ${stageTop.toFixed(2)}`);
    if (hasLauncher && !(await yielding())) check("launcher visible at the top", await vis());
    await scrollToStage(page);
    await page.waitForTimeout(500);
    check("html yields while the stage is on screen", await page.evaluate(() => document.documentElement.classList.contains("maya-yield")));
    if (hasLauncher) check("launcher hidden over the stage", !(await vis()));
    await page.evaluate(() => document.querySelector("#try-maya").scrollIntoView({ behavior: "instant" }));
    await page.waitForTimeout(700);
    check("html stops yielding below the stage", !(await page.evaluate(() => document.documentElement.classList.contains("maya-yield"))));
    if (hasLauncher) check("launcher back below the stage", await vis());
    check("the Maya launcher or pill is on the page", hasLauncher);

    page.__quiet = true;
    for (const evt of ["maya:open", "maya:call-start"]) {
      // the real Maya opens a panel over the page on these events, so each one gets a fresh page
      await go(page);
      await setSound(page, false);
      await scrollToStage(page);
      await pickCall(page, 1);
      await playBtn(page).click();
      await page.waitForTimeout(1200);
      let s = await st(page);
      check(`${evt}: was playing`, s.playing);
      await page.evaluate((e) => window.dispatchEvent(new Event(e)), evt);
      await page.waitForTimeout(300);
      s = await st(page);
      check(`${evt} pauses the scripted call`, !s.playing && s.busy === null && s.mediaPlaying === 0, j({ p: s.playing, b: s.busy }));
    }
    page.__quiet = false;
    await page.evaluate(() => { document.documentElement.classList.remove("maya-yield"); });
    await noOverflow(page, "maya");
    check("no console or network errors", page.__errs.length === 0, page.__errs.join(" | "));
    await page.context().close();
  },

  /** Phone: the sticky transport and caption appear over the stage and leave with it. */
  async sticky(browser) {
    if (!PHONE) {
      console.log("  skip  sticky transport is phone-only");
      return;
    }
    const page = await newPage(browser);
    await go(page);
    await setSound(page, false);
    const dock = async () =>
      page.evaluate(() => {
        const d = document.querySelector("#demo .ad-dock");
        const r = d.getBoundingClientRect();
        const c = d.querySelector(".ad-caption");
        const cr = c.getBoundingClientRect();
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, pos: getComputedStyle(d).position, capShown: getComputedStyle(c).display !== "none" && cr.height > 0, capText: c.textContent.trim(), stageTop: Math.round(document.getElementById("demo").getBoundingClientRect().top), stageBottom: Math.round(document.getElementById("demo").getBoundingClientRect().bottom) };
      });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.waitForTimeout(300);
    let d = await dock();
    check("transport is sticky", d.pos === "sticky", d.pos);
    check("above the stage the transport is below the fold", d.top >= d.vh - 1, j(d));
    await scrollToStage(page, "chips");
    await playBtn(page).click();
    await page.waitForTimeout(2500);
    d = await dock();
    check("over the stage the transport is on screen, within the bottom of the viewport", d.bottom <= d.vh + 1 && d.top > d.vh * 0.5, j(d));
    check("phone caption shows the line being spoken", d.capShown && d.capText.length > 3 && !/Press play/.test(d.capText), d.capText);
    await shot(page, "sticky-over-stage");
    // scroll through the stage: the dock must stay in view the whole way
    let stuck = true;
    for (const f of [0.25, 0.5, 0.75, 0.95]) {
      await page.evaluate((f) => {
        const s = document.getElementById("demo");
        const top = s.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({ top: top + (s.offsetHeight - innerHeight) * f, behavior: "instant" });
      }, f);
      await page.waitForTimeout(200);
      const x = await dock();
      if (!(x.bottom <= x.vh + 1 && x.top >= 0)) stuck = false;
    }
    check("the transport stays on screen all the way down the stage", stuck);
    await page.evaluate(() => document.querySelector("#how-it-works").scrollIntoView({ behavior: "instant" }));
    await page.waitForTimeout(400);
    d = await dock();
    check("past the stage the transport has left the screen", d.bottom <= 0 || d.top >= d.vh, j(d));
    const s = await st(page);
    check("the call keeps going off-screen (it is the visitor's to pause)", s.playing);
    await page.locator("#demo .ad-play").evaluate((b) => b.click());
    await noOverflow(page, "sticky");
    check("no console or network errors", page.__errs.length === 0, page.__errs.join(" | "));
    await page.context().close();
  },

  /** Hidden tab, system audio interruption, rapid clicks. */
  async stress(browser) {
    const page = await newPage(browser);
    await go(page);

    // hidden tab, sound on
    await setSound(page, true);
    await pickCall(page, 3);
    await playBtn(page).click();
    await page.waitForTimeout(2000);
    const hide = (on) =>
      page.evaluate((on) => {
        Object.defineProperty(document, "hidden", { get: () => on, configurable: true });
        Object.defineProperty(document, "visibilityState", { get: () => (on ? "hidden" : "visible"), configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
      }, on);
    await hide(true);
    await page.waitForTimeout(2500);
    await hide(false);
    await page.waitForTimeout(600);
    let s = await st(page);
    check("sound on, tab hidden then back: still playing, clock follows audio", s.playing && s.audio && !s.audio.paused && Math.abs(s.audio.t - s.t) <= 1.2, j({ t: s.t, audio: s.audio }));
    check("sound on, tab hidden then back: it did not jump or restart", s.t >= 4 && s.t <= 12, `t=${s.t}`);
    consistent("after hidden tab", s);

    // the system takes the audio away (phone call, lock screen): the stage must show paused, not a frozen "playing"
    await page.evaluate(() => document.querySelector("#demo audio").pause());
    await page.waitForTimeout(500);
    s = await st(page);
    check("audio paused by the system -> the stage shows paused", !s.playing && s.busy === null, j({ p: s.playing, b: s.busy }));
    await playBtn(page).click();
    await page.waitForTimeout(1200);
    s = await st(page);
    check("press Play after a system pause: plays on from there", s.playing && s.audio && !s.audio.paused, j(s.audio));
    await playBtn(page).click();

    // hidden tab, sound off
    await setSound(page, false);
    await pickCall(page, 2);
    await playBtn(page).click();
    await page.waitForTimeout(1500);
    const t0 = (await st(page)).t;
    await hide(true);
    await page.waitForTimeout(2000);
    await hide(false);
    await page.waitForTimeout(1200);
    s = await st(page);
    check("sound off, tab hidden then back: still playing and moving forward, no jump", s.playing && s.t >= t0 + 1 && s.t <= t0 + 8, j({ t0, t: s.t }));
    await playBtn(page).click();

    // rapid play/pause
    await setSound(page, true);
    await pickCall(page, 1);
    for (let i = 0; i < 21; i++) await playBtn(page).click({ delay: 0 });
    await page.waitForTimeout(900);
    s = await st(page);
    check("21 quick Play/Pause clicks end up playing", s.playing, "");
    check("quick clicks did not knock the sound over to captions only", s.soundLabel !== "Captions only", s.soundLabel);
    consistent("after quick play/pause", s);
    for (let i = 0; i < 13; i++) await playBtn(page).click({ delay: 0 });
    await page.waitForTimeout(900);
    s = await st(page);
    check("13 more quick clicks end paused, audio silent", !s.playing && s.mediaPlaying === 0 && s.soundLabel !== "Captions only", j({ p: s.playing, m: s.mediaPlaying, label: s.soundLabel }));

    // rapid replay
    for (let i = 0; i < 10; i++) await replayBtn(page).click({ delay: 0 });
    await page.waitForTimeout(1200);
    s = await st(page);
    check("10 quick Replay clicks end up playing from the top, one sound", s.playing && s.t <= 4 && s.mediaPlaying <= 1 && s.soundLabel !== "Captions only", j({ p: s.playing, t: s.t, m: s.mediaPlaying }));
    consistent("after quick replays", s);

    // rapid sound toggles while playing
    for (let i = 0; i < 11; i++) await soundBtn(page).click({ delay: 0 });
    await page.waitForTimeout(900);
    s = await st(page);
    check("11 quick sound toggles: now off, still playing, nothing audible", !s.soundOn && s.playing && s.mediaPlaying === 0, j({ on: s.soundOn, p: s.playing, m: s.mediaPlaying }));
    await soundBtn(page).click();
    await page.waitForTimeout(900);
    s = await st(page);
    check("sound back on mid-call: audio joins at the call's time", s.soundOn && s.playing && s.audio && !s.audio.paused && Math.abs(s.audio.t - s.t) <= 1.5, j({ t: s.t, audio: s.audio }));
    await playBtn(page).click();

    // rapid chip changes
    for (let k = 0; k < 4; k++) for (let i = 0; i < 5; i++) await chip(page, i).click({ delay: 0 });
    await chip(page, 2).click();
    await page.waitForTimeout(900);
    s = await st(page);
    check("20 quick chip clicks: last one wins, idle, silent, right file", s.chip === "Home services" && !s.playing && s.mediaPlaying === 0 && s.t === 0 && (!s.audio?.src || s.audio.src.endsWith("/plumbing.mp3")), j({ chip: s.chip, p: s.playing, src: s.audio?.src }));
    check("quick chip clicks leave no toasts or tool lines", s.toasts === 0 && s.tools === 0);
    check("address bar matches the last chip", s.search === "?call=plumbing", s.search);
    // chip + Play + chip + Play ...
    for (let i = 0; i < 5; i++) {
      await chip(page, i).click({ delay: 0 });
      await playBtn(page).click({ delay: 0 });
    }
    await page.waitForTimeout(2200);
    s = await st(page);
    check("chip then Play five times: ends on the last call, playing, one sound, not on captions only", s.chip === "Restaurant" && s.playing && s.mediaPlaying <= 1 && s.soundLabel !== "Captions only" && (!s.audio?.src || s.audio.src.endsWith("/restaurant.mp3")), j({ chip: s.chip, p: s.playing, m: s.mediaPlaying, label: s.soundLabel, src: s.audio?.src }));
    consistent("after chip+play spam", s);
    check("never more than one sound playing at once", s.maxPlaying <= 1, `max ${s.maxPlaying}`);

    // a call that plays all the way through
    await setSound(page, false);
    await playBtn(page).click();
    await slider(page).focus();
    await page.keyboard.press("End");
    await page.waitForTimeout(300);
    await noOverflow(page, "stress");
    check("no console or network errors", page.__errs.length === 0, page.__errs.join(" | "));
    await page.context().close();
  },

  /** A call left to run on its own reaches the end by itself (sound off, so it is quick to check with the clock sped up). */
  async runthrough(browser) {
    const page = await newPage(browser);
    await go(page);
    await setSound(page, false);
    await pickCall(page, 1);
    await playBtn(page).click();
    // jump near the end and let it finish on its own
    const dur = (await st(page)).dur;
    await slider(page).focus();
    await seekTo(page, (dur - 4) / dur);
    await page.waitForTimeout(5500);
    const s = await st(page);
    check("a call reaches its end by itself and stops", s.ended && !s.playing && s.busy === null && s.t >= dur - 1, j({ ended: s.ended, p: s.playing, b: s.busy, t: s.t }));
    check("the end pill says how long the call was", new RegExp(`Call ended, ${Math.floor(dur / 60)}:`).test(s.pill) || /Call ended/.test(s.pill), s.pill);
    await playBtn(page).click();
    await page.waitForTimeout(1200);
    const r = await st(page);
    check("Play after the end starts over", r.playing && r.t <= 3 && !r.ended, j({ p: r.playing, t: r.t }));
    check("no console or network errors", page.__errs.length === 0, page.__errs.join(" | "));
    await page.context().close();
  },


  /** Sound that never arrives, or a file that is missing: the call must carry on with captions, never freeze. */
  async slownet(browser) {
    const page = await newPage(browser);
    page.__quiet = true; // the broken files are on purpose
    await page.route("**/agent-demo/dental.mp3", () => {
      /* never answered: the connection just hangs */
    });
    await page.route("**/agent-demo/plumbing.mp3", (route) => route.fulfill({ status: 404, body: "no" }));
    await page.route("**/agent-demo/restaurant.mp3", async (route) => {
      await sleep(1800); // slow, but it does arrive
      await route.continue();
    });
    await go(page);
    await setSound(page, true);
    await pickCall(page, 1);
    await playBtn(page).click();
    await page.waitForTimeout(2600);
    let s = await st(page);
    check("audio that is slow to arrive: the call says it is connecting, not frozen", s.playing && /Connecting|Ringing/.test(s.pill), j({ pill: s.pill, t: s.t }));
    check("audio that is slow to arrive: pause works", await (async () => { await playBtn(page).click(); await page.waitForTimeout(200); return !(await st(page)).playing; })());
    await playBtn(page).click();
    await page.waitForTimeout(12000);
    s = await st(page);
    check("audio that never arrives: after a few seconds the captions take over and the call moves", s.playing && s.soundLabel === "Captions only" && s.t >= 2, j({ label: s.soundLabel, t: s.t, pill: s.pill }));
    await playBtn(page).click();

    await pickCall(page, 2);
    await playBtn(page).click();
    await page.waitForTimeout(2500);
    s = await st(page);
    check("a missing audio file: captions take over at once and the call moves", s.playing && s.soundLabel === "Captions only" && s.t >= 1, j({ label: s.soundLabel, t: s.t }));
    await playBtn(page).click();
    // and the next call, with a good file, still gets its sound back
    await pickCall(page, 0);
    await playBtn(page).click();
    await page.waitForTimeout(2200);
    s = await st(page);
    check("the next call has its sound back", s.playing && s.soundLabel === "Sound on" && s.audio && !s.audio.paused, j({ label: s.soundLabel, audio: s.audio }));
    // Pause (and switch calls) while the sound is still on its way: cancelling a pending play() is not a broken file.
    await pickCall(page, 4);
    await playBtn(page).click();
    await page.waitForTimeout(400);
    await playBtn(page).click();
    await page.waitForTimeout(2600);
    s = await st(page);
    check("pausing while the sound is still loading does not knock it over to captions only", !s.playing && s.soundLabel === "Sound on", j({ label: s.soundLabel, p: s.playing }));
    await playBtn(page).click();
    await page.waitForTimeout(1800);
    s = await st(page);
    check("...and Play afterwards brings the sound in", s.playing && s.soundLabel === "Sound on" && s.audio && !s.audio.paused, j({ label: s.soundLabel, audio: s.audio }));
    await playBtn(page).click();
    await pickCall(page, 4);
    await replayBtn(page).click();
    await page.waitForTimeout(300);
    await chip(page, 0).click(); // switch away while it is still loading
    await page.waitForTimeout(2600);
    await playBtn(page).click();
    await page.waitForTimeout(1500);
    s = await st(page);
    check("switching away while the sound is still loading leaves the next call with its sound", s.playing && s.soundLabel === "Sound on" && s.audio && !s.audio.paused && s.audio.src.endsWith("/saas-support.mp3"), j({ label: s.soundLabel, audio: s.audio }));
    page.__quiet = false;
    await noOverflow(page, "slownet");
    check("no console errors beyond the broken files", page.__errs.length === 0, page.__errs.join(" | "));
    await page.context().close();
  },
  /** Reduce Motion: only crossfades, no travelling cards or slides. */
  async reduced(browser) {
    const page = await newPage(browser, { reduce: true });
    await go(page);
    await setSound(page, false);
    await pickCall(page, 1);
    await page.evaluate(() => {
      window.__moving = new Set();
      const scan = () => {
        const stage = document.getElementById("demo");
        for (const a of document.getAnimations()) {
          const tg = a.effect?.target;
          if (!tg || !stage.contains(tg)) continue;
          for (const k of a.effect.getKeyframes()) for (const p of Object.keys(k)) if (!["offset", "easing", "composite", "computedOffset"].includes(p)) window.__moving.add(p);
        }
      };
      window.__qaScan = setInterval(scan, 120);
    });
    await playBtn(page).click();
    for (const i of [0, 1, 2, 3, 4]) {
      await page.waitForTimeout(1500);
      await slider(page).focus();
      await seekTo(page, 0.2 + i * 0.15);
    }
    await page.waitForTimeout(500);
    const props = await page.evaluate(() => [...window.__moving]);
    check("Reduce Motion: nothing in the stage animates position or size", !props.some((p) => /^(transform|translate|scale|rotate|top|left|right|bottom|width|height|margin\w*|inset\w*)$/i.test(p)), j(props));
    const toastTransforms = await page.evaluate(() => [...document.querySelectorAll("#demo .ad-toast")].map((e) => getComputedStyle(e).transform));
    check("Reduce Motion: toasts do not slide", toastTransforms.every((t) => t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)"), j(toastTransforms));
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    const y = await page.evaluate(async () => {
      document.querySelectorAll("#industries button")[2].scrollIntoView({ behavior: "instant" });
      return window.scrollY;
    });
    await page.waitForTimeout(150);
    await page.locator("#industries button").nth(2).click();
    await page.waitForTimeout(150);
    const y2 = await page.evaluate(() => window.scrollY);
    check("Reduce Motion: a card click jumps to the stage instead of gliding", Math.abs(y2 - y) > 200, j({ y, y2 }));
    await noOverflow(page, "reduced");
    check("no console or network errors", page.__errs.length === 0, page.__errs.join(" | "));
    await page.context().close();
  },

  /** Page-wide review checks: sizes, focus rings, wrapped numbers, truncation, emoji, images, overflow at many widths. */
  async audit(browser) {
    const page = await newPage(browser);
    await go(page);
    await setSound(page, false);
    await scrollToStage(page);

    // 44px targets inside the stage
    const small = await page.evaluate(() =>
      [...document.querySelectorAll("#demo button, #demo [role=radio], #demo [role=slider], #demo a")]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => ({ n: (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 28), w: e.offsetWidth, h: e.offsetHeight })) // layout size, so a button mid-press does not read small
        .filter((x) => x.w < 44 || x.h < 44),
    );
    check("every control in the stage is at least 44x44", small.length === 0, j(small));
    const smallPage = await page.evaluate(() =>
      [...document.querySelectorAll("main button, main [role=button], main a")]
        .filter((e) => !e.closest("#demo") && e.getBoundingClientRect().width > 0 && !e.closest("p, li, dd, dt, span"))
        .map((e) => { const r = e.getBoundingClientRect(); return { n: (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 28), w: Math.round(r.width), h: Math.round(r.height) }; })
        .filter((x) => x.h < 44),
    );
    check("every button and block link on the rest of /agent is at least 44px tall", smallPage.length === 0, j(smallPage));

    // focus rings, walking with the keyboard
    await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo({ top: 0, behavior: "instant" }); });
    await chip(page, 0).focus();
    await page.keyboard.press("Shift+Tab");
    const noRing = [];
    for (let n = 0; n < 16; n++) {
      await page.keyboard.press("Tab");
      const r = await page.evaluate(() => {
        const e = document.activeElement;
        if (!e || !document.getElementById("demo").contains(e)) return null;
        const c = getComputedStyle(e);
        const ring = (c.outlineStyle !== "none" && parseFloat(c.outlineWidth) > 0) || (c.boxShadow && c.boxShadow !== "none");
        // a radio's ring may live on the element or a child
        return { n: (e.getAttribute("aria-label") || e.textContent).trim().slice(0, 28), ring: !!ring };
      });
      if (r && !r.ring) noRing.push(r.n);
    }
    check("every focusable thing in the stage shows a focus ring", noRing.length === 0, j(noRing));

    // no ellipsis truncation anywhere on /agent
    const clipped = await page.evaluate(() =>
      [...document.querySelectorAll("main *")]
        .filter((e) => { const c = getComputedStyle(e); return c.textOverflow === "ellipsis" || (c.webkitLineClamp && c.webkitLineClamp !== "none"); })
        .map((e) => e.className?.toString().slice(0, 40)),
    );
    check('no "..." truncation (text-overflow or line-clamp) anywhere', clipped.length === 0, j(clipped));

    // every call, at its end (the fullest state): wrapped numbers, emoji, 24h times, broken images, and sideways overflow
    for (let i = 0; i < CALLS.length; i++) {
      const L = CALLS[i].id;
      await pickCall(page, i);
      await playBtn(page).click();
      await slider(page).focus();
      await page.keyboard.press("End");
      await page.waitForTimeout(900);
      for (const frac of [0.35, 0.7, 1]) {
        if (frac < 1) await seekTo(page, frac);
        await page.waitForTimeout(500);
        const r = await page.evaluate(() => {
          const stage = document.getElementById("demo");
          const wraps = [];
          const re = /(\$?\d[\d,.:]*)(\s| )+(AM|PM|am|pm|min|mins|minutes|minute|hours|hour|hrs|%|miles|mi|ft|sq ft|beds?|baths?|seats?|people|guests|days|seconds|sec)\b/g;
          const w = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
          for (let n = w.nextNode(); n; n = w.nextNode()) {
            if (n.parentElement.closest("[aria-hidden=true] .sr-only, .sr-only")) continue;
            const txt = n.textContent;
            re.lastIndex = 0;
            for (let m = re.exec(txt); m; m = re.exec(txt)) {
              const rg = document.createRange();
              rg.setStart(n, m.index);
              rg.setEnd(n, m.index + m[0].length);
              const rects = [...rg.getClientRects()].filter((q) => q.width > 0);
              if (rects.length > 1 && Math.abs(rects[0].top - rects[rects.length - 1].top) > 4) wraps.push(m[0]);
            }
          }
          const text = stage.innerText;
          const bad = [...document.querySelectorAll("#demo img")].filter((im) => im.complete && im.naturalWidth === 0).map((im) => im.getAttribute("src"));
          const clipRight = [...stage.querySelectorAll(".ad-grid *")]
            .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && !e.closest("#demo-chips, .ad-tx, .ad-win-body, .ad-seek") && Number(getComputedStyle(e.closest(".ad-toast") || e).opacity) > 0.05; })
            .map((e) => e.className?.toString().slice(0, 30)).slice(0, 5);
          return { wraps, emoji: /\p{Extended_Pictographic}/u.test(text), h24: text.match(/\b(1[3-9]|2[0-3]):[0-5]\d\b/g), bad, clipRight, dots: /\.\.\./.test(text) };
        });
        const tag = `${L} @${Math.round(frac * 100)}%`;
        check(`${tag}: no number wrapped away from its unit`, r.wraps.length === 0, j(r.wraps));
        check(`${tag}: no emoji`, !r.emoji);
        check(`${tag}: no 24-hour times`, !r.h24, j(r.h24));
        check(`${tag}: no broken images`, r.bad.length === 0, j(r.bad));
        check(`${tag}: nothing pokes out past the right edge`, r.clipRight.length === 0, j(r.clipRight));
        check(`${tag}: no "..." in the text`, !r.dots);
        await noOverflow(page, tag);
        if (frac === 1) {
          await page.evaluate(AUDIT_JS);
          const low = await page.evaluate(() => window.__qaContrast(document.getElementById("demo")));
          check(`${tag}: text contrast meets 4.5:1 (3:1 for large text)`, low.length === 0, j(low));
          const tight = [];
          for (const grp of ["#demo-chips [role=radio]", "#demo .ad-transport button, #demo .ad-transport [role=slider]", "#demo .ad-outcome-btns button"]) tight.push(...(await page.evaluate((g) => window.__qaGaps(g), grp)));
          check(`${tag}: at least 8px between tap targets`, tight.length === 0, j(tight));
        }
      }
      await playBtn(page).click().catch(() => {});
    }
    await shot(page, "audit-end");
    await page.evaluate(AUDIT_JS);
    const lowRest = await page.evaluate(() => {
      const out = [];
      for (const sec of document.querySelectorAll("main > section, main section, #root section")) if (sec.id !== "demo" && !sec.closest("#demo")) out.push(...window.__qaContrast(sec));
      return [...new Set(out)];
    });
    check("the rest of /agent: text contrast meets 4.5:1 (3:1 for large text)", lowRest.length === 0, j(lowRest));
    const tightRest = await page.evaluate(() => window.__qaGaps("main section:not(#demo) button, main section:not(#demo) a"));
    check("the rest of /agent: at least 8px between buttons and links", tightRest.length === 0, j(tightRest));
    check("no console or network errors", page.__errs.length === 0, page.__errs.join(" | "));
    await page.context().close();

    // the whole page, other widths: no sideways scroll, no clipped columns
    for (const w of [320, 375, 768, 1024, 1280, 1920]) {
      const p = await newPage(browser, { w, h: 900 });
      await go(p);
      await setSound(p, false);
      for (let i = 0; i < CALLS.length; i++) {
        await pickCall(p, i, 300);
        await playBtn(p).click();
        await slider(p).focus();
        await p.keyboard.press("End");
        await p.waitForTimeout(350);
        const s = await st(p);
        check(`width ${w}, ${CALLS[i].id} (ended): no sideways scroll`, s.overflow <= 0, `over by ${s.overflow}`);
        await playBtn(p).click().catch(() => {});
      }
      check(`width ${w}: no console or network errors`, p.__errs.length === 0, p.__errs.join(" | "));
      await p.context().close();
    }
  },
};

// ---------------------------------------------------------------------------------------------------------------------

const browser = await chromium.launch({
  executablePath: findBrowser(),
  args: ["--autoplay-policy=no-user-gesture-required"],
});
console.log(`agent demo QA  ${BASE}/agent  ${TAG}${PHONE ? " (phone)" : ""}`);
const started = Date.now();
for (const [name, fn] of Object.entries(GROUPS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  group = name;
  const t0 = Date.now();
  const before = results.length;
  try {
    await fn(browser);
  } catch (e) {
    check("group ran to the end", false, e && e.message ? e.message.split("\n")[0] : String(e));
  }
  const mine = results.slice(before);
  console.log(`${mine.every((r) => r.ok) ? "ok  " : "FAIL"}  ${name.padEnd(12)} ${mine.filter((r) => r.ok).length}/${mine.length} checks  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${((Date.now() - started) / 1000).toFixed(0)}s at ${TAG}`);
if (failed.length) {
  console.log("\nFailures:");
  for (const f of failed) console.log(` - [${f.group}] ${f.name}${f.detail ? "  ->  " + f.detail : ""}`);
  process.exit(1);
}
