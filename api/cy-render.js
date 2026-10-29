// Cookie Yeti — self-hosted render engine (replaces the paid Browserless dependency).
//
// POST /api/cy-render   header x-render-key: <key from Supabase Vault "cy_render_key">
//   { action: "ping" }                                   -> { ok: true, engine }
//   { action: "content",  url }                          -> { ok, html, finalUrl }
//   { action: "validate", url, selector }                -> { ok, found, dismissed, inConsent, error }
//   { action: "inspect",  url, steps?, viewport? }       -> { ok, shot, vw, vh, elements[], note? }
//   { action: "test",     url, steps, viewport? }        -> { ok, dismissed, failedStep?, before, after }
//
// steps = [{ selector }] clicks replayed in order before inspecting / testing.
// Called only by Cookie Yeti edge functions (render-banner, validate-pattern, cy-autofix,
// cy-guide, cy-render-health). The key is checked against Vault through an RPC, so no
// secret lives on Vercel. Fixed actions only: callers never send code to run.

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { AsyncLocalStorage } from "node:async_hooks";
const config = { maxDuration: 75 };
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://rcqfqhguwpmaarseifqg.supabase.co";
const SUPABASE_ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "sb_publishable_K8JVbZUyPt3jUPEHIADBAA_fNzJ0Iqw";
const ENGINE = "vercel-chromium";
const DESKTOP = {
  viewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
};
const PHONE = {
  viewport: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"
};
let keyOkUntil = 0;
let keyOkHash = "";
async function sha(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Buffer.from(buf).toString("hex");
}
async function keyValid(key) {
  if (!key || key.length < 32) return false;
  const h = await sha(key);
  if (h === keyOkHash && Date.now() < keyOkUntil) return true;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cy_render_key_ok`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON, ...(SUPABASE_ANON.startsWith("sb_") ? {} : { Authorization: `Bearer ${SUPABASE_ANON}` }), "Content-Type": "application/json" },
    body: JSON.stringify({ p_key: key }),
    signal: AbortSignal.timeout(6e3)
  }).catch(() => null);
  if (!res || !res.ok) return false;
  const ok = await res.json() === true;
  if (ok) {
    keyOkHash = h;
    keyOkUntil = Date.now() + 10 * 6e4;
  }
  return ok;
}
function safeUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) || host.includes(":")) return null;
    return u.toString();
  } catch {
    return null;
  }
}
// Chromium is the only memory hog here: ~400 MB each. One Vercel instance can serve several requests at
// once, so cap browsers per instance and make extra callers wait briefly (or get a fast JSON "busy").
const MAX_BROWSERS = 2;
const SLOT_WAIT_MS = 20e3;
let activeBrowsers = 0;
const slotWaiters = [];
function takeSlot(maxWaitMs) {
  if (activeBrowsers < MAX_BROWSERS) {
    activeBrowsers++;
    return Promise.resolve(releaseSlot());
  }
  return new Promise((resolve, reject) => {
    const w = { resolve, timer: null };
    w.timer = setTimeout(() => {
      const i = slotWaiters.indexOf(w);
      if (i >= 0) slotWaiters.splice(i, 1);
      reject(Object.assign(new Error("busy"), { busy: true }));
    }, maxWaitMs);
    slotWaiters.push(w);
  });
}
function releaseSlot() {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const next = slotWaiters.shift();
    if (next) {
      clearTimeout(next.timer);
      next.resolve(releaseSlot()); // the slot passes straight to the next waiter
    } else {
      activeBrowsers = Math.max(0, activeBrowsers - 1);
    }
  };
}
// A wedged Chromium ignores browser.close(); SIGKILL cannot be ignored, and it makes every pending
// puppeteer call reject (disconnected) instead of hanging until the platform kills the function.
function hardKill(browser) {
  if (!browser) return;
  try {
    browser.process()?.kill("SIGKILL");
  } catch {
  }
  browser.close().catch(() => {
  });
}
async function withPage(fn, opts = {}) {
  const profile = opts.phone ? PHONE : DESKTOP;
  const viewport = opts.height ? { ...profile.viewport, height: opts.height } : profile.viewport;
  const c = clock.getStore();
  const release = await takeSlot(Math.max(1e3, Math.min(SLOT_WAIT_MS, left() - 20e3)));
  let browser = null;
  let finished = false;
  let deadlineTimer = null;
  try {
    // Hard deadline: whatever is hung (launch, a click, a screenshot), we stop at KILL_MS and answer.
    const deadline = new Promise((_, rej) => {
      deadlineTimer = setTimeout(() => {
        if (c) c.killed = true;
        hardKill(browser);
        rej(new Error("render deadline"));
      }, c ? Math.max(1e3, c.start + KILL_MS - Date.now()) : KILL_MS);
    });
    const work = (async () => {
      const b = await puppeteer.launch({
        args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
        defaultViewport: viewport,
        executablePath: await chromium.executablePath(),
        headless: "shell",
        timeout: 20e3,
        protocolTimeout: 20e3
      });
      browser = b;
      if (finished) {
        hardKill(b); // launch finished after we already gave up
        throw new Error("render deadline");
      }
      const page = await b.newPage();
      page.setDefaultTimeout(15e3);
      // An alert()/confirm()/beforeunload dialog freezes every later evaluate() call on the page.
      page.on("dialog", (d) => {
        d.dismiss().catch(() => {
        });
      });
      await page.setUserAgent(profile.ua);
      // Sites with looping animations (bestly.tech's own homepage) peg a serverless CPU so hard that
      // screenshots never come back. Most honor reduced motion; the screenshot fallback pauses the rest.
      await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]).catch(() => {
      });
      await page.setRequestInterception(true);
      page.on("request", (r) => {
        const t = r.resourceType();
        if (t === "media" || t === "font" || t === "image" && !opts.images || heavyHost(r.url())) r.abort().catch(() => {
        });
        else r.continue().catch(() => {
        });
      });
      return await fn(page);
    })();
    work.catch(() => {
    });
    return await Promise.race([work, deadline]);
  } finally {
    finished = true;
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (browser) {
      // close() can hang on a wedged browser: give it 3 s, then kill the process outright.
      await Promise.race([browser.close().catch(() => {
      }), sleep(3e3)]);
      hardKill(browser);
    }
    release();
  }
}
async function load(page, url) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: cap(2e4) });
  } catch (e) {
    // A slow page that has started rendering is still worth a look; anything else is a real failure.
    if (!/timeout/i.test(String(e))) throw e;
    markSlow();
    const hasBody = await within(page.evaluate(() => !!document.body && document.body.childElementCount > 0), 5e3, "evaluate").catch(() => false);
    if (!hasBody) throw new Error("The site didn't load in 20 seconds.");
  }
  await page.waitForNetworkIdle({ idleTime: 600, timeout: cap(8e3) }).catch(() => {
  });
  await napFor(2e3);
}
const visible = (sel) => {
  const el = document.querySelector(sel);
  return { exists: !!el, vis: !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)) };
};
const inConsentBanner = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const KEY = /cookie|consent|gdpr|ccpa|onetrust|optanon|didomi|cookiebot|cybot|usercentrics|truste-|trustarc|quantcast|qc-cmp|sp_message|sourcepoint|osano|iubenda|(^|[^a-z])cky-|cmplz|complianz|termly|klaro|(^|[^a-z])ketch|borlabs|axeptio|tarteaucitron|guce-/i;
  const TEXT = /(we|site|website|this site|our partners)\s+(and our partners\s+)?uses?\s+cookies|cookies? (to|for|help|and similar)|(accept|reject|allow|decline)( all)? cookies|necessary cookies|cookie (settings|preferences|choices)|manage (cookies|consent|preferences)|your consent|consent to|datenschutz|einwilligung|tracking technolog|your privacy choices|we value your privacy/i;
  let container = null;
  for (let a = el; a && a !== document.body; a = a.parentElement) {
    const idc = `${a.id} ${typeof a.className === "string" ? a.className : ""} ${a.getAttribute("aria-label") || ""} ${a.getAttribute("data-testid") || ""}`;
    if (KEY.test(idc)) return true;
    const cs = getComputedStyle(a);
    if (!container && (cs.position === "fixed" || a.getAttribute("role") === "dialog" || a.getAttribute("role") === "alertdialog" || a.tagName === "DIALOG" || a.getAttribute("aria-modal") === "true")) container = a;
  }
  return !!container && TEXT.test((container.innerText || "").slice(0, 4e3));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Time budget. Every Supabase caller gives up after 55-58 s, so we answer before that: every wait is
// clamped to what's left of a per-request budget, and at KILL_MS the browser is killed and a plain
// JSON error goes back. (Before 2026-10-29 this was 80/106 s against a 120 s platform limit, and a
// wedged Chromium still ran into the limit: 240 "Task timed out" errors in 7 days.)
const BUDGET_MS = 48e3;
const KILL_MS = 52e3;
const clock = new AsyncLocalStorage();
const left = () => {
  const c = clock.getStore();
  return c ? c.end - Date.now() : Infinity;
};
const cap = (ms) => Math.max(1, Math.min(ms, left()));
const napFor = (ms) => sleep(Math.max(0, Math.min(ms, left())));
const markSlow = () => {
  const c = clock.getStore();
  if (c) c.slow = true;
};
// A page whose main thread is pegged can hang evaluate/screenshot forever; give up instead.
const within = (p, ms, what) => {
  let t;
  const timer = new Promise((_, rej) => {
    t = setTimeout(() => rej(new Error(`${what} timeout`)), Math.max(1500, Math.min(ms, left() + 8e3)));
  });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
};
// Ads, analytics and video players make pages slow and never hold the cookie banner.
const HEAVY = /(^|\.)(doubleclick\.net|googlesyndication\.com|googleadservices\.com|adservice\.google\.[a-z.]+|google-analytics\.com|googletagservices\.com|amazon-adsystem\.com|adnxs\.com|criteo\.(com|net)|taboola\.com|outbrain\.com|scorecardresearch\.com|quantserve\.com|hotjar\.com|clarity\.ms|facebook\.net|analytics\.tiktok\.com|snap\.licdn\.com|ads\.linkedin\.com|bat\.bing\.com|pubmatic\.com|rubiconproject\.com|openx\.net|casalemedia\.com|moatads\.com|adsrvr\.org|yieldmo\.com|teads\.tv|jwplayer\.com|jwpcdn\.com|brightcove\.net|vimeocdn\.com|ytimg\.com|newrelic\.com|nr-data\.net|segment\.(io|com)|mixpanel\.com|fullstory\.com|chartbeat\.(com|net)|parsely\.com|permutive\.(com|app)|media\.net|sharethrough\.com|indexww\.com|3lift\.com|smartadserver\.com|adform\.net|bidswitch\.net|lijit\.com|sovrn\.com|gumgum\.com|kargo\.com|zemanta\.com|mgid\.com|revcontent\.com)$/i;
const heavyHost = (u) => {
  try {
    return HEAVY.test(new URL(u).hostname);
  } catch {
    return false;
  }
};
async function settledEval(page, fn, ...args) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      return await within(page.evaluate(fn, ...args), 15e3, "evaluate");
    } catch (e) {
      last = e;
      if (!/context was destroyed|navigation|detached/i.test(String(e))) throw e;
      if (left() < 2e3) throw e;
      await page.waitForNetworkIdle({ idleTime: 600, timeout: cap(6e3) }).catch(() => {
      });
      await napFor(1500);
    }
  }
  throw last;
}
const consentVisible = () => {
  const KEY = /cookie|consent|gdpr|onetrust|didomi|usercentrics|truste|cmp|privacy-?(banner|notice|center)|sp_message|qc-cmp/i;
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const idc = `${el.id} ${typeof el.className === "string" ? el.className : ""}`;
    if (!KEY.test(idc)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 120 || r.height < 40) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) continue;
    if (r.bottom > 0 && r.top < window.innerHeight) return true;
  }
  return false;
};
async function waitForConsent(page, ms) {
  const until = Date.now() + Math.min(ms, Math.max(0, left() - 6e3));
  while (Date.now() < until) {
    if (await settledEval(page, consentVisible).catch(() => false)) {
      await sleep(600);
      return true;
    }
    await sleep(500);
  }
  return false;
}
const collectElements = (maxN) => {
  const KEY = /cookie|consent|privacy|gdpr|ccpa|tracking|datenschutz|cmp|onetrust|didomi|usercentrics|truste|notice|banner/i;
  const vw = window.innerWidth, vh = window.innerHeight;
  const esc = (s) => window.CSS.escape(s);
  const uniq = (s) => {
    try {
      return document.querySelectorAll(s).length === 1;
    } catch {
      return false;
    }
  };
  const unstable = (s) => /\d{5,}|[a-f0-9]{8,}|^(css|sc|jsx|emotion|svelte)-/i.test(s);
  const selectorFor = (el) => {
    const tag = el.tagName.toLowerCase();
    if (el.id && !unstable(el.id) && uniq("#" + esc(el.id))) return "#" + esc(el.id);
    for (const a of ["data-testid", "data-test", "data-cy", "data-action", "data-tracking-opt-in-reject", "aria-label", "name", "title", "value"]) {
      const v = el.getAttribute(a);
      if (v && v.length < 80 && !unstable(v)) {
        const s2 = `${tag}[${a}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
        if (uniq(s2)) return s2;
      }
    }
    const cls = Array.from(el.classList).filter((c) => !unstable(c) && c.length < 40).slice(0, 3);
    if (cls.length) {
      const s2 = tag + cls.map((c) => "." + esc(c)).join("");
      if (uniq(s2)) return s2;
    }
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      if (cur !== el && cur.id && !unstable(cur.id)) {
        parts.unshift("#" + esc(cur.id));
        break;
      }
      let part = cur.tagName.toLowerCase();
      const parent = cur.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter((x) => x.tagName === cur.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(cur) + 1})`;
      }
      parts.unshift(part);
      const s2 = parts.join(" > ");
      if (parts.length > 1 && uniq(s2)) return s2;
      cur = parent;
    }
    const s = parts.join(" > ");
    return s && uniq(s) ? s : null;
  };
  const q = 'button, a[href], a[role="button"], [role="button"], [role="link"], input[type="button"], input[type="submit"], [onclick], [tabindex="0"]';
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const el of Array.from(document.querySelectorAll(q))) {
    const r = el.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) continue;
    const offscreen = r.bottom <= 0 || r.right <= 0 || r.top >= vh || r.left >= vw;
    if (el.tagName !== "BUTTON" && el.querySelector(q)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;
    if (!offscreen) {
      const cx = Math.min(vw - 1, Math.max(0, r.left + r.width / 2));
      const cy = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(cx, cy);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) continue;
    }
    const text = (el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim().replace(/\s+/g, " ").slice(0, 60);
    if (!text && r.width > 64) continue;
    const selector = selectorFor(el);
    if (!selector || seen.has(selector)) continue;
    seen.add(selector);
    let likely = false;
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const idc = `${a.id} ${typeof a.className === "string" ? a.className : ""} ${a.getAttribute("aria-label") || ""} ${a.getAttribute("role") || ""}`;
      if (KEY.test(idc)) {
        likely = true;
        break;
      }
      const pos = getComputedStyle(a).position;
      if (pos === "fixed" || pos === "sticky" || a.getAttribute("role") === "dialog" || a.tagName === "DIALOG") {
        if (/cookie|consent|gdpr|datenschutz|einwilligung|rgpd/i.test((a.innerText || "").slice(0, 3e3))) likely = true;
        break;
      }
    }
    if (offscreen && !likely) continue;
    out.push({ selector, text, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), likely, offscreen });
  }
  out.sort((a, b) => Number(b.likely) - Number(a.likely));
  const frames = Array.from(document.querySelectorAll("iframe")).map((f) => f.src || "").filter((s) => /consent|cmp|privacy|cookie|sourcepoint|privacy-mgmt|trustarc|didomi/i.test(s));
  const shadow = Array.from(document.querySelectorAll("*")).some((e) => e.shadowRoot && KEY.test(e.tagName + " " + e.id));
  return { elements: out.slice(0, maxN), vw, vh, frames: frames.slice(0, 3), shadow };
};
const markRoot = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  let root = el;
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.position === "fixed" || cs.position === "sticky" || a.getAttribute("role") === "dialog" || a.tagName === "DIALOG" || Number(cs.zIndex) >= 100) root = a;
  }
  const w = window;
  (w.__cyRoots ||= []).push(root);
  return true;
};
const rootsGone = () => {
  const roots = window.__cyRoots || [];
  return roots.length > 0 && roots.every((r) => {
    if (!r.isConnected) return true;
    const cs = getComputedStyle(r);
    return cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0 || !(r.offsetWidth || r.offsetHeight || r.getClientRects().length);
  });
};
async function clickStep(page, selector) {
  await page.waitForSelector(selector, { visible: true, timeout: cap(7e3) });
  await settledEval(page, markRoot, selector).catch(() => false);
  try {
    await page.click(selector);
  } catch {
    await page.evaluate((s) => document.querySelector(s)?.click(), selector);
  }
  await page.waitForNetworkIdle({ idleTime: 400, timeout: cap(3e3) }).catch(() => {
  });
  await napFor(1200);
}
async function replay(page, steps) {
  for (let i = 0; i < steps.length; i++) {
    if (left() < 4e3) {
      markSlow();
      return i;
    }
    try {
      await clickStep(page, steps[i].selector);
    } catch {
      return i;
    }
  }
  return null;
}
const shot = async (page) => {
  try {
    return await within(page.screenshot({ type: "jpeg", quality: 55, encoding: "base64", captureBeyondViewport: false }), 12e3, "screenshot");
  } catch {
    // Freeze CSS/Web animations and grab the last painted frame instead of waiting for a fresh one.
    const cdp = await page.createCDPSession();
    try {
      await within(cdp.send("Emulation.setScriptExecutionDisabled", { value: true }), 3e3, "pause").catch(() => {
      });
      await within(cdp.send("Animation.enable").then(() => cdp.send("Animation.setPlaybackRate", { playbackRate: 0 })), 3e3, "pause").catch(() => {
      });
      const out = await within(cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 50, optimizeForSpeed: true }), 12e3, "screenshot");
      return out.data;
    } finally {
      await cdp.detach().catch(() => {
      });
    }
  }
};
function cleanSteps(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > 6) return null;
  const out = [];
  for (const s of raw) {
    const selector = String(s?.selector ?? "");
    if (!selector || selector.length > 500) return null;
    out.push({ selector });
  }
  return out;
}
async function inner(req, res, c) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  const key = String(req.headers["x-render-key"] || "");
  if (!await keyValid(key)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const action = body.action;
  if (action === "ping") return res.status(200).json({ ok: true, engine: ENGINE });
  if (action === "selftest") {
    // Real Chromium launch + render of an inline page, no network. Used by cy-render-health's watchdog:
    // "ping" only proves the function answers, this proves the browser itself still starts and renders.
    try {
      const out = await withPage(async (page) => {
        await page.setContent("<title>cy-selftest</title><p id=a>ok</p>", { waitUntil: "domcontentloaded", timeout: cap(1e4) });
        return { title: await within(page.title(), 5e3, "title") };
      });
      return res.status(200).json({ ok: out.title === "cy-selftest", engine: ENGINE, selftest: true });
    } catch (e) {
      if (e?.busy) return res.status(503).json({ ok: false, engine: ENGINE, busy: true, error: "The robot browser is busy right now. Try again in a minute." });
      return res.status(502).json({ ok: false, engine: ENGINE, selftest: true, error: String(e?.message || e).slice(0, 200) });
    }
  }
  const url = safeUrl(body.url);
  if (!url) return res.status(400).json({ ok: false, error: "Bad url" });
  const phone = body.viewport === "phone";
  const height = Number.isFinite(Number(body.height)) ? Math.round(Math.min(1600, Math.max(560, Number(body.height)))) : void 0;
  try {
    if (action === "content") {
      const out = await withPage(async (page) => {
        await load(page, url);
        return { html: await page.content(), finalUrl: page.url() };
      });
      return res.status(200).json({ ok: true, engine: ENGINE, ...out, slow: c.slow });
    }
    if (action === "validate") {
      const selector = String(body.selector || "");
      if (!selector || selector.length > 500) return res.status(400).json({ ok: false, error: "Bad selector" });
      const out = await withPage(async (page) => {
        const r = { found: false, dismissed: false, inConsent: false, error: null };
        try {
          await load(page, url);
          await waitForConsent(page, 7e3);
          const before = await settledEval(page, visible, selector);
          r.found = before.exists;
          if (!before.exists) return r;
          r.inConsent = await settledEval(page, inConsentBanner, selector).catch(() => false);
          let clicked = false;
          try {
            await within(page.click(selector), 8e3, "click");
            clicked = true;
          } catch {
          }
          if (!clicked) {
            await within(page.evaluate((s) => document.querySelector(s)?.click(), selector), 5e3, "evaluate").catch(() => {
            });
          }
          await napFor(1800);
          const after = await within(page.evaluate(visible, selector), 8e3, "evaluate").catch(() => ({ exists: false, vis: false }));
          r.dismissed = !after.exists || !after.vis;
        } catch (e) {
          r.error = String(e).slice(0, 200);
        }
        return r;
      });
      return res.status(200).json({ ok: true, engine: ENGINE, ...out, slow: c.slow });
    }
    if (action === "inspect") {
      const steps = cleanSteps(body.steps);
      if (!steps) return res.status(400).json({ ok: false, error: "Bad steps" });
      const out = await withPage(async (page) => {
        await load(page, url);
        if (!steps.length) await waitForConsent(page, 7e3);
        const failedStep = await replay(page, steps);
        if (failedStep !== null) {
          return { failedStep, shot: await shot(page), vw: page.viewport().width, vh: page.viewport().height, elements: [] };
        }
        const found = await settledEval(page, collectElements, 80);
        return { failedStep: null, shot: await shot(page), finalUrl: page.url(), ...found };
      }, { phone, images: true, height });
      return res.status(200).json({ ok: true, engine: ENGINE, ...out, slow: c.slow });
    }
    if (action === "test") {
      const steps = cleanSteps(body.steps);
      if (!steps || steps.length === 0) return res.status(400).json({ ok: false, error: "Bad steps" });
      const out = await withPage(async (page) => {
        await load(page, url);
        await waitForConsent(page, 7e3);
        const before = await shot(page);
        const failedStep = await replay(page, steps);
        await sleep(800);
        const dismissed = failedStep === null ? await settledEval(page, rootsGone).catch(() => true) : false;
        return { dismissed, failedStep, before, after: await shot(page) };
      }, { phone, images: true, height });
      return res.status(200).json({ ok: true, engine: ENGINE, ...out, slow: c.slow });
    }
    return res.status(400).json({ ok: false, error: "Unknown action" });
  } catch (e) {
    if (e?.busy) {
      return res.status(503).json({ ok: false, engine: ENGINE, busy: true, error: "The robot browser is busy with other pages right now. Try again in a minute." });
    }
    if (c.killed) {
      return res.status(504).json({ ok: false, engine: ENGINE, slow: true, error: "That site took too long for the robot browser (over 50 seconds). Try again, or try the phone view." });
    }
    const msg = String(e?.message || e);
    if (/didn't load|timeout/i.test(msg)) {
      return res.status(504).json({ ok: false, engine: ENGINE, slow: true, error: "That site didn't load in time for the robot browser. Try again in a minute." });
    }
    return res.status(502).json({ ok: false, engine: ENGINE, error: msg.slice(0, 300) });
  }
}
async function handler(req, res) {
  const start = Date.now();
  const c = { start, end: start + BUDGET_MS, killed: false, slow: false };
  const status = res.status.bind(res);
  let code = 200;
  res.status = (n) => {
    code = n;
    return status(n);
  };
  // Last-resort guard: if anything outside the browser ever hangs, still answer before callers give up.
  const guard = setTimeout(() => {
    if (res.headersSent) return;
    c.killed = true;
    res.status(504).json({ ok: false, engine: ENGINE, slow: true, error: "The robot browser took too long. Try again in a minute." });
  }, KILL_MS + 4e3);
  try {
    return await clock.run(c, () => inner(req, res, c));
  } finally {
    clearTimeout(guard);
    const b = req.body && typeof req.body === "object" ? req.body : {};
    let host = "";
    try {
      host = new URL(String(b.url)).hostname;
    } catch {
    }
    if (b.action !== "ping") {
      console.log(JSON.stringify({ cyRender: b.action, host, browsers: activeBrowsers, viewport: b.viewport || "desktop", steps: Array.isArray(b.steps) ? b.steps.length : 0, code, ms: Date.now() - start, slow: c.slow, killed: c.killed }));
    }
  }
}
export {
  config,
  handler as default
};
