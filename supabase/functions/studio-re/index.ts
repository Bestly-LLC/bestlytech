// studio-re — Bestly Studio for Real Estate, the door and the board's backend (v2 of studio-start).
// POST JSON only. verify_jwt = false: a stranger has no account; the session token IS the credential.
// Contract: /home/claude/studio-re/CONTRACT.md. Every authenticated call carries { token } in the body.
//
//   plans · link · verify · resume · save · ai · upload_url · listing_save · listing_list · queue · decide ·
//   video_make · connect_start · connect_status · checkout · billing · portal · passkey_options · passkey_save ·
//   passkey_login_options · passkey_login · originals · forget · networks · wait · sweep (cron, x-sweep-key)
//
// 2026-11-05: serves every business, not just real estate. studio_signups.vertical = 'general' | 'real-estate'.
// Connect comes BEFORE the card: connect_start makes an inactive pre-client (studio_ensure_client) so the
// account can be linked; checkout refuses until one account on an open network (studio_networks) is connected.
//
// Tokens: 32 random bytes, only the sha256 is stored (studio_signups.token_hash), 30-day sliding expiry,
// a fresh one is minted on verify and passkey_login. Server-owned state lives in columns, never in answers.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { planPayload, PLANS, TRIAL_DAYS } from "../_shared/studio-plans.ts";
import { createCheckout, createPortal, extraVideoPrice, stripeKey, type Cadence, type PlanId } from "../_shared/studio-billing.ts";
import { extractZipImage, listZipImages, sniffImage, ZIP_MAX_BYTES } from "../_shared/zip-images.ts";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@13.1.1";

/* ── environment ───────────────────────────────────────────────────────── */
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB_URL, SB_SECRET, { auth: { persistSession: false } });

const APP = "https://studio.bestly.tech";
// 2026-11-05: the sign-up and the self-serve board live on the public site, right under the Studio page
// (bestly.tech/studio/start, bestly.tech/studio/me). Passkeys use rpID bestly.tech so they work on both hosts
// (no self-serve passkey existed before this change).
const SITE = "https://www.bestly.tech/studio";
const RP_ID = "bestly.tech";
const ORIGINS = [APP, "https://www.bestly.tech", "https://bestly.tech"];
// Browsers may call us from the app, the board host, localhost (tests), and any exact https origin named in
// STUDIO_RE_EXTRA_ORIGINS (e.g. a Vercel preview). Never "*".
const ALLOWED_ORIGINS = new Set<string>([APP, "https://review.bestly.tech", "https://www.bestly.tech", "https://bestly.tech",
  ...(Deno.env.get("STUDIO_RE_EXTRA_ORIGINS") ?? "").split(",").map((x) => x.trim()).filter((x) => /^https:\/\/[a-z0-9.-]+$/i.test(x))]);
const LOCAL_ORIGIN = /^http:\/\/localhost(:\d{1,5})?$/;
const originOk = (o: string) => ALLOWED_ORIGINS.has(o) || LOCAL_ORIGIN.test(o);
function corsFor(req: Request): Record<string, string> {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": o && originOk(o) ? o : APP,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "600",
  };
}
const FROM = "Bestly Studio <studio@bestly.tech>";
const LINK_MINUTES = 15;
const TOKEN_DAYS = 30;
const BUCKET = "re-uploads";
const DISCLOSURE = "AI-animated from listing photos. Camera movement is simulated; no video was filmed. Property is unchanged.";
const MAX_BODY = 256 * 1024;
const MAX_ANSWERS = 64 * 1024;

// CORS headers are added once, per request, by the wrapper at the bottom (see corsFor).
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const E = (error: string, message: string, status = 200, extra: Record<string, unknown> = {}) => J({ ok: false, error, message, ...extra }, status);

/* ── helpers ───────────────────────────────────────────────────────────── */
const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/;
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
function rndHex(n = 32): string { const b = new Uint8Array(n); crypto.getRandomValues(b); return hex(b); }
async function sha256hex(s: string): Promise<string> { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))); }
const CODE_ALPHA = "23456789abcdefghjkmnpqrstuvwxyz"; // no 0/o/1/i/l
function rndCode(len: number): string { const b = new Uint8Array(len); crypto.getRandomValues(b); return [...b].map((x) => CODE_ALPHA[x % CODE_ALPHA.length]).join(""); }
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function b64u(buf: Uint8Array): string { let s = ""; for (const x of buf) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function unb64u(s: string): Uint8Array { const p = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4); const bin = atob(p); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
function clientIp(req: Request): string {
  // cf-connecting-ip is set by the edge in front of us and cannot be forged by the caller; X-Forwarded-For can.
  return (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown").trim().slice(0, 64);
}
/** true = allowed. If the limiter itself is down: sign-in and email actions fail CLOSED (closed=true), the rest fail open (logged). */
async function allow(key: string, limit: number, windowS: number, closed = false): Promise<boolean> {
  const { data, error } = await db.rpc("studio_rate_hit", { p_key: key, p_limit: limit, p_window_s: windowS });
  if (error) { console.error("rate", error.message); return !closed; }
  return data === true;
}
async function readCapped(req: Request, max: number): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) { try { await reader.cancel(); } catch { /* ignore */ } return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(n); let off = 0; for (const c of chunks) { all.set(c, off); off += c.length; }
  return new TextDecoder().decode(all);
}
const RATE_MSG = "Too many tries. Wait a few minutes and try again.";

/** Clamp anything a stranger sends: depth, string length, array length. */
function clamp(v: unknown, depth = 0): unknown {
  if (v === null || typeof v === "boolean" || typeof v === "number") return v;
  if (typeof v === "string") return v.slice(0, 2000);
  if (depth > 6) return null;
  if (Array.isArray(v)) return v.slice(0, 100).map((x) => clamp(x, depth + 1));
  if (typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 60)) { if (k === "__proto__" || k === "constructor" || k === "prototype") continue; o[k.slice(0, 60)] = clamp(x, depth + 1); }
    return o;
  }
  return null;
}
const PATCH_KEYS = new Set(["about", "brand", "voice", "rules", "content", "cadence", "style", "legal"]);
function cleanAnswers(a: any): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a ?? {})) if (!k.startsWith("_")) o[k] = v;
  return o;
}

/* ── session ───────────────────────────────────────────────────────────── */
async function signupFromToken(t: unknown): Promise<any | null> {
  const tok = String(t ?? "");
  if (!/^[0-9a-f]{64}$/.test(tok)) return null;
  const { data } = await db.from("studio_signups").select("*").eq("token_hash", await sha256hex(tok)).maybeSingle();
  if (!data) return null;
  const exp = data.token_expires_at ? new Date(data.token_expires_at).getTime() : 0;
  if (exp < Date.now()) return null;
  // sliding expiry, written at most once an hour
  if (exp - Date.now() < (TOKEN_DAYS * 24 - 1) * 3600_000) {
    await db.from("studio_signups").update({
      token_expires_at: new Date(Date.now() + TOKEN_DAYS * 86400_000).toISOString(),
      last_seen_at: new Date().toISOString(),
    }).eq("id", data.id);
  }
  return data;
}
async function mintSession(signupId: string): Promise<string> {
  const tok = rndHex(32);
  await db.from("studio_signups").update({
    token_hash: await sha256hex(tok),
    token_expires_at: new Date(Date.now() + TOKEN_DAYS * 86400_000).toISOString(),
    token_rotated_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  }).eq("id", signupId);
  return tok;
}

async function clientId(slug: string | null): Promise<string | null> {
  if (!slug) return null;
  const { data } = await db.from("approval_clients").select("id").eq("slug", slug).maybeSingle();
  return data?.id ?? null;
}
async function networks(): Promise<{ id: string; name: string; open: boolean }[]> {
  const { data } = await db.from("studio_networks").select("platform,label,open,sort").order("sort");
  return (data ?? []).map((r: any) => ({ id: r.platform, name: r.label, open: !!r.open }));
}
async function connStatus(signup: any) {
  const out = { instagram: "none", facebook: "none" } as Record<string, string>;
  const cid = await clientId(signup.client_slug ?? signup.pre_client_slug ?? null);
  if (!cid) return out;
  const { data } = await db.from("social_accounts").select("platform,active,access_token").eq("client_id", cid);
  for (const r of data ?? []) if (r.active && r.access_token) out[r.platform] = "connected";
  return out;
}
async function openConnected(signup: any): Promise<number> {
  const [c, n] = await Promise.all([connStatus(signup), networks()]);
  return n.filter((x) => x.open && c[x.id] === "connected").length;
}
async function billingFor(signup: any) {
  const b = { can_post: false, trial_end: null as string | null, videos_left: 0, plan: signup.plan ?? null as string | null };
  if (!signup.client_slug) return b;
  const { data } = await db.rpc("studio_entitlement", { p_slug: signup.client_slug });
  if (data) { b.can_post = !!data.can_post; b.trial_end = data.trial_end ?? null; b.videos_left = Number(data.videos_left ?? 0); b.plan = data.plan ?? b.plan; }
  return b;
}
async function resumePayload(signup: any) {
  const [connections, billing] = await Promise.all([connStatus(signup), billingFor(signup)]);
  return {
    ok: true,
    vertical: signup.vertical ?? "real-estate",
    networks: await networks(),
    step: signup.step_id ?? "intro",
    answers: cleanAnswers(signup.answers),
    email: signup.email,
    rev: signup.rev ?? 0,
    plan: billing.plan ?? signup.plan ?? null,
    client_slug: signup.client_slug ?? null,
    status: signup.status ?? null,
    connections,
    billing,
  };
}

/* ── sweep: run by cron studio-selfserve-sweep (x-sweep-key from Vault) ──── */
async function sweep(req: Request): Promise<Response> {
  // The cron sends the studio_notify_key from Vault; the database compares it, so the key never lives in this code.
  const k = req.headers.get("x-sweep-key") ?? "";
  const chk = k.length >= 20 ? await db.rpc("studio_sweep_key_ok", { p_key: k }) : null;
  if (!chk || chk.error || chk.data !== true) return E("forbidden", "Not allowed.", 403);
  const out = { opened: 0, nudged: 0, failed: 0 };
  // 1. a network opened: tell everyone waiting for it, once
  const { data: waits } = await db.from("studio_network_waits").select("id,email,platform,studio_networks!inner(label,open)").is("notified_at", null).eq("studio_networks.open", true).limit(50);
  for (const w of waits ?? []) {
    const name = (w as any).studio_networks?.label ?? w.platform;
    const link = `${SITE}/start`;
    const text = `Good news: you can now connect ${name} to Bestly Studio.\n\nPick up where you left off:\n${link}\n\nYour 7 days free start when you add a plan.\n\nBestly Studio\nWe make your social media posts. You approve them. We post them.`;
    const ok = await sendMail(w.email, `${name} is open in Bestly Studio`, text, simpleHtml(`${name} is open now`, `You asked us to tell you when ${name} opened. It has. Pick up where you left off.`, link, "Pick up where I left off"));
    if (ok) { await db.from("studio_network_waits").update({ notified_at: new Date().toISOString() }).eq("id", w.id); out.opened++; } else out.failed++;
  }
  // 2. one gentle nudge to people who started, did not finish, and went quiet for a day (never twice, never after 14 days)
  const day = new Date(Date.now() - 24 * 3600_000).toISOString(), fortnight = new Date(Date.now() - 14 * 24 * 3600_000).toISOString();
  const { data: quiet } = await db.from("studio_signups").select("id,email,vertical")
    .eq("status", "linked").is("client_slug", null).is("nudge_sent_at", null)
    .lt("updated_at", day).gt("created_at", fortnight).limit(25);
  for (const s of quiet ?? []) {
    const link = `${SITE}/start${s.vertical === "real-estate" ? "?for=real-estate" : ""}`;
    const text = `You started setting up Bestly Studio and stopped partway. Your answers are saved.\n\nPick up where you left off:\n${link}\n\nWe will not email you about this again.\n\nBestly Studio`;
    const ok = await sendMail(s.email, "Your Bestly Studio setup is saved", text, simpleHtml("Your answers are saved", "You started setting up Bestly Studio and stopped partway. Everything you typed is still there. We will not email you about this again.", link, "Pick up where I left off"));
    await db.from("studio_signups").update({ nudge_sent_at: new Date().toISOString() }).eq("id", s.id);
    if (ok) out.nudged++; else out.failed++;
  }
  return J({ ok: true, ...out });
}
function simpleHtml(title: string, body: string, link: string, cta: string): string {
  const f = "-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#F5F5F7"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F5F7"><tr><td align="center" style="padding:36px 16px 48px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px">
<tr><td style="padding:0 6px 18px;font:600 11px/1.3 ${f};color:#5B6B7A;letter-spacing:.16em;text-transform:uppercase">Bestly Studio</td></tr>
<tr><td style="background:#fff;border-radius:18px;padding:32px 28px;font:400 16px/1.6 ${f};color:#1a1a1a">
<p style="margin:0 0 16px;font:600 21px/1.3 ${f};color:#0C1826">${esc(title)}</p><p style="margin:0 0 24px">${esc(body)}</p>
<p style="margin:0"><a href="${esc(link)}" style="display:inline-block;background:#1F8F82;color:#fff;text-decoration:none;font-weight:600;padding:14px 22px;border-radius:999px">${esc(cta)}</a></p>
</td></tr><tr><td style="padding:18px 8px 0;font:400 13px/1.5 ${f};color:#777">We make your social media posts. You approve them. We post them. <a href="https://www.bestly.tech/studio" style="color:#1F8F82">bestly.tech/studio</a></td></tr>
</table></td></tr></table></body></html>`;
}

/* ── mail ──────────────────────────────────────────────────────────────── */
function emailBody(link: string, vertical = "real-estate"): { text: string; html: string } {
  const text =
`Here is your way into Bestly Studio.

${link}

It works once and it lasts ${LINK_MINUTES} minutes. If it has gone stale, go back to bestly.tech/studio/start and ask for another one.

You are not signing up for anything by opening it. It just puts you back where you left off.

Bestly Studio
${vertical === "real-estate" ? "We turn listing photos into posts, and publish them for you." : "We make your social media posts. You approve them. We post them."}`;
  const f = "-apple-system,BlinkMacSystemFont,'Helvetica Neue',Helvetica,Arial,sans-serif";
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your link</title></head>
<body style="margin:0;padding:0;background:#F5F5F7;-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F5F7"><tr><td align="center" style="padding:36px 16px 48px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px">
  <tr><td style="padding:0 6px 18px;font:600 11px/1.3 ${f};color:#5B6B7A;letter-spacing:.16em;text-transform:uppercase">Bestly Studio</td></tr>
  <tr><td style="background:#fff;border-radius:18px;padding:32px 28px;font:400 16px/1.6 ${f};color:#1a1a1a">
    <p style="margin:0 0 16px;font:600 21px/1.3 ${f};color:#0C1826">Here is your way in</p>
    <p style="margin:0 0 22px">Tap it and you are back where you left off. It works once, and it lasts ${LINK_MINUTES}&nbsp;minutes.</p>
    <p style="margin:0 0 26px"><a href="${esc(link)}" style="display:inline-block;background:#1F8F82;color:#fff;text-decoration:none;font-weight:600;padding:14px 22px;border-radius:999px">Open Bestly Studio</a></p>
    <p style="margin:0 0 8px;color:#555;font-size:14px">Or copy this into your browser:<br><span style="color:#111;word-break:break-all">${esc(link)}</span></p>
  </td></tr>
  <tr><td style="padding:18px 8px 0;font:400 13px/1.5 ${f};color:#777">Stale link? Go back to bestly.tech/studio/start and ask for another. Opening this signs you up for nothing by itself.</td></tr>
</table></td></tr></table></body></html>`;
  return { text, html };
}
async function sendMail(to: string, subject: string, text: string, html: string): Promise<boolean> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) { console.error("studio-re: no RESEND_API_KEY"); return false; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
    });
    if (!r.ok) { console.error("studio-re resend", r.status, (await r.text()).slice(0, 200)); return false; }
    return true;
  } catch (e) { console.error("studio-re resend threw", String(e)); return false; }
}

/* ── SSRF-safe fetch: resolve first, re-check every hop, never follow blindly ── */
function isPrivateIp(ip: string): boolean {
  const x = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (x.includes(":")) {
    if (x === "::1" || x === "::") return true;
    if (/^f[cd]/.test(x)) return true;           // fc00::/7
    if (/^fe[89abcdef]/.test(x)) return true;    // fe80::/10 and the old site-local fec0::/10
    if (x.startsWith("64:ff9b:") || x.startsWith("2002:") || x.startsWith("2001:db8") || x.startsWith("100:")) return true; // NAT64, 6to4, docs, discard
    const m4 = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m4) return isPrivateIp(m4[1]);
    const mh = x.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mh) { const a = parseInt(mh[1], 16), b = parseInt(mh[2], 16); return isPrivateIp(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`); }
    return false;
  }
  const p = x.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0 && p[2] <= 2) || (a === 198 && b === 51 && p[2] === 100) || (a === 203 && b === 0 && p[2] === 113) ||
    (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 198 && (b === 18 || b === 19));
}
const IP4 = /^\d{1,3}(\.\d{1,3}){3}$/;
async function dnsLookup(host: string): Promise<string[]> {
  const out: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    try {
      const r = await (Deno as any).resolveDns(host, type);
      for (const ip of r as string[]) out.push(ip);
    } catch (e) {
      if ((e as any)?.name === "NotFound") continue;
      // resolver not available in this runtime: DNS-over-HTTPS, same answer
      try {
        const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(4000) });
        const j = await r.json();
        for (const a of j.Answer ?? []) if (a.type === (type === "A" ? 1 : 28)) out.push(String(a.data));
      } catch { /* treated as unresolved */ }
    }
  }
  return out;
}
class Blocked extends Error {}
async function assertPublic(u: URL): Promise<void> {
  if (!/^https?:$/.test(u.protocol)) throw new Blocked("scheme");
  if (u.port && u.port !== "80" && u.port !== "443") throw new Blocked("port");
  if (u.username || u.password) throw new Blocked("userinfo");
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".localhost")) throw new Blocked("host");
  if (IP4.test(h) || h.includes(":")) { if (isPrivateIp(h)) throw new Blocked("private"); return; }
  const ips = await dnsLookup(h);
  if (!ips.length) throw new Blocked("unresolved");
  if (ips.some(isPrivateIp)) throw new Blocked("private");
}
const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
/** Returns {url, html} (html capped at maxBytes, read as a stream), null if unreadable, throws Blocked if the URL points inward. */
async function safeFetchHtml(raw: string, maxBytes = 400_000): Promise<{ url: string; html: string } | null> {
  let u: URL;
  try { u = new URL(String(raw ?? "").trim()); } catch { return null; }
  for (let hop = 0; hop <= 4; hop++) {
    await assertPublic(u);
    let r: Response;
    try {
      r = await fetch(u.toString(), {
        redirect: "manual",
        headers: { "User-Agent": BROWSER_UA, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5", "Accept-Language": "en-US,en;q=0.9" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch { return null; }
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get("location");
      try { await r.body?.cancel(); } catch { /* ignore */ }
      if (!loc) return null;
      try { u = new URL(loc, u); } catch { return null; }
      continue;
    }
    if (!r.ok || !r.body) { try { await r.body?.cancel(); } catch { /* ignore */ } return null; }
    const ct = r.headers.get("content-type") ?? "";
    if (ct && !/text\/|html|xml/i.test(ct)) { try { await r.body.cancel(); } catch { /* ignore */ } return null; }
    const reader = r.body.getReader();
    const chunks: Uint8Array[] = []; let got = 0;
    while (got < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value); got += value.length;
    }
    try { await reader.cancel(); } catch { /* ignore */ }
    const all = new Uint8Array(Math.min(got, maxBytes)); let off = 0;
    for (const c of chunks) { const take = Math.min(c.length, all.length - off); all.set(c.subarray(0, take), off); off += take; if (off >= all.length) break; }
    return { url: u.toString(), html: new TextDecoder().decode(all) };
  }
  return null;
}

/* ── free-LLM ladder (the existing free-llm function, paid:"never") ────── */
async function askLlm(task: string, system: string, user: string, maxTokens: number, timeoutMs = 22_000): Promise<any | null> {
  const headers: Record<string, string> = { "Content-Type": "application/json", apikey: SB_SECRET };
  if (!SB_SECRET.startsWith("sb_")) headers.Authorization = `Bearer ${SB_SECRET}`;
  try {
    const r = await fetch(`${SB_URL}/functions/v1/free-llm`, {
      method: "POST", headers, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ op: "run", task, system, user: user.slice(0, 9000), json: true, privacy: "public", paid: "never", maxTokens }),
    });
    const j = await r.json();
    return j?.ok ? (j.json ?? null) : null;
  } catch { return null; }
}
const TONES = ["Warm", "Luxury", "Straight-talking", "Playful", "Local expert"];
const TONES_GEN = ["Warm", "Straight-talking", "Playful", "Expert", "Calm"];
const isRE = (signup: any) => (signup?.vertical ?? "real-estate") === "real-estate";
const arr = (v: unknown, n: number, len = 60) => (Array.isArray(v) ? v : []).map((x) => String(x).trim().slice(0, len)).filter(Boolean).slice(0, n);

function pageText(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 9000);
}
function pageColors(html: string): string[] {
  const out: string[] = [];
  const theme = html.match(/<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-f]{3,8})["']/i)?.[1];
  if (theme) out.push(theme.toLowerCase());
  const count = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-f]{6})\b/gi)) {
    const h = m[1].toLowerCase(); const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 24) continue;            // grays, white, black
    count.set("#" + h, (count.get("#" + h) ?? 0) + 1);
  }
  for (const [c] of [...count.entries()].sort((a, b) => b[1] - a[1])) if (!out.includes(c)) out.push(c);
  return out.slice(0, 3);
}

async function brandFromSite(url: string, re = true) {
  let site: { url: string; html: string } | null;
  try { site = await safeFetchHtml(url); }
  catch (e) { if (e instanceof Blocked) return { ok: false, error: "blocked_url", message: "That address is not a public website we can read. Fill in what you know and we will get the rest from your posts." }; throw e; }
  if (!site) return { ok: false, error: "cannot_read_site", message: "We could not read that page. Some sites block us. Fill in what you know and we will get the rest from your posts." };
  const text = pageText(site.html);
  if (text.length < 80) return { ok: false, error: "cannot_read_site", message: "We could not read that page. Some sites block us. Fill in what you know and we will get the rest from your posts." };
  const logo = site.html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
  let g: any = null;
  for (let pass = 0; pass < 2 && !g; pass++) {
    const j = !re ? await askLlm("extract",
      "You read a small business's own website and pull out what is already published on it. Return JSON only, no prose. Empty string or empty array when the page does not say. " +
      'Shape: {"name":"","business":"","what":"","cities":[],"tones":[],"words_use":[],"words_avoid":[],"hashtags":[],"about":""}. ' +
      "business: the business name as written in its own title, header, footer or copyright line. name: the owner or person, only if the page names one. what: what the business does, in under 12 plain words. " +
      "cities: towns or areas the page says it serves; never guess. tones: up to 2 from exactly [Warm, Straight-talking, Playful, Expert, Calm]. " +
      "words_use: up to 5 words the page repeats. words_avoid: up to 3 cliches. hashtags: up to 5, with #, that fit the business. about: one sentence, third person.",
      `URL: ${site.url}\n\nPAGE TEXT:\n${text}`, 700) : await askLlm("extract",
      "You read a real estate agent's website and pull out what is already published on it. Return JSON only, no prose. Empty string or empty array when the page does not say. " +
      'Shape: {"name":"","brokerage":"","license":"","cities":[],"tones":[],"words_use":[],"words_avoid":[],"hashtags":[],"about":""}. ' +
      "brokerage: the company that runs this site, as written in its own title, header, footer or copyright line. name: the individual agent, only if the page names one. license: only if a license number appears. " +
      "cities: towns and neighborhoods the page says it works in; never guess. tones: up to 2 from exactly [Warm, Luxury, Straight-talking, Playful, Local expert]. " +
      "words_use: up to 5 words the page repeats. words_avoid: up to 3 cliches. hashtags: up to 5, with #, for the cities found. about: one sentence, third person.",
      `URL: ${site.url}\n\nPAGE TEXT:\n${text}`, 700);
    if (j && (String(j.brokerage ?? j.business ?? j.name ?? "").trim() || (Array.isArray(j.cities) && j.cities.length))) g = j;
  }
  g = g ?? {};
  return {
    ok: true,
    suggestion: {
      name: String(g.name ?? "").slice(0, 80), brokerage: String(g.brokerage ?? "").slice(0, 120), license: String(g.license ?? "").slice(0, 40),
      business: String(g.business ?? "").slice(0, 120), what: String(g.what ?? "").slice(0, 120),
      cities: arr(g.cities, 8), tones: arr(g.tones, 2).map((t) => (re ? TONES : TONES_GEN).find((x) => x.toLowerCase() === t.toLowerCase())).filter(Boolean),
      words_use: arr(g.words_use, 6, 40), words_avoid: arr(g.words_avoid, 4, 40),
      hashtags: arr(g.hashtags, 6, 30).filter((h) => h.startsWith("#")), about: String(g.about ?? "").slice(0, 240),
      colors: pageColors(site.html), logo_url: logo && /^https?:\/\//i.test(logo) ? logo.slice(0, 500) : "", source: site.url,
    },
  };
}
async function voiceTask(signup: any) {
  const a = signup.answers ?? {};
  // only what the task needs: no email, no name, no license
  const slim = { cities: a.about?.cities ?? [], brokerage: a.about?.brokerage ?? "", tones: a.voice?.tones ?? [], words_use: a.voice?.words_use ?? [], words_avoid: a.voice?.words_avoid ?? [], content: a.content ?? {} };
  if (!isRE(signup)) {
    const g = { what: a.about?.what ?? "", business: a.about?.business ?? "", cities: a.about?.cities ?? [], tones: a.voice?.tones ?? [], words_use: a.voice?.words_use ?? [], words_avoid: a.voice?.words_avoid ?? [], content: a.content ?? {} };
    const jg = await askLlm("extract",
      'Turn a small business owner\'s own answers into writing rules for their social posts. Return JSON only: {"words_use":[],"words_avoid":[],"hashtags":[],"tone_note":""}. ' +
      "words_use: up to 6. words_avoid: up to 6 (add the usual marketing cliches if none named). hashtags: up to 6, with #, that fit what the business does and where. tone_note: one short line. Never invent facts about the business.",
      JSON.stringify(g), 600);
    if (!jg) return { ok: false, error: "helper_busy", message: "Our helper is busy right now. Type it in yourself, or try again in a minute." };
    return { ok: true, suggestion: {
      words_use: arr(jg.words_use, 6, 40), words_avoid: arr(jg.words_avoid, 6, 40),
      hashtags: arr(jg.hashtags, 6, 30).map((h) => (h.startsWith("#") ? h : "#" + h)), tone_note: String(jg.tone_note ?? "").slice(0, 200) } };
  }
  const j = await askLlm("extract",
    'Turn an agent\'s own answers into writing rules. Return JSON only: {"words_use":[],"words_avoid":[],"hashtags":[],"tone_note":""}. ' +
    "words_use: up to 6. words_avoid: up to 6 (add the usual real estate cliches if none named). hashtags: up to 6, with #, built from the cities. tone_note: one short line. Never invent a neighborhood.",
    JSON.stringify(slim), 600);
  if (!j) return { ok: false, error: "helper_busy", message: "Our helper is busy right now. Type it in yourself, or try again in a minute." };
  return { ok: true, suggestion: {
    words_use: arr(j.words_use, 6, 40), words_avoid: arr(j.words_avoid, 6, 40),
    hashtags: arr(j.hashtags, 6, 30).map((h) => (h.startsWith("#") ? h : "#" + h)), tone_note: String(j.tone_note ?? "").slice(0, 200) } };
}
const PUFFERY = /\b(guarantee[ds]?|no[- ]brainer|steal|can'?t miss|won'?t last|must[- ]see|best in (class|town|the)|#1|number one|flawless|breathtaking|dream home|will appreciate|sure thing|risk[- ]free|once[- ]in[- ]a[- ]lifetime|unbeatable|perfect)\b/i;
async function lintCaption(text: string) {
  const { data } = await db.rpc("re_fair_housing_lint", { t: text });
  const issues: any[] = Array.isArray(data) ? data.map((x: any) => ({ code: x.code, severity: x.severity, message: x.message, suggestion: x.suggestion })) : [];
  const m = text.match(PUFFERY);
  if (m) issues.push({ code: "exaggeration", severity: "warn", message: `"${m[0]}" is a claim that cannot be backed up.`, suggestion: "State the fact instead: the square footage, the year of the roof, the lot size." });
  const j = await askLlm("judge",
    'You check a real estate social post for claims that cannot be verified from listing facts (guarantees, rankings, appreciation forecasts, invented features). Return JSON only: {"claims":[{"quote":"","why":""}]}. At most 3. Empty list if none.',
    text, 300, 12_000);
  for (const c of Array.isArray(j?.claims) ? j.claims.slice(0, 3) : []) {
    const quote = String(c?.quote ?? "").slice(0, 80);
    if (quote && text.toLowerCase().includes(quote.toLowerCase()) && !issues.some((i) => i.code === "exaggeration" && i.message.includes(quote)))
      issues.push({ code: "exaggeration", severity: "warn", message: `"${quote}": ${String(c?.why ?? "cannot be verified").slice(0, 140)}`, suggestion: "Use a fact from the listing instead." });
  }
  const blocking = issues.some((i) => i.severity === "block");
  return { issues, blocking, ok_to_post: !blocking };
}

/* ── listings ──────────────────────────────────────────────────────────── */
const MIMES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heic", "application/zip": "zip" };
const STATUSES = ["coming_soon", "just_listed", "open_house", "price_change", "pending", "sold"];
const ROOM_RANK: Record<string, number> = { exterior: 0, living: 1, dining: 1.5, kitchen: 2, primary: 3, bedroom: 3.5, bath: 4, yard: 5, other: 6 };
const WIDE = new Set(["exterior", "living", "dining", "kitchen", "primary", "yard"]);
function guessRoom(name: string): string | null {
  const n = name.toLowerCase();
  if (/(exterior|front|curb|facade|outside|street)/.test(n)) return "exterior";
  if (/(kitchen)/.test(n)) return "kitchen";
  if (/(living|family|great[-_ ]?room|lounge)/.test(n)) return "living";
  if (/(dining)/.test(n)) return "dining";
  if (/(primary|master|main[-_ ]?bed)/.test(n)) return "primary";
  if (/(bath|powder|shower)/.test(n)) return "bath";
  if (/(bed)/.test(n)) return "bedroom";
  if (/(yard|garden|patio|deck|pool|backyard|balcony)/.test(n)) return "yard";
  return null;
}
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
function money(n: number): string { return "$" + Math.round(n).toLocaleString("en-US"); }

function mapItemStatus(it: any): string {
  if (it.provenance?.skipped_at) return "skipped";
  if (it.work_kind) return "making";
  if (it.posted_at) return "posted";
  if (it.stage === "internal") return it.internal_status === "changes" ? "changes" : "making";
  if (it.status === "approved") return (it.scheduled_at || it.scheduled_for) ? "scheduled" : "approved";
  if (it.status === "changes") return "changes";
  return "to_review";
}
async function signMany(paths: string[], secs: number): Promise<string[]> {
  if (!paths.length) return [];
  const { data } = await db.storage.from(BUCKET).createSignedUrls(paths, secs);
  const m = new Map<string, string>();
  for (const d of data ?? []) if (d.path && d.signedUrl) m.set(d.path, d.signedUrl);
  return paths.map((p) => m.get(p)).filter(Boolean) as string[];
}

/* ── the door ──────────────────────────────────────────────────────────── */
/** One extra video, $15, one-time Stripe Checkout. The price id comes from studio_prices (plan "extravideo"); we never create prices. */
async function extraVideoCheckout(signup: any, body: Record<string, any>): Promise<Response> {
  if (String(body.cadence ?? "once") !== "once") return E("bad_cadence", "An extra video is a one-time purchase.", 400);
  if (!signup.client_slug) return E("no_video_plan", "Videos come with the Premium plan. Pick a plan first.");
  let listingId = "";
  if (body.listing_id) {
    if (!uuidRe.test(String(body.listing_id))) return E("not_found", "We could not find that listing.", 404);
    const { data: l } = await db.from("re_listings").select("id").eq("id", body.listing_id).eq("signup_id", signup.id).maybeSingle();
    if (!l) return E("not_found", "We could not find that listing.", 404);
    listingId = l.id;
  }
  const ent = (await db.rpc("studio_entitlement", { p_slug: signup.client_slug })).data ?? {};
  if (!ent.billing || ent.plan !== "premium" || !ent.can_post) return E("no_video_plan", "Extra videos come with the Premium plan.");
  if (!(await allow(`co:${signup.id}`, 10, 3600))) return E("rate_limited", RATE_MSG, 429);
  const ctx = { db, url: SB_URL, secret: SB_SECRET };
  const price = await extraVideoPrice(ctx);
  if (!price) return E("not_available", "Extra videos are not on sale just yet. Email studio@bestly.tech and we will add one to your account.");
  const key = await stripeKey(ctx);
  if (!key) return E("checkout_failed", "We could not start the checkout. Nothing was charged. Try again in a minute.");
  const { data: b } = await db.from("studio_billing").select("stripe_customer").eq("client_slug", signup.client_slug).maybeSingle();
  const customer = (b?.stripe_customer as string | null) ?? signup.stripe_customer ?? null;
  // surface=studio + plan=extra_video: the Stripe webhook hands this to studio_provision_client, which credits one video and nothing else.
  const meta = { surface: "studio", signup_id: signup.id, plan: "extra_video", cadence: "once", listing_id: listingId };
  const p = new URLSearchParams({
    mode: "payment", client_reference_id: signup.id, "line_items[0][price]": price, "line_items[0][quantity]": "1",
    success_url: `${SITE}/me?extra=1`, cancel_url: `${SITE}/me`, allow_promotion_codes: "false", "payment_method_types[0]": "card",
  });
  if (customer) p.set("customer", customer); else p.set("customer_email", signup.email);
  for (const [k, v] of Object.entries(meta)) { p.set(`metadata[${k}]`, v); p.set(`payment_intent_data[metadata][${k}]`, v); }
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `studio-extra-${signup.id}-${listingId || "x"}-${Math.floor(Date.now() / 600_000)}` },
    body: p,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.url) { console.error("stripe extra video", r.status, j?.error?.message); return E("checkout_failed", "Stripe would not open the checkout. Nothing was charged. Try again in a minute."); }
  return J({ ok: true, url: j.url });
}

async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  if (origin && !originOk(origin)) return E("origin_not_allowed", "This page is not allowed to talk to Bestly Studio.", 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return E("post_only", "POST only.", 405);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY) return E("too_large", "That request is too big.", 413);
  const rawBody = await readCapped(req, MAX_BODY);   // counts bytes as they arrive, so a chunked body cannot skip the cap
  if (rawBody === null) return E("too_large", "That request is too big.", 413);
  let body: Record<string, any> = {};
  try { body = JSON.parse(rawBody || "{}"); } catch { return E("bad_json", "Something went wrong sending that. Try again.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return E("bad_json", "Something went wrong sending that. Try again.", 400);
  const action = String(body.action ?? "");
  const ip = clientIp(req);

  try {
    if (action === "plans") return J({ ok: true, ...planPayload() });
    if (action === "networks") return J({ ok: true, networks: await networks() });
    if (action === "sweep") return await sweep(req);

    /* link */
    if (action === "link") {
      const email = norm(body.email).slice(0, 160);
      if (!EMAIL_RE.test(email)) return E("bad_email", "That email does not look right. Check it and try again.", 400);
      if (!(await allow(`link:email:${email}`, 5, 900, true)) || !(await allow(`link:ip:${ip}`, 20, 3600, true))) return E("rate_limited", RATE_MSG, 429);
      const same = J({ ok: true, sent: true });
      const vert = body.vertical === "general" ? "general" : body.vertical === "real-estate" ? "real-estate" : null;
      const { data: existing } = await db.from("studio_signups").select("id,vertical,status,client_slug,pre_client_slug").eq("email", email).maybeSingle();
      let id = existing?.id as string | undefined;
      let vNow = (existing?.vertical as string | undefined) ?? vert ?? "real-estate";
      // someone who has not connected or paid yet can switch between the general and real estate doors
      if (existing && vert && vert !== existing.vertical && !existing.client_slug && !existing.pre_client_slug && existing.status !== "converted") {
        await db.from("studio_signups").update({ vertical: vert }).eq("id", existing.id); vNow = vert;
      }
      if (!id) {
        const ins = await db.from("studio_signups").insert({ email, token: rndHex(32), vertical: vert ?? "real-estate" }).select("id").single();
        if (ins.error) { console.error("link insert", ins.error.message); return same; }
        id = ins.data.id as string;
      }
      await db.from("studio_magic_links").delete().eq("signup_id", id).is("used_at", null);
      const c = rndCode(9);
      const { error: e2 } = await db.from("studio_magic_links").insert({ code: c, signup_id: id, email, expires_at: new Date(Date.now() + LINK_MINUTES * 60_000).toISOString() });
      if (e2) { console.error("link code", e2.message); return same; }
      const { text, html } = emailBody(`${SITE}/start?c=${c}${vNow === "real-estate" ? "&for=real-estate" : ""}`, vNow);
      if (!(await sendMail(email, "Your link into Bestly Studio", text, html))) return E("mail_failed", "We could not send that email. Try again in a minute.");
      return same;
    }

    /* verify */
    if (action === "verify") {
      const c = String(body.code ?? "").trim().toLowerCase();
      if (!/^[a-z0-9]{6,12}$/.test(c)) return E("bad_link", "That link does not look right. Ask for a new one.");
      if (!(await allow(`verify:ip:${ip}`, 15, 900, true)) || !(await allow(`verify:code:${c}`, 6, 900, true))) return E("rate_limited", RATE_MSG, 429);
      const { data: row } = await db.from("studio_magic_links").select("*").eq("code", c).maybeSingle();
      if (!row) return E("bad_link", "That link does not look right. Ask for a new one.");
      if (row.used_at) return E("used", "That link was already used. Ask for a new one.");
      if (new Date(row.expires_at).getTime() < Date.now()) return E("expired", "That link ran out. Ask for a new one.");
      const { data: claimed } = await db.from("studio_magic_links").update({ used_at: new Date().toISOString() }).eq("code", c).is("used_at", null).select("code");
      if (!claimed?.length) return E("used", "That link was already used. Ask for a new one.");
      const { data: s0 } = await db.from("studio_signups").select("id,status").eq("id", row.signup_id).maybeSingle();
      if (!s0) return E("bad_link", "That link does not look right. Ask for a new one.");
      if (s0.status === "open") await db.from("studio_signups").update({ status: "linked" }).eq("id", s0.id); // paying clients keep "converted"
      const tok = await mintSession(s0.id);
      const { data: s } = await db.from("studio_signups").select("*").eq("id", s0.id).single();
      return J({ ok: true, token: tok, step: s.step_id ?? "intro", answers: cleanAnswers(s.answers), email: s.email, rev: s.rev ?? 0, client_slug: s.client_slug ?? null, vertical: s.vertical ?? "real-estate", networks: await networks() });
    }

    /* no token needed */
    if (action === "originals") {
      const code = String(body.code ?? "").trim().toLowerCase();
      if (!/^[a-z0-9]{5,12}$/.test(code)) return E("not_found", "We could not find those photos.", 404);
      if (!(await allow(`orig:ip:${ip}`, 60, 3600))) return E("rate_limited", RATE_MSG, 429);
      const { data: link } = await db.from("re_short_links").select("listing_id").eq("code", code).eq("kind", "originals").maybeSingle();
      if (!link) return E("not_found", "We could not find those photos.", 404);
      const { data: l } = await db.from("re_listings").select("id,street,city,state").eq("id", link.listing_id).maybeSingle();
      const { data: ph } = await db.from("re_listing_photos").select("storage_path,position").eq("listing_id", link.listing_id).not("storage_path", "is", null).order("position");
      const photos = await signMany((ph ?? []).map((p: any) => p.storage_path), 3600);
      return J({ ok: true, photos, address: l ? [l.street, l.city].filter(Boolean).join(", ") : "", disclosure: DISCLOSURE });
    }
    if (action === "passkey_login_options") {
      if (!(await allow(`pk:ip:${ip}`, 20, 900, true))) return E("rate_limited", RATE_MSG, 429);
      // Same answer for every email (no list of this person's keys), so this cannot be used to find out who has an account.
      // Passkeys are made discoverable (residentKey "preferred"), so the device finds its own.
      const opts = await generateAuthenticationOptions({ rpID: RP_ID, allowCredentials: [], userVerification: "required" });
      await db.from("re_webauthn_challenges").delete().lt("expires_at", new Date().toISOString());
      await db.from("re_webauthn_challenges").insert({ challenge: opts.challenge, kind: "auth" });
      return J({ ok: true, ...opts });
    }
    if (action === "passkey_login") {
      if (!(await allow(`pk:ip:${ip}`, 20, 900, true))) return E("rate_limited", RATE_MSG, 429);
      const cred = body.credential;
      try {
        const cd = JSON.parse(new TextDecoder().decode(unb64u(String(cred?.response?.clientDataJSON ?? ""))));
        const challenge = String(cd.challenge ?? "");
        const { data: ch } = await db.from("re_webauthn_challenges").select("id,expires_at").eq("challenge", challenge).eq("kind", "auth").maybeSingle();
        if (!ch || new Date(ch.expires_at).getTime() < Date.now()) return E("passkey_failed", "That sign-in took too long. Try again.");
        await db.from("re_webauthn_challenges").delete().eq("id", ch.id);
        const { data: key } = await db.from("re_passkeys").select("*").eq("credential_id", String(cred?.id ?? "")).maybeSingle();
        if (!key) return E("passkey_failed", "We do not know that passkey. Use the email link instead.");
        const v = await verifyAuthenticationResponse({
          response: cred, expectedChallenge: challenge, expectedOrigin: ORIGINS, expectedRPID: RP_ID,
          credential: { id: key.credential_id, publicKey: unb64u(key.public_key), counter: Number(key.counter), transports: key.transports ?? undefined },
        });
        if (!v.verified) return E("passkey_failed", "That passkey did not work. Use the email link instead.");
        await db.from("re_passkeys").update({ counter: v.authenticationInfo.newCounter, last_used_at: new Date().toISOString() }).eq("id", key.id);
        const tok = await mintSession(key.signup_id);
        const { data: s } = await db.from("studio_signups").select("*").eq("id", key.signup_id).single();
        return J({ ...(await resumePayload(s)), token: tok });
      } catch (e) {
        console.error("passkey_login", String(e));
        return E("passkey_failed", "That passkey did not work. Use the email link instead.");
      }
    }

    /* everything below is theirs, and only theirs */
    const signup = await signupFromToken(body.token);
    if (!signup) return E("not_signed_in", "Please sign in again.", 401);

    if (action === "resume") {
      await db.from("studio_signups").update({ last_seen_at: new Date().toISOString() }).eq("id", signup.id);
      return J(await resumePayload(signup));
    }

    /* save: patch with revision */
    if (action === "save") {
      const patch = body.patch;
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) return E("bad_patch", "Nothing to save.", 400);
      const rev = Number(body.rev);
      if (!Number.isInteger(rev)) return E("bad_rev", "Something went wrong saving. Reload the page.", 400);
      if (rev !== (signup.rev ?? 0)) return E("stale_rev", "Your answers changed on another screen. Reloading them.", 200, { rev: signup.rev ?? 0 });
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) if (PATCH_KEYS.has(k) && v && typeof v === "object" && !Array.isArray(v)) clean[k] = clamp(v);
      // an agent can only point their brand at files in their own folder
      if (clean.brand && typeof clean.brand === "object") {
        const br = clean.brand as Record<string, unknown>;
        for (const f of ["logo_path", "headshot_path"]) {
          const v = br[f];
          if (typeof v === "string" && v && !(v.startsWith(`signups/${signup.id}/`) && !v.includes(".."))) br[f] = "";
        }
      }
      const merged = { ...cleanAnswers(signup.answers), ...clean };
      if (JSON.stringify(merged).length > MAX_ANSWERS) return E("answers_too_large", "That is more than we can save. Shorten the longest answer.", 413);
      const step = typeof body.step === "string" && /^[a-z0-9_-]{1,32}$/.test(body.step) ? body.step : signup.step_id;
      const { data: upd } = await db.from("studio_signups")
        .update({ answers: merged, rev: rev + 1, step_id: step, updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString() })
        .eq("id", signup.id).eq("rev", rev).select("rev").maybeSingle();
      if (!upd) return E("stale_rev", "Your answers changed on another screen. Reloading them.", 200);
      // A signed-up agent editing their brand (/start?step=brand): carry it to the board's brand guide too.
      if (signup.client_slug && Object.keys(clean).length && isRE(signup)) {
        const r = await db.rpc("re_brand_sync", { p_signup: signup.id });
        if (r.error) console.error("brand sync", r.error.message);
      } else if ((signup.client_slug || signup.pre_client_slug) && Object.keys(clean).length) {
        const r = await db.rpc("studio_ensure_client", { p_signup_id: signup.id });   // refreshes the brand profile
        if (r.error) console.error("brand sync (general)", r.error.message);
      }
      return J({ ok: true, rev: upd.rev, saved_at: new Date().toISOString() });
    }

    /* ai */
    if (action === "ai") {
      const task = String(body.task ?? "");
      if (!["brand_from_site", "voice", "caption_lint"].includes(task)) return E("unknown_task", "That helper does not exist.", 400);
      const n = await db.rpc("re_ai_take", { p_signup: signup.id, p_cap: 40 });
      if (n.data === null || n.error) return E("ai_cap", "That is a lot of help for one day. Add it by hand, or come back tomorrow.");
      if (task === "brand_from_site") return J(await brandFromSite(String(body.url ?? "").slice(0, 500), isRE(signup)));
      if (task === "voice") return J(await voiceTask(signup));
      const text = String(body.text ?? "").slice(0, 4000);
      if (!text.trim()) return E("empty", "Paste the words to check.", 400);
      return J({ ok: true, suggestion: await lintCaption(text) });
    }

    /* upload_url */
    if (action === "upload_url") {
      const kind = String(body.kind ?? "");
      const mime = String(body.mime ?? "").toLowerCase();
      const size = Number(body.size);
      if (!["logo", "headshot", "photo", "zip"].includes(kind)) return E("bad_kind", "That kind of file is not supported.", 400);
      const ext = MIMES[mime];
      if (!ext || (kind === "zip") !== (mime === "application/zip")) return E("bad_mime", "Use a JPEG, PNG, HEIC or WebP photo.", 400);
      if (!Number.isFinite(size) || size <= 0) return E("bad_size", "We could not tell how big that file is.", 400);
      const cap = kind === "photo" ? 25 * 1024 * 1024 : kind === "zip" ? 50 * 1024 * 1024 : 8 * 1024 * 1024;
      if (size > cap) return E("too_big", `That file is too big. The limit is ${Math.round(cap / 1048576)} MB.`, 200);
      if (!(await allow(`up:${signup.id}`, 300, 3600))) return E("rate_limited", RATE_MSG, 429);
      if (kind === "photo" && body.listing_id) {
        if (!uuidRe.test(String(body.listing_id))) return E("bad_listing", "We could not find that listing.", 404);
        const { data: l } = await db.from("re_listings").select("id").eq("id", body.listing_id).eq("signup_id", signup.id).maybeSingle();
        if (!l) return E("not_found", "We could not find that listing.", 404);
        const { count } = await db.from("re_listing_photos").select("id", { count: "exact", head: true }).eq("listing_id", l.id);
        if ((count ?? 0) >= 60) return E("too_many_photos", "A listing can have up to 60 photos.");
      }
      const path = `signups/${signup.id}/${kind}/${crypto.randomUUID()}.${ext}`;
      const { data, error } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) { console.error("signed upload", error?.message); return E("upload_failed", "We could not start that upload. Try again."); }
      return J({ ok: true, url: data.signedUrl, path, method: "PUT", headers: { "Content-Type": mime, "x-upsert": "false" } });
    }

    /* listing_save */
    if (action === "listing_save") {
      const L = body.listing ?? {};
      if (body.attested !== true) return E("attestation_required", "Please confirm you own these photos (or have permission) and that you are authorized to advertise this listing.");
      const address = String(L.address ?? "").trim().slice(0, 160);
      const city = String(L.city ?? "").trim().slice(0, 80);
      const state = String(L.state ?? "").trim().toUpperCase().slice(0, 2);
      const zip = String(L.zip ?? "").trim().slice(0, 10);
      const status = String(L.status ?? "just_listed");
      if (address.length < 5) return E("bad_address", "Enter the street address.", 400);
      if (!city) return E("bad_city", "Enter the city.", 400);
      if (state && !/^[A-Z]{2}$/.test(state)) return E("bad_state", "Use the two-letter state, like OR.", 400);
      if (zip && !/^\d{5}(-\d{4})?$/.test(zip)) return E("bad_zip", "Check the ZIP code.", 400);
      if (!STATUSES.includes(status)) return E("bad_status", "Pick one of the listing statuses.", 400);
      const price = num(L.price_usd), beds = num(L.beds), baths = num(L.baths), sqft = num(L.sqft);
      if (price !== null && !(price > 0 && price <= 100_000_000)) return E("bad_price", "Check the price. It must be under $100,000,000.", 400);
      if (beds !== null && !(beds >= 0 && beds <= 20)) return E("bad_beds", "Bedrooms must be 0 to 20.", 400);
      if (baths !== null && !(baths >= 0 && baths <= 20)) return E("bad_baths", "Bathrooms must be 0 to 20.", 400);
      if (sqft !== null && !(sqft > 0 && sqft <= 50_000)) return E("bad_sqft", "Square feet must be under 50,000.", 400);
      const notes = String(L.notes ?? "").slice(0, 2000);
      let openHouse: string | null = null;
      if (L.open_house_at) { const t = new Date(String(L.open_house_at)); if (isNaN(t.getTime())) return E("bad_open_house", "Check the open house date and time.", 400); openHouse = t.toISOString(); }
      // photos: loose files and zips. Every path must be one the server handed out for THIS agent.
      if (!(await allow(`ls:${signup.id}`, 60, 3600))) return E("rate_limited", RATE_MSG, 429);
      const pre = `signups/${signup.id}/`;
      const prefix = `${pre}photo/`;
      const PHOTO_RE = new RegExp(`^signups/${signup.id}/photo/[0-9a-f-]{36}\\.(jpg|png|webp|heic)$`);
      const ZIP_RE = new RegExp(`^signups/${signup.id}/zip/[0-9a-f-]{36}\\.zip$`);
      const given = (Array.isArray(body.photos) ? body.photos : []).slice(0, 80);
      let photos: { path: string; position: number; name?: string }[] = [];
      const zips: string[] = [];
      for (const p of given) {
        if (p?.kind === "zip") { if (typeof p.path !== "string" || !ZIP_RE.test(p.path)) return E("bad_photo", "One of the files did not upload. Try that one again.", 400); zips.push(p.path); }
        else { if (typeof p?.path !== "string" || !PHOTO_RE.test(p.path)) return E("bad_photo", "One of the photos did not upload. Try that one again.", 400); photos.push({ path: p.path, position: Number(p.position) || 0, name: typeof p.name === "string" ? p.name.slice(0, 120) : undefined }); }
      }
      if (zips.length > 3) return E("too_many_zips", "Add up to 3 zip files at a time.", 400);
      photos = photos.slice(0, 60);
      const inBucket = async (path: string): Promise<any | null> => {
        const slash = path.lastIndexOf("/");
        const { data } = await db.storage.from(BUCKET).list(path.slice(0, slash), { limit: 5, search: path.slice(slash + 1) });
        return (data ?? []).find((o: any) => o.name === path.slice(slash + 1)) ?? null;
      };

      // listing: new or an edit of one of theirs
      let listing: any = null;
      if (L.id) {
        if (!uuidRe.test(String(L.id))) return E("not_found", "We could not find that listing.", 404);
        const r = await db.from("re_listings").select("*").eq("id", L.id).eq("signup_id", signup.id).maybeSingle();
        if (!r.data) return E("not_found", "We could not find that listing.", 404);
        listing = r.data;
      }
      // the photos must really be in storage (and tell us their size / type); checked a few at a time
      const meta = new Map<string, any>();
      for (let i = 0; i < photos.length; i += 10) {
        const got = await Promise.all(photos.slice(i, i + 10).map((p) => inBucket(p.path)));
        for (let j = 0; j < got.length; j++) { if (!got[j]) return E("photo_missing", "One of the photos did not finish uploading. Try that one again.", 400); meta.set(photos[i + j].path.slice(prefix.length), got[j].metadata); }
      }
      // zips: open each one, keep the images (cap 60 photos per listing), delete the zip
      let zipSkipped = 0;
      if (zips.length) {
        let room = 60 - photos.length;
        let nextPos = photos.reduce((m, p) => Math.max(m, p.position), -1) + 1;
        let found = 0;
        for (const zp of zips) {
          if (!(await inBucket(zp))) return E("photo_missing", "One of the files did not finish uploading. Try that one again.", 400);
          const dl = await db.storage.from(BUCKET).download(zp);
          if (dl.error || !dl.data) { console.error("zip download", dl.error?.message); return E("zip_failed", "We could not open that zip. Try again, or add the photos on their own."); }
          if (dl.data.size > ZIP_MAX_BYTES) return E("too_big", "That zip is too big. The limit is 50 MB.");
          let list: ReturnType<typeof listZipImages>;
          const bytes = new Uint8Array(await dl.data.arrayBuffer());
          try { list = listZipImages(bytes); } catch (e) { console.error("zip read", String(e)); return E("bad_zip", "We could not read that zip. Make it again, or add the photos on their own."); }
          found += list.entries.length; zipSkipped += list.skipped;
          for (const ent of list.entries) {
            if (room <= 0) { zipSkipped++; continue; }
            let data: Uint8Array | null = null;
            try { data = extractZipImage(bytes, ent.name); } catch { data = null; }
            const kind = data ? sniffImage(data) : null;
            if (!data || !kind) { zipSkipped++; continue; }
            const path = `${prefix}${crypto.randomUUID()}.${kind.ext}`;
            const up = await db.storage.from(BUCKET).upload(path, data, { contentType: kind.mime, upsert: false });
            if (up.error) { console.error("zip photo upload", up.error.message); return E("zip_failed", "We could not finish unpacking that zip. Try again."); }
            photos.push({ path, position: nextPos++, name: ent.name.split("/").pop() });
            meta.set(path.slice(prefix.length), { size: data.length, mimetype: kind.mime });
            room--;
          }
          await db.storage.from(BUCKET).remove([zp]);
        }
        if (!found && !photos.length) return E("zip_empty", "We did not find any photos in that zip. Use JPEG, PNG, HEIC or WebP files.");
      }
      let existingCount = 0;
      if (listing) { const c = await db.from("re_listing_photos").select("id", { count: "exact", head: true }).eq("listing_id", listing.id); existingCount = c.count ?? 0; }
      if (status === "just_listed" && photos.length + (photos.length ? 0 : existingCount) < 1) return E("photo_required", "Add at least one photo to post a just-listed home.");

      const fields = {
        street: address, city, state: state || null, postal_code: zip || null, price_usd: price, beds, baths, sqft,
        notes: notes || null, open_house_at: openHouse, listing_status: status, attested_at: new Date().toISOString(),
        intake_address: [address, city, state].filter(Boolean).join(", "),
      };
      let listingId: string;
      let code: string | null = listing?.short_code ?? null;
      if (listing) {
        const u = await db.from("re_listings").update(fields).eq("id", listing.id);
        if (u.error) { console.error("listing update", u.error.message); return E("save_failed", "We could not save that listing. Try again."); }
        listingId = listing.id;
      } else {
        code = rndCode(7);
        const ins = await db.from("re_listings").insert({
          ...fields, job_ref: `re-${code}`, sender: signup.email, subject: `Upload: ${address}`, received_at: new Date().toISOString(),
          status: "received", source: "upload", signup_id: signup.id, client_slug: signup.client_slug ?? null, short_code: code,
        }).select("id").single();
        if (ins.error || !ins.data) { console.error("listing insert", ins.error?.message); return E("save_failed", "We could not save that listing. Try again."); }
        listingId = ins.data.id;
      }
      if (!code) { code = rndCode(7); await db.from("re_listings").update({ short_code: code }).eq("id", listingId); }
      for (let i = 0; i < 5; i++) {   // a short code must point at exactly one listing: never share one
        const { data: ex } = await db.from("re_short_links").select("listing_id").eq("code", code).maybeSingle();
        if (ex?.listing_id === listingId) break;
        if (!ex) { const sl = await db.from("re_short_links").insert({ code, listing_id: listingId, kind: "originals" }); if (!sl.error) break; }
        code = rndCode(7); await db.from("re_listings").update({ short_code: code }).eq("id", listingId);
      }

      if (photos.length) {
        const keep = photos.map((p: any) => p.path);
        await db.from("re_listing_photos").delete().eq("listing_id", listingId).not("storage_path", "in", `(${keep.map((k: string) => `"${k}"`).join(",")})`);
        const have = await db.from("re_listing_photos").select("id,storage_path").eq("listing_id", listingId);
        const haveMap = new Map((have.data ?? []).map((r: any) => [r.storage_path, r.id]));
        let first: string | null = null;
        for (const p of photos) {
          const name = p.path.slice(prefix.length); const m = meta.get(name) ?? {};
          const row = { listing_id: listingId, filename: name, mime_type: m.mimetype ?? null, bytes: m.size ?? null, storage_path: p.path, position: Number(p.position) || 0, room_label: guessRoom(String(p.name ?? name)) };
          if (haveMap.has(p.path)) { await db.from("re_listing_photos").update({ position: row.position }).eq("id", haveMap.get(p.path)); if (!first) first = haveMap.get(p.path) as string; }
          else { const r = await db.from("re_listing_photos").insert(row).select("id").single(); if (!first && r.data) first = r.data.id; }
        }
        const { data: cover } = await db.from("re_listing_photos").select("id").eq("listing_id", listingId).order("position").limit(1).maybeSingle();
        await db.from("re_listings").update({ cover_photo_id: cover?.id ?? first }).eq("id", listingId);
      }

      const lint = notes ? ((await db.rpc("re_fair_housing_lint", { t: notes })).data ?? []) : [];
      let carousel = "after_plan";
      if (signup.client_slug) { const r = await db.rpc("re_enqueue_listing", { p_listing: listingId }); carousel = r.data ? "queued" : "failed"; }
      return J({ ok: true, listing_id: listingId, status, short_code: code, short_url: `${APP}/o/${code}`, lint, carousel, photos: photos.length, zip_skipped: zipSkipped });
    }

    /* listing_list */
    if (action === "listing_list") {
      const { data: ls } = await db.from("re_listings").select("id,street,city,state,price_usd,beds,baths,sqft,listing_status,open_house_at,cover_photo_id,short_code,created_at")
        .eq("signup_id", signup.id).order("created_at", { ascending: false }).limit(100);
      const ids = (ls ?? []).map((l: any) => l.id);
      const posts = new Map<string, number>(), videos = new Map<string, number>(), covers = new Map<string, string>();
      if (ids.length) {
        // carousels carry provenance.listing_id (re_enqueue_listing), videos carry provenance.re_listing_id (the worker)
        const [it1, it2] = await Promise.all([
          db.from("approval_items").select("id,provenance,media_type").in("provenance->>listing_id", ids).neq("status", "draft"),
          db.from("approval_items").select("id,provenance,media_type").in("provenance->>re_listing_id", ids).neq("status", "draft"),
        ]);
        const seen = new Set<string>();
        for (const r of [...(it1.data ?? []), ...(it2.data ?? [])]) {
          if (seen.has(r.id)) continue; seen.add(r.id);
          const k = r.provenance?.re_listing_id ?? r.provenance?.listing_id; if (k) posts.set(k, (posts.get(k) ?? 0) + 1);
        }
        const vj = await db.from("studio_video_jobs").select("listing_id,status").in("listing_id", ids).in("status", ["queued", "working", "done"]);
        for (const r of vj.data ?? []) videos.set(r.listing_id, (videos.get(r.listing_id) ?? 0) + 1);
        const cp = await db.from("re_listing_photos").select("id,storage_path").in("id", (ls ?? []).map((l: any) => l.cover_photo_id).filter(Boolean));
        const pm = new Map((cp.data ?? []).map((r: any) => [r.id, r.storage_path]));
        const paths = [...new Set([...pm.values()].filter(Boolean) as string[])];
        const urls = paths.length ? (await db.storage.from(BUCKET).createSignedUrls(paths, 3600)).data ?? [] : [];
        const um = new Map(urls.map((u: any) => [u.path, u.signedUrl]));
        for (const l of ls ?? []) { const p = pm.get(l.cover_photo_id); if (p && um.get(p)) covers.set(l.id, um.get(p) as string); }
      }
      return J({ ok: true, listings: (ls ?? []).map((l: any) => ({
        id: l.id, address: l.street, city: l.city, state: l.state, price_usd: l.price_usd, beds: l.beds, baths: l.baths, sqft: l.sqft,
        status: l.listing_status, cover_path: covers.get(l.id) ?? null, posts: posts.get(l.id) ?? 0, videos: videos.get(l.id) ?? 0,
        open_house_at: l.open_house_at, short_url: l.short_code ? `${APP}/o/${l.short_code}` : null })) });
    }

    /* queue */
    if (action === "queue") {
      const cid = await clientId(signup.client_slug);
      if (!cid) return J({ ok: true, items: [], counts: { to_review: 0, n: 0 } });
      const { data: its } = await db.from("approval_items")
        .select("id,title,caption,media_type,media_url,thumb_url,platform,platforms,status,stage,internal_status,work_kind,posted_at,scheduled_at,scheduled_for,provenance,created_at,external_ref")
        .eq("client_id", cid).neq("status", "draft").or("internal_status.is.null,internal_status.neq.killed").order("created_at", { ascending: false }).limit(60);
      const items = its ?? [];
      const ids = items.map((i: any) => i.id);
      const [slides, vars] = ids.length ? await Promise.all([
        db.from("approval_slides").select("item_id,media_url,position").in("item_id", ids).order("position"),
        db.from("approval_variants").select("item_id,platform,caption").in("item_id", ids),
      ]) : [{ data: [] }, { data: [] }];
      const slideMap = new Map<string, string[]>(); for (const s of (slides as any).data ?? []) { if (!s.media_url) continue; slideMap.set(s.item_id, [...(slideMap.get(s.item_id) ?? []), s.media_url]); }
      const varMap = new Map<string, any[]>(); for (const v of (vars as any).data ?? []) varMap.set(v.item_id, [...(varMap.get(v.item_id) ?? []), v]);
      const footer = (await db.rpc("re_caption_footer", { signup_id: signup.id })).data ?? "";
      const out: any[] = [];
      for (const it of items) {
        let media = slideMap.get(it.id) ?? (it.media_url ? [it.media_url] : []);
        const lid = it.provenance?.re_listing_id ?? it.provenance?.listing_id;
        if (!media.length && lid && it.media_type !== "video" && uuidRe.test(String(lid))) {
          const { data: ph } = await db.from("re_listing_photos").select("storage_path").eq("listing_id", lid).not("storage_path", "is", null).order("position").limit(10);
          media = await signMany((ph ?? []).map((p: any) => p.storage_path), 3600);
        }
        const v = varMap.get(it.id) ?? [];
        const caption = v.find((x: any) => x.platform === "instagram")?.caption ?? it.caption ?? "";
        const lint = ((await db.rpc("re_fair_housing_lint", { t: caption })).data ?? []).map((x: any) => ({ code: x.code, message: x.message, severity: x.severity }));
        out.push({
          id: it.id, listing_id: lid ?? null, kind: it.media_type === "video" ? "video" : "carousel", title: it.title, caption, footer,
          media, thumb: it.thumb_url ?? null, platforms: it.platforms?.length ? it.platforms : v.map((x: any) => x.platform), status: mapItemStatus(it),
          scheduled_for: it.scheduled_at ?? it.scheduled_for ?? null, lint,
          captions: Object.fromEntries(v.map((x: any) => [x.platform, x.caption])),
        });
      }
      return J({ ok: true, items: out, counts: { to_review: out.filter((o) => o.status === "to_review").length, n: out.length } });
    }

    /* decide */
    if (action === "decide") {
      const itemId = String(body.item_id ?? "");
      const decision = String(body.decision ?? "");
      const note = String(body.note ?? "").trim().slice(0, 1000);
      if (!uuidRe.test(itemId)) return E("not_found", "We could not find that post.", 404);
      if (!["approve", "changes", "skip"].includes(decision)) return E("bad_decision", "Pick approve, changes or skip.", 400);
      if (decision === "changes" && !note) return E("note_required", "Tell us what to change.");
      const { data: client } = await db.from("approval_clients").select("id,access_token").eq("slug", signup.client_slug ?? "").maybeSingle();
      if (!client) return E("no_board", "Your board is not ready yet. Finish picking a plan first.");
      const { data: it } = await db.from("approval_items").select("id,title,caption,provenance,stage,status,work_kind").eq("id", itemId).eq("client_id", client.id).maybeSingle();
      if (!it) return E("not_found", "We could not find that post.", 404);
      if (decision === "skip") {
        await db.from("approval_items").update({ provenance: { ...(it.provenance ?? {}), skipped_at: new Date().toISOString() } }).eq("id", it.id);
        await db.from("approval_item_events").insert({ item_id: it.id, kind: "client_skip", actor_kind: "client", payload: {} });
        return J({ ok: true, status: "skipped" });
      }
      if (it.work_kind) return E("still_making", "That post is still being made. Check back in a few minutes.");
      if (decision === "approve") {
        const { data: va } = await db.from("approval_variants").select("caption").eq("item_id", it.id);
        const text = [it.caption, ...(va ?? []).map((v: any) => v.caption)].filter(Boolean).join("\n");
        const lint = ((await db.rpc("re_fair_housing_lint", { t: text })).data ?? []).filter((x: any) => x.severity === "block");
        if (lint.length) return E("lint_blocked", `This can't go out yet: ${lint[0].message} ${lint[0].suggestion} Ask for changes and we will reword it.`, 200, { lint });
      }
      const r = await db.rpc("approval_review", { p_token: client.access_token, p_item: it.id, p_decision: decision === "approve" ? "approved" : "changes", p_note: note || null, p_version: null });
      if (r.error || !r.data?.ok) { console.error("approval_review", r.error?.message ?? JSON.stringify(r.data)); return E("decide_failed", "We could not save that. Try again."); }
      return J({ ok: true, status: decision === "approve" ? "approved" : "changes" });
    }

    /* video_make */
    if (action === "video_make") {
      if (!signup.client_slug) return E("no_video_plan", "Videos come with the Premium plan. Pick a plan first.");
      if (!uuidRe.test(String(body.listing_id ?? ""))) return E("not_found", "We could not find that listing.", 404);
      const { data: l } = await db.from("re_listings").select("*").eq("id", body.listing_id).eq("signup_id", signup.id).maybeSingle();
      if (!l) return E("not_found", "We could not find that listing.", 404);
      const { data: ph } = await db.from("re_listing_photos").select("id,storage_path,room_label,position,use_in_video,has_people,has_text")
        .eq("listing_id", l.id).not("storage_path", "is", null);
      const usable = (ph ?? []).filter((p: any) => p.use_in_video !== false && !p.has_people && !p.has_text);
      if (usable.length < 5) return E("too_few_photos", "We need at least 5 usable photos with no people or text in them to make a video.", 200, { usable: usable.length });
      const ent = (await db.rpc("studio_entitlement", { p_slug: signup.client_slug })).data ?? {};
      if (!ent.billing || ent.plan !== "premium") return E("no_video_plan", "Videos come with the Premium plan.");
      if (!ent.can_video) return E("no_videos_left", "You are out of videos this month. You can buy one more for $15.", 200, { extra_video: { cents: 1500, price: "$15" } });

      usable.sort((a: any, b: any) => (ROOM_RANK[a.room_label ?? "other"] ?? 6) - (ROOM_RANK[b.room_label ?? "other"] ?? 6) || (a.position ?? 0) - (b.position ?? 0));
      const picked = usable.slice(0, 12);
      const urls = await signMany(picked.map((p: any) => p.storage_path), 7200);
      const motions = ["push", "drift_l", "drift_r"];
      let ltx = 0;
      const clips = picked.map((p: any, i: number) => {
        let motion = motions[i % 3];
        if (ent.plan === "premium" && ltx < 3 && WIDE.has(p.room_label ?? "")) { motion = "ltx_push"; ltx++; }
        return { photo_id: p.id, path: p.storage_path, room_label: p.room_label ?? null, motion, seconds: motion === "ltx_push" ? 5 : 4.5, url: urls[i] ?? null };
      });
      const { data: music } = await db.from("studio_music_tracks").select("id").eq("active", true).in("mood", ["calm", "upbeat"]);
      const track = music?.length ? music[Math.floor(Math.random() * music.length)].id : null;
      const a = signup.answers ?? {};
      const facts = [l.beds != null ? `${Number(l.beds)} bd` : "", l.baths != null ? `${Number(l.baths)} ba` : "", l.sqft != null ? `${Number(l.sqft).toLocaleString("en-US")} sq ft` : ""].filter(Boolean).join(" · ");
      const brandPaths = [a.brand?.logo_path, a.brand?.headshot_path].filter((p: any) => typeof p === "string" && p.startsWith(`signups/${signup.id}/`));
      const brandUrls = await signMany(brandPaths, 7200);
      const script = {
        listing_id: l.id,
        address_line: [l.street, l.city].filter(Boolean).join(", "),
        price_line: l.price_usd != null ? money(Number(l.price_usd)) : "",
        facts_line: facts,
        footer: (await db.rpc("re_caption_footer", { signup_id: signup.id })).data ?? "",
        disclosure: DISCLOSURE,
        music_track_id: track,
        end_card: { agent: a.about?.licensed_name || a.about?.name || "", brokerage: a.about?.brokerage || "", license: a.about?.license || "" },
        brand: {
          colors: a.brand?.colors ?? [],
          logo_url: a.brand?.logo_path && brandPaths.includes(a.brand.logo_path) ? brandUrls[brandPaths.indexOf(a.brand.logo_path)] : null,
          headshot_url: a.brand?.headshot_path && brandPaths.includes(a.brand.headshot_path) ? brandUrls[brandPaths.indexOf(a.brand.headshot_path)] : null,
        },
      };
      const r = await db.rpc("re_video_enqueue", { p_slug: signup.client_slug, p_listing: l.id, p_clips: clips, p_script: script, p_brief: `Walkthrough video for ${script.address_line}` });
      const d = r.data;
      if (r.error || !d?.ok) {
        if (d?.reason === "no_video") return d.detail === "no_credits" ? E("no_videos_left", "You are out of videos this month. You can buy one more for $15.", 200, { extra_video: { cents: 1500, price: "$15" } }) : E("no_video_plan", "Videos come with the Premium plan.");
        if (d?.reason === "ceiling") return E("no_videos_left", "You have reached this month's video limit. Talk to us at studio@bestly.tech.");
        console.error("video enqueue", r.error?.message ?? JSON.stringify(d));
        return E("video_failed", "We could not start that video. Nothing was used. Try again.");
      }
      return J({ ok: true, job_id: d.job_id, videos_left: d.videos_left });
    }

    /* connect */
    if (action === "connect_status") return J({ ok: true, ...(await connStatus(signup)), networks: await networks() });
    if (action === "wait") {
      const plats = (Array.isArray(body.platforms) ? body.platforms : []).map(String).slice(0, 10);
      const open = new Set((await networks()).filter((n) => !n.open).map((n) => n.id));
      const rows = plats.filter((p: string) => open.has(p)).map((p: string) => ({ signup_id: signup.id, platform: p, email: signup.email }));
      if (rows.length) await db.from("studio_network_waits").upsert(rows, { onConflict: "signup_id,platform", ignoreDuplicates: true });
      return J({ ok: true, waiting: rows.map((r: any) => r.platform) });
    }
    if (action === "connect_start") {
      const provider = String(body.provider ?? "");
      const net = (await networks()).find((n) => n.id === provider);
      if (!net) return E("bad_provider", "That account type is not available yet.", 400);
      if (!net.open) {
        await db.from("studio_network_waits").upsert({ signup_id: signup.id, platform: provider, email: signup.email }, { onConflict: "signup_id,platform", ignoreDuplicates: true });
        return J({ ok: true, url: null, waitlisted: true, message: `${net.name} is not open to new sign-ups yet. We will email you the day it opens.` });
      }
      if (!(await allow(`connect:${signup.id}`, 20, 3600, true))) return E("rate_limited", RATE_MSG, 429);
      const ens = await db.rpc("studio_ensure_client", { p_signup_id: signup.id });
      if (ens.error || !ens.data?.client_id) { console.error("ensure client", ens.error?.message); return E("connect_failed", "We could not start that. Try again in a minute."); }
      const cid = ens.data.client_id as string;
      const r = await db.rpc("social_connect_mint", { p_client: cid, p_by: `self-serve ${signup.email}`, p_platform: provider });
      if (r.error || !r.data) { console.error("connect mint", r.error?.message); return J({ ok: true, url: null, message: "Coming soon" }); }
      return J({ ok: true, url: r.data });
    }

    /* billing */
    if (action === "checkout") {
      if (String(body.plan ?? "") === "extra_video") return await extraVideoCheckout(signup, body);
      const plan = String(body.plan ?? "") as PlanId;
      const cadence = String(body.cadence ?? "monthly") as Cadence;
      if (!PLANS[plan]) return E("bad_plan", "Pick one of the two plans first.", 400);
      if (!["monthly", "annual"].includes(cadence)) return E("bad_cadence", "Pick monthly or annual.", 400);
      if (signup.client_slug) {
        const { data: bill } = await db.from("studio_billing").select("status").eq("client_slug", signup.client_slug).maybeSingle();
        if (bill && ["trialing", "active", "past_due", "paused"].includes(bill.status)) return E("already_subscribed", "You already have a plan. Use Manage billing in Settings.");
      }
      // No card until something can actually be posted: one account connected on a network open to new sign-ups.
      if ((await openConnected(signup)) < 1) return E("connect_first", "Connect one account first. We do not ask for a card until we can post for you.");
      const ctx = { db, url: SB_URL, secret: SB_SECRET };
      // The customer lives in a column. studio-billing's ensureCustomer returns early for a cached id, so it never rewrites answers.
      let customer: string | null = signup.stripe_customer ?? null;
      if (!customer) {
        const key = await stripeKey(ctx);
        if (!key) return E("checkout_failed", "We could not start the checkout. Nothing was charged. Try again in a minute.");
        const p = new URLSearchParams({ email: signup.email, "metadata[bestly_surface]": "studio", "metadata[studio_signup]": signup.id });
        const nm = String(signup.answers?.about?.name ?? "").slice(0, 120); if (nm) p.set("name", nm);
        const r = await fetch("https://api.stripe.com/v1/customers", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `studio-customer-${signup.id}` }, body: p });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.id) { console.error("stripe customer", r.status, j?.error?.message); return E("checkout_failed", "We could not start the checkout. Nothing was charged. Try again in a minute."); }
        customer = j.id as string;
        await db.from("studio_signups").update({ stripe_customer: customer }).eq("id", signup.id);
      }
      const out = await createCheckout(ctx, { id: signup.id, email: signup.email, answers: { _stripe_customer: customer } }, plan, cadence, SITE);
      if (!out.ok) return E("checkout_failed", out.error ?? "We could not start the checkout. Nothing was charged.");
      await db.from("studio_signups").update({ plan, cadence_billing: cadence, updated_at: new Date().toISOString() }).eq("id", signup.id);
      return J({ ok: true, url: out.url });
    }
    if (action === "billing") {
      if (!signup.client_slug) return J({ ok: true, billing: false, can_post: false, reason: "no_card_on_file", trial_days: TRIAL_DAYS });
      const { data, error } = await db.rpc("studio_entitlement", { p_slug: signup.client_slug });
      if (error) return E("billing_failed", "Could not read your plan just now.", 500);
      return J({ ok: true, ...(data as Record<string, unknown>) });
    }
    if (action === "portal") {
      if (!signup.client_slug) return E("no_card_on_file", "Pick a plan first.");
      const { data: b } = await db.from("studio_billing").select("stripe_customer").eq("client_slug", signup.client_slug).maybeSingle();
      if (!b?.stripe_customer) return E("no_card_on_file", "Pick a plan first.");
      const out = await createPortal({ db, url: SB_URL, secret: SB_SECRET }, b.stripe_customer as string, `${SITE}/me`);
      return out.ok ? J({ ok: true, url: out.url }) : E("portal_failed", out.error ?? "We could not open the billing page.");
    }

    /* passkeys */
    if (action === "passkey_options") {
      const { data: keys } = await db.from("re_passkeys").select("credential_id,transports").eq("signup_id", signup.id);
      const opts = await generateRegistrationOptions({
        rpName: "Bestly Studio", rpID: RP_ID, userName: signup.email, userDisplayName: String(signup.answers?.about?.name || signup.email).slice(0, 80),
        userID: new TextEncoder().encode(signup.id), attestationType: "none",
        excludeCredentials: (keys ?? []).map((k: any) => ({ id: k.credential_id, transports: k.transports ?? undefined })),
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      });
      await db.from("re_webauthn_challenges").delete().lt("expires_at", new Date().toISOString());
      await db.from("re_webauthn_challenges").insert({ challenge: opts.challenge, kind: "reg", signup_id: signup.id });
      return J({ ok: true, ...opts });
    }
    if (action === "passkey_save") {
      const cred = body.credential;
      try {
        const { data: ch } = await db.from("re_webauthn_challenges").select("id,challenge,expires_at").eq("signup_id", signup.id).eq("kind", "reg").order("created_at", { ascending: false }).limit(1).maybeSingle();
        if (!ch || new Date(ch.expires_at).getTime() < Date.now()) return E("passkey_failed", "That took too long. Try again.");
        await db.from("re_webauthn_challenges").delete().eq("id", ch.id);
        const v = await verifyRegistrationResponse({ response: cred, expectedChallenge: ch.challenge, expectedOrigin: ORIGINS, expectedRPID: RP_ID });
        if (!v.verified || !v.registrationInfo) return E("passkey_failed", "We could not save that passkey.");
        const c = v.registrationInfo.credential;
        const ins = await db.from("re_passkeys").insert({
          signup_id: signup.id, credential_id: c.id, public_key: b64u(c.publicKey), counter: c.counter,
          transports: cred?.response?.transports ?? c.transports ?? null, device_name: String(body.device_name ?? "").slice(0, 60) || null });
        if (ins.error) return E("passkey_failed", "We could not save that passkey.");
        return J({ ok: true, saved: true });
      } catch (e) { console.error("passkey_save", String(e)); return E("passkey_failed", "We could not save that passkey."); }
    }

    /* forget */
    if (action === "forget") {
      if (signup.client_slug) {
        const { data: b } = await db.from("studio_billing").select("status").eq("client_slug", signup.client_slug).maybeSingle();
        if (b && ["trialing", "active", "past_due", "paused"].includes(b.status)) return E("has_billing", "Cancel your plan in Manage billing first, then you can delete your account.");
      }
      // storage first (listing photos, logo, headshot), then rows
      for (const kind of ["photo", "logo", "headshot", "zip"]) {
        const folder = `signups/${signup.id}/${kind}`;
        for (let guard = 0; guard < 20; guard++) {   // up to 20,000 files; each pass removes what it lists
          const { data: objs } = await db.storage.from(BUCKET).list(folder, { limit: 1000 });
          if (!objs?.length) break;
          await db.storage.from(BUCKET).remove(objs.map((o: any) => `${folder}/${o.name}`));
        }
      }
      if (signup.pre_client_slug && !signup.client_slug) {   // unpaid: disconnect anything they linked before the card
        const pc = await clientId(signup.pre_client_slug);
        if (pc) await db.from("social_accounts").update({ active: false, access_token: null, refresh_token: null }).eq("client_id", pc);
      }
      await db.from("studio_network_waits").delete().eq("signup_id", signup.id);
      await db.from("re_listings").delete().eq("signup_id", signup.id);           // photos + short links cascade
      await db.from("studio_connections").delete().eq("signup_id", signup.id);
      await db.from("studio_signups").delete().eq("id", signup.id);               // magic links, passkeys, challenges cascade
      return J({ ok: true, gone: true });
    }

    return E("unknown_action", "That action does not exist.", 400);
  } catch (e) {
    console.error("studio-re", action, String((e as any)?.stack ?? e));
    return E("server_error", "Something went wrong on our side. Try again in a minute.", 500);
  }
}

Deno.serve(async (req) => {
  let res: Response;
  try { res = await handle(req); }
  catch (e) { console.error("studio-re top", String((e as any)?.stack ?? e).slice(0, 600)); res = E("server_error", "Something went wrong on our side. Try again in a minute.", 500); }
  for (const [k, v] of Object.entries(corsFor(req))) res.headers.set(k, v);
  return res;
});
