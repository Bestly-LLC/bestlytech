// Cookie Yeti — self-hosted render engine (replaces the paid Browserless dependency).
//
// POST /api/cy-render   header x-render-key: <key from Supabase Vault "cy_render_key">
//   { action: "ping" }                                   -> { ok: true, engine }
//   { action: "content",  url }                          -> { ok, html, finalUrl }
//   { action: "validate", url, selector }                -> { ok, found, dismissed, error }
//   { action: "inspect",  url, steps?, viewport? }       -> { ok, shot, vw, vh, elements[], note? }
//   { action: "test",     url, steps, viewport? }        -> { ok, dismissed, failedStep?, before, after }
//
// steps = [{ selector }] clicks replayed in order before inspecting / testing.
// Called only by Cookie Yeti edge functions (render-banner, validate-pattern, cy-autofix,
// cy-guide, cy-render-health). The key is checked against Vault through an RPC, so no
// secret lives on Vercel. Fixed actions only: callers never send code to run.

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
const config = { maxDuration: 60 };
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://rcqfqhguwpmaarseifqg.supabase.co";
const SUPABASE_ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjcWZxaGd1d3BtYWFyc2VpZnFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNTc1OTUsImV4cCI6MjA5MDkzMzU5NX0.MHwsTd3CmaTViv3HoFRbeF1t6hmlf5W-p_4eHFBQP9k";
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
    headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_key: key })
  });
  if (!res.ok) return false;
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
async function withPage(fn, opts = {}) {
  const profile = opts.phone ? PHONE : DESKTOP;
  const viewport = opts.height ? { ...profile.viewport, height: opts.height } : profile.viewport;
  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    defaultViewport: viewport,
    executablePath: await chromium.executablePath(),
    headless: "shell"
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(profile.ua);
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const t = r.resourceType();
      if (t === "media" || t === "font" || t === "image" && !opts.images) r.abort().catch(() => {
      });
      else r.continue().catch(() => {
      });
    });
    return await fn(page);
  } finally {
    await browser.close().catch(() => {
    });
  }
}
async function load(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 2e4 });
  await page.waitForNetworkIdle({ idleTime: 600, timeout: 8e3 }).catch(() => {
  });
  await new Promise((r) => setTimeout(r, 2e3));
}
const visible = (sel) => {
  const el = document.querySelector(sel);
  return { exists: !!el, vis: !!(el && (el.offsetWidth || el.offsetHeight || el.getClientRects().length)) };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function settledEval(page, fn, ...args) {
  let last;
  for (let i = 0; i < 3; i++) {
    try {
      return await page.evaluate(fn, ...args);
    } catch (e) {
      last = e;
      if (!/context was destroyed|navigation|detached/i.test(String(e))) throw e;
      await page.waitForNetworkIdle({ idleTime: 600, timeout: 6e3 }).catch(() => {
      });
      await sleep(1500);
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
  const until = Date.now() + ms;
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
  await page.waitForSelector(selector, { visible: true, timeout: 7e3 });
  await settledEval(page, markRoot, selector).catch(() => false);
  try {
    await page.click(selector);
  } catch {
    await page.evaluate((s) => document.querySelector(s)?.click(), selector);
  }
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 3e3 }).catch(() => {
  });
  await sleep(1200);
}
async function replay(page, steps) {
  for (let i = 0; i < steps.length; i++) {
    try {
      await clickStep(page, steps[i].selector);
    } catch {
      return i;
    }
  }
  return null;
}
const shot = (page) => page.screenshot({ type: "jpeg", quality: 55, encoding: "base64", captureBeyondViewport: false });
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
async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  const key = String(req.headers["x-render-key"] || "");
  if (!await keyValid(key)) return res.status(401).json({ ok: false, error: "Unauthorized" });
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  const action = body.action;
  if (action === "ping") return res.status(200).json({ ok: true, engine: ENGINE });
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
      return res.status(200).json({ ok: true, engine: ENGINE, ...out });
    }
    if (action === "validate") {
      const selector = String(body.selector || "");
      if (!selector || selector.length > 500) return res.status(400).json({ ok: false, error: "Bad selector" });
      const out = await withPage(async (page) => {
        const r = { found: false, dismissed: false, error: null };
        try {
          await load(page, url);
          const before = await page.evaluate(visible, selector);
          r.found = before.exists;
          if (!before.exists) return r;
          let clicked = false;
          try {
            await page.click(selector);
            clicked = true;
          } catch {
          }
          if (!clicked) {
            await page.evaluate((s) => document.querySelector(s)?.click(), selector).catch(() => {
            });
          }
          await sleep(1800);
          const after = await page.evaluate(visible, selector).catch(() => ({ exists: false, vis: false }));
          r.dismissed = !after.exists || !after.vis;
        } catch (e) {
          r.error = String(e).slice(0, 200);
        }
        return r;
      });
      return res.status(200).json({ ok: true, engine: ENGINE, ...out });
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
      return res.status(200).json({ ok: true, engine: ENGINE, ...out });
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
      return res.status(200).json({ ok: true, engine: ENGINE, ...out });
    }
    return res.status(400).json({ ok: false, error: "Unknown action" });
  } catch (e) {
    return res.status(502).json({ ok: false, engine: ENGINE, error: String(e).slice(0, 300) });
  }
}
export {
  config,
  handler as default
};
