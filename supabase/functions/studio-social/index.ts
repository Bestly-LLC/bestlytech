// studio-social — lets any Studio client connect their own accounts.
//
// The pages live on www.bestly.tech/connect/ (Supabase will not serve HTML from an
// edge function), and talk to this function as a small JSON API:
//
//   Links: a client is sent a SHORT link, bestly.tech/c/xxxxxxxx. `k` below is either that
//   8-character code or the legacy 48-hex token; both resolve the same one-use row.
//   POST {op:"resolve", k}             -> which platform the link is for
//
//   Instagram (Instagram Login; Business or Creator account, no Facebook Page):
//   POST {op:"start",  k}              a one-use link minted by Studio (staff or client)
//                                      -> the client's name and the Instagram authorize URL
//   POST {op:"finish", k, code}        Instagram's code -> 60-day token on the client's
//                                      social_accounts row (bestly-ig-poster refreshes it)
//   POST {op:"setup",  s, app_id, app_secret}   one-time: the Instagram app id + secret
//
//   TikTok (Login Kit; inbox mode — videos land in her drafts, she taps Post):
//   POST {op:"tiktok_start",  k}       -> the TikTok authorize URL
//   POST {op:"tiktok_finish", k, code} TikTok's code -> access + refresh token on the
//                                      client's social_accounts row (tiktok-inbox refreshes)
//   POST {op:"tiktok_setup", s, client_key, client_secret}   one-time: the TikTok app creds
//
//   Facebook (Facebook Login for Business; posts to a Page, not a profile):
//   POST {op:"fb_start",  k}        -> the Facebook authorize URL
//   POST {op:"fb_finish", k, code}   Facebook's code -> her Pages. One Page: connected.
//                                    Several: {pick:[{id,name}]} and the Page tokens wait
//                                    server-side (never sent to the browser)
//   POST {op:"fb_pick",   k, page_id} the Page she chose -> connected
//   POST {op:"fb_setup", s, app_id, app_secret, config_id?}  one-time: the Meta app creds (Vault)
//
//   LinkedIn (3-legged OAuth). Default (v10): posts to the PERSON's own profile with the app's
//   "Share on LinkedIn" + "Sign In with OpenID" products (w_member_social; no LinkedIn review,
//   60-day token, no refresh token, so she reconnects every ~2 months). If the app's scopes are
//   ever switched to Community Management (w_organization_social), li_finish falls back to the
//   company-Page flow below automatically.
//   POST {op:"li_start",  k}        -> the LinkedIn authorize URL
//   POST {op:"li_finish", k, code}   LinkedIn's code -> token; profile mode stores urn:li:person:<sub>.
//                                    Page mode: the Pages she administers, one = connected,
//                                    several = {pick:[{id,name}]}, none = no_company_page
//   POST {op:"li_pick",   k, org_id} the Page she chose -> connected (Page mode only)
//   POST {op:"li_setup", s, client_id, client_secret, scopes?}  one-time: the LinkedIn app creds (Vault)
//
//   Pinterest (API v5; BUSINESS account; pins go onto one board):
//   POST {op:"pin_start",  k}       -> the Pinterest authorize URL
//   POST {op:"pin_finish", k, code} Pinterest's code -> tokens (held server-side), then her boards:
//                                   {pick_board:[{id,name}], can_create:true}. Personal account: error personal_account
//   POST {op:"pin_pick",   k, board_id | new_board_name}  the board (or a new one) -> connected
//   POST {op:"pin_setup", s, app_id, app_secret}  one-time: the Pinterest app creds (Vault)
//
//   YouTube (Google OAuth, YouTube Data API v3; videos go to the channel she picks on Google's own screen):
//   POST {op:"yt_start",  k}        -> the Google authorize URL
//   POST {op:"yt_finish", k, code}   Google's code -> access + refresh token on the client's social_accounts row
//                                    (bestly-yt-poster refreshes). No upload scope: scope_missing. No channel: no_channel
//   POST {op:"yt_setup", s, client_id, client_secret}  one-time: the Google OAuth client (Vault)
//
// Tokens are never returned, logged or echoed.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const REDIRECT = "https://www.bestly.tech/connect/instagram.html";
const SCOPES = "instagram_business_basic,instagram_business_content_publish";
const TT_REDIRECT = "https://www.bestly.tech/connect/tiktok.html";
const TT_SCOPES = "user.info.basic,video.upload";
const FB_REDIRECT = "https://www.bestly.tech/connect/facebook.html";
const FB_SCOPES = "pages_show_list,pages_manage_posts,pages_read_engagement";
const FB_GRAPH = "https://graph.facebook.com/v23.0";
const LI_REDIRECT = "https://www.bestly.tech/connect/linkedin.html";
// Profile posting (Share on LinkedIn + OpenID). Overridable from the setup page (Vault studio_li_scopes):
// set "r_basicprofile w_organization_social r_organization_social rw_organization_admin" for Page posting
// once an app has Community Management.
const LI_SCOPES = "openid profile w_member_social";
const LI_REST = "https://api.linkedin.com/rest";
// LinkedIn versions are YYYYMM and each one is retired after about a year; walk down this list if one is refused (426).
const LI_VERSIONS = ["202606", "202604", "202601", "202511", "202509"];
const PIN_REDIRECT = "https://www.bestly.tech/connect/pinterest.html";
const PIN_SCOPES = "boards:read,boards:write,pins:read,pins:write,user_accounts:read";
const PIN_API = "https://api.pinterest.com/v5";
const YT_REDIRECT = "https://www.bestly.tech/connect/youtube.html";
const YT_SCOPES = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly";
const YT_API = "https://www.googleapis.com/youtube/v3";
const ORIGINS = new Set(["https://www.bestly.tech", "https://bestly.tech", "https://studio.bestly.tech"]);

const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const scrub = (s: string) => s.replace(/access_token=[^&\s"]+/g, "access_token=…").replace(/IGAA[\w-]+/g, "IGAA…").replace(/act\.[\w!-]+/g, "act.…").replace(/rft\.[\w!-]+/g, "rft.…").replace(/EA[A-Za-z0-9]{30,}/g, "EA…")
  .replace(/AQ[A-Za-z0-9_-]{40,}/g, "AQ…").replace(/pin[ar]_[A-Za-z0-9]{20,}/g, "pin…").replace(/(client_secret|refresh_token|code)=[^&\s"]+/g, "$1=…");
// Google tokens: ya29.… access tokens, 1//… refresh tokens, GOCSPX-… client secrets
const ytScrub = (s: string) => scrub(s).replace(/ya29\.[\w-]+/g, "ya29.…").replace(/1\/\/[\w-]{20,}/g, "1//…").replace(/GOCSPX-[\w-]+/g, "GOCSPX-…");

async function appCreds(): Promise<{ id: string; secret: string } | null> {
  const { data } = await db.rpc("studio_ig_app_get");
  const id = (data as any)?.app_id, secret = (data as any)?.app_secret;
  return id && secret ? { id: String(id), secret: String(secret) } : null;
}
async function ttCreds(): Promise<{ key: string; secret: string } | null> {
  const { data } = await db.rpc("studio_tiktok_app_get");
  const key = (data as any)?.client_key, secret = (data as any)?.client_secret;
  return key && secret ? { key: String(key), secret: String(secret) } : null;
}
async function fbCreds(): Promise<{ id: string; secret: string; config: string | null } | null> {
  const { data } = await db.rpc("studio_fb_app_get");
  const id = (data as any)?.app_id, secret = (data as any)?.app_secret;
  return id && secret ? { id: String(id), secret: String(secret), config: (data as any)?.config_id ? String((data as any).config_id) : null } : null;
}
async function liCreds(): Promise<{ id: string; secret: string; scopes: string } | null> {
  const { data } = await db.rpc("studio_li_app_get");
  const id = (data as any)?.client_id, secret = (data as any)?.client_secret;
  return id && secret ? { id: String(id), secret: String(secret), scopes: String((data as any)?.scopes || LI_SCOPES) } : null;
}
async function pinCreds(): Promise<{ id: string; secret: string } | null> {
  const { data } = await db.rpc("studio_pin_app_get");
  const id = (data as any)?.app_id, secret = (data as any)?.app_secret;
  return id && secret ? { id: String(id), secret: String(secret) } : null;
}
async function ytCreds(): Promise<{ id: string; secret: string } | null> {
  const { data } = await db.rpc("studio_yt_app_get");
  const id = (data as any)?.client_id, secret = (data as any)?.client_secret;
  return id && secret ? { id: String(id), secret: String(secret) } : null;
}
// a one-time setup link: the sha of its secret lives in Vault (setup_link_sha), 24h
async function setupOk(s: string): Promise<boolean> {
  if (!s) return false;
  const { data } = await db.rpc("studio_setup_link_ok", { p_sha: await sha(s) });
  return data === true;
}

async function link(k: string) {
  const short = /^[a-z2-9]{8}$/.test(k);
  if (!short && !/^[0-9a-f]{48}$/.test(k)) return null;
  const q = db.from("social_connect_links")
    .select("id, client_id, expires_at, used_at, created_by, result, approval_clients(name, slug)");
  const { data } = await (short ? q.eq("short_code", k) : q.eq("token_hash", await sha(k))).maybeSingle();
  return data as any;
}
const linkProblem = (l: any) =>
  !l ? "link_not_found" : l.used_at ? "link_used" : Date.parse(l.expires_at) < Date.now() ? "link_expired" : null;
const linkIsFor = (l: any, platform: string) => String(l?.created_by ?? "").endsWith("· " + platform) || (platform === "instagram" && !/·/.test(String(l?.created_by ?? "")));
const linkPlatform = (l: any) => { const m = String(l?.created_by ?? "").match(/· (\w+)$/); return m ? m[1] : "instagram"; };

async function fbGet(path: string, params: Record<string, string>) {
  const u = new URL(FB_GRAPH + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString());
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}

// store one chosen Page on the client's facebook account row, switch Facebook on for the brand
async function fbStore(l: any, page: { id: string; name: string; token: string }) {
  const { data: brand, error: be } = await db.rpc("client_social_brand", { p_client: l.client_id });
  if (be || !brand) return { ok: false, error: "store", detail: be?.message ?? "no brand" };
  const now = new Date().toISOString();
  const patch = {
    access_token: page.token, remote_user_id: page.id, page_id: page.id, handle: page.name,
    token_expires_at: null, last_refreshed_at: now, active: true, publishing_paused: false,
    client_id: l.client_id, connected_via: "studio-social", updated_at: now,
  };
  const { data: ex } = await db.from("social_accounts").select("id").eq("brand", brand).eq("platform", "facebook").maybeSingle();
  const w = ex?.id
    ? await db.from("social_accounts").update(patch).eq("id", ex.id)
    : await db.from("social_accounts").insert({ ...patch, brand, platform: "facebook", label: l.approval_clients?.name ?? null });
  if (w.error) return { ok: false, error: "store", detail: w.error.message };
  await db.rpc("studio_fb_switch_on", { p_brand: brand });
  await db.from("social_connect_links").update({ used_at: now, result: { handle: page.name, page_id: page.id, platform: "facebook" } }).eq("id", l.id);
  return { ok: true, client: l.approval_clients?.name ?? null, handle: page.name, slug: l.approval_clients?.slug ?? null };
}

// ---- LinkedIn helpers ---------------------------------------------------------------------------
let liVersion = LI_VERSIONS[0];
async function liApi(path: string, token: string) {
  for (let i = Math.max(0, LI_VERSIONS.indexOf(liVersion)); i < LI_VERSIONS.length; i++) {
    const r = await fetch(LI_REST + path, {
      headers: { Authorization: "Bearer " + token, "Linkedin-Version": LI_VERSIONS[i], "X-Restli-Protocol-Version": "2.0.0" },
    });
    if (r.status === 426) continue;   // that version is not served any more (or yet)
    liVersion = LI_VERSIONS[i];
    return { status: r.status, json: await r.json().catch(() => ({})) as any };
  }
  return { status: 426, json: {} as any };
}
// urn is set for profile mode (urn:li:person:<sub>); Page mode derives urn:li:organization:<id>
type LiOrg = { id: string; name: string; access_token: string; refresh_token: string | null; token_expires_at: string; refresh_expires_at: string | null; urn?: string };

async function liStore(l: any, org: LiOrg) {
  const { data: brand, error: be } = await db.rpc("client_social_brand", { p_client: l.client_id });
  if (be || !brand) return { ok: false, error: "store", detail: be?.message ?? "no brand" };
  const now = new Date().toISOString();
  const patch = {
    access_token: org.access_token, refresh_token: org.refresh_token, remote_user_id: org.id, page_id: org.urn ?? ("urn:li:organization:" + org.id),
    handle: org.name, token_expires_at: org.token_expires_at, refresh_expires_at: org.refresh_expires_at, last_refreshed_at: now,
    active: true, publishing_paused: false, client_id: l.client_id, connected_via: "studio-social", updated_at: now,
  };
  const { data: ex } = await db.from("social_accounts").select("id").eq("brand", brand).eq("platform", "linkedin").maybeSingle();
  const w = ex?.id
    ? await db.from("social_accounts").update(patch).eq("id", ex.id)
    : await db.from("social_accounts").insert({ ...patch, brand, platform: "linkedin", label: l.approval_clients?.name ?? null });
  if (w.error) return { ok: false, error: "store", detail: w.error.message };
  await db.rpc("studio_li_switch_on", { p_brand: brand });
  await db.from("social_connect_links").update({ used_at: now, result: { handle: org.name, org_id: org.id, urn: org.urn ?? null, platform: "linkedin" } }).eq("id", l.id);
  return { ok: true, client: l.approval_clients?.name ?? null, handle: org.name, slug: l.approval_clients?.slug ?? null, mode: org.urn ? "profile" : "page" };
}

// ---- Pinterest helpers --------------------------------------------------------------------------
async function pinGet(path: string, token: string) {
  const r = await fetch(PIN_API + path, { headers: { Authorization: "Bearer " + token } });
  return { status: r.status, json: await r.json().catch(() => ({})) as any };
}
async function pinBoards(token: string): Promise<{ id: string; name: string }[]> {
  const out: { id: string; name: string }[] = [];
  let bookmark = "";
  for (let i = 0; i < 5; i++) {
    const r = await pinGet("/boards?page_size=100" + (bookmark ? "&bookmark=" + encodeURIComponent(bookmark) : ""), token);
    if (r.status !== 200) break;
    for (const b of (r.json.items ?? []) as any[]) {
      if (String(b.privacy ?? "PUBLIC") !== "SECRET") out.push({ id: String(b.id), name: String(b.name ?? "") });
    }
    bookmark = String(r.json.bookmark ?? "");
    if (!bookmark) break;
  }
  return out;
}
type PinPending = { access_token: string; refresh_token: string | null; token_expires_at: string; refresh_expires_at: string | null; username: string; boards: { id: string; name: string }[] };

async function pinStore(l: any, p: PinPending, board: { id: string; name: string }) {
  const { data: brand, error: be } = await db.rpc("client_social_brand", { p_client: l.client_id });
  if (be || !brand) return { ok: false, error: "store", detail: be?.message ?? "no brand" };
  const now = new Date().toISOString();
  const handle = "@" + p.username + " · " + board.name;
  const patch = {
    access_token: p.access_token, refresh_token: p.refresh_token, remote_user_id: p.username, page_id: board.id,
    handle, token_expires_at: p.token_expires_at, refresh_expires_at: p.refresh_expires_at, last_refreshed_at: now,
    active: true, publishing_paused: false, client_id: l.client_id, connected_via: "studio-social", updated_at: now,
  };
  const { data: ex } = await db.from("social_accounts").select("id").eq("brand", brand).eq("platform", "pinterest").maybeSingle();
  const w = ex?.id
    ? await db.from("social_accounts").update(patch).eq("id", ex.id)
    : await db.from("social_accounts").insert({ ...patch, brand, platform: "pinterest", label: l.approval_clients?.name ?? null });
  if (w.error) return { ok: false, error: "store", detail: w.error.message };
  await db.rpc("studio_pin_switch_on", { p_brand: brand });
  await db.from("social_connect_links").update({ used_at: now, result: { handle, board_id: board.id, platform: "pinterest" } }).eq("id", l.id);
  return { ok: true, client: l.approval_clients?.name ?? null, handle, board: board.name, slug: l.approval_clients?.slug ?? null };
}

// ---- YouTube helpers ----------------------------------------------------------------------------
async function ytStore(l: any, ch: { id: string; title: string; access_token: string; refresh_token: string; token_expires_at: string }) {
  const { data: brand, error: be } = await db.rpc("client_social_brand", { p_client: l.client_id });
  if (be || !brand) return { ok: false, error: "store", detail: be?.message ?? "no brand" };
  const now = new Date().toISOString();
  const patch = {
    access_token: ch.access_token, refresh_token: ch.refresh_token, remote_user_id: ch.id, page_id: ch.id,
    handle: ch.title, token_expires_at: ch.token_expires_at, refresh_expires_at: null, last_refreshed_at: now,
    active: true, publishing_paused: false, client_id: l.client_id, connected_via: "studio-social", updated_at: now,
  };
  const { data: ex } = await db.from("social_accounts").select("id").eq("brand", brand).eq("platform", "youtube").maybeSingle();
  const w = ex?.id
    ? await db.from("social_accounts").update(patch).eq("id", ex.id)
    : await db.from("social_accounts").insert({ ...patch, brand, platform: "youtube", label: l.approval_clients?.name ?? null });
  if (w.error) return { ok: false, error: "store", detail: w.error.message };
  await db.rpc("studio_yt_switch_on", { p_brand: brand });
  await db.from("social_connect_links").update({ used_at: now, result: { handle: ch.title, channel_id: ch.id, platform: "youtube" } }).eq("id", l.id);
  return { ok: true, client: l.approval_clients?.name ?? null, handle: ch.title, slug: l.approval_clients?.slug ?? null };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://www.bestly.tech",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method !== "POST") return J({ ok: false, error: "post_only" }, 405);

  let b: Record<string, any> = {};
  try { b = await req.json(); } catch { return J({ ok: false, error: "bad_json" }, 400); }
  const op = String(b.op ?? "");

  if (op === "setup") {
    if (!(await setupOk(String(b.s ?? "")))) return J({ ok: false, error: "setup_link_expired" }, 404);
    const { error } = await db.rpc("studio_ig_app_set", { p_app_id: String(b.app_id ?? ""), p_app_secret: String(b.app_secret ?? "") });
    if (error) return J({ ok: false, error: "not_saved", detail: error.message }, 400);
    return J({ ok: true, redirect_uri: REDIRECT });
  }
  if (op === "tiktok_setup") {
    if (!(await setupOk(String(b.s ?? "")))) return J({ ok: false, error: "setup_link_expired" }, 404);
    const { error } = await db.rpc("studio_tiktok_app_set", { p_client_key: String(b.client_key ?? ""), p_client_secret: String(b.client_secret ?? "") });
    if (error) return J({ ok: false, error: "not_saved", detail: error.message }, 400);
    return J({ ok: true, redirect_uri: TT_REDIRECT });
  }
  if (op === "fb_setup") {
    if (!(await setupOk(String(b.s ?? "")))) return J({ ok: false, error: "setup_link_expired" }, 404);
    const { error } = await db.rpc("studio_fb_app_set", { p_app_id: String(b.app_id ?? ""), p_app_secret: String(b.app_secret ?? ""), p_config_id: b.config_id ? String(b.config_id) : null });
    if (error) return J({ ok: false, error: "not_saved", detail: error.message }, 400);
    return J({ ok: true, redirect_uri: FB_REDIRECT, scopes: FB_SCOPES });
  }
  if (op === "li_setup") {
    if (!(await setupOk(String(b.s ?? "")))) return J({ ok: false, error: "setup_link_expired" }, 404);
    const scopes = b.scopes ? String(b.scopes).replace(/[,\s]+/g, " ").trim() : null;
    const { error } = await db.rpc("studio_li_app_set", { p_client_id: String(b.client_id ?? ""), p_client_secret: String(b.client_secret ?? ""), p_scopes: scopes });
    if (error) return J({ ok: false, error: "not_saved", detail: error.message }, 400);
    return J({ ok: true, redirect_uri: LI_REDIRECT, scopes: scopes || LI_SCOPES });
  }
  if (op === "pin_setup") {
    if (!(await setupOk(String(b.s ?? "")))) return J({ ok: false, error: "setup_link_expired" }, 404);
    const { error } = await db.rpc("studio_pin_app_set", { p_app_id: String(b.app_id ?? ""), p_app_secret: String(b.app_secret ?? "") });
    if (error) return J({ ok: false, error: "not_saved", detail: error.message }, 400);
    return J({ ok: true, redirect_uri: PIN_REDIRECT, scopes: PIN_SCOPES });
  }
  if (op === "yt_setup") {
    if (!(await setupOk(String(b.s ?? "")))) return J({ ok: false, error: "setup_link_expired" }, 404);
    const { error } = await db.rpc("studio_yt_app_set", { p_client_id: String(b.client_id ?? ""), p_client_secret: String(b.client_secret ?? "") });
    if (error) return J({ ok: false, error: "not_saved", detail: error.message }, 400);
    return J({ ok: true, redirect_uri: YT_REDIRECT, scopes: YT_SCOPES });
  }

  if (op === "resolve") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad, platform: l ? linkPlatform(l) : null }, 410);
    return J({ ok: true, platform: linkPlatform(l) });
  }

  if (op === "start") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!linkIsFor(l, "instagram")) return J({ ok: false, error: "wrong_platform" }, 400);
    const app = await appCreds();
    if (!app) return J({ ok: false, error: "not_set_up", client: l.approval_clients?.name ?? null }, 503);
    const go = new URL("https://www.instagram.com/oauth/authorize");
    go.searchParams.set("enable_fb_login", "0");
    go.searchParams.set("force_authentication", "1");
    go.searchParams.set("client_id", app.id);
    go.searchParams.set("redirect_uri", REDIRECT);
    go.searchParams.set("response_type", "code");
    go.searchParams.set("scope", SCOPES);
    go.searchParams.set("state", String(b.k));
    return J({ ok: true, client: l.approval_clients?.name ?? null, authorize_url: go.toString() });
  }

  if (op === "finish") {
    const k = String(b.k ?? "");
    const code = String(b.code ?? "").replace(/#_$/, "");
    const l = await link(k);
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!code) return J({ ok: false, error: "no_code" }, 400);
    const app = await appCreds();
    if (!app) return J({ ok: false, error: "not_set_up" }, 503);
    try {
      const sr = await fetch("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: app.id, client_secret: app.secret, grant_type: "authorization_code", redirect_uri: REDIRECT, code }),
      });
      const sj: any = await sr.json();
      const short = sj.access_token ?? sj.data?.[0]?.access_token;
      const perms = String(sj.permissions ?? sj.data?.[0]?.permissions ?? "");
      if (!short) return J({ ok: false, error: "code_exchange", detail: scrub(JSON.stringify(sj.error_message ?? sj.error ?? sj)).slice(0, 300) }, 502);
      if (perms && !perms.includes("instagram_business_content_publish")) return J({ ok: false, error: "publish_permission_missing" }, 400);

      const lr = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(app.secret)}&access_token=${encodeURIComponent(short)}`);
      const lj: any = await lr.json();
      if (!lj.access_token) return J({ ok: false, error: "long_exchange", detail: scrub(JSON.stringify(lj.error ?? lj)).slice(0, 300) }, 502);
      const expiresAt = new Date(Date.now() + (Number(lj.expires_in) || 5184000) * 1000).toISOString();

      const mr = await fetch(`https://graph.instagram.com/v23.0/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(lj.access_token)}`);
      const me: any = await mr.json();
      const igId = String(me.user_id ?? me.id ?? "");
      if (!igId) return J({ ok: false, error: "profile", detail: scrub(JSON.stringify(me.error ?? me)).slice(0, 300) }, 502);
      if (me.account_type && !/BUSINESS|CREATOR/i.test(String(me.account_type))) return J({ ok: false, error: "personal_account" }, 400);

      const { data: brand, error: be } = await db.rpc("client_social_brand", { p_client: l.client_id });
      if (be || !brand) return J({ ok: false, error: "store", detail: be?.message ?? "no brand" }, 500);
      const { error: ue } = await db.from("social_accounts").update({
        access_token: lj.access_token, remote_user_id: igId, handle: me.username ? "@" + me.username : null,
        token_expires_at: expiresAt, last_refreshed_at: new Date().toISOString(), active: true,
        client_id: l.client_id, connected_via: "studio-social", updated_at: new Date().toISOString(),
      }).eq("brand", brand).eq("platform", "instagram");
      if (ue) return J({ ok: false, error: "store", detail: ue.message }, 500);
      await db.from("social_connect_links").update({ used_at: new Date().toISOString(), result: { handle: me.username ?? null, ig_id: igId } }).eq("id", l.id);
      return J({ ok: true, client: l.approval_clients?.name ?? null, handle: me.username ?? null, slug: l.approval_clients?.slug ?? null });
    } catch (e) {
      console.error("studio-social finish", scrub(String(e)));
      return J({ ok: false, error: "unexpected", detail: scrub(String(e)).slice(0, 300) }, 502);
    }
  }

  // ---- TikTok --------------------------------------------------------------
  if (op === "tiktok_start") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!linkIsFor(l, "tiktok")) return J({ ok: false, error: "wrong_platform" }, 400);
    const app = await ttCreds();
    if (!app) return J({ ok: false, error: "not_set_up", client: l.approval_clients?.name ?? null }, 503);
    const go = new URL("https://www.tiktok.com/v2/auth/authorize/");
    go.searchParams.set("client_key", app.key);
    go.searchParams.set("scope", TT_SCOPES);
    go.searchParams.set("response_type", "code");
    go.searchParams.set("redirect_uri", TT_REDIRECT);
    go.searchParams.set("state", String(b.k));
    return J({ ok: true, client: l.approval_clients?.name ?? null, authorize_url: go.toString() });
  }

  if (op === "tiktok_finish") {
    const k = String(b.k ?? ""), code = String(b.code ?? "");
    const l = await link(k);
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!code) return J({ ok: false, error: "no_code" }, 400);
    const app = await ttCreds();
    if (!app) return J({ ok: false, error: "not_set_up" }, 503);
    try {
      const tr = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_key: app.key, client_secret: app.secret, code, grant_type: "authorization_code", redirect_uri: TT_REDIRECT }),
      });
      const tj: any = await tr.json();
      if (!tj.access_token || !tj.refresh_token || !tj.open_id) return J({ ok: false, error: "code_exchange", detail: scrub(JSON.stringify(tj.error_description ?? tj.error ?? tj)).slice(0, 300) }, 502);
      const scope = String(tj.scope ?? "");
      if (scope && !scope.includes("video.upload")) return J({ ok: false, error: "upload_permission_missing" }, 400);
      const expiresAt = new Date(Date.now() + (Number(tj.expires_in) || 86400) * 1000).toISOString();
      const refreshExpiresAt = new Date(Date.now() + (Number(tj.refresh_expires_in) || 31536000) * 1000).toISOString();
      let handle: string | null = null;
      try {
        const ur = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name", { headers: { Authorization: "Bearer " + tj.access_token } });
        const uj: any = await ur.json();
        handle = uj?.data?.user?.display_name ?? null;
      } catch { /* the name is a nicety */ }

      const { data: brand, error: be } = await db.rpc("client_social_brand", { p_client: l.client_id });
      if (be || !brand) return J({ ok: false, error: "store", detail: be?.message ?? "no brand" }, 500);
      const { error: ue } = await db.from("social_accounts").update({
        access_token: tj.access_token, refresh_token: tj.refresh_token, remote_user_id: String(tj.open_id), handle,
        token_expires_at: expiresAt, refresh_expires_at: refreshExpiresAt, last_refreshed_at: new Date().toISOString(), active: true,
        client_id: l.client_id, connected_via: "studio-social", updated_at: new Date().toISOString(),
      }).eq("brand", brand).eq("platform", "tiktok");
      if (ue) return J({ ok: false, error: "store", detail: ue.message }, 500);
      await db.from("social_connect_links").update({ used_at: new Date().toISOString(), result: { handle, open_id: String(tj.open_id), platform: "tiktok" } }).eq("id", l.id);
      return J({ ok: true, client: l.approval_clients?.name ?? null, handle, slug: l.approval_clients?.slug ?? null });
    } catch (e) {
      console.error("studio-social tiktok_finish", scrub(String(e)));
      return J({ ok: false, error: "unexpected", detail: scrub(String(e)).slice(0, 300) }, 502);
    }
  }

  // ---- Facebook ------------------------------------------------------------
  if (op === "fb_start") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!linkIsFor(l, "facebook")) return J({ ok: false, error: "wrong_platform" }, 400);
    const app = await fbCreds();
    if (!app) return J({ ok: false, error: "not_set_up", client: l.approval_clients?.name ?? null }, 503);
    const go = new URL("https://www.facebook.com/v23.0/dialog/oauth");
    go.searchParams.set("client_id", app.id);
    go.searchParams.set("redirect_uri", FB_REDIRECT);
    go.searchParams.set("response_type", "code");
    go.searchParams.set("state", String(b.k));
    if (app.config) { go.searchParams.set("config_id", app.config); go.searchParams.set("override_default_response_type", "true"); }
    else go.searchParams.set("scope", FB_SCOPES);
    return J({ ok: true, client: l.approval_clients?.name ?? null, authorize_url: go.toString() });
  }

  if (op === "fb_finish") {
    const k = String(b.k ?? ""), code = String(b.code ?? "");
    const l = await link(k);
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!code) return J({ ok: false, error: "no_code" }, 400);
    const app = await fbCreds();
    if (!app) return J({ ok: false, error: "not_set_up" }, 503);
    try {
      const sx = await fbGet("/oauth/access_token", { client_id: app.id, client_secret: app.secret, redirect_uri: FB_REDIRECT, code });
      if (!sx.json.access_token) return J({ ok: false, error: "code_exchange", detail: scrub(JSON.stringify(sx.json.error?.message ?? sx.json)).slice(0, 300) }, 502);
      const lx = await fbGet("/oauth/access_token", { grant_type: "fb_exchange_token", client_id: app.id, client_secret: app.secret, fb_exchange_token: sx.json.access_token });
      const userTok = lx.json.access_token ?? sx.json.access_token;
      const pm = await fbGet("/me/permissions", { access_token: userTok });
      const granted = new Set(((pm.json.data ?? []) as any[]).filter((p) => p.status === "granted").map((p) => p.permission));
      if (!granted.has("pages_manage_posts") || !granted.has("pages_show_list")) return J({ ok: false, error: "post_permission_missing" }, 400);
      const ac = await fbGet("/me/accounts", { fields: "id,name,tasks,access_token", limit: "100", access_token: userTok });
      if (ac.json.error) return J({ ok: false, error: "pages", detail: scrub(JSON.stringify(ac.json.error.message ?? ac.json.error)).slice(0, 300) }, 502);
      const pages = ((ac.json.data ?? []) as any[])
        .filter((p) => p.access_token && (!Array.isArray(p.tasks) || p.tasks.includes("CREATE_CONTENT") || p.tasks.includes("MANAGE")))
        .map((p) => ({ id: String(p.id), name: String(p.name ?? ""), token: String(p.access_token) }));
      if (pages.length === 0) return J({ ok: false, error: "no_pages" }, 400);
      if (pages.length === 1) return J(await fbStore(l, pages[0]));
      // several Pages: the tokens wait here, the browser only sees names
      await db.from("social_connect_links").update({ result: { pending: pages } }).eq("id", l.id);
      return J({ ok: true, pick: pages.map((p) => ({ id: p.id, name: p.name })), client: l.approval_clients?.name ?? null });
    } catch (e) {
      console.error("studio-social fb_finish", scrub(String(e)));
      return J({ ok: false, error: "unexpected", detail: scrub(String(e)).slice(0, 300) }, 502);
    }
  }

  if (op === "fb_pick") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    const pending = (l.result?.pending ?? []) as { id: string; name: string; token: string }[];
    const page = pending.find((p) => p.id === String(b.page_id ?? ""));
    if (!page) return J({ ok: false, error: "page_not_found" }, 400);
    return J(await fbStore(l, page));
  }

  // ---- LinkedIn ------------------------------------------------------------
  if (op === "li_start") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!linkIsFor(l, "linkedin")) return J({ ok: false, error: "wrong_platform" }, 400);
    const app = await liCreds();
    if (!app) return J({ ok: false, error: "not_set_up", client: l.approval_clients?.name ?? null }, 503);
    const go = new URL("https://www.linkedin.com/oauth/v2/authorization");
    go.searchParams.set("response_type", "code");
    go.searchParams.set("client_id", app.id);
    go.searchParams.set("redirect_uri", LI_REDIRECT);
    go.searchParams.set("state", String(b.k));
    go.searchParams.set("scope", app.scopes);
    return J({ ok: true, client: l.approval_clients?.name ?? null, authorize_url: go.toString() });
  }

  if (op === "li_finish") {
    const k = String(b.k ?? ""), code = String(b.code ?? "");
    const l = await link(k);
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!linkIsFor(l, "linkedin")) return J({ ok: false, error: "wrong_platform" }, 400);
    if (!code) return J({ ok: false, error: "no_code" }, 400);
    const app = await liCreds();
    if (!app) return J({ ok: false, error: "not_set_up" }, 503);
    try {
      const tr = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: app.id, client_secret: app.secret, redirect_uri: LI_REDIRECT }),
      });
      const tj: any = await tr.json().catch(() => ({}));
      if (!tj.access_token) return J({ ok: false, error: "code_exchange", detail: scrub(JSON.stringify(tj.error_description ?? tj.error ?? tj)).slice(0, 300) }, 502);
      const granted = new Set(String(tj.scope ?? app.scopes).split(/[,\s]+/).filter(Boolean));
      const tokenExpires = new Date(Date.now() + (Number(tj.expires_in) || 5184000) * 1000).toISOString();
      const refreshExpires = tj.refresh_token ? new Date(Date.now() + (Number(tj.refresh_token_expires_in) || 31536000) * 1000).toISOString() : null;

      // Profile mode: post as the person who signed in (Share on LinkedIn)
      if (!granted.has("w_organization_social")) {
        if (!granted.has("w_member_social")) return J({ ok: false, error: "post_permission_missing" }, 400);
        const ur = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: "Bearer " + tj.access_token } });
        const uj: any = await ur.json().catch(() => ({}));
        const sub = String(uj.sub ?? "");
        if (!sub) return J({ ok: false, error: "profile", detail: scrub(JSON.stringify(uj.message ?? uj.error ?? ur.status)).slice(0, 300) }, 502);
        const name = String(uj.name ?? [uj.given_name, uj.family_name].filter(Boolean).join(" ") ?? "").trim() || "LinkedIn profile";
        return J(await liStore(l, { id: sub, name, urn: "urn:li:person:" + sub, access_token: String(tj.access_token), refresh_token: tj.refresh_token ? String(tj.refresh_token) : null, token_expires_at: tokenExpires, refresh_expires_at: refreshExpires }));
      }

      // Page mode: the Pages she administers
      const ac = await liApi("/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50", tj.access_token);
      if (ac.status !== 200) return J({ ok: false, error: "pages", detail: scrub(JSON.stringify(ac.json?.message ?? ac.json?.code ?? ac.status)).slice(0, 300) }, 502);
      const ids = [...new Set(((ac.json.elements ?? []) as any[]).map((e) => String(e.organization ?? "").match(/urn:li:organization:(\d+)/)?.[1]).filter(Boolean) as string[])];
      if (ids.length === 0) return J({ ok: false, error: "no_company_page" }, 400);
      const orgs: LiOrg[] = [];
      for (const id of ids.slice(0, 25)) {
        let name = "";
        const o = await liApi("/organizations/" + id, tj.access_token);
        if (o.status === 200) name = String(o.json.localizedName ?? o.json.vanityName ?? "");
        orgs.push({ id, name: name || "LinkedIn Page " + id, access_token: String(tj.access_token), refresh_token: tj.refresh_token ? String(tj.refresh_token) : null, token_expires_at: tokenExpires, refresh_expires_at: refreshExpires });
      }
      if (orgs.length === 1) return J(await liStore(l, orgs[0]));
      // several Pages: the tokens wait here, the browser only sees names
      await db.from("social_connect_links").update({ result: { pending: orgs } }).eq("id", l.id);
      return J({ ok: true, pick: orgs.map((o) => ({ id: o.id, name: o.name })), client: l.approval_clients?.name ?? null });
    } catch (e) {
      console.error("studio-social li_finish", scrub(String(e)));
      return J({ ok: false, error: "unexpected", detail: scrub(String(e)).slice(0, 300) }, 502);
    }
  }

  if (op === "li_pick") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    const pending = (l.result?.pending ?? []) as LiOrg[];
    const org = pending.find((o) => o.id === String(b.org_id ?? ""));
    if (!org) return J({ ok: false, error: "page_not_found" }, 400);
    return J(await liStore(l, org));
  }

  // ---- Pinterest -----------------------------------------------------------
  if (op === "pin_start") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!linkIsFor(l, "pinterest")) return J({ ok: false, error: "wrong_platform" }, 400);
    const app = await pinCreds();
    if (!app) return J({ ok: false, error: "not_set_up", client: l.approval_clients?.name ?? null }, 503);
    const go = new URL("https://www.pinterest.com/oauth/");
    go.searchParams.set("client_id", app.id);
    go.searchParams.set("redirect_uri", PIN_REDIRECT);
    go.searchParams.set("response_type", "code");
    go.searchParams.set("scope", PIN_SCOPES);
    go.searchParams.set("state", String(b.k));
    return J({ ok: true, client: l.approval_clients?.name ?? null, authorize_url: go.toString() });
  }

  if (op === "pin_finish") {
    const k = String(b.k ?? ""), code = String(b.code ?? "");
    const l = await link(k);
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!linkIsFor(l, "pinterest")) return J({ ok: false, error: "wrong_platform" }, 400);
    if (!code) return J({ ok: false, error: "no_code" }, 400);
    const app = await pinCreds();
    if (!app) return J({ ok: false, error: "not_set_up" }, 503);
    try {
      const tr = await fetch(PIN_API + "/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(app.id + ":" + app.secret) },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: PIN_REDIRECT, continuous_refresh: "true" }),
      });
      const tj: any = await tr.json().catch(() => ({}));
      if (!tj.access_token) return J({ ok: false, error: "code_exchange", detail: scrub(JSON.stringify(tj.message ?? tj.error_description ?? tj.error ?? tj)).slice(0, 300) }, 502);
      const scope = String(tj.scope ?? "");
      if (scope) {
        const have = new Set(scope.split(/[,\s]+/));
        if (!have.has("pins:write") || !have.has("boards:read")) return J({ ok: false, error: "post_permission_missing" }, 400);
      }
      const ua = await pinGet("/user_account", tj.access_token);
      if (ua.status !== 200) return J({ ok: false, error: "profile", detail: scrub(JSON.stringify(ua.json?.message ?? ua.status)).slice(0, 300) }, 502);
      if (ua.json.account_type && String(ua.json.account_type).toUpperCase() !== "BUSINESS") return J({ ok: false, error: "personal_account" }, 400);
      const username = String(ua.json.username ?? "");
      if (!username) return J({ ok: false, error: "profile", detail: "no username" }, 502);
      const boards = await pinBoards(tj.access_token);
      const pending: PinPending = {
        access_token: String(tj.access_token), refresh_token: tj.refresh_token ? String(tj.refresh_token) : null,
        token_expires_at: new Date(Date.now() + (Number(tj.expires_in) || 2592000) * 1000).toISOString(),
        refresh_expires_at: tj.refresh_token ? new Date(Date.now() + (Number(tj.refresh_token_expires_in) || 5184000) * 1000).toISOString() : null,
        username, boards,
      };
      // the tokens wait here, the browser only sees board names
      await db.from("social_connect_links").update({ result: { pending } }).eq("id", l.id);
      return J({ ok: true, pick_board: boards, can_create: true, username, client: l.approval_clients?.name ?? null });
    } catch (e) {
      console.error("studio-social pin_finish", scrub(String(e)));
      return J({ ok: false, error: "unexpected", detail: scrub(String(e)).slice(0, 300) }, 502);
    }
  }

  if (op === "pin_pick") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    const pending = l.result?.pending as PinPending | undefined;
    if (!pending?.access_token) return J({ ok: false, error: "nothing_pending" }, 400);
    try {
      const fresh = String(b.new_board_name ?? "").trim();
      if (fresh) {
        const cr = await fetch(PIN_API + "/boards", {
          method: "POST", headers: { Authorization: "Bearer " + pending.access_token, "Content-Type": "application/json" },
          body: JSON.stringify({ name: fresh.slice(0, 180), privacy: "PUBLIC" }),
        });
        const cj: any = await cr.json().catch(() => ({}));
        if (!cj.id) return J({ ok: false, error: "board_create", detail: scrub(JSON.stringify(cj.message ?? cj)).slice(0, 300) }, 502);
        return J(await pinStore(l, pending, { id: String(cj.id), name: String(cj.name ?? fresh) }));
      }
      const board = pending.boards.find((x) => x.id === String(b.board_id ?? ""));
      if (!board) return J({ ok: false, error: "board_not_found" }, 400);
      return J(await pinStore(l, pending, board));
    } catch (e) {
      console.error("studio-social pin_pick", scrub(String(e)));
      return J({ ok: false, error: "unexpected", detail: scrub(String(e)).slice(0, 300) }, 502);
    }
  }

  // ---- YouTube -------------------------------------------------------------
  if (op === "yt_start") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!linkIsFor(l, "youtube")) return J({ ok: false, error: "wrong_platform" }, 400);
    const app = await ytCreds();
    if (!app) return J({ ok: false, error: "not_set_up", client: l.approval_clients?.name ?? null }, 503);
    const go = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    go.searchParams.set("client_id", app.id);
    go.searchParams.set("redirect_uri", YT_REDIRECT);
    go.searchParams.set("response_type", "code");
    go.searchParams.set("scope", YT_SCOPES);
    go.searchParams.set("access_type", "offline");
    go.searchParams.set("prompt", "consent");
    go.searchParams.set("include_granted_scopes", "true");
    go.searchParams.set("state", String(b.k));
    return J({ ok: true, client: l.approval_clients?.name ?? null, authorize_url: go.toString() });
  }

  if (op === "yt_finish") {
    const k = String(b.k ?? ""), code = String(b.code ?? "");
    const l = await link(k);
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!linkIsFor(l, "youtube")) return J({ ok: false, error: "wrong_platform" }, 400);
    if (!code) return J({ ok: false, error: "no_code" }, 400);
    const app = await ytCreds();
    if (!app) return J({ ok: false, error: "not_set_up" }, 503);
    try {
      const tr = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: app.id, client_secret: app.secret, redirect_uri: YT_REDIRECT }),
      });
      const tj: any = await tr.json().catch(() => ({}));
      if (!tj.access_token) return J({ ok: false, error: "code_exchange", detail: ytScrub(JSON.stringify(tj.error_description ?? tj.error ?? tj)).slice(0, 300) }, 502);
      // she may have unticked the upload box on Google's screen
      const granted = new Set(String(tj.scope ?? "").split(/[,\s]+/).filter(Boolean));
      if (!granted.has("https://www.googleapis.com/auth/youtube.upload")) return J({ ok: false, error: "scope_missing" }, 400);
      if (!tj.refresh_token) return J({ ok: false, error: "code_exchange", detail: "no refresh token from Google" }, 502);
      const cr = await fetch(YT_API + "/channels?part=snippet&mine=true", { headers: { Authorization: "Bearer " + tj.access_token } });
      const cj: any = await cr.json().catch(() => ({}));
      if (cr.status !== 200) return J({ ok: false, error: "profile", detail: ytScrub(JSON.stringify(cj?.error?.message ?? cr.status)).slice(0, 300) }, 502);
      const ch = ((cj.items ?? []) as any[])[0];
      if (!ch?.id) return J({ ok: false, error: "no_channel" }, 400);
      return J(await ytStore(l, {
        id: String(ch.id), title: String(ch.snippet?.title ?? "").trim() || "YouTube channel",
        access_token: String(tj.access_token), refresh_token: String(tj.refresh_token),
        token_expires_at: new Date(Date.now() + (Number(tj.expires_in) || 3600) * 1000).toISOString(),
      }));
    } catch (e) {
      console.error("studio-social yt_finish", ytScrub(String(e)));
      return J({ ok: false, error: "unexpected", detail: ytScrub(String(e)).slice(0, 300) }, 502);
    }
  }

  return J({ ok: false, error: "unknown_op" }, 400);
});
