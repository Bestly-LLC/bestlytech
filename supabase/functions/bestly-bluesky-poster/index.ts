// bestly-bluesky-poster — the Bluesky leg of the Studio posting queue (2026-10-19).
// Sibling of bestly-threads-poster; same queue, same gates, same shape. Plain fetch against the AT Protocol, no SDK.
//
// A queued social_posts row (platform 'bluesky') is published to the brand's Bluesky account:
//   video     -> official video service: getServiceAuth -> video.bsky.app uploadVideo -> getJobStatus until JOB_STATE_COMPLETED
//                -> app.bsky.embed.video (blob, aspectRatio, alt = headline)  -> com.atproto.repo.createRecord
//   image(s)  -> com.atproto.repo.uploadBlob (Bluesky images must be 1,000,000 bytes or less) -> app.bsky.embed.images
// A video job still processing when this run ends is kept in social_posts.publish_id ("bsky-job:<id>") and picked up
// again by the next drain (no second upload).
//
// Identity: keyed on the account DID (social_accounts.remote_user_id), never the handle, so a later change to
// @minutenewsdaily.com keeps working. Sign-in uses the DID + an APP PASSWORD from Vault (studio_bluesky_cred_get);
// the session (accessJwt / refreshJwt) is cached on social_accounts (access_token / refresh_token) and refreshed with
// refreshSession; createSession only runs when both are gone. Tokens and passwords are never returned or logged.
//
// Caps and the master rule are enforced INSIDE claim_next_platform_post('bluesky') (SQL): only Jared-approved items
// (house_post_cleared), the brand's per-day cap, posting window, freshest-first order and expiry, from social_platform_caps.
//
// Limits (checked 2026-10-19): video blob 300,000,000 bytes, video/mp4 (app.bsky.embed.video lexicon); 10 minutes
// (Bluesky announcement); daily upload quota read live from app.bsky.video.getUploadLimits before every upload.
// A clip over a limit is refused cleanly: the post fails with the reason and Anchor is told; nothing is truncated or re-encoded.
//
// AI label: Bluesky has no AI-content field, so when provenance says AI voice (or provenance is missing) the
// text's LAST LINE says "AI voice" (text.ts).
//
// Actions (POST, service role or x-proxy-key):
//   { action:'drain' }     publish one due row (pg_cron every 5 min)
//   { action:'check' }     prove every active login still works; dead -> inactive + alert to the brand's owner (every 6 h)
//   { action:'me', brand } sanity check one account
//   { action:'compose', caption, aiLabel?, ensureMore? }   the exact text + facets that would be posted (no network)
//   { action:'dryrun', brand, mediaUrl, caption, aiLabel?, title?, upload? }   build the whole record; never createRecord.
//        No connected account: builds the record with a placeholder blob and stops (no network to Bluesky).
//        Connected: signs in, reads the clip, checks limits, (upload:true also uploads and waits for the blob) and stops.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { blueskyText } from "./text.ts";
import { readMp4 } from "./mp4.ts";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLATFORM = "bluesky";
const PDS = "https://bsky.social";                       // entryway: proxies to the account's PDS
const VIDEO = "https://video.bsky.app";
const VIDEO_DID = "did:web:video.bsky.app";
const MAX_VIDEO_BYTES = 300_000_000;
const MAX_VIDEO_SECONDS = 600;
const MAX_IMAGE_BYTES = 1_000_000;
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-proxy-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };

type Account = { id: string; brand: string; handle: string | null; remote_user_id: string | null; access_token: string | null; refresh_token: string | null; active: boolean; client_id: string | null };
type Row = { id?: string; brand: string; media_type: string; media_url: string; media_urls: string[] | null; caption: string | null; title?: string | null; alt_text?: string | null; publish_id?: string | null; approval_item_id?: string | null; attempts?: number; max_attempts?: number };
type Sess = { jwt: string; did: string; handle: string | null; emailConfirmed: boolean | null };

function b64urlJson(seg: string): Record<string, unknown> | null {
  try { const s = seg.replace(/-/g, "+").replace(/_/g, "/"); return JSON.parse(atob(s + "=".repeat((4 - (s.length % 4)) % 4))); } catch { return null; }
}
async function callerAuthorized(req: Request): Promise<boolean> {
  const k = req.headers.get("x-proxy-key");
  if (k) for (const n of ["edge_proxy_key_sha256", "edge_proxy_key_prev_sha256"]) {
    const { data } = await db.rpc("edge_key_ok", { p_name: n, p_key: k }); if (data === true) return true;
  }
  const jwt = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const parts = jwt.split(".");
  if (parts.length === 3) { const p = b64urlJson(parts[1]); if (p && p.role === "service_role") return true; }
  return false;
}
const scrub = (s: string) => s.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "jwt…")
  .replace(/\b[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}\b/gi, "app-password…");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function xrpc(base: string, nsid: string, o: { method?: "GET" | "POST"; params?: Record<string, string>; json?: unknown; bytes?: Uint8Array; contentType?: string; token?: string } = {}) {
  const u = new URL(`${base}/xrpc/${nsid}`);
  for (const [k, v] of Object.entries(o.params ?? {})) u.searchParams.set(k, v);
  const headers: Record<string, string> = {};
  if (o.token) headers["Authorization"] = `Bearer ${o.token}`;
  let body: BodyInit | undefined;
  if (o.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(o.json); }
  else if (o.bytes) { headers["Content-Type"] = o.contentType ?? "application/octet-stream"; body = o.bytes; }
  const r = await fetch(u.toString(), { method: o.method ?? (body ? "POST" : "GET"), headers, body });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}

// ---- alerts: signed by the owner of the brand (mnd -> Anchor; everything else -> Bluesky Poster) --------------------
const alertKey = (brand: string) => (brand === "minutenewsdaily" ? "mnd.bluesky" : "studio:bluesky");
async function raise(brand: string, kind: "problem" | "resolved", title: string, body: string | null) {
  try { await db.rpc("bestly_raise", { p_key: alertKey(brand), p_kind: kind, p_severity: kind === "resolved" ? "info" : "warning", p_title: title, p_body: body, p_area: "ops" }); } catch { /* alerts are best effort */ }
}
async function reconnectLink(a: Account): Promise<string | null> {
  if (!a.client_id) return null;
  const { data: open } = await db.from("social_connect_links").select("short_code, created_by").eq("client_id", a.client_id).is("used_at", null)
    .gt("expires_at", new Date(Date.now() + 2 * 86400000).toISOString()).not("short_code", "is", null).like("created_by", "% · bluesky").order("created_at", { ascending: false }).limit(1);
  if (open?.[0]?.short_code) return "https://www.bestly.tech/c/" + open[0].short_code;
  const { data } = await db.rpc("social_connect_mint", { p_client: a.client_id, p_by: "Bluesky watchdog", p_platform: PLATFORM });
  return typeof data === "string" ? data : null;
}

// ---- account + session ----------------------------------------------------------------------------------------------
async function account(brand: string): Promise<Account> {
  const { data, error } = await db.from("social_accounts").select("*").eq("brand", brand).eq("platform", PLATFORM).maybeSingle();
  if (error) throw new Error("db: " + error.message);
  if (!data) throw new Error(`brand '${brand}' has no bluesky account`);
  if (!data.access_token || !data.remote_user_id) throw new Error(`brand '${brand}' bluesky is not connected`);
  return data as Account;
}
class AuthDead extends Error { }
const jwtExp = (t: string) => Number((b64urlJson(t.split(".")[1] ?? "") ?? {}).exp ?? 0);

async function store(a: Account, s: { accessJwt: string; refreshJwt?: string; handle?: string }) {
  a.access_token = s.accessJwt; if (s.refreshJwt) a.refresh_token = s.refreshJwt;
  const patch: Record<string, unknown> = { access_token: s.accessJwt, last_refreshed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (s.refreshJwt) patch.refresh_token = s.refreshJwt;
  if (s.handle) { patch.handle = "@" + s.handle; a.handle = "@" + s.handle; }
  await db.from("social_accounts").update(patch).eq("id", a.id);
}

async function session(a: Account, force = false): Promise<Sess> {
  const did = a.remote_user_id!;
  // 1. cached access token with time left
  if (!force && a.access_token && jwtExp(a.access_token) > Date.now() / 1000 + 120) return { jwt: a.access_token, did, handle: a.handle?.replace(/^@/, "") ?? null, emailConfirmed: null };
  // 2. refresh it
  if (!force && a.refresh_token && jwtExp(a.refresh_token) > Date.now() / 1000 + 60) {
    const r = await xrpc(PDS, "com.atproto.server.refreshSession", { method: "POST", token: a.refresh_token });
    if (r.json?.accessJwt) {
      await store(a, r.json);
      return { jwt: r.json.accessJwt, did: r.json.did ?? did, handle: r.json.handle ?? null, emailConfirmed: null };
    }
  }
  // 3. fresh sign-in with the app password in Vault (identifier = DID, so a handle change never breaks it)
  const { data: cred } = await db.rpc("studio_bluesky_cred_get", { p_brand: a.brand });
  const pw = (cred as any)?.app_password;
  if (!pw) throw new AuthDead("no app password saved for this account");
  const r = await xrpc(PDS, "com.atproto.server.createSession", { json: { identifier: did, password: pw } });
  if (r.json?.accessJwt) {
    if (r.json.did && r.json.did !== did) throw new AuthDead("the saved login belongs to a different Bluesky account");
    await store(a, r.json);
    return { jwt: r.json.accessJwt, did, handle: r.json.handle ?? null, emailConfirmed: r.json.emailConfirmed ?? null };
  }
  const code = String(r.json?.error ?? "");
  if (r.status === 401 || ["AuthenticationRequired", "AccountTakedown", "AccountDeactivated", "InvalidToken", "ExpiredToken"].includes(code))
    throw new AuthDead(code === "AuthenticationRequired" ? "Bluesky no longer accepts the app password (it was revoked or changed)" : `Bluesky refused the login (${code || r.status})`);
  throw new Error(`createSession ${r.status} ${code}`);
}

let pdsAudCache: Record<string, string> = {};
async function pdsAud(did: string): Promise<string> {
  if (pdsAudCache[did]) return pdsAudCache[did];
  const r = await fetch(did.startsWith("did:plc:") ? `https://plc.directory/${did}` : `https://${did.replace("did:web:", "")}/.well-known/did.json`);
  const doc: any = await r.json().catch(() => ({}));
  const svc = (doc.service ?? []).find((s: any) => s.type === "AtprotoPersonalDataServer" || String(s.id).endsWith("#atproto_pds"));
  const host = svc?.serviceEndpoint ? new URL(svc.serviceEndpoint).host : "bsky.social";
  return (pdsAudCache[did] = "did:web:" + host);
}
async function serviceToken(s: Sess, aud: string, lxm: string) {
  const r = await xrpc(PDS, "com.atproto.server.getServiceAuth", { token: s.jwt, params: { aud, lxm, exp: String(Math.floor(Date.now() / 1000) + 1800) } });
  if (!r.json?.token) throw new Error(`getServiceAuth ${r.status} ${r.json?.error ?? ""}`);
  return String(r.json.token);
}

// ---- text + record ---------------------------------------------------------------------------------------------------
async function aiLabelFor(itemId: string | null | undefined): Promise<boolean> {
  if (!itemId) return true;                                   // unknown provenance: label it (fail safe)
  const { data } = await db.from("approval_items").select("provenance").eq("id", itemId).maybeSingle();
  const p = (data as any)?.provenance;
  if (!p || typeof p !== "object") return true;
  return p.ai_voice === true || p.ai_label_needed === true;
}
const altFor = (row: Row) => {
  const first = String(row.caption ?? "").split("\n").find((l) => l.trim() && !l.trim().startsWith("#")) ?? "";
  return String(row.alt_text || row.title || first || "News clip").replace(/\s+/g, " ").trim().slice(0, 500);
};

async function fetchMedia(url: string, maxBytes: number): Promise<{ ok: true; bytes: Uint8Array; type: string } | { ok: false; stage: string; detail: string }> {
  const r = await fetch(url);
  if (!r.ok) return { ok: false, stage: "download", detail: `HTTP ${r.status} fetching the media` };
  const len = Number(r.headers.get("content-length") ?? 0);
  if (len > maxBytes) { await r.body?.cancel(); return { ok: false, stage: "too-large", detail: `${len} bytes is over Bluesky's ${maxBytes} byte limit` }; }
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > maxBytes) return { ok: false, stage: "too-large", detail: `${bytes.length} bytes is over Bluesky's ${maxBytes} byte limit` };
  return { ok: true, bytes, type: r.headers.get("content-type") ?? "" };
}

async function uploadLimits(s: Sess): Promise<{ canUpload: boolean | null; message?: string }> {
  try {
    const tok = await serviceToken(s, VIDEO_DID, "app.bsky.video.getUploadLimits");
    const r = await xrpc(VIDEO, "app.bsky.video.getUploadLimits", { token: tok });
    if (typeof r.json?.canUpload === "boolean") return { canUpload: r.json.canUpload, message: r.json.message ?? r.json.error };
  } catch { /* unknown: let the upload itself decide */ }
  return { canUpload: null };
}

async function pollJob(jobId: string, tries: number, gap = 2000) {
  let last: any = null;
  for (let i = 0; i < tries; i++) {
    const r = await xrpc(VIDEO, "app.bsky.video.getJobStatus", { params: { jobId } });
    const js = r.json?.jobStatus ?? r.json;
    last = js;
    if (js?.blob) return { ok: true as const, blob: js.blob };
    if (js?.state === "JOB_STATE_FAILED" || js?.error) return { ok: false as const, stage: "video-failed", detail: js?.error ?? js?.message ?? js?.state, failed: true };
    await sleep(gap);
  }
  return { ok: false as const, stage: "video-processing", detail: last?.state ?? "still processing", waiting: true };
}

type VideoResult = { ok: true; blob: unknown; width: number | null; height: number | null } | { ok: false; stage: string; detail: unknown; waiting?: boolean; failed?: boolean; held?: boolean };

async function prepareVideo(a: Account, s: Sess, row: Row, opts: { upload: boolean }): Promise<VideoResult> {
  // resume a job that was still processing on the last run
  if (row.publish_id?.startsWith("bsky-job:")) {
    const j = await pollJob(row.publish_id.slice(9), 40);
    if (j.ok) return { ok: true, blob: j.blob, width: null, height: null };
    if (j.waiting) return { ...j, ok: false };
    if (row.id) await db.from("social_posts").update({ publish_id: null }).eq("id", row.id);   // dead job: next attempt starts fresh
    return { ...j, ok: false };
  }
  const m = await fetchMedia(row.media_url, MAX_VIDEO_BYTES);
  if (!m.ok) return m;
  const info = readMp4(m.bytes);
  if (!info.isMp4) return { ok: false, stage: "not-mp4", detail: "the clip is not an MP4 file (Bluesky video takes video/mp4)" };
  if (info.durationSec !== null && info.durationSec > MAX_VIDEO_SECONDS) return { ok: false, stage: "too-long", detail: `the clip runs ${Math.round(info.durationSec)} seconds; Bluesky's limit is ${MAX_VIDEO_SECONDS} seconds` };
  const lim = await uploadLimits(s);
  if (lim.canUpload === false) return { ok: false, stage: "upload-limit", detail: lim.message ?? "Bluesky says this account cannot upload video right now (daily limit or email not verified)", held: true };
  if (!opts.upload) return { ok: true, blob: { placeholder: "not uploaded (dry run)", size: m.bytes.length, mimeType: "video/mp4" }, width: info.width, height: info.height };

  const tok = await serviceToken(s, await pdsAud(s.did), "com.atproto.repo.uploadBlob");
  const u = new URL(`${VIDEO}/xrpc/app.bsky.video.uploadVideo`);
  u.searchParams.set("did", s.did); u.searchParams.set("name", "clip.mp4");
  const up = await fetch(u.toString(), { method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "video/mp4", "Content-Length": String(m.bytes.length) }, body: m.bytes });
  const uj: any = await up.json().catch(() => ({}));
  const js = uj?.jobStatus ?? uj;                              // "already_exists" answers carry the job/blob too
  if (js?.blob) return { ok: true, blob: js.blob, width: info.width, height: info.height };
  if (!js?.jobId) return { ok: false, stage: "video-upload", detail: uj?.message ?? uj?.error ?? `HTTP ${up.status}` };
  if (row.id) await db.from("social_posts").update({ publish_id: "bsky-job:" + js.jobId }).eq("id", row.id);
  const j = await pollJob(String(js.jobId), 40);
  if (j.ok) return { ok: true, blob: j.blob, width: info.width, height: info.height };
  if (!j.waiting && row.id) await db.from("social_posts").update({ publish_id: null }).eq("id", row.id);
  return { ...j, ok: false };
}

async function prepareImages(s: Sess, row: Row): Promise<{ ok: true; images: Array<{ alt: string; image: unknown }> } | { ok: false; stage: string; detail: string }> {
  const urls = (row.media_urls && row.media_urls.length ? row.media_urls : [row.media_url]).slice(0, 4);   // Bluesky: 4 images max
  const out: Array<{ alt: string; image: unknown }> = [];
  for (const u of urls) {
    const m = await fetchMedia(u, MAX_IMAGE_BYTES);
    if (!m.ok) return m;
    const up = await xrpc(PDS, "com.atproto.repo.uploadBlob", { token: s.jwt, bytes: m.bytes, contentType: m.type.split(";")[0] || "image/jpeg" });
    if (!up.json?.blob) return { ok: false, stage: "image-upload", detail: up.json?.message ?? up.json?.error ?? `HTTP ${up.status}` };
    out.push({ alt: altFor(row), image: up.json.blob });
  }
  return { ok: true, images: out };
}

function buildRecord(text: string, facets: unknown[], embed: unknown) {
  return { $type: "app.bsky.feed.post", text, facets, langs: ["en"], createdAt: new Date().toISOString(), embed };
}

async function publishAny(a: Account, row: Row, opts: { dry?: boolean; aiLabel?: boolean; upload?: boolean } = {}) {
  const ai = opts.aiLabel ?? await aiLabelFor(row.approval_item_id);
  const t = blueskyText(row.caption ?? "", ai, { ensureMore: a.brand === "minutenewsdaily" });
  if (!t.text) return { ok: false, stage: "text", detail: "empty text" };
  const s = await session(a);
  const isVideo = row.media_type === "video" || row.media_type === "reel";
  let embed: any;
  if (isVideo) {
    const v = await prepareVideo(a, s, row, { upload: !opts.dry || !!opts.upload });
    if (!v.ok) return v;
    embed = { $type: "app.bsky.embed.video", video: v.blob, alt: altFor(row), ...(v.width && v.height ? { aspectRatio: { width: v.width, height: v.height } } : {}) };
  } else {
    const im = await prepareImages(s, row);
    if (!im.ok) return im;
    embed = { $type: "app.bsky.embed.images", images: im.images };
  }
  const record = buildRecord(t.text, t.facets, embed);
  if (opts.dry) return { ok: true, dry: true, stage: "record-built", record, graphemes: t.graphemes, bytes: t.bytes };
  const r = await xrpc(PDS, "com.atproto.repo.createRecord", { token: s.jwt, json: { repo: s.did, collection: "app.bsky.feed.post", record } });
  if (!r.json?.uri) return { ok: false, stage: "createRecord", detail: r.json?.message ? { error: r.json.error, message: r.json.message } : r.json, status: r.status };
  const rkey = String(r.json.uri).split("/").pop();
  return { ok: true, remoteId: String(r.json.uri), permalink: `https://bsky.app/profile/${s.did}/post/${rkey}`, text: t.text };
}

async function goDead(a: Account, why: string) {
  await db.from("social_accounts").update({ active: false, updated_at: new Date().toISOString() }).eq("id", a.id);
  const link = await reconnectLink(a);
  await raise(a.brand, "problem", "Bluesky connection lost",
    `${a.handle ?? a.brand}: ${why}. Queued Bluesky posts are held until it is reconnected.` + (link ? `\nReconnect (make a new app password in Bluesky, then paste it here): ${link}` : ""));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  if (!(await callerAuthorized(req))) return J({ error: "unauthorized" }, 401);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const action = body.action || "drain";
  const brand = String(body.brand ?? "").toLowerCase();
  try {
    if (action === "compose") {
      const r = blueskyText(String(body.caption ?? ""), body.aiLabel !== false, { ensureMore: body.ensureMore === true });
      return J(r);
    }

    if (action === "me") {
      const a = await account(brand);
      const s = await session(a);
      const r = await xrpc(PDS, "com.atproto.server.getSession", { token: s.jwt });
      return J(r.json?.did ? { did: r.json.did, handle: r.json.handle, emailConfirmed: r.json.emailConfirmed ?? null } : { error: scrub(String(r.json?.message ?? r.json?.error ?? r.status)) }, r.status);
    }

    if (action === "dryrun") {
      const row: Row = { brand, media_type: String(body.mediaType || "video"), media_url: String(body.mediaUrl ?? ""), media_urls: Array.isArray(body.mediaUrls) ? body.mediaUrls.map(String) : null,
        caption: String(body.caption ?? ""), title: body.title ? String(body.title) : null };
      const ai = body.aiLabel !== false;
      const { data: acct } = await db.from("social_accounts").select("*").eq("brand", brand).eq("platform", PLATFORM).maybeSingle();
      if (!acct || !acct.access_token || !acct.remote_user_id) {
        // no connected account: build everything we can without touching Bluesky, then stop
        const t = blueskyText(row.caption ?? "", ai, { ensureMore: brand === "minutenewsdaily" });
        const m = row.media_url && (row.media_type === "video") ? await fetchMedia(row.media_url, MAX_VIDEO_BYTES) : null;
        const info = m && m.ok ? readMp4(m.bytes) : null;
        const embed = { $type: "app.bsky.embed.video", video: { placeholder: "not uploaded: no connected Bluesky account yet" }, alt: altFor(row),
          ...(info?.width && info?.height ? { aspectRatio: { width: info.width, height: info.height } } : {}) };
        return J({ brand, published: false, connected: false, stage: "record-built-no-account", media: info ? { ...info, bytes: m && m.ok ? m.bytes.length : null } : null,
          limits: { maxBytes: MAX_VIDEO_BYTES, maxSeconds: MAX_VIDEO_SECONDS }, graphemes: t.graphemes, bytes: t.bytes, record: buildRecord(t.text, t.facets, embed) });
      }
      const res: any = await publishAny(acct as Account, row, { dry: true, aiLabel: ai, upload: body.upload === true });
      return J({ brand, published: false, connected: true, ...res }, res.ok ? 200 : 502);
    }

    if (action === "check") {
      const { data } = await db.from("social_accounts").select("*").eq("platform", PLATFORM).eq("active", true);
      const out: unknown[] = []; const healthyBrands: string[] = [];
      for (const a of (data ?? []) as Account[]) {
        if (!a.access_token || !a.remote_user_id) continue;
        try {
          const s = await session(a);
          const r = await xrpc(PDS, "com.atproto.server.getSession", { token: s.jwt });
          if (r.json?.did) { out.push({ brand: a.brand, ok: true }); healthyBrands.push(a.brand); continue; }
          if (r.status === 400 || r.status === 401) {
            // the cached session was refused: prove the app password itself still works with a fresh sign-in
            await session(a, true);
            out.push({ brand: a.brand, ok: true, resigned: true }); healthyBrands.push(a.brand); continue;
          }
          out.push({ brand: a.brand, ok: false, transient: true, status: r.status });
        } catch (e) {
          if (e instanceof AuthDead) { await goDead(a, e.message); out.push({ brand: a.brand, ok: false, dead: true }); }
          else out.push({ brand: a.brand, ok: false, transient: true });
        }
      }
      for (const b of healthyBrands) await raise(b, "resolved", "Bluesky connection healthy", null);
      return J({ results: out });
    }

    if (action === "drain") {
      await db.rpc("requeue_stuck_social_posts");
      const { data: claimed, error: cErr } = await db.rpc("claim_next_platform_post", { p_platform: PLATFORM });
      if (cErr) return J({ error: cErr.message }, 500);
      const row = Array.isArray(claimed) ? claimed[0] : claimed;
      if (!row) return J({ drained: 0 });
      const a = await account(row.brand).catch(() => null);
      try {
        if (!a) throw new Error("no connected bluesky account");
        const res: any = await publishAny(a, row);
        if (res.ok) {
          await db.from("social_posts").update({ status: "posted", remote_id: res.remoteId, permalink: res.permalink, posted_at: new Date().toISOString(), error: null, publish_id: null }).eq("id", row.id);
          await raise(row.brand, "resolved", "Bluesky posting healthy", null);
          return J({ drained: 1, id: row.id, brand: row.brand, permalink: res.permalink });
        }
        // refused for good (over a limit / wrong file): fail now, tell the owner. Still processing: keep the job id and try again next drain.
        const permanent = ["too-large", "too-long", "not-mp4", "video-failed", "image-upload", "text"].includes(res.stage);
        const giveUp = permanent || row.attempts >= row.max_attempts;
        await db.from("social_posts").update({ status: giveUp ? "failed" : "queued", error: scrub(`${res.stage}: ${JSON.stringify(res.detail)}`).slice(0, 2000) }).eq("id", row.id);
        if (giveUp || res.held) await raise(row.brand, "problem", res.held ? "Bluesky will not take another video right now" : "A Bluesky post failed",
          `${a.handle ?? row.brand}: ${scrub(res.stage + ": " + JSON.stringify(res.detail)).slice(0, 400)}\nPost id ${row.id}. ${res.held ? "It stays queued and tries again on the next run." : "Studio shows a Retry button."}`);
        return J({ drained: 0, id: row.id, retrying: !giveUp, stage: res.stage }, 502);
      } catch (e) {
        if (e instanceof AuthDead && a) {
          await goDead(a, e.message);
          await db.from("social_posts").update({ status: "queued", attempts: Math.max(0, (row.attempts ?? 1) - 1), error: scrub(e.message).slice(0, 500) }).eq("id", row.id);
          return J({ drained: 0, id: row.id, dead: true }, 401);
        }
        const giveUp = row.attempts >= row.max_attempts;
        await db.from("social_posts").update({ status: giveUp ? "failed" : "queued", error: scrub(String(e)).slice(0, 2000) }).eq("id", row.id);
        if (giveUp) await raise(row.brand, "problem", "A Bluesky post failed", scrub(String(e)).slice(0, 400) + `\nPost id ${row.id}.`);
        return J({ drained: 0, id: row.id, retrying: !giveUp, error: scrub(String(e)) }, 500);
      }
    }
    return J({ error: "unknown action" }, 400);
  } catch (e) { return J({ error: scrub(String(e)) }, 500); }
});
