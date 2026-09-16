// Cookie Yeti — self-hosted render engine (replaces the paid Browserless dependency).
//
// POST /api/cy-render   header x-render-key: <key from Supabase Vault "cy_render_key">
//   { action: "ping" }                         -> { ok: true, engine }
//   { action: "content",  url }                -> { ok, html, finalUrl }
//   { action: "validate", url, selector }      -> { ok, found, dismissed, error }
//
// Called only by the render-banner, validate-pattern and cy-render-health edge
// functions. The key is checked against Vault through an RPC, so no secret has to
// be configured on Vercel. Fixed actions only: callers never send code to run.

import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
const config = { maxDuration: 60 };
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://rcqfqhguwpmaarseifqg.supabase.co";
const SUPABASE_ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJjcWZxaGd1d3BtYWFyc2VpZnFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUzNTc1OTUsImV4cCI6MjA5MDkzMzU5NX0.MHwsTd3CmaTViv3HoFRbeF1t6hmlf5W-p_4eHFBQP9k";
const ENGINE = "vercel-chromium";
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
async function withPage(fn) {
  const browser = await puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    defaultViewport: { width: 1366, height: 900 },
    executablePath: await chromium.executablePath(),
    headless: "shell"
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
    );
    await page.setRequestInterception(true);
    page.on("request", (r) => {
      const t = r.resourceType();
      if (t === "image" || t === "media" || t === "font") r.abort().catch(() => {
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
          await new Promise((res2) => setTimeout(res2, 1800));
          const after = await page.evaluate(visible, selector).catch(() => ({ exists: false, vis: false }));
          r.dismissed = !after.exists || !after.vis;
        } catch (e) {
          r.error = String(e).slice(0, 200);
        }
        return r;
      });
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
