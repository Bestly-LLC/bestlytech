// bestly-yt-poster — the YouTube leg of the Studio posting queue.
// Sibling of bestly-ig-poster, tiktok-inbox, bestly-fb-poster, bestly-li-poster and bestly-pin-poster; same queue, same shape.
//
// A queued social_posts row (platform 'youtube') becomes a video on the client's channel. Video only; a vertical clip of
// 3 minutes or less is a Short (#Shorts in the description, /shorts/ link), anything else is a normal video.
// Upload: YouTube Data API v3 resumable upload. The source file is STREAMED from media_url into 8 MiB PUTs, never held whole in memory.
// Credentials: social_accounts (platform 'youtube'): access_token (1 h), refresh_token (long-lived), page_id = remote_user_id = channel id,
// handle = channel title. App creds live in Vault (studio_yt_app_get). Tokens are never returned or logged.
//
// Live gate: like bestly-pin-poster, drain does nothing while studio_yt_live() is false (Google locks API uploads from an
// unaudited project to private, and the creator cannot make them public, so a real post would burn quota and look posted
// while nobody can see it). Queued rows simply wait. When it is true, uploads are public.
// Quota: 10,000 units a day per project, an upload is about 1,600. quotaExceeded keeps the post queued (no attempt burned),
// pushes every queued YouTube post to after the reset (midnight Pacific), and warns once.
//
// Actions (POST, service role or x-proxy-key):
//   { action:'drain' }                      upload one due row (pg_cron, every 5 min)
//   { action:'check' }                      refresh every active login and prove it with channels.list (1 unit); dead -> account
//                                           inactive + Studio Watch alert (pg_cron, every 6 h)
//   { action:'me', brand }                  the channel this login belongs to (id + title + counts only)
//   { action:'test', account_id, item_id }  upload that one approved video as PRIVATE whatever the live gate says, write no
//                                           social_posts row, return {video_id, url}. Manual only (never called by cron):
//                                           proves the Google path end to end on a channel before the audit
//   { action:'dryrun', itemId? | (mediaType, mediaUrl, title?, caption?, linkUrl?) }
//                                           build the exact upload request (title, description, privacy, Short or not) and
//                                           probe the file; Google is never called, nothing is uploaded. With itemId the caption,
//                                           title and link are the ones a queued post would carry (youtube variant, then
//                                           instagram variant, then item caption)

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GAPI = "https://www.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const PLATFORM = "youtube";
const CHUNK = 8 * 1024 * 1024;                  // multiple of 256 KiB, as resumable uploads require
const MAX_VIDEO_BYTES = 512 * 1024 * 1024;
const SHORT_MAX_S = 180;
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-proxy-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };

type Account = { id: string; brand: string; label: string | null; handle: string | null; remote_user_id: string | null; page_id: string | null; access_token: string | null; refresh_token: string | null; token_expires_at: string | null; active: boolean; client_id: string | null };
type Row = { id: string; brand: string; media_type: string; media_url: string; caption: string | null; title: string | null; link_url: string | null; approval_item_id: string | null; error: string | null; attempts: number; max_attempts: number };

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
const scrub = (s: string) => s.replace(/ya29\.[\w-]+/g, "ya29.…").replace(/1\/\/[\w-]{20,}/g, "1//…").replace(/GOCSPX-[\w-]+/g, "GOCSPX-…")
  .replace(/access_token=[^&\s"]+/g, "access_token=…").replace(/(client_secret|refresh_token|code)=[^&\s"]+/g, "$1=…")
  .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer …").replace(/upload_id=[^&\s"]+/g, "upload_id=…");

class DeadToken extends Error {}
class QuotaHold extends Error { constructor(public reason: string, public until: Date) { super(reason); } }

// ---- Google helpers ------------------------------------------------------------------------------
function gerr(j: any): { reason: string; message: string } {
  const e = j?.error;
  if (!e) return { reason: "", message: "" };
  if (typeof e === "string") return { reason: e, message: String(j.error_description ?? e) };
  return { reason: String(e.errors?.[0]?.reason ?? e.status ?? ""), message: String(e.message ?? "") };
}
async function jsonOf(r: Response): Promise<any> {
  const text = await r.text();
  try { return text ? JSON.parse(text) : {}; } catch { return { raw: text.slice(0, 200) }; }
}
async function gget(token: string, path: string) {
  const r = await fetch(GAPI + path, { headers: { Authorization: "Bearer " + token } });
  return { status: r.status, json: await jsonOf(r) };
}

// next quota reset: midnight Pacific is 07:00 or 08:00 UTC; 08:05 UTC is always safely after it
function nextQuotaReset(now = new Date()): Date {
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 5, 0));
  return t.getTime() > now.getTime() ? t : new Date(t.getTime() + 24 * 3600 * 1000);
}

async function account(brand: string): Promise<Account> {
  const { data, error } = await db.from("social_accounts").select("*").eq("brand", brand).eq("platform", PLATFORM).maybeSingle();
  if (error) throw new Error("db: " + error.message);
  if (!data) throw new Error(`brand '${brand}' has no youtube account`);
  if (!data.access_token || !data.remote_user_id || !data.refresh_token) throw new Error(`brand '${brand}' youtube is not connected`);
  return data as Account;
}

// ---- tokens: refresh before every use (access tokens last about an hour) --------------------------
async function refreshAccount(a: Account): Promise<{ ok: boolean; dead?: boolean; reason?: string }> {
  if (!a.refresh_token) return { ok: false, dead: true, reason: "no_refresh_token" };
  const { data: app } = await db.rpc("studio_yt_app_get");
  const id = (app as any)?.client_id, secret = (app as any)?.client_secret;
  if (!id || !secret) return { ok: false, reason: "app_not_set_up" };
  const r = await fetch(TOKEN_URL, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: a.refresh_token, client_id: String(id), client_secret: String(secret) }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.access_token) {
    const code = String(j.error ?? "");
    return { ok: false, dead: code === "invalid_grant", reason: scrub(`${code || r.status}${j.error_description ? ": " + j.error_description : ""}`).slice(0, 200) };
  }
  const now = new Date();
  const patch: Record<string, unknown> = {
    access_token: j.access_token, token_expires_at: new Date(now.getTime() + (Number(j.expires_in) || 3600) * 1000).toISOString(),
    last_refreshed_at: now.toISOString(), updated_at: now.toISOString(),
  };
  if (j.refresh_token) patch.refresh_token = j.refresh_token;   // Google rarely rotates it, but keep it if it does
  await db.from("social_accounts").update(patch).eq("id", a.id);
  a.access_token = j.access_token;
  if (j.refresh_token) a.refresh_token = j.refresh_token;
  return { ok: true };
}

async function raise(kind: "problem" | "resolved", title: string, body: string | null) {
  try { await db.rpc("bestly_raise", { p_key: "studio:youtube", p_kind: kind, p_severity: "warning", p_title: title, p_body: body, p_area: "ops" }); } catch { /* alerts are best effort */ }
}
async function markDead(a: Account, why: string) {
  await db.from("social_accounts").update({ active: false, updated_at: new Date().toISOString() }).eq("id", a.id);
  await raise("problem", "YouTube connection lost", `${a.handle ?? a.brand}: ${why} (needs reconnect). Queued videos are held until it is reconnected.`);
}

// ---- reading the file: MP4 width, height, duration from a few ranged reads ---------------------------
async function readUpTo(r: Response, n: number): Promise<Uint8Array> {
  const out = new Uint8Array(n); let got = 0;
  if (!r.body) return out.subarray(0, 0);
  const rd = r.body.getReader();
  while (got < n) {
    const { value, done } = await rd.read();
    if (done) break;
    const take = Math.min(value.length, n - got);
    out.set(value.subarray(0, take), got); got += take;
  }
  try { await rd.cancel(); } catch { /* the rest of the body is not wanted */ }
  return out.subarray(0, got);
}
async function getRange(url: string, start: number, len: number): Promise<{ bytes: Uint8Array; total: number | null }> {
  const r = await fetch(url, { headers: { Range: `bytes=${start}-${start + len - 1}` } });
  if (!r.ok) { try { await r.body?.cancel(); } catch { /* */ } return { bytes: new Uint8Array(0), total: null }; }
  let total: number | null = null;
  const cr = r.headers.get("content-range")?.match(/\/(\d+)$/);
  if (cr) total = Number(cr[1]); else if (r.status === 200) total = Number(r.headers.get("content-length") ?? 0) || null;
  const bytes = await readUpTo(r, len);
  return { bytes: start > 0 && r.status === 200 ? new Uint8Array(0) : bytes, total };
}
type Probe = { width: number | null; height: number | null; duration_s: number | null; bytes: number | null; note?: string };
async function probeMp4(url: string): Promise<Probe> {
  const out: Probe = { width: null, height: null, duration_s: null, bytes: null };
  try {
    const first = await getRange(url, 0, 65536);
    out.bytes = first.total;
    const total = first.total ?? 0;
    let moov: Uint8Array | null = null;
    let off = 0;
    for (let i = 0; i < 24 && off < total && !moov; i++) {
      const h = off === 0 ? first.bytes : (await getRange(url, off, 16)).bytes;
      if (h.length < 8) break;
      const dv = new DataView(h.buffer, h.byteOffset, h.byteLength);
      let size = dv.getUint32(0);
      const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
      if (size === 1 && h.length >= 16) size = Number(dv.getBigUint64(8));
      else if (size === 0) size = total - off;
      if (size < 8) break;
      if (type === "moov") {
        if (size > 8 * 1024 * 1024) { out.note = "moov too large"; break; }
        moov = (await getRange(url, off, size)).bytes;
        if (moov.length < size) moov = null;
      }
      off += size;
    }
    if (!moov) { out.note ||= "no moov box found"; return out; }
    const walk = (buf: Uint8Array, start: number, end: number) => {
      let p = start;
      while (p + 8 <= end) {
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const size = dv.getUint32(p);
        const type = String.fromCharCode(buf[p + 4], buf[p + 5], buf[p + 6], buf[p + 7]);
        if (size < 8 || p + size > end) break;
        const body = p + 8;
        if (type === "moov" || type === "trak") walk(buf, body, p + size);
        else if (type === "mvhd") {
          const v = buf[body];
          const ts = dv.getUint32(body + (v === 1 ? 20 : 12));
          const dur = v === 1 ? Number(dv.getBigUint64(body + 24)) : dv.getUint32(body + 16);
          if (ts > 0 && out.duration_s === null) out.duration_s = Math.round((dur / ts) * 10) / 10;
        } else if (type === "tkhd" && out.width === null) {
          const v = buf[body];
          const m = body + (v === 1 ? 52 : 40);
          const a = dv.getInt32(m) / 65536, bb = dv.getInt32(m + 4) / 65536;
          let w = dv.getUint32(m + 36) / 65536, h = dv.getUint32(m + 40) / 65536;
          if (w > 0 && h > 0) {
            if (a === 0 && bb !== 0) [w, h] = [h, w];   // stored sideways, shown rotated
            out.width = Math.round(w); out.height = Math.round(h);
          }
        }
        p += size;
      }
    };
    walk(moov, 0, moov.length);
  } catch (e) { out.note = scrub(String(e)).slice(0, 120); }
  return out;
}

// ---- building the upload ------------------------------------------------------------------------
function cleanTitle(t: string): string {
  const s = t.replace(/<[^>]*>/g, "").replace(/[<>]/g, "").replace(/\.{3,}|…/g, "").replace(/\s+/g, " ").trim();
  if (s.length <= 100) return s;
  const cut = s.slice(0, 101);                       // if the 101st char is a space, the first 100 already end on a word
  const i = cut.lastIndexOf(" ");
  const out = i >= 30 ? cut.slice(0, i) : s.slice(0, 100);
  return out.replace(/[\s,;:\-–—]+$/, "");
}
function clipBytes(s: string, max: number): string {
  const enc = new TextEncoder();
  if (enc.encode(s).length <= max) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (enc.encode(s.slice(0, mid)).length <= max) lo = mid; else hi = mid - 1; }
  const cut = s.slice(0, lo), i = cut.lastIndexOf(" ");
  return (i > lo - 80 && i > 0 ? cut.slice(0, i) : cut).trimEnd();
}
function buildMeta(row: Pick<Row, "title" | "caption" | "link_url">, fallbackTitle: string, short: boolean, live: boolean) {
  const caption = (row.caption ?? "").replace(/<[^>]*>/g, "").replace(/[<>]/g, "").trim();
  const title = cleanTitle(row.title ?? "") || cleanTitle(caption.split("\n")[0]) || cleanTitle(fallbackTitle) || "New video";
  let desc = caption;
  if (row.link_url && !desc.includes(row.link_url)) desc += (desc ? "\n\n" : "") + row.link_url;
  const tail = short && !/#shorts\b/i.test(desc) ? "\n\n#Shorts" : "";
  desc = clipBytes(desc, 5000 - tail.length) + tail;
  const tags: string[] = []; let tagLen = 0;
  for (const m of caption.matchAll(/#([\p{L}\p{N}_]{2,40})/gu)) {
    const t = m[1];
    if (/^shorts$/i.test(t) || tags.some((x) => x.toLowerCase() === t.toLowerCase()) || tagLen + t.length > 400 || tags.length >= 15) continue;
    tags.push(t); tagLen += t.length + 1;
  }
  const snippet: Record<string, unknown> = { title, description: desc, categoryId: "22" };
  if (tags.length) snippet.tags = tags;
  return { title, description: desc, privacy: live ? "public" : "private", body: { snippet, status: { privacyStatus: live ? "public" : "private", selfDeclaredMadeForKids: false } } };
}
async function provenanceDuration(itemId: string | null): Promise<number | null> {
  if (!itemId) return null;
  const { data } = await db.from("approval_items").select("provenance").eq("id", itemId).maybeSingle();
  const p: any = data?.provenance;
  const d = Number(p?.edited?.duration_s ?? p?.length_s ?? p?.duration_s ?? p?.render?.duration_s);
  return Number.isFinite(d) && d > 0 ? d : null;
}
async function isShort(url: string, itemId: string | null): Promise<{ short: boolean; probe: Probe }> {
  const probe = await probeMp4(url);
  if (probe.duration_s === null) probe.duration_s = await provenanceDuration(itemId);
  const vertical = probe.width !== null && probe.height !== null && probe.height > probe.width;
  return { short: vertical && probe.duration_s !== null && probe.duration_s <= SHORT_MAX_S, probe };
}
// What a queued post for this item would carry, in the order social_enqueue_item uses: her own YouTube version
// (platform 'youtube', or 'youtube_shorts' as stored today), then the Instagram version, then the item caption.
type ItemSource = { item_id: string; title: string | null; caption: string; link_url: string | null; media_url: string; media_type: string; client_name: string | null; caption_from: string };
async function itemSource(itemId: string): Promise<ItemSource | null> {
  const { data: it } = await db.from("approval_items").select("id, client_id, title, caption, media_url, media_type").eq("id", itemId).maybeSingle();
  if (!it) return null;
  const { data: vs } = await db.from("approval_variants").select("platform, caption, hashtags, title, link, created_at")
    .eq("item_id", itemId).in("platform", ["youtube", "youtube_shorts", "instagram"]).order("created_at", { ascending: false });
  const list = (vs ?? []) as any[];
  const own = list.find((v) => v.platform === "youtube") ?? list.find((v) => v.platform === "youtube_shorts");
  const ig = list.find((v) => v.platform === "instagram");
  let cap: string | null = own?.caption ?? null, tags: string[] | null = own?.hashtags ?? null, from = own ? own.platform : "item";
  if (cap === null && ig?.caption != null) { cap = ig.caption; tags = ig.hashtags ?? null; from = "instagram"; }
  cap = cap ?? it.caption ?? "";
  if (Array.isArray(tags) && tags.length) cap += "\n\n" + tags.join(" ");
  const { data: cl } = await db.from("approval_clients").select("name").eq("id", it.client_id).maybeSingle();
  let site: string | null = null;
  try { const { data } = await db.rpc("studio_client_site", { p_client: it.client_id }); site = data ? String(data) : null; } catch { /* the link is optional */ }
  const link = String(own?.link ?? "").trim() || site;
  return { item_id: it.id, title: (String(own?.title ?? "").trim() || it.title) ?? null, caption: cap as string, link_url: link, media_url: it.media_url, media_type: it.media_type, client_name: cl?.name ?? null, caption_from: from };
}
async function isLive(): Promise<boolean> {
  const { data } = await db.rpc("studio_yt_live");
  return data === true;
}

// ---- upload -------------------------------------------------------------------------------------
async function upload(a: Account, row: Pick<Row, "media_url">, meta: ReturnType<typeof buildMeta>): Promise<{ ok: boolean; videoId?: string; stage?: string; detail?: unknown; status?: number }> {
  // fetch the file first: a missing file must not cost quota
  const dl = await fetch(row.media_url);
  if (!dl.ok || !dl.body) { try { await dl.body?.cancel(); } catch { /* */ } return { ok: false, stage: "video-download", detail: { status: dl.status } }; }
  const total = Number(dl.headers.get("content-length") ?? 0);
  if (!total) { await dl.body.cancel(); return { ok: false, stage: "video-download", detail: { error: "no content-length" } }; }
  if (total > MAX_VIDEO_BYTES) { await dl.body.cancel(); return { ok: false, stage: "video-download", detail: { error: "too large", bytes: total } }; }
  const ct = (dl.headers.get("content-type") ?? "").startsWith("video/") ? dl.headers.get("content-type")! : "video/mp4";

  const init = await fetch(`${GAPI}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + a.access_token, "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(total), "X-Upload-Content-Type": ct,
    },
    body: JSON.stringify(meta.body),
  });
  if (init.status >= 300) {
    await dl.body.cancel();
    const j = await jsonOf(init), g = gerr(j);
    if (init.status === 401 || g.reason === "youtubeSignupRequired") throw new DeadToken(g.reason || "login refused");
    if (["quotaExceeded", "dailyLimitExceeded", "uploadLimitExceeded"].includes(g.reason)) throw new QuotaHold(g.reason, nextQuotaReset());
    if (g.reason === "rateLimitExceeded") throw new QuotaHold(g.reason, new Date(Date.now() + 15 * 60 * 1000));
    return { ok: false, stage: "upload-init", detail: { reason: g.reason, message: g.message }, status: init.status };
  }
  const loc = init.headers.get("location");
  await init.body?.cancel();
  if (!loc) { await dl.body.cancel(); return { ok: false, stage: "upload-init", detail: { error: "no upload location" } }; }

  const rd = dl.body.getReader();
  const buf = new Uint8Array(CHUNK);
  let spill: Uint8Array | null = null, sent = 0, ended = false;
  while (true) {
    let filled = 0;
    while (filled < CHUNK && sent + filled < total) {
      let piece: Uint8Array | null = spill; spill = null;
      if (!piece) { const { value, done } = await rd.read(); if (done) { ended = true; break; } piece = value; }
      const take = Math.min(piece.length, CHUNK - filled);
      buf.set(piece.subarray(0, take), filled); filled += take;
      if (take < piece.length) spill = piece.subarray(take);
    }
    if (filled === 0 || (ended && sent + filled < total)) return { ok: false, stage: "upload-stream", detail: { error: "source ended early", sent, total } };
    const put = await fetch(loc, {
      method: "PUT",
      headers: { "Content-Range": `bytes ${sent}-${sent + filled - 1}/${total}`, "Content-Type": ct },
      body: buf.subarray(0, filled),
    });
    if (put.status === 200 || put.status === 201) {
      const j = await jsonOf(put);
      if (!j?.id) return { ok: false, stage: "upload-finish", detail: j };
      try { await rd.cancel(); } catch { /* */ }
      return { ok: true, videoId: String(j.id) };
    }
    if (put.status === 308) {
      await put.body?.cancel();
      sent += filled;
      const got = put.headers.get("range")?.match(/bytes=0-(\d+)/);
      if (got && Number(got[1]) + 1 !== sent) return { ok: false, stage: "upload-stream", detail: { error: "Google accepted a different length", accepted: Number(got[1]) + 1, sent } };
      if (sent >= total) return { ok: false, stage: "upload-finish", detail: { error: "all bytes sent but no video returned" } };
      continue;
    }
    const j = await jsonOf(put), g = gerr(j);
    try { await rd.cancel(); } catch { /* */ }
    if (put.status === 401) throw new DeadToken("login refused during upload");
    if (["quotaExceeded", "dailyLimitExceeded", "uploadLimitExceeded"].includes(g.reason)) throw new QuotaHold(g.reason, nextQuotaReset());
    return { ok: false, stage: "upload-put", detail: { reason: g.reason, message: g.message }, status: put.status };
  }
}

async function publish(a: Account, row: Row, live: boolean) {
  if (row.media_type !== "video" && row.media_type !== "reel") return { ok: false, final: true, stage: "not-video", detail: { media_type: row.media_type } };
  const { short, probe } = await isShort(row.media_url, row.approval_item_id);
  const meta = buildMeta(row, a.label ?? a.handle ?? "", short, live);
  const f = await refreshAccount(a);                       // refresh before every call to Google
  if (!f.ok) { if (f.dead) throw new DeadToken(f.reason ?? "login refused"); return { ok: false, stage: "token-refresh", detail: f.reason }; }
  const up = await upload(a, row, meta);
  if (!up.ok) return up;
  const permalink = short ? "https://www.youtube.com/shorts/" + up.videoId : "https://www.youtube.com/watch?v=" + up.videoId;
  return { ok: true, remoteId: up.videoId!, permalink, short, privacy: meta.privacy, probe };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  if (!(await callerAuthorized(req))) return J({ error: "unauthorized" }, 401);
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const action = body.action || "drain";
  const brand = String(body.brand ?? "").toLowerCase();
  try {
    if (action === "me") {
      const a = await account(brand);
      const f = await refreshAccount(a);
      if (!f.ok) return J({ brand, ok: false, dead: !!f.dead, reason: f.reason }, 502);
      const r = await gget(a.access_token!, "/youtube/v3/channels?part=snippet,statistics&mine=true");
      const ch = (r.json?.items ?? [])[0];
      return J({ brand, status: r.status, channel: ch ? { id: ch.id, title: ch.snippet?.title, videos: ch.statistics?.videoCount, subscribers_hidden: ch.statistics?.hiddenSubscriberCount } : null, error: r.status >= 300 ? scrub(JSON.stringify(r.json)).slice(0, 300) : null }, r.status >= 300 ? 502 : 200);
    }

    if (action === "test") {
      // manual proof of the Google path: one approved video, uploaded PRIVATE whatever the live gate says, no social_posts row
      const accountId = String(body.account_id ?? ""), itemId = String(body.item_id ?? "");
      if (!accountId || !itemId) return J({ error: "account_id and item_id required" }, 400);
      const { data: acct } = await db.from("social_accounts").select("*").eq("id", accountId).eq("platform", PLATFORM).maybeSingle();
      if (!acct?.refresh_token) return J({ error: "no connected youtube account with that id" }, 404);
      const src = await itemSource(itemId);
      if (!src) return J({ error: "item not found" }, 404);
      if (src.media_type !== "video" && src.media_type !== "reel") return J({ error: "YouTube takes video only", media_type: src.media_type }, 400);
      const a = acct as Account;
      const { short } = await isShort(src.media_url, src.item_id);
      const meta = buildMeta(src, src.client_name ?? "", short, false);          // false = private, always
      const f = await refreshAccount(a);
      if (!f.ok) return J({ ok: false, stage: "token-refresh", dead: !!f.dead, reason: f.reason }, 502);
      try {
        const up = await upload(a, { media_url: src.media_url }, meta);
        if (!up.ok) return J({ ok: false, stage: up.stage, detail: up.detail }, 502);
        return J({ ok: true, video_id: up.videoId, url: short ? "https://www.youtube.com/shorts/" + up.videoId : "https://www.youtube.com/watch?v=" + up.videoId, short, privacy: "private" });
      } catch (e) {
        if (e instanceof QuotaHold) return J({ ok: false, quota: e.reason }, 429);
        if (e instanceof DeadToken) return J({ ok: false, stage: "login", dead: true, reason: scrub(e.message) }, 502);
        throw e;
      }
    }

    if (action === "dryrun") {
      // nothing here calls Google; the file host is read with a few ranged requests to learn the size and length
      let src: { title: string | null; caption: string | null; link_url: string | null; approval_item_id: string | null; media_url: string; media_type: string; client_name?: string | null; caption_from?: string };
      if (body.itemId) {
        const it = await itemSource(String(body.itemId));
        if (!it) return J({ error: "item not found" }, 404);
        src = { title: body.title ?? it.title, caption: body.caption ?? it.caption, link_url: body.linkUrl ?? it.link_url, media_url: it.media_url, media_type: it.media_type, approval_item_id: it.item_id, client_name: it.client_name, caption_from: body.caption ? "request" : it.caption_from };
      } else {
        src = { title: body.title ?? null, caption: body.caption ?? "", link_url: body.linkUrl ?? null, media_url: String(body.mediaUrl ?? ""), media_type: String(body.mediaType || "video"), approval_item_id: null, caption_from: "request" };
      }
      if (!src.media_url) return J({ error: "mediaUrl or itemId required" }, 400);
      if (src.media_type !== "video" && src.media_type !== "reel") return J({ ok: false, dry: true, called_google: false, plan: null, skipped: "YouTube takes video only", media_type: src.media_type });
      const { data: acct } = brand ? await db.from("social_accounts").select("label, handle").eq("brand", brand).eq("platform", PLATFORM).maybeSingle() : { data: null };
      const live = await isLive();
      const { short, probe } = await isShort(src.media_url, src.approval_item_id);
      const meta = buildMeta(src, src.client_name ?? (acct as any)?.label ?? (acct as any)?.handle ?? "", short, live);
      return J({
        ok: true, dry: true, called_google: false, live, short, privacy: meta.privacy, caption_from: src.caption_from, probe,
        title: meta.title, title_chars: meta.title.length, description: meta.description,
        request: {
          init_url: `${GAPI}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`,
          headers: { "X-Upload-Content-Length": probe.bytes, "X-Upload-Content-Type": "video/mp4" }, body: meta.body,
        },
        permalink_pattern: short ? "https://www.youtube.com/shorts/<id>" : "https://www.youtube.com/watch?v=<id>",
      });
    }

    if (action === "check") {
      const { data } = await db.from("social_accounts").select("*").eq("platform", PLATFORM).eq("active", true);
      const out: unknown[] = []; const bad: string[] = [];
      for (const a of (data ?? []) as Account[]) {
        if (!a.access_token && !a.refresh_token) continue;
        const f = await refreshAccount(a);
        if (!f.ok) {
          if (f.dead) { await markDead(a, "Google no longer accepts the saved login"); out.push({ brand: a.brand, ok: false, dead: true }); continue; }
          bad.push(`${a.handle ?? a.brand}: renewing the Google login failed (${f.reason})`); out.push({ brand: a.brand, ok: false, transient: true, reason: f.reason }); continue;
        }
        const r = await gget(a.access_token!, "/youtube/v3/channels?part=id&mine=true");   // 1 quota unit
        if (r.status === 401) { await markDead(a, "Google refused the login"); out.push({ brand: a.brand, ok: false, dead: true }); continue; }
        if (r.status === 200 && !(r.json?.items ?? []).length) { await markDead(a, "the YouTube channel is gone or no longer shared"); out.push({ brand: a.brand, ok: false, dead: true, channel_missing: true }); continue; }
        if (r.status !== 200) { out.push({ brand: a.brand, ok: false, transient: true, status: r.status }); continue; }
        out.push({ brand: a.brand, ok: true });
      }
      if (bad.length) await raise("problem", "YouTube login needs attention", bad.join("\n"));
      else {
        // do not call the line healthy while uploads are waiting on today's quota
        const { count } = await db.from("social_posts").select("id", { count: "exact", head: true }).eq("platform", PLATFORM).eq("status", "queued").like("error", "YouTube quota%");
        if (!count) await raise("resolved", "YouTube connections healthy", null);
      }
      return J({ results: out });
    }

    if (action === "drain") {
      // connected is not the same as switched on: nothing goes to YouTube until the live gate is thrown
      const { data: live } = await db.rpc("studio_yt_live");
      if (live !== true) return J({ drained: 0, gated: true });
      await db.rpc("requeue_stuck_social_posts");
      const { data: claimed, error: cErr } = await db.rpc("claim_next_social_post", { p_platform: PLATFORM });
      if (cErr) return J({ error: cErr.message }, 500);
      const row = (Array.isArray(claimed) ? claimed[0] : claimed) as Row | undefined;
      if (!row) return J({ drained: 0 });
      try {
        const a = await account(row.brand);
        const res: any = await publish(a, row, true);
        if (res.ok) {
          await db.from("social_posts").update({ status: "posted", remote_id: res.remoteId, permalink: res.permalink, posted_at: new Date().toISOString(), error: null }).eq("id", row.id);
          if ((row.error ?? "").startsWith("YouTube quota")) await raise("resolved", "YouTube uploads running again", null);
          return J({ drained: 1, id: row.id, brand: row.brand, permalink: res.permalink, short: res.short, privacy: res.privacy });
        }
        if (res.final) {
          await db.from("social_posts").update({ status: "failed", error: scrub(`${res.stage}: ${JSON.stringify(res.detail ?? "")}`).slice(0, 2000) }).eq("id", row.id);
          return J({ drained: 0, id: row.id, retrying: false, stage: res.stage });
        }
        const giveUp = row.attempts >= row.max_attempts;
        await db.from("social_posts").update({ status: giveUp ? "failed" : "queued", error: scrub(`${res.stage}: ${JSON.stringify(res.detail ?? res.status)}`).slice(0, 2000) }).eq("id", row.id);
        return J({ drained: 0, id: row.id, retrying: !giveUp, stage: res.stage }, 502);
      } catch (e) {
        if (e instanceof QuotaHold) {
          // not a failure: keep it queued for after the reset, give the attempt back, and stop every queued YouTube post trying again today
          const until = e.until.toISOString();
          const msg = e.reason === "rateLimitExceeded" ? "YouTube quota: rate limited; will try again shortly." : "YouTube quota is full for today; will upload after it resets at 12 AM Pacific.";
          await db.from("social_posts").update({ status: "queued", attempts: Math.max(0, row.attempts - 1), scheduled_at: until, error: msg }).eq("id", row.id);
          await db.from("social_posts").update({ scheduled_at: until }).eq("platform", PLATFORM).eq("status", "queued").lt("scheduled_at", until);
          if (e.reason !== "rateLimitExceeded") await raise("problem", "YouTube upload quota is full", `Google allows about six uploads a day for this project. Queued videos wait and upload after the quota resets at 12 AM Pacific. Nothing is lost.`);
          return J({ drained: 0, id: row.id, retrying: true, quota: e.reason, until });
        }
        if (e instanceof DeadToken) {
          const a2 = await account(row.brand).catch(() => null);
          if (a2) await markDead(a2, "Google refused the saved login while posting");
          await db.from("social_posts").update({ status: "failed", error: "YouTube login refused; reconnect needed" }).eq("id", row.id);
          return J({ drained: 0, id: row.id, retrying: false, dead: true }, 502);
        }
        const giveUp = row.attempts >= row.max_attempts;
        await db.from("social_posts").update({ status: giveUp ? "failed" : "queued", error: scrub(String(e)).slice(0, 2000) }).eq("id", row.id);
        return J({ drained: 0, id: row.id, retrying: !giveUp, error: scrub(String(e)) }, 500);
      }
    }
    return J({ error: "unknown action" }, 400);
  } catch (e) { return J({ error: scrub(String(e)) }, 500); }
});
