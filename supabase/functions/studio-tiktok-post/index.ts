// studio-tiktok-post — the TikTok "Direct Post" leg of Studio, built to TikTok's Content Posting API guidelines.
//
// A client (a business that connected its OWN TikTok through Login Kit) opens the Studio TikTok posting screen on
// its board, picks a video it already approved, and taps Post. This function is the server side of that screen.
// Nothing is sent to TikTok before the explicit Post tap; the video is never altered (no watermark, no overlay).
//
// Auth: the client's board token (same door as every other board call). The TikTok tokens stay on the server.
//
//   POST { op:"creator", token }   latest creator_info for the connected account: nickname, avatar, the privacy
//                                  options it allows, which of comment / duet / stitch the creator switched off,
//                                  and the longest video it can post. Called every time the screen opens.
//   POST { op:"post", token, item_id, title, privacy_level, allow_comment, allow_duet, allow_stitch,
//          disclose:{on, own, branded}, ai_generated, consent:true }
//                                  validates, re-reads creator_info, checks the video's length, uploads the file.
//   POST { op:"status", token, id }  asks TikTok where the post is (processing -> published / failed).
//
// Secrets: the TikTok app key/secret come from Vault via studio_tiktok_app_get (service role only).
// Table: tiktok_direct_posts (service role only; one row per tap on Post).

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB_URL, SB_SECRET, { auth: { persistSession: false } });
const API = "https://open.tiktokapis.com/v2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const scrub = (s: string) => s.replace(/act\.[\w!-]+/g, "act.…").replace(/rft\.[\w!-]+/g, "rft.…");
const PRIVACY = ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"];

type Account = { id: string; brand: string; handle: string | null; access_token: string | null; refresh_token: string | null;
  token_expires_at: string | null; refresh_expires_at: string | null; active: boolean };

async function appCreds() {
  const { data, error } = await db.rpc("studio_tiktok_app_get");
  if (error || !(data as any)?.client_key) throw new Error("tiktok app creds missing");
  return { key: String((data as any).client_key), secret: String((data as any).client_secret) };
}
async function refreshAccount(a: Account, force = false): Promise<Account> {
  const left = a.token_expires_at ? (Date.parse(a.token_expires_at) - Date.now()) / 60000 : -1;
  if (!force && left > 10) return a;
  if (!a.refresh_token) throw new Error("no refresh token");
  const app = await appCreds();
  const r = await fetch(API + "/oauth/token/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: app.key, client_secret: app.secret, grant_type: "refresh_token", refresh_token: a.refresh_token }) });
  const j: any = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error("refresh failed: " + scrub(JSON.stringify(j.error_description ?? j.error ?? j)).slice(0, 160));
  const patch = {
    access_token: j.access_token, refresh_token: j.refresh_token ?? a.refresh_token,
    token_expires_at: new Date(Date.now() + (Number(j.expires_in) || 86400) * 1000).toISOString(),
    refresh_expires_at: j.refresh_expires_in ? new Date(Date.now() + Number(j.refresh_expires_in) * 1000).toISOString() : a.refresh_expires_at,
    last_refreshed_at: new Date().toISOString(),
  };
  await db.from("social_accounts").update(patch).eq("id", a.id);
  return { ...a, ...patch };
}
async function tk(path: string, tok: string, body: unknown) {
  const r = await fetch(API + path, { method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

/** Who is calling, and which TikTok account is theirs. Viewers (view-only links) cannot post. */
async function whoAndAccount(token: string) {
  if (!token || token.length < 16) return { error: "not_found" as const };
  const { data: c } = await db.rpc("approval_resolve_client", { p_token: token });
  const client = Array.isArray(c) ? c[0] : c;
  if (!client?.id) return { error: "not_found" as const };
  const { data: viewer } = await db.rpc("client_viewer", { p_token: token });
  if (viewer) return { error: "view_only" as const };
  const { data: cl } = await db.from("approval_clients").select("id,slug,name,social_brand").eq("id", client.id).maybeSingle();
  if (!cl?.social_brand) return { client: cl, error: "not_connected" as const };
  const { data: acct } = await db.from("social_accounts").select("*").eq("brand", cl.social_brand).eq("platform", "tiktok").maybeSingle();
  if (!acct || !acct.active || !acct.access_token) return { client: cl, error: "not_connected" as const };
  return { client: cl, account: acct as Account };
}

/** creator_info, fresh. Returns the fields the posting screen must show, or a plain-words reason it cannot post now. */
async function creatorInfo(a: Account) {
  let acct = await refreshAccount(a);
  let r = await tk("/post/publish/creator_info/query/", acct.access_token!, {});
  if (r.json?.error?.code === "access_token_invalid") { acct = await refreshAccount(acct, true); r = await tk("/post/publish/creator_info/query/", acct.access_token!, {}); }
  const code = r.json?.error?.code;
  if (r.status !== 200 || (code && code !== "ok")) return { acct, ok: false as const, code: String(code ?? r.status), message: String(r.json?.error?.message ?? "").slice(0, 200) };
  const d = r.json?.data ?? {};
  return { acct, ok: true as const, info: {
    nickname: String(d.creator_nickname ?? ""), username: String(d.creator_username ?? ""), avatar_url: String(d.creator_avatar_url ?? ""),
    privacy_level_options: (Array.isArray(d.privacy_level_options) ? d.privacy_level_options : []).filter((p: string) => PRIVACY.includes(p)),
    comment_disabled: !!d.comment_disabled, duet_disabled: !!d.duet_disabled, stitch_disabled: !!d.stitch_disabled,
    max_video_post_duration_sec: Number(d.max_video_post_duration_sec ?? 0),
  } };
}
const CANT_POST: Record<string, string> = {
  spam_risk_too_many_posts: "TikTok says this account has reached its posting limit for today. Please try again later.",
  spam_risk_user_banned_from_posting: "TikTok is not letting this account post right now. Please try again later.",
  reached_active_user_cap: "TikTok has reached the daily limit for Bestly Studio. Please try again later.",
  rate_limit_exceeded: "TikTok is busy. Please try again in a few minutes.",
};
const cantPostWords = (code: string) => CANT_POST[code] ?? "TikTok is not letting this account post right now. Please try again later.";

/** Length of an mp4 in seconds, read from its mvhd box. null when it cannot be read. */
function mp4Seconds(b: Uint8Array): number | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 4; i < b.length - 32; i++) {
    if (b[i] === 0x6d && b[i + 1] === 0x76 && b[i + 2] === 0x68 && b[i + 3] === 0x64) {   // "mvhd"
      const v = b[i + 4];
      if (v === 1) { const ts = dv.getUint32(i + 24), du = Number(dv.getBigUint64(i + 28)); return ts ? du / ts : null; }
      const ts = dv.getUint32(i + 16), du = dv.getUint32(i + 20); return ts ? du / ts : null;
    }
  }
  return null;
}

const STATUS_WORDS: Record<string, string> = {
  PROCESSING_UPLOAD: "TikTok is receiving your video.", PROCESSING_DOWNLOAD: "TikTok is processing your video.",
  SEND_TO_USER_INBOX: "Sent to your TikTok.", PUBLISH_COMPLETE: "Posted to TikTok.", FAILED: "TikTok could not post this video.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return J({ ok: false, error: "post_only" }, 405);
  const b: any = await req.json().catch(() => ({}));
  const op = String(b.op ?? "");
  try {
    const who: any = await whoAndAccount(String(b.token ?? ""));
    if (who.error === "not_found") return J({ ok: false, error: "not_found" }, 404);
    if (who.error === "view_only") return J({ ok: false, error: "view_only" }, 403);
    if (who.error === "not_connected") return J({ ok: true, connected: false });

    if (op === "creator") {
      const c = await creatorInfo(who.account);
      if (!c.ok) return J({ ok: true, connected: true, can_post: false, code: c.code, message: cantPostWords(c.code) });
      return J({ ok: true, connected: true, can_post: true, creator: c.info, account_handle: who.account.handle });
    }

    if (op === "post") {
      if (b.consent !== true) return J({ ok: false, error: "consent_needed", message: "Tick the box to agree before you post." }, 400);
      const title = String(b.title ?? "").trim();
      if (title.length > 2200) return J({ ok: false, error: "title_long", message: "The caption is longer than TikTok allows (2,200 characters)." }, 400);
      const privacy = String(b.privacy_level ?? "");
      if (!PRIVACY.includes(privacy)) return J({ ok: false, error: "privacy_needed", message: "Choose who can view this video." }, 400);
      const dis = b.disclose ?? {}, on = dis.on === true, own = on && dis.own === true, branded = on && dis.branded === true;
      if (on && !own && !branded) return J({ ok: false, error: "disclose_pick", message: "You need to indicate if your content promotes yourself, a third party, or both." }, 400);
      if (branded && privacy === "SELF_ONLY") return J({ ok: false, error: "branded_private", message: "Branded content visibility cannot be set to private." }, 400);

      // the video: one this client already approved, a real file in Studio's own storage
      const { data: item } = await db.from("approval_items").select("id,client_id,title,status,media_type,media_url").eq("id", String(b.item_id ?? "")).maybeSingle();
      if (!item || item.client_id !== who.client.id) return J({ ok: false, error: "no_item", message: "That video was not found on your board." }, 404);
      if (item.status !== "approved") return J({ ok: false, error: "not_approved", message: "Only a video you have approved can be posted." }, 400);
      if (item.media_type !== "video" || !item.media_url || !String(item.media_url).startsWith(SB_URL + "/storage/v1/object/public/")) return J({ ok: false, error: "no_video", message: "This post has no video file to send." }, 400);

      // one at a time, and a sane daily ceiling
      const since = new Date(Date.now() - 5 * 60000).toISOString(), day = new Date(Date.now() - 86400000).toISOString();
      const { count: inflight } = await db.from("tiktok_direct_posts").select("id", { count: "exact", head: true }).eq("client_id", who.client.id).in("status", ["uploading", "processing"]).gte("created_at", since);
      if ((inflight ?? 0) > 0) return J({ ok: false, error: "busy", message: "A video is already being sent. Wait for it to finish." }, 429);
      const { count: today } = await db.from("tiktok_direct_posts").select("id", { count: "exact", head: true }).eq("client_id", who.client.id).gte("created_at", day);
      if ((today ?? 0) >= 20) return J({ ok: false, error: "limit", message: "That is the most videos Studio sends in a day. Try again tomorrow." }, 429);

      // creator_info again, right now: can this account post, and which choices are legal
      const c = await creatorInfo(who.account);
      if (!c.ok) return J({ ok: false, error: "cannot_post_now", message: cantPostWords(c.code) }, 409);
      const ci = c.info;
      if (!ci.privacy_level_options.includes(privacy)) return J({ ok: false, error: "privacy_not_allowed", message: "TikTok does not allow that choice for this account." }, 400);
      if (b.allow_comment === true && ci.comment_disabled) return J({ ok: false, error: "comment_off", message: "Comments are switched off in your TikTok settings." }, 400);
      if (b.allow_duet === true && ci.duet_disabled) return J({ ok: false, error: "duet_off", message: "Duet is switched off in your TikTok settings." }, 400);
      if (b.allow_stitch === true && ci.stitch_disabled) return J({ ok: false, error: "stitch_off", message: "Stitch is switched off in your TikTok settings." }, 400);

      const vid = await fetch(String(item.media_url));
      if (!vid.ok) return J({ ok: false, error: "fetch_video", message: "Studio could not read the video file. Nothing was sent to TikTok." }, 502);
      const bytes = new Uint8Array(await vid.arrayBuffer());
      const size = bytes.length;
      if (size < 1024) return J({ ok: false, error: "fetch_video", message: "The video file looks empty. Nothing was sent to TikTok." }, 502);
      const secs = mp4Seconds(bytes);
      if (ci.max_video_post_duration_sec > 0 && secs != null && secs > ci.max_video_post_duration_sec + 0.5) {
        return J({ ok: false, error: "too_long", message: `This video is ${Math.round(secs)} seconds. This TikTok account can post videos up to ${ci.max_video_post_duration_sec} seconds.` }, 400);
      }

      const row = { client_id: who.client.id, item_id: item.id, status: "uploading", title, privacy_level: privacy,
        allow_comment: b.allow_comment === true, allow_duet: b.allow_duet === true, allow_stitch: b.allow_stitch === true,
        brand_organic: own, brand_content: branded, is_aigc: b.ai_generated === true, creator_nickname: ci.nickname, video_seconds: secs, video_bytes: size };
      const { data: ins, error: ie } = await db.from("tiktok_direct_posts").insert(row).select("id").single();
      if (ie || !ins) return J({ ok: false, error: "store", message: "Something went wrong on our side. Nothing was sent to TikTok." }, 500);
      const fail = async (stage: string, detail: unknown, words: string) => {
        await db.from("tiktok_direct_posts").update({ status: "failed", fail_reason: scrub(`${stage}: ${JSON.stringify(detail)}`).slice(0, 1500), updated_at: new Date().toISOString() }).eq("id", ins.id);
        return J({ ok: false, error: stage, message: words, id: ins.id }, 502);
      };

      const CH = 10 * 1024 * 1024;
      const chunks = size <= 64 * 1024 * 1024 ? 1 : Math.ceil(size / CH), chunkSize = chunks === 1 ? size : CH;
      const post_info: Record<string, unknown> = {
        title, privacy_level: privacy,
        disable_comment: !(b.allow_comment === true), disable_duet: !(b.allow_duet === true), disable_stitch: !(b.allow_stitch === true),
        brand_content_toggle: branded, brand_organic_toggle: own, is_aigc: b.ai_generated === true,
      };
      const init = await tk("/post/publish/video/init/", c.acct.access_token!, { post_info, source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: chunkSize, total_chunk_count: chunks } });
      const code = init.json?.error?.code;
      if (init.status !== 200 || (code && code !== "ok")) {
        const words = code === "unaudited_client_can_only_post_to_private_accounts"
          ? "TikTok only lets Bestly Studio post to private accounts until its review finishes. Set your TikTok account to private, choose Only me, and try again."
          : (CANT_POST[code] ?? `TikTok did not accept the video${init.json?.error?.message ? ": " + String(init.json.error.message).slice(0, 140) : "."}`);
        return await fail("init", init.json?.error ?? init.json, words);
      }
      const publishId = init.json?.data?.publish_id, uploadUrl = init.json?.data?.upload_url;
      if (!publishId || !uploadUrl) return await fail("init", init.json, "TikTok did not accept the video.");
      for (let i = 0; i < chunks; i++) {
        const start = i * chunkSize, end = Math.min(size, start + chunkSize) - 1, part = bytes.subarray(start, end + 1);
        const put = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(part.length), "Content-Range": `bytes ${start}-${end}/${size}` }, body: part });
        if (![200, 201, 206].includes(put.status)) return await fail("upload", { status: put.status, chunk: i + 1, of: chunks }, "The upload to TikTok did not finish. Please try again.");
      }
      await db.from("tiktok_direct_posts").update({ status: "processing", publish_id: String(publishId), tiktok_status: "PROCESSING_UPLOAD", updated_at: new Date().toISOString() }).eq("id", ins.id);
      return J({ ok: true, id: ins.id, status: "processing", message: STATUS_WORDS.PROCESSING_UPLOAD });
    }

    if (op === "status") {
      const { data: row } = await db.from("tiktok_direct_posts").select("*").eq("id", String(b.id ?? "")).eq("client_id", who.client.id).maybeSingle();
      if (!row) return J({ ok: false, error: "not_found" }, 404);
      if (row.status === "published" || row.status === "failed" || !row.publish_id) return J({ ok: true, id: row.id, status: row.status, tiktok_status: row.tiktok_status, message: row.status === "published" ? STATUS_WORDS.PUBLISH_COMPLETE : row.status === "failed" ? "TikTok could not post this video." : "", fail_reason: row.status === "failed" ? row.fail_reason : null, permalink: row.permalink ?? null });
      const acct = await refreshAccount(who.account);
      const st = await tk("/post/publish/status/fetch/", acct.access_token!, { publish_id: row.publish_id });
      const d = st.json?.data ?? {};
      const ts = String(d.status ?? "");
      const patch: Record<string, unknown> = { tiktok_status: ts || row.tiktok_status, updated_at: new Date().toISOString() };
      if (ts === "PUBLISH_COMPLETE") {
        const pid = Array.isArray(d.publicaly_available_post_id) ? d.publicaly_available_post_id[0] : d.publicaly_available_post_id;
        patch.status = "published"; patch.post_id = pid ? String(pid) : null;
        patch.permalink = pid && who.account.handle ? `https://www.tiktok.com/@${String(who.account.handle).replace(/^@/, "")}/video/${pid}` : null;
      } else if (ts === "FAILED") { patch.status = "failed"; patch.fail_reason = scrub(String(d.fail_reason ?? "failed")).slice(0, 500); }
      await db.from("tiktok_direct_posts").update(patch).eq("id", row.id);
      return J({ ok: true, id: row.id, status: patch.status ?? row.status, tiktok_status: ts, message: STATUS_WORDS[ts] ?? "TikTok is processing your video.", fail_reason: patch.fail_reason ?? null, permalink: patch.permalink ?? null });
    }
    return J({ ok: false, error: "unknown_op" }, 400);
  } catch (e) {
    console.error("studio-tiktok-post", scrub(String(e)));
    return J({ ok: false, error: "unexpected", message: "Something went wrong. Nothing was posted. Please try again." }, 500);
  }
});
