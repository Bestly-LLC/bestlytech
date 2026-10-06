// partner-google — Eli's Google Calendar. Connect once, then every meeting Ava books lands on his calendar.
//
// JSON actions (POST, signed-in partner or admin):
//   start       -> { ok, url }                 Google consent URL to open
//   status      -> { ok, configured, connected, email, needs_reconnect }
//   disconnect  -> { ok }                      revokes at Google, deletes the Vault secret and the row
//   book        -> { ok, meet_url, ... }       { call_id, start_at (ISO), duration_min = 30 }
// Browser redirect (GET):
//   /callback   Google sends the browser here after consent.
//
// WHY verify_jwt = false (see supabase/config.toml): Google's redirect to /callback is a plain browser GET with no
// Supabase JWT, so the gateway cannot check one. Instead:
//   - every JSON action validates the caller's JWT itself (auth.getUser) and requires the partner or admin role;
//   - /callback trusts nothing but the signed `state` it issued: HMAC-SHA256 over {user id, expiry, nonce}, keyed with
//     GOOGLE_OAUTH_CLIENT_SECRET, valid 10 minutes. A raw user id from the client is never believed.
//
// TWO EVENTS per booked call, because Google allows one description per event:
//   A) the meeting: the lead is an attendee, Google Meet link, customer-facing description only (fixed text below).
//   B) the prep brief: private, Eli only, no attendees, 15 minutes before A, the internal brief plus the Meet link.
// Booking is idempotent: rg_calls.cal_event_id / cal_prep_event_id are saved as soon as they exist, and a second
// book updates those same events (same Meet link) instead of creating new ones.
//
// SETUP (once): set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in Edge Function secrets, and add the
// callback to the OAuth client's authorized redirect URIs. Use https://bestly.tech/auth/google/callback (rewritten
// to this function in vercel.json) and set GOOGLE_REDIRECT_URI to the same value, so nothing a customer sees says
// supabase.co. Without GOOGLE_REDIRECT_URI it falls back to <SUPABASE_URL>/functions/v1/partner-google/callback.
// With the secrets missing every action answers { configured: false } and the callback shows a plain page.
//
// Deterministic only: no AI / LLM calls anywhere in this function. The refresh token lives in Vault
// (partner_google_refresh_<user_id>), never in a table the browser can read.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPABASE_URL, SB_SECRET, { auth: { persistSession: false } });

const CLIENT_ID = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") ?? "";
const CONFIGURED = !!(CLIENT_ID && CLIENT_SECRET);
// What Google redirects back to, and what we must repeat on the token exchange -- the two have to match exactly.
// Default is the raw Supabase URL. Set GOOGLE_REDIRECT_URI to a bestly.tech path instead (Vercel rewrites it
// straight to this function) so the consent screen a customer sees says bestly.tech, never supabase.co.
const REDIRECT_URI = Deno.env.get("GOOGLE_REDIRECT_URI")
  || `${SUPABASE_URL}/functions/v1/partner-google/callback`;
const SCOPES = "https://www.googleapis.com/auth/calendar.events openid email";
const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const SITE = "https://bestly.tech";
const ALERT_KEY = "rg:booking";
const AGENT = "roofguard-outreach";
const DEFAULT_TZ = "America/Los_Angeles";

const CORS = corsWith({ headers: "authorization, x-client-info, apikey, content-type", methods: "POST, GET, OPTIONS" });
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const fail = (code: string, message: string, extra: Record<string, unknown> = {}) => J({ ok: false, code, message, ...extra });

// ---------- small page, same look as social-connect ----------
function page(title: string, body: string, ok = true) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name=viewport content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
max-width:640px;margin:10vh auto;padding:0 24px;color:#14202E;background:#F7F8FA}
h1{font-size:26px;margin:0 0 12px;color:${ok ? "#1C6B4A" : "#A4262C"}}
code{background:#EDF0F4;padding:2px 6px;border-radius:4px;font-size:13px;word-break:break-all}
.box{background:#fff;border:1px solid #E1E6EC;border-radius:10px;padding:20px 24px;margin-top:18px}
a{color:#12507E;font-weight:600}</style>
<h1>${title}</h1>${body}`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// ---------- signed state ----------
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hmacKey = () => crypto.subtle.importKey("raw", new TextEncoder().encode(CLIENT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
async function signState(userId: string): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const body = b64u(new TextEncoder().encode(JSON.stringify({ u: userId, exp: Date.now() + 10 * 60_000, n: b64u(nonce) })));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), new TextEncoder().encode(body));
  return `${body}.${b64u(sig)}`;
}
async function readState(state: string | null): Promise<string | null> {
  if (!state || !state.includes(".")) return null;
  const [body, sig] = state.split(".");
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), unb64u(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const p = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return typeof p.u === "string" && Number(p.exp) > Date.now() ? p.u : null;
  } catch { return null; }
}

// ---------- watchdog: every failure is one alert, owned by roofguard-outreach; success resolves it ----------
async function raise(kind: "problem" | "resolved", title: string, body: string, needsJared: string | null = null) {
  await db.rpc("bestly_raise", { p_key: ALERT_KEY, p_kind: kind, p_severity: "warning", p_title: title, p_body: body, p_area: "roofguard", p_needs_jared: needsJared, p_healed: false })
    .then(() => {}, () => {});
}
const beat = (ok: boolean, summary: string) => db.rpc("agent_beat", { p_slug: AGENT, p_ok: ok, p_summary: summary.slice(0, 200) }).then(() => {}, () => {});

// ---------- caller ----------
type Caller = { id: string; admin: boolean; partner: boolean };
async function caller(req: Request): Promise<Caller | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  const id = data?.user?.id;
  if (!id) return null;
  const has = async (role: string) => !!(await db.rpc("has_role", { _user_id: id, _role: role })).data;
  const [admin, partner] = await Promise.all([has("admin"), has("partner")]);
  return admin || partner ? { id, admin, partner } : null;
}

// ---------- Google tokens ----------
const vaultName = (userId: string) => `partner_google_refresh_${userId}`;
class Reconnect extends Error {}

async function tokenCall(params: Record<string, string>) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) as Record<string, string> };
}

async function accessToken(userId: string): Promise<string> {
  const { data: row } = await db.from("partner_google").select("vault_secret_name").eq("user_id", userId).maybeSingle();
  if (!row) throw new Reconnect("not connected");
  const { data: refresh } = await db.rpc("partner_google_vault_get", { p_name: row.vault_secret_name });
  if (!refresh) { await markReconnect(userId, "refresh token missing from Vault"); throw new Reconnect("token missing"); }
  const t = await tokenCall({ grant_type: "refresh_token", refresh_token: String(refresh) });
  if (!t.ok) {
    if (t.body.error === "invalid_grant") { await markReconnect(userId, "Google said invalid_grant"); throw new Reconnect("invalid_grant"); }
    throw new Error(`Google token error ${t.status}: ${t.body.error ?? ""}`);
  }
  await db.from("partner_google").update({ last_ok_at: new Date().toISOString(), last_error: null }).eq("user_id", userId);
  return t.body.access_token;
}

async function markReconnect(userId: string, why: string) {
  await db.from("partner_google").update({ needs_reconnect: true, last_error: why }).eq("user_id", userId);
  await raise("problem", "Eli's Google Calendar needs to be reconnected",
    "Google stopped accepting the saved sign-in, so Ava cannot add booked meetings to Eli's calendar until he reconnects.",
    "Eli taps Reconnect Google Calendar in his portal (Ava, then the Meetings tab).");
}

// ---------- calendar ----------
const GCAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
async function gcal(token: string, method: string, path: string, query: Record<string, string>, body?: unknown) {
  const u = new URL(GCAL + path); for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  const r = await fetch(u, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const json = await r.json().catch(() => ({})) as Record<string, any>;
  return { ok: r.ok, status: r.status, json };
}
const meetUrl = (ev: Record<string, any>): string | null =>
  ev?.hangoutLink ?? ev?.conferenceData?.entryPoints?.find((e: any) => e.entryPointType === "video")?.uri ?? null;

const MEETING_DESCRIPTION = `A short call with Eli Cooper, who runs the RoofGuard program at Legacy Building Maintenance Company.

What we'll cover:
- Where your roof's maintenance and warranty stand today
- How the RoofGuard maintenance program works, and whether it fits your building
- Your questions

Eli Cooper · BDC Universal
eli.cooper@bdcuniversal.com · (816) 588-3683`;

const txt = (v: unknown) => (v == null ? "" : String(v).trim());
const line = (label: string, parts: unknown[], sep = " · ") => {
  const s = parts.map(txt).filter(Boolean).join(sep);
  return s ? `${label}: ${s}` : null;
};

function prepBrief(c: Record<string, any>, l: Record<string, any>, meet: string | null): string {
  const who = [[c.dm_name, c.dm_title].map(txt).filter(Boolean).join(", "), l.phone];
  return [
    line("Who", who),
    line("Company", [l.company, l.category, l.state, l.timezone]),
    line("Roof", [l.roof_volume, l.footprint, l.site_model, txt(l.risk_tier) ? `risk ${txt(l.risk_tier)}` : ""]),
    line("Website", [l.website]),
    line("They said", [c.meeting_times]),
    line("Email", [c.meeting_email]),
    line("Ava's summary", [c.summary]),
    line("Notes", [c.notes]),
    line("Next", [c.next_actions]),
    line("Recording", [c.recording_url]),
    line("Join", [meet]),
  ].filter(Boolean).join("\n");
}

async function book(who: Caller, body: Record<string, any>) {
  const callId = txt(body.call_id);
  const startMs = Date.parse(txt(body.start_at));
  const dur = Math.min(240, Math.max(15, Math.round(Number(body.duration_min) || 30)));
  if (!callId) return fail("bad_request", "Pick a meeting to add.");
  if (!Number.isFinite(startMs)) return fail("bad_time", "That date and time did not look right. Pick it again.");
  if (startMs < Date.now() - 5 * 60_000) return fail("bad_time", "That time has already passed. Pick a time in the future.");

  const { data: c } = await db.from("rg_calls").select("*").eq("id", callId).maybeSingle();
  if (!c || c.outcome !== "booked") return fail("not_booked", "That call is not a booked meeting.");
  const { data: l } = await db.from("rg_leads").select("*").eq("id", c.lead_id).maybeSingle();
  if (!l) return fail("not_booked", "Could not find the company for that meeting.");

  // Whose calendar: the partner's own. An admin books onto the connected partner's calendar (Eli's).
  let ownerId = who.id;
  if (!who.partner) {
    const { data: ps } = await db.from("partners").select("user_id").not("user_id", "is", null);
    const ids = (ps ?? []).map((p: any) => p.user_id);
    const { data: g } = await db.from("partner_google").select("user_id").in("user_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
      .order("connected_at", { ascending: false }).limit(1);
    if (!g?.length) return fail("not_connected", "Eli has not connected Google Calendar yet.");
    ownerId = g[0].user_id;
  } else {
    const { data: g } = await db.from("partner_google").select("user_id").eq("user_id", ownerId).maybeSingle();
    if (!g) return fail("not_connected", "Connect Google Calendar first.");
  }

  let token: string;
  try { token = await accessToken(ownerId); }
  catch (e) {
    if (e instanceof Reconnect) return fail("reconnect", "Google Calendar needs to be reconnected before Ava can add this meeting.");
    await saveError(callId, String(e)); await raise("problem", "Could not reach Google Calendar", `Booking ${l.company} failed: ${String(e).slice(0, 300)}`);
    return fail("google", "Google did not answer. Try again in a minute.");
  }

  const tz = txt(l.timezone) || DEFAULT_TZ;
  const start = new Date(startMs), end = new Date(startMs + dur * 60_000), prepStart = new Date(startMs - 15 * 60_000);
  const win = (s: Date, e: Date) => ({ start: { dateTime: s.toISOString(), timeZone: tz }, end: { dateTime: e.toISOString(), timeZone: tz } });
  const company = txt(l.company) || "your building";
  const email = txt(c.meeting_email);

  try {
    // ---- A: the meeting ----
    const evA: Record<string, unknown> = {
      summary: `Roof walkthrough — ${company}`, description: MEETING_DESCRIPTION, ...win(start, end),
      reminders: { useDefault: true }, ...(email ? { attendees: [{ email }] } : {}),
    };
    let a: { ok: boolean; status: number; json: Record<string, any> } | null = null;
    if (c.cal_event_id) {
      a = await gcal(token, "PATCH", `/${encodeURIComponent(c.cal_event_id)}`, { conferenceDataVersion: "1", sendUpdates: "all" }, evA);
      if (a.ok && a.json.status === "cancelled") a = null;                      // deleted by Eli: make a fresh one
      else if (!a.ok && (a.status === 404 || a.status === 410)) a = null;
    }
    if (!a) {
      a = await gcal(token, "POST", "", { conferenceDataVersion: "1", sendUpdates: "all" }, {
        ...evA, conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
      });
    }
    if (!a.ok) throw new GoogleError(a.status, a.json);
    const eventId = String(a.json.id);
    let meet = meetUrl(a.json) ?? (c.cal_event_id === eventId ? c.cal_meet_url : null);
    for (let i = 0; i < 4 && !meet; i++) {                                       // Meet link is sometimes made a moment later
      await new Promise((r) => setTimeout(r, 900));
      const g = await gcal(token, "GET", `/${encodeURIComponent(eventId)}`, {});
      meet = g.ok ? meetUrl(g.json) : null;
    }
    // Save A right away so a failure on B can never lead to a duplicate meeting on retry.
    await db.from("rg_calls").update({ cal_event_id: eventId, cal_meet_url: meet, cal_start_at: start.toISOString(), cal_booked_by: who.id }).eq("id", callId);

    // ---- B: the private prep brief ----
    const contact = txt(c.dm_name);
    const evB = {
      summary: contact ? `Prep: ${company} — ${contact}` : `Prep: ${company}`, description: prepBrief(c, l, meet),
      visibility: "private", ...win(prepStart, start), reminders: { useDefault: true },
    };
    let b: { ok: boolean; status: number; json: Record<string, any> } | null = null;
    if (c.cal_prep_event_id) {
      b = await gcal(token, "PATCH", `/${encodeURIComponent(c.cal_prep_event_id)}`, {}, evB);
      if (b.ok && b.json.status === "cancelled") b = null;
      else if (!b.ok && (b.status === 404 || b.status === 410)) b = null;
    }
    if (!b) b = await gcal(token, "POST", "", {}, evB);
    if (!b.ok) throw new GoogleError(b.status, b.json);

    await db.from("rg_calls").update({ cal_prep_event_id: String(b.json.id), cal_error: meet ? null : "Google was slow making the Meet link. Change the time to retry." }).eq("id", callId);
    await raise("resolved", "Eli's calendar bookings are working", `${company} is on Eli's calendar.`);
    await beat(true, `Put ${company} on Eli's calendar`);
    return J({ ok: true, meet_url: meet, cal_event_id: eventId, cal_start_at: start.toISOString(), updated: !!c.cal_event_id });
  } catch (e) {
    if (e instanceof GoogleError && e.status === 401) {
      await markReconnect(ownerId, "Google rejected the access token");
      await saveError(callId, "Google Calendar needs to be reconnected");
      return fail("reconnect", "Google Calendar needs to be reconnected before Ava can add this meeting.");
    }
    const detail = e instanceof GoogleError ? `Google ${e.status}: ${e.reason}` : String(e);
    await saveError(callId, detail);
    await raise("problem", "Could not add a booked meeting to Eli's calendar", `${company}: ${detail.slice(0, 300)}`);
    await beat(false, `Calendar booking failed for ${company}`);
    const msg = e instanceof GoogleError && e.status === 403 ? "Google would not let Ava use that calendar. Reconnect Google Calendar and try again."
      : e instanceof GoogleError && e.status === 400 ? "Google did not accept that meeting. Check the time and email, then try again."
      : "The meeting did not reach your calendar. Try again in a minute.";
    return fail("google", msg);
  }
}

class GoogleError extends Error {
  status: number; reason: string;
  constructor(status: number, json: Record<string, any>) { super("google"); this.status = status; this.reason = String(json?.error?.message ?? json?.error ?? "").slice(0, 200); }
}
const saveError = (callId: string, msg: string) => db.from("rg_calls").update({ cal_error: msg.slice(0, 300) }).eq("id", callId).then(() => {}, () => {});

// ---------- connect / callback ----------
async function callback(url: URL) {
  if (!CONFIGURED) return page("Not set up yet", `<div class=box><p>Google Calendar is not set up on our side yet. Tell Jared, then try again.</p></div>`, false);
  const denied = url.searchParams.get("error");
  if (denied) return page("Google Calendar not connected", `<div class=box><p>Google said: <code>${esc(denied)}</code></p><p>Nothing was saved. Go back to your portal and tap Connect Google Calendar to try again.</p></div>`, false);
  const userId = await readState(url.searchParams.get("state"));
  if (!userId) return page("That link expired", `<div class=box><p>Go back to your portal and tap <b>Connect Google Calendar</b> again.</p></div>`, false);
  const code = url.searchParams.get("code");
  if (!code) return page("No code returned", `<div class=box>Google sent no authorization code. Please try again.</div>`, false);

  try {
    const t = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI });
    if (!t.ok) throw new Error(`Google token error: ${t.body.error ?? t.status}`);
    const scope = String(t.body.scope ?? "");
    if (!scope.includes(CAL_SCOPE)) {
      return page("Calendar permission missing", `<div class=box><p>Google connected, but the calendar box was not ticked, so Ava cannot add meetings.</p><p>Go back to your portal, tap <b>Connect Google Calendar</b>, and leave every box ticked.</p></div>`, false);
    }
    if (!t.body.refresh_token) throw new Error("Google sent no refresh token");
    let email = "";
    try { email = String(JSON.parse(new TextDecoder().decode(unb64u(String(t.body.id_token).split(".")[1]))).email ?? ""); } catch { /* fall through */ }
    if (!email) {
      const ui = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${t.body.access_token}` } });
      email = String((await ui.json().catch(() => ({}))).email ?? "");
    }
    const name = vaultName(userId);
    const put = await db.rpc("partner_google_vault_put", { p_name: name, p_secret: t.body.refresh_token });
    if (put.error) throw new Error("Could not store the sign-in securely");
    const { error } = await db.from("partner_google").upsert({
      user_id: userId, email: email || null, vault_secret_name: name, scope, connected_at: new Date().toISOString(),
      last_ok_at: new Date().toISOString(), last_error: null, needs_reconnect: false,
    }, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    await raise("resolved", "Eli's Google Calendar is connected again", "Ava can add booked meetings to his calendar.");
    return page("Google Calendar connected", `<div class=box>
<p>Connected as <b>${esc(email || "your Google account")}</b>.</p>
<p>From now on, each meeting Ava books can go on your calendar with a Google Meet link, plus a private prep note 15 minutes before.</p>
<p style="margin-top:16px"><a href="${SITE}/partner">Back to your portal →</a></p></div>`);
  } catch (e) {
    await raise("problem", "Google Calendar connection failed", String(e).slice(0, 300));
    return page("Connection failed", `<div class=box><p>Something went wrong connecting Google Calendar. Nothing was saved.</p><p>Go back to your portal and try again. If it keeps failing, tell Jared.</p></div>`, false);
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method === "GET" && url.pathname.split("/").pop() === "callback") return callback(url);
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);

  const who = await caller(req);
  if (!who) return J({ ok: false, code: "forbidden", message: "Sign in again to continue." }, 401);
  const body = await req.json().catch(() => ({})) as Record<string, any>;
  const action = String(body.action ?? "");

  if (action === "status") {
    const { data: g } = await db.from("partner_google").select("email, needs_reconnect").eq("user_id", who.id).maybeSingle();
    return J({ ok: true, configured: CONFIGURED, connected: !!g, email: g?.email ?? null, needs_reconnect: !!g?.needs_reconnect });
  }
  if (!CONFIGURED) return J({ ok: false, configured: false, code: "not_configured", message: "Not set up yet." });

  if (action === "start") {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.searchParams.set("client_id", CLIENT_ID);
    u.searchParams.set("redirect_uri", REDIRECT_URI);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", SCOPES);
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("include_granted_scopes", "true");
    u.searchParams.set("state", await signState(who.id));
    return J({ ok: true, configured: true, url: u.toString() });
  }

  if (action === "disconnect") {
    const { data: g } = await db.from("partner_google").select("vault_secret_name").eq("user_id", who.id).maybeSingle();
    if (g) {
      const { data: refresh } = await db.rpc("partner_google_vault_get", { p_name: g.vault_secret_name });
      if (refresh) await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: String(refresh) }),
      }).catch(() => {});
      await db.rpc("partner_google_vault_delete", { p_name: g.vault_secret_name });
      await db.from("partner_google").delete().eq("user_id", who.id);
    }
    return J({ ok: true });
  }

  if (action === "book") return book(who, body);
  return fail("bad_request", "Unknown action.");
});
