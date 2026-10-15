// client-media - the private side of client recordings.
//
// Three callers, three doors, each checked explicitly:
//   client (her board token)  -> "done"        mark an upload ready, ping Talk
//   staff  (studio token)     -> "sign"        1h playback URL for a raw recording
//   worker (this fn's key)    -> "pending" / "sign_upload" / "finish"   transcode loop
//
// Bytes never pass through here: uploads go browser -> Storage (TUS), and the
// worker downloads/uploads on signed URLs. This function only moves state.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const RAW_BUCKET = "client-media";
const OUT_BUCKET = "review";
const TALK_ROOM = "fyqvdsa4";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// Inbound key (2026-09-24): no key literal in this file. Vault holds only sha256
// fingerprints (client_media_worker_key_sha256, plus client_media_worker_key_prev_sha256 while callers move
// over); edge_key_ok() (service-role only) checks them.
async function okWorkerKey(k: string | null | undefined): Promise<boolean> {
  if (!k) return false;
  for (const n of ["client_media_worker_key_sha256", "client_media_worker_key_prev_sha256"]) {
    const { data } = await db.rpc("edge_key_ok", { p_name: n, p_key: k });
    if (data === true) return true;
  }
  return false;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-worker-key, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

function safePath(s: string): string {
  return s.split("/")
    .map((seg) => seg.replace(/[^A-Za-z0-9._-]/g, ""))
    .filter((seg) => seg && seg !== "." && seg !== "..")
    .join("/");
}

async function talk(message: string): Promise<boolean> {
  try {
    const { data } = await db.rpc("get_nextcloud_credentials");
    const row = Array.isArray(data) ? data[0] : data;
    const base = String(row?.base_url ?? "").replace(/\/+$/, "");
    const user = String(row?.username ?? ""), pass = String(row?.app_password ?? "");
    if (!base || !user || !pass) return false;
    const r = await fetch(`${base}/ocs/v2.php/apps/spreed/api/v1/chat/${TALK_ROOM}`, {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${user}:${pass}`), "OCS-APIRequest": "true",
                 Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    return r.ok;
  } catch { return false; }
}

const fmtDur = (s: number | null) => s == null ? "" : ` ${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
const fmtMB = (b: number | null) => b == null ? "" : ` (${(b / 1048576).toFixed(0)} MB)`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* handled per action */ }
  const action = String(body.action ?? "");

  // ── client: upload finished ────────────────────────────────────────────
  if (action === "done") {
    const token = String(body.token ?? ""), upload = String(body.upload_id ?? "");
    if (!token || !upload) return J({ ok: false, error: "token and upload_id required" }, 400);
    const dur = body.duration == null ? null : Number(body.duration);
    const parts = Math.max(1, Number(body.parts ?? 1) || 1);
    const { data, error } = await db.rpc("client_upload_done", { p_token: token, p_upload: upload, p_duration: dur, p_parts: parts });
    if (error) return J({ ok: false, error: error.message }, 500);
    // A file or voice memo for "Send us an idea" is announced by client_brief_send
    // once she presses Send (2026-10-06) — before, it posted 'a recording for "undefined"'.
    if (data?.ok && !data.already && data.purpose !== "research") {
      // one line per thing that arrived, worded for what it actually is
      const msg = data.purpose === "brand_guide"
        ? (String(body.mime ?? "").startsWith("image/")
            ? `🖼 ${data.client} added a file to their brand guide (${data.question})${fmtMB(data.bytes)}.`
            : `🎙 ${data.client} recorded an answer in their brand guide (${data.question})${fmtDur(dur)}.`)
        // 2026-10-15: a take no longer goes straight to the editor. A person approves it, or sends it back.
        : `🎥 ${data.client} sent Take ${data.take_no ?? 1} for "${data.ask_title}"${fmtDur(dur)}${fmtMB(data.bytes)}. It is transcoding. Review it in Studio > Asks: approve it, or send it back.`;
      data.notified = await talk(msg);
    }
    return J(data);
  }

  // ── staff: playback URL for a raw recording ───────────────────────────
  // A recording over the part size is stored as <path>.part0, .part1, ... (byte
  // slices of one file). Signing <path> itself answered "Object not found", which
  // is why "Play original" never played (Jared + Eli, 2026-10-06). With `parts`
  // (or when <path> is missing) this returns one URL per part, in order, and the
  // page joins them. The staff member's client scope applies here too: the first
  // path segment is the client's slug.
  if (action === "sign") {
    const token = String(body.staff_token ?? ""), path = safePath(String(body.path ?? ""));
    if (!token || !path) return J({ ok: false, error: "staff_token and path required" }, 400);
    const { data: s, error } = await db.rpc("studio_resolve_staff", { p_token: token });
    const staff = Array.isArray(s) ? s[0] : s;
    if (error || !staff?.id) return J({ ok: false, error: "not_found" }, 401);
    const slug = path.split("/")[0];
    const { data: may } = await db.rpc("staff_may_see_slug", { p_staff: staff.id, p_slug: slug });
    if (may === false) return J({ ok: false, error: "not_permitted" }, 403);
    let parts = Math.max(0, Math.min(64, Number(body.parts ?? 0) || 0));
    if (parts <= 1) {
      const { data, error: e2 } = await db.storage.from(RAW_BUCKET).createSignedUrl(path, 3600);
      if (!e2 && data?.signedUrl) return J({ ok: true, url: data.signedUrl, urls: [data.signedUrl], parts: 1, expires_in: 3600 });
      // not there as one file: look for its parts before giving up
      const dir = path.split("/").slice(0, -1).join("/"), base = path.split("/").pop() ?? "";
      const { data: ls } = await db.storage.from(RAW_BUCKET).list(dir, { search: base + ".part", limit: 100 });
      parts = (ls ?? []).filter((o) => new RegExp("^" + base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.part\\d+$").test(o.name)).length;
      if (!parts) return J({ ok: false, error: e2?.message ?? "Object not found" }, 404);
    }
    const names = Array.from({ length: parts }, (_, i) => `${path}.part${i}`);
    const { data: urls, error: e3 } = await db.storage.from(RAW_BUCKET).createSignedUrls(names, 3600);
    if (e3 || !urls || urls.some((u) => !u.signedUrl)) return J({ ok: false, error: e3?.message ?? "a part is missing" }, 404);
    return J({ ok: true, url: urls[0].signedUrl, urls: urls.map((u) => u.signedUrl), parts, expires_in: 3600 });
  }

  // ── staff: a place to put a picture for a new post ───────────────────────
  // The browser uploads straight to the public review bucket on a signed URL;
  // the post row is written afterwards by studio_item_create with the public
  // address. Hashed names, so a re-upload never overwrites the old one.
  if (action === "post_upload_url") {
    const token = String(body.staff_token ?? ""), slug = safePath(String(body.client_slug ?? "")).slice(0, 60);
    const mime = String(body.mime ?? ""), name = String(body.filename ?? "file");
    if (!token || !slug) return J({ ok: false, error: "staff_token and client_slug required" }, 400);
    const { data: s, error } = await db.rpc("studio_resolve_staff", { p_token: token });
    const staff = Array.isArray(s) ? s[0] : s;
    if (error || !staff?.id) return J({ ok: false, error: "not_found" }, 401);
    if (!/^(image|video)\//.test(mime)) return J({ ok: false, error: "images and video only" }, 400);
    const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "video/mp4": "mp4", "video/quicktime": "mov" } as Record<string, string>)[mime]
             ?? (name.match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toLowerCase() ?? "bin");
    const dest = `posts/${slug}/${crypto.randomUUID()}.${ext}`;
    const { data, error: e2 } = await db.storage.from(OUT_BUCKET).createSignedUploadUrl(dest);
    if (e2) return J({ ok: false, error: e2.message }, 500);
    return J({ ok: true, path: dest, signed_url: data.signedUrl, token: data.token,
               public_url: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${OUT_BUCKET}/${dest}` });
  }

  // ── worker: everything below needs this function's own key ────────────────
  const k = req.headers.get("x-worker-key") ?? String(body.workerKey ?? "");
  if (!k || !(await okWorkerKey(k))) return J({ ok: false, error: "unauthorized" }, 401);

  if (action === "pending") {
    const { data, error } = await db.rpc("client_media_pending");
    if (error) return J({ ok: false, error: error.message }, 500);
    const out = [];
    for (const u of (data ?? []) as Record<string, unknown>[]) {
      const n = Math.max(1, Number(u.parts ?? 1) || 1);
      const names = n > 1 ? Array.from({ length: n }, (_, i) => `${u.path}.part${i}`) : [String(u.path)];
      const { data: s } = await db.storage.from(RAW_BUCKET).createSignedUrls(names, 7200);
      out.push({ ...u, download_urls: (s ?? []).map((x) => x.signedUrl) });
    }
    return J({ ok: true, uploads: out });
  }

  if (action === "sign_upload") {
    const dest = safePath(String(body.dest ?? ""));
    if (!dest) return J({ ok: false, error: "dest required" }, 400);
    const { data, error } = await db.storage.from(OUT_BUCKET).createSignedUploadUrl(dest, { upsert: true });
    if (error) return J({ ok: false, error: error.message }, 500);
    return J({ ok: true, path: dest, signed_url: data.signedUrl, token: data.token,
               public_url: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/${OUT_BUCKET}/${dest}` });
  }

  if (action === "finish") {
    const upload = String(body.upload_id ?? "");
    if (!upload) return J({ ok: false, error: "upload_id required" }, 400);
    const { data, error } = await db.rpc("client_media_finish", {
      p_upload: upload, p_url: body.url ?? null, p_poster: body.poster ?? null,
      p_duration: body.duration == null ? null : Number(body.duration), p_error: body.error ?? null,
    });
    if (error) return J({ ok: false, error: error.message }, 500);
    return J(data);
  }

  // delete raw objects (test junk, or raw parts once a recording is no longer needed)
  if (action === "remove") {
    const paths = (Array.isArray(body.paths) ? body.paths : []).map((p) => safePath(String(p))).filter(Boolean);
    if (!paths.length) return J({ ok: false, error: "paths required" }, 400);
    const { data, error } = await db.storage.from(RAW_BUCKET).remove(paths);
    if (error) return J({ ok: false, error: error.message }, 500);
    return J({ ok: true, removed: (data ?? []).map((o) => o.name) });
  }

  return J({ ok: false, error: "unknown action" }, 400);
});
