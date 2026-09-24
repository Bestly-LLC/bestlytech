// bestly-ig-poster — ONE first-party Instagram publisher for all Bestly-owned brands.
// Sibling of bestly-poster (TikTok). Same shape, same brand-slug convention.
//
// TWO Instagram publishing APIs are supported, chosen per-account by token shape:
//
//   * Instagram API with Instagram Login  -> https://graph.instagram.com
//     Token looks like "IGAA...". No Facebook Page needed. 60-day token that this
//     function rotates itself via ig_refresh_token.
//
//   * Instagram API with Facebook Login   -> https://graph.facebook.com
//     Token looks like "EAA.../EABC...". Requires the IG Business account to be
//     linked to a Facebook Page. A Page token minted from a long-lived user token
//     does NOT expire, so token_expires_at is left NULL and refresh skips it.
//
// Both APIs speak the identical publishing grammar (/{ig-user-id}/media ->
// /{ig-user-id}/media_publish), so only the host differs. graphBase() picks it.
//
// Credentials live in public.social_accounts, NOT in Supabase secrets.
// App-level fallbacks: IG_APP_ID, IG_APP_SECRET (Instagram Login flow only).
//
// Actions:
//   GET  ?action=brands                       -> which brands are connected
//   GET  ?action=me&brand=<slug>              -> IG account sanity check
//   POST { action:'connect', brand, accessToken, remoteUserId? }
//                                             -> exchange for 60-day token + store
//   POST { action:'setfb', brand, accessToken, remoteUserId }
//                                             -> store a Facebook-Login page token as-is
//   POST { action:'dryrun', brand, mediaUrl|mediaUrls[], caption? }
//                                             -> build container(s), never publish
//   POST { action:'queue', brand, mediaUrl|mediaUrls[], caption, scheduledAt?,
//                          mediaType?, coverUrl? }
//   POST { action:'post', brand, mediaUrl, caption, mediaType?, coverUrl? }
//                                             -> publish now
//
// coverUrl applies to video only. A Reel is 1080x1920 and the profile grid
// shows it in a 3:4 tile, keeping the middle 1440 rows; without an explicit
// cover Instagram picks its own frame, so a post can end up represented on the
// profile by a blurred mid-transition.
//   POST { action:'oauth', brand, code, redirectUri }
//                                             -> full code -> short -> 60d exchange
//   POST { action:'setapp', brand, appId, appSecret }   -> per-brand Meta app creds
//   POST { action:'upload', brand, filename, contentType, dataBase64 }
//                                             -> store media, return public URL
//   POST { action:'list', brand?, limit? }    -> recent queue rows
//   POST { action:'cancel', id }              -> cancel a queued post
//   POST { action:'drain' }                   -> publish one due queued post (pg_cron)
//   POST { action:'refresh' }                 -> roll every token nearing expiry (pg_cron)

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const GRAPH_IG = "https://graph.instagram.com/v23.0";
const GRAPH_FB = "https://graph.facebook.com/v23.0";
const PLATFORM = "instagram";

// Instagram-Login tokens start with "IG"; Facebook tokens start with "EA".
// Anything unrecognised is treated as Instagram Login, which is what every
// account created through the connect/oauth actions below will be.
function isFacebookToken(tok: string | null | undefined): boolean {
  return !!tok && tok.startsWith("EA");
}
function graphBase(tok: string | null | undefined): string {
  return isFacebookToken(tok) ? GRAPH_FB : GRAPH_IG;
}

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

type Account = {
  id: string; brand: string; handle: string | null; label: string | null;
  remote_user_id: string | null; access_token: string | null;
  token_expires_at: string | null; active: boolean;
  app_id: string | null; app_secret: string | null;
};

// Jared keeps one Meta app per brand, so app credentials live on the account row
// and only fall back to the shared env vars when a brand hasn't got its own.
function appId(a?: Account | null): string {
  return (a?.app_id || Deno.env.get("IG_APP_ID") || "");
}
function appSecret(a?: Account | null): string {
  return (a?.app_secret || Deno.env.get("IG_APP_SECRET") || "");
}

async function loadRow(brand: string): Promise<Account | null> {
  const { data } = await db.from("social_accounts").select("*")
    .eq("brand", brand).eq("platform", PLATFORM).maybeSingle();
  return (data as Account) ?? null;
}

async function getAccount(brand: string): Promise<Account> {
  const { data, error } = await db
    .from("social_accounts")
    .select("*")
    .eq("brand", brand)
    .eq("platform", PLATFORM)
    .maybeSingle();
  if (error) throw new Error("db: " + error.message);
  if (!data) throw new Error(`brand '${brand}' is not registered`);
  if (!data.access_token || !data.remote_user_id) {
    throw new Error(`brand '${brand}' is not connected (no token / ig-user-id)`);
  }
  return data as Account;
}

async function ig(
  base: string,
  path: string,
  params: Record<string, string>,
  method: "GET" | "POST" = "GET",
) {
  const url = new URL(base + path);
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const r = await fetch(url.toString());
    return { status: r.status, json: await r.json() };
  }
  const body = new URLSearchParams(params);
  const r = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return { status: r.status, json: await r.json() };
}

// Build the container(s) for a post without publishing. Shared by the real
// publish path and by action=dryrun, so a rehearsal exercises exactly the same
// code — token, permissions, and every media URL — as the live post will.
// Unpublished containers are discarded by Instagram after 24h.
async function buildContainers(
  acct: Account,
  urls: string[] | null,
  mediaUrl: string | null,
  caption: string,
  mediaType: string,
  coverUrl: string | null = null,
) {
  const base = graphBase(acct.access_token);
  const uid = acct.remote_user_id!;
  const tok = acct.access_token!;
  const cap = (caption || "").slice(0, 2200);

  if (urls && urls.length > 1) {
    if (urls.length > 10) {
      return { ok: false, stage: "carousel-shape", detail: { count: urls.length } };
    }
    const children: string[] = [];
    for (let i = 0; i < urls.length; i++) {
      const c = await ig(base, `/${uid}/media`, {
        access_token: tok, image_url: urls[i], is_carousel_item: "true",
      }, "POST");
      if (!c.json?.id) return { ok: false, stage: `carousel-slide-${i + 1}`, detail: c.json };
      children.push(String(c.json.id));
    }
    const parent = await ig(base, `/${uid}/media`, {
      access_token: tok, media_type: "CAROUSEL",
      children: children.join(","), caption: cap,
    }, "POST");
    if (!parent.json?.id) return { ok: false, stage: "carousel-container", detail: parent.json };
    return { ok: true, creationId: String(parent.json.id), slides: urls.length, video: false };
  }

  const single: Record<string, string> = { access_token: tok, caption: cap };
  const isVideo = mediaType !== "image" && mediaType !== "carousel";
  if (isVideo) {
    single.media_type = "REELS";
    single.video_url = mediaUrl!;
    // Without this Instagram chooses its own frame for the profile grid, and
    // the grid tile is a 3:4 crop of a 9:16 video - so a mid-transition frame
    // becomes how the post is represented on the profile. The cover is composed
    // inside the band that crop keeps.
    if (coverUrl) single.cover_url = coverUrl;
  } else {
    single.image_url = mediaUrl!;
  }
  const init = await ig(base, `/${uid}/media`, single, "POST");
  if (!init.json?.id) return { ok: false, stage: "container", detail: init.json };
  return { ok: true, creationId: String(init.json.id), slides: 1, video: isVideo };
}

// Publish a prepared container. Video containers must finish transcoding first.
async function publishContainer(acct: Account, creationId: string, isVideo: boolean) {
  const base = graphBase(acct.access_token);
  const uid = acct.remote_user_id!;
  const tok = acct.access_token!;

  // A container is not publishable the instant it is created. Video needs
  // transcoding, and a CAROUSEL parent needs its children assembled — publishing
  // either too early returns 9007 "media is not ready for publishing".
  //
  // An earlier version treated a MISSING status_code as "ready", because some
  // edges omit the field for simple image containers. That guess was wrong often
  // enough to matter: a real post failed its first attempt with 9007 and only
  // went out on the retry, burning one of three attempts every time. Video makes
  // it worse, because transcoding takes real seconds.
  //
  // So readiness is no longer inferred. Poll for FINISHED, and if the edge never
  // reports a status at all, attempt the publish and let 9007 itself say "not
  // yet" — that error is authoritative in a way a missing field is not.
  let ready = false;
  let sawStatus = false;
  for (let i = 0; i < 24; i++) {
    const st = await ig(base, `/${creationId}`, { fields: "status_code", access_token: tok });
    const code = st.json?.status_code;
    if (code !== undefined) sawStatus = true;
    if (code === "FINISHED") { ready = true; break; }
    if (code === "ERROR") return { ok: false, stage: "processing", detail: st.json };
    await new Promise((r) => setTimeout(r, isVideo ? 3000 : 1500));
  }
  // Only a container whose status WAS reported and never reached FINISHED is a
  // genuine timeout. One that never reported at all still deserves a publish.
  if (!ready && sawStatus) {
    return { ok: false, stage: "processing-timeout", detail: { creationId } };
  }

  // 9007 / 2207027 means "not ready yet", not "broken" — so it is retried here
  // rather than being handed back as a failed attempt.
  let pub: Awaited<ReturnType<typeof ig>> | null = null;
  let mediaId: string | undefined;
  for (let attempt = 0; attempt < 5; attempt++) {
    pub = await ig(base, `/${uid}/media_publish`,
      { creation_id: creationId, access_token: tok }, "POST");
    mediaId = pub.json?.id;
    if (mediaId) break;
    const err = pub.json?.error;
    const notReadyYet = !!err && (err.code === 9007 || err.error_subcode === 2207027);
    if (!notReadyYet) break;
    await new Promise((r) => setTimeout(r, isVideo ? 4000 : 2000));
  }
  if (!mediaId) return { ok: false, stage: "publish", detail: pub?.json };

  const link = await ig(base, `/${mediaId}`, { fields: "permalink", access_token: tok });
  return { ok: true, remoteId: mediaId, permalink: link.json?.permalink ?? null };
}

async function publishAny(
  acct: Account,
  urls: string[] | null,
  mediaUrl: string | null,
  caption: string,
  mediaType: string,
  coverUrl: string | null = null,
) {
  const built = await buildContainers(acct, urls, mediaUrl, caption, mediaType, coverUrl);
  if (!built.ok) return built;
  const res = await publishContainer(acct, built.creationId!, !!built.video);
  return res.ok ? { ...res, slides: built.slides } : res;
}

// ---- Caller authorization -------------------------------------------------
// The Supabase anon key is PUBLIC (it ships in hoku-clean.com's page source),
// so verify_jwt alone is not authorization — it only proves the caller found a
// key anyone can read. Every real caller of this function is server-side:
//   * Vercel /api/social  -> sends x-proxy-key
//   * pg_cron drain/refresh via invoke_edge_function -> bears the service_role JWT
// Anything else is rejected before it can read a token or publish a post.
const PROXY_KEY = Deno.env.get("SOCIAL_PROXY_KEY") ||
  "HZW143PPv0ezYqQ2Ww9tQGar_ywER6dHPXG6yvalpv84jRBR";

function b64urlJson(seg: string): Record<string, unknown> | null {
  try {
    const s = seg.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(s + "=".repeat((4 - (s.length % 4)) % 4)));
  } catch { return null; }
}

// Constant-time compare so a wrong key cannot be discovered byte by byte.
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function callerAuthorized(req: Request): boolean {
  const k = req.headers.get("x-proxy-key");
  if (k && sameSecret(k, PROXY_KEY)) return true;

  // Supabase has already verified this JWT's signature (verify_jwt = true),
  // so trusting the role claim here is safe.
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const parts = jwt.split(".");
  if (parts.length === 3) {
    const payload = b64urlJson(parts[1]);
    if (payload && payload.role === "service_role") return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  if (!callerAuthorized(req)) return J({ error: "unauthorized" }, 401);

  try {
    const url = new URL(req.url);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const action = url.searchParams.get("action") || body.action || (req.method === "POST" ? "drain" : "brands");
    const brand = (url.searchParams.get("brand") || body.brand || "").toLowerCase();

    // ---- brands -----------------------------------------------------------
    if (action === "brands") {
      const { data } = await db.from("social_accounts").select("*").eq("platform", PLATFORM);
      return J({
        brands: (data ?? []).map((a: Account) => ({
          slug: a.brand,
          label: a.label,
          handle: a.handle,
          connected: !!(a.access_token && a.remote_user_id),
          api: isFacebookToken(a.access_token) ? "facebook-login" : "instagram-login",
          hasAppId: !!(a.app_id || Deno.env.get("IG_APP_ID")),
          hasAppSecret: !!(a.app_secret || Deno.env.get("IG_APP_SECRET")),
          active: a.active,
          tokenExpiresAt: a.token_expires_at,
          daysLeft: a.token_expires_at
            ? Math.round((Date.parse(a.token_expires_at) - Date.now()) / 86400000)
            : null,
          neverExpires: !!a.access_token && !a.token_expires_at,
        })),
      });
    }

    // ---- me ---------------------------------------------------------------
    if (action === "me") {
      const acct = await getAccount(brand);
      const base = graphBase(acct.access_token);
      // account_type exists only on the Instagram-Login API; the Facebook-Login
      // edge exposes followers_count/name instead. Asking for the wrong one 400s.
      const fields = base === GRAPH_FB
        ? "id,username,name,followers_count,media_count"
        : "id,username,account_type,media_count";
      const r = await ig(base, `/${acct.remote_user_id}`, {
        fields, access_token: acct.access_token!,
      });
      return J({ api: base === GRAPH_FB ? "facebook-login" : "instagram-login", ...r.json }, r.status);
    }

    // ---- setfb ------------------------------------------------------------
    // Store a Facebook-Login credential exactly as issued. A Page token minted
    // from a long-lived user token never expires, so token_expires_at stays NULL
    // and the refresh cron leaves it alone. Never echoes the token back.
    if (action === "setfb") {
      if (!brand) return J({ error: "brand required" }, 400);
      const tok = body.accessToken;
      const uid = body.remoteUserId;
      if (!tok || !uid) return J({ error: "accessToken and remoteUserId required" }, 400);
      if (!isFacebookToken(String(tok))) {
        return J({ error: "that is not a Facebook access token (expected an EA... prefix)" }, 400);
      }

      // Prove the credential works against this exact IG account before storing.
      const check = await ig(GRAPH_FB, `/${uid}`, {
        fields: "id,username", access_token: String(tok),
      });
      if (!check.json?.id) return J({ stage: "verify", detail: check.json }, 400);

      const patch: Record<string, unknown> = {
        access_token: String(tok),
        remote_user_id: String(uid),
        token_expires_at: null,
        last_refreshed_at: new Date().toISOString(),
        active: true,
      };
      if (check.json.username) patch.handle = "@" + check.json.username;

      const { error } = await db.from("social_accounts").update(patch)
        .eq("brand", brand).eq("platform", PLATFORM);
      if (error) return J({ error: error.message }, 500);
      return J({
        brand, connected: true, api: "facebook-login",
        handle: check.json.username ? "@" + check.json.username : null,
        remoteUserId: String(uid), neverExpires: true,
      });
    }

    // ---- connect ----------------------------------------------------------
    // Takes the short-lived token from the OAuth redirect, exchanges it for a
    // 60-day long-lived token, resolves the ig-user-id, and stores both.
    if (action === "connect") {
      if (!brand) return J({ error: "brand required" }, 400);
      const short = body.accessToken;
      if (!short) return J({ error: "accessToken required" }, 400);

      const row = await loadRow(brand);
      const secret = appSecret(row);
      if (!secret) return J({ error: "no app secret for this brand (set social_accounts.app_secret or IG_APP_SECRET)" }, 400);
      const ex = await ig(GRAPH_IG, "/access_token", {
        grant_type: "ig_exchange_token",
        client_secret: secret,
        access_token: short,
      });
      const longTok = ex.json?.access_token;
      if (!longTok) return J({ stage: "exchange", detail: ex.json }, 400);
      const expiresAt = new Date(Date.now() + (ex.json.expires_in ?? 5184000) * 1000).toISOString();

      let uid = body.remoteUserId;
      if (!uid) {
        const meRes = await ig(GRAPH_IG, "/me", { fields: "id,username", access_token: longTok });
        uid = meRes.json?.id;
        if (!uid) return J({ stage: "me", detail: meRes.json }, 400);
      }

      const { error } = await db.from("social_accounts").update({
        access_token: longTok,
        remote_user_id: String(uid),
        token_expires_at: expiresAt,
        last_refreshed_at: new Date().toISOString(),
        active: true,
      }).eq("brand", brand).eq("platform", PLATFORM);
      if (error) return J({ error: error.message }, 500);

      return J({ brand, connected: true, remoteUserId: String(uid), tokenExpiresAt: expiresAt });
    }

    // ---- refresh ----------------------------------------------------------
    // Only Instagram-Login tokens expire. They are good for 60 days and can be
    // refreshed any time after 24h of age; roll anything with under 20 days left.
    // Facebook Page tokens never expire, so they are skipped by design — calling
    // ig_refresh_token on one would fail every run and mask a real problem.
    if (action === "refresh") {
      const { data } = await db.from("social_accounts")
        .select("*").eq("platform", PLATFORM).eq("active", true);
      const out: unknown[] = [];
      for (const a of (data ?? []) as Account[]) {
        if (!a.access_token) continue;
        if (isFacebookToken(a.access_token)) {
          out.push({ brand: a.brand, skipped: true, reason: "facebook page token never expires" });
          continue;
        }
        if (!a.token_expires_at) {
          out.push({ brand: a.brand, skipped: true, reason: "no expiry recorded" });
          continue;
        }
        const daysLeft = (Date.parse(a.token_expires_at) - Date.now()) / 86400000;
        if (daysLeft > 20) { out.push({ brand: a.brand, skipped: true, daysLeft: Math.round(daysLeft) }); continue; }
        const r = await ig(GRAPH_IG, "/refresh_access_token", {
          grant_type: "ig_refresh_token",
          access_token: a.access_token,
        });
        if (r.json?.access_token) {
          const exp = new Date(Date.now() + (r.json.expires_in ?? 5184000) * 1000).toISOString();
          await db.from("social_accounts").update({
            access_token: r.json.access_token,
            token_expires_at: exp,
            last_refreshed_at: new Date().toISOString(),
          }).eq("id", a.id);
          out.push({ brand: a.brand, refreshed: true, tokenExpiresAt: exp });
        } else {
          out.push({ brand: a.brand, refreshed: false, detail: r.json });
        }
      }
      return J({ results: out });
    }

    // ---- oauth ------------------------------------------------------------
    // Full exchange straight off the redirect: code -> short-lived -> 60-day.
    if (action === "oauth") {
      if (!brand) return J({ error: "brand required" }, 400);
      if (!body.code) return J({ error: "code required" }, 400);
      const row = await loadRow(brand);
      if (!appId(row) || !appSecret(row)) {
        return J({ error: "no app id/secret for this brand" }, 400);
      }
      const form = new URLSearchParams({
        client_id: appId(row),
        client_secret: appSecret(row),
        grant_type: "authorization_code",
        redirect_uri: body.redirectUri || "",
        code: String(body.code).replace(/#_$/, ""),
      });
      const sr = await fetch("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      const sj = await sr.json();
      if (!sj.access_token) return J({ stage: "code-exchange", detail: sj }, 400);

      const ex = await ig(GRAPH_IG, "/access_token", {
        grant_type: "ig_exchange_token",
        client_secret: appSecret(row),
        access_token: sj.access_token,
      });
      if (!ex.json?.access_token) return J({ stage: "long-exchange", detail: ex.json }, 400);
      const expiresAt = new Date(Date.now() + (ex.json.expires_in ?? 5184000) * 1000).toISOString();

      let uid = sj.user_id ? String(sj.user_id) : null;
      let handle: string | null = null;
      const meRes = await ig(GRAPH_IG, "/me", { fields: "id,username", access_token: ex.json.access_token });
      if (meRes.json?.id) { uid = String(meRes.json.id); handle = meRes.json.username ?? null; }
      if (!uid) return J({ stage: "me", detail: meRes.json }, 400);

      const patch: Record<string, unknown> = {
        access_token: ex.json.access_token,
        remote_user_id: uid,
        token_expires_at: expiresAt,
        last_refreshed_at: new Date().toISOString(),
        active: true,
      };
      if (handle) patch.handle = "@" + handle;
      const { error } = await db.from("social_accounts").update(patch)
        .eq("brand", brand).eq("platform", PLATFORM);
      if (error) return J({ error: error.message }, 500);
      return J({ brand, connected: true, handle, remoteUserId: uid, tokenExpiresAt: expiresAt });
    }

    // ---- setapp -----------------------------------------------------------
    // Stores this brand's Meta app id/secret. Never echoes the secret back.
    if (action === "setapp") {
      if (!brand) return J({ error: "brand required" }, 400);
      const patch: Record<string, unknown> = {};
      if (body.appId) patch.app_id = String(body.appId).trim();
      if (body.appSecret) patch.app_secret = String(body.appSecret).trim();
      if (!Object.keys(patch).length) return J({ error: "appId and/or appSecret required" }, 400);
      const { error } = await db.from("social_accounts").update(patch)
        .eq("brand", brand).eq("platform", PLATFORM);
      if (error) return J({ error: error.message }, 500);
      return J({ brand, appIdSet: !!patch.app_id, appSecretSet: !!patch.app_secret });
    }

    // ---- upload -----------------------------------------------------------
    // Instagram fetches media by URL and cannot accept an upload, so everything
    // has to land in the public bucket first.
    if (action === "upload") {
      if (!body.dataBase64) return J({ error: "dataBase64 required" }, 400);
      const raw = String(body.dataBase64).replace(/^data:[^;]+;base64,/, "");
      let bytes: Uint8Array;
      try {
        const bin = atob(raw);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } catch { return J({ error: "dataBase64 is not valid base64" }, 400); }

      const safe = String(body.filename || "upload.jpg").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-64);
      const path = `${brand || "shared"}/${crypto.randomUUID()}-${safe}`;
      const { error } = await db.storage.from("social-media").upload(path, bytes, {
        contentType: body.contentType || "image/jpeg",
        upsert: false,
      });
      if (error) return J({ stage: "upload", error: error.message }, 500);
      const { data } = db.storage.from("social-media").getPublicUrl(path);
      return J({ path, url: data.publicUrl, bytes: bytes.length });
    }

    // ---- list -------------------------------------------------------------
    if (action === "list") {
      let q = db.from("social_posts").select("*").eq("platform", PLATFORM)
        .order("scheduled_at", { ascending: false })
        .limit(Math.min(Number(body.limit) || 50, 200));
      if (brand) q = q.eq("brand", brand);
      const { data, error } = await q;
      if (error) return J({ error: error.message }, 500);
      return J({ posts: data ?? [] });
    }

    // ---- cancel -----------------------------------------------------------
    if (action === "cancel") {
      if (!body.id) return J({ error: "id required" }, 400);
      const { data, error } = await db.from("social_posts")
        .update({ status: "canceled" })
        .eq("id", body.id).in("status", ["queued", "failed"])
        .select().maybeSingle();
      if (error) return J({ error: error.message }, 500);
      if (!data) return J({ error: "not cancelable (already posting or posted)" }, 409);
      return J({ canceled: data });
    }

    // ---- dryrun -----------------------------------------------------------
    // Everything the live post does except the final media_publish call: the
    // token is used, permissions are checked, and Instagram fetches and validates
    // every image URL. An unpublished container is discarded after 24h, so this
    // is a genuine rehearsal that puts nothing on the feed.
    if (action === "dryrun") {
      const acct = await getAccount(brand);
      const urls: string[] | null = Array.isArray(body.mediaUrls) && body.mediaUrls.length
        ? body.mediaUrls.map(String) : null;
      const cover = body.mediaUrl || (urls ? urls[0] : null);
      if (!cover && !urls) return J({ error: "mediaUrl or mediaUrls required" }, 400);
      const built = await buildContainers(
        acct, urls, cover, body.caption || "", body.mediaType || "image",
        body.coverUrl ? String(body.coverUrl) : null,
      );
      return J({
        brand,
        api: isFacebookToken(acct.access_token) ? "facebook-login" : "instagram-login",
        published: false,
        ...built,
      }, built.ok ? 200 : 502);
    }

    // ---- queue ------------------------------------------------------------
    if (action === "queue") {
      if (!brand) return J({ error: "brand required" }, 400);
      const urls: string[] | null = Array.isArray(body.mediaUrls) && body.mediaUrls.length
        ? body.mediaUrls.map(String) : null;
      const isCarousel = !!urls && urls.length > 1;
      const cover = body.mediaUrl || (urls ? urls[0] : null);
      if (!cover) return J({ error: "mediaUrl or mediaUrls required" }, 400);
      if (urls && (urls.length < 1 || urls.length > 10)) {
        return J({ error: "a carousel takes 2-10 slides" }, 400);
      }
      const { data, error } = await db.from("social_posts").insert({
        brand,
        platform: PLATFORM,
        media_url: cover,
        media_urls: isCarousel ? urls : null,
        media_type: isCarousel ? "carousel" : (body.mediaType || "image"),
        cover_url: body.coverUrl ? String(body.coverUrl) : null,
        caption: body.caption || "",
        scheduled_at: body.scheduledAt || new Date().toISOString(),
      }).select().single();
      if (error) return J({ error: error.message }, 500);
      return J({ queued: data });
    }

    // ---- post (immediate) -------------------------------------------------
    if (action === "post") {
      const acct = await getAccount(brand);
      const urls: string[] | null = Array.isArray(body.mediaUrls) && body.mediaUrls.length > 1
        ? body.mediaUrls.map(String) : null;
      if (!body.mediaUrl && !urls) return J({ error: "mediaUrl or mediaUrls required" }, 400);
      const res = await publishAny(
        acct, urls, body.mediaUrl ?? null, body.caption || "", body.mediaType || "image",
        body.coverUrl ? String(body.coverUrl) : null,
      );
      return J({ brand, ...res }, res.ok ? 200 : 502);
    }

    // ---- drain (pg_cron) --------------------------------------------------
    if (action === "drain") {
      await db.rpc("requeue_stuck_social_posts");
      const { data: claimed, error: cErr } = await db.rpc("claim_next_social_post", { p_platform: PLATFORM });
      if (cErr) return J({ error: cErr.message }, 500);
      const row = Array.isArray(claimed) ? claimed[0] : claimed;
      if (!row) return J({ drained: 0 });

      try {
        const acct = await getAccount(row.brand);
        const urls = (row.media_type === "carousel" && Array.isArray(row.media_urls))
          ? row.media_urls as string[] : null;
        const res = await publishAny(acct, urls, row.media_url, row.caption,
                                     row.media_type, row.cover_url ?? null);
        if (res.ok) {
          await db.from("social_posts").update({
            status: "posted", remote_id: res.remoteId, permalink: res.permalink,
            posted_at: new Date().toISOString(), error: null,
          }).eq("id", row.id);
          return J({ drained: 1, id: row.id, brand: row.brand, permalink: res.permalink });
        }
        const giveUp = row.attempts >= row.max_attempts;
        await db.from("social_posts").update({
          status: giveUp ? "failed" : "queued",
          error: `${res.stage}: ${JSON.stringify(res.detail)}`.slice(0, 2000),
        }).eq("id", row.id);
        return J({ drained: 0, id: row.id, retrying: !giveUp, stage: res.stage, detail: res.detail }, 502);
      } catch (e) {
        const giveUp = row.attempts >= row.max_attempts;
        await db.from("social_posts").update({
          status: giveUp ? "failed" : "queued",
          error: String(e).slice(0, 2000),
        }).eq("id", row.id);
        return J({ drained: 0, id: row.id, retrying: !giveUp, error: String(e) }, 500);
      }
    }

    return J({ error: "unknown action" }, 400);
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});
