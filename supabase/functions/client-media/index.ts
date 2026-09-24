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

// Key rotated 2026-09-15. WORKER_KEY_PREV exists only so the hourly transcode
// run that fires mid-rotation does not get a 401; it is emptied in the very
// next deploy, once the scheduled task carries the new one. If you are reading
// this and WORKER_KEY_PREV is NOT empty, the rotation was left half-done.
const WORKER_KEY = "r3SA9Q1v3FudP_J2j5C2EXTmmu_s6XQw";
const WORKER_KEY_PREV = "";
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
function okWorkerKey(k: string): boolean {
  return sameSecret(k, WORKER_KEY) || (WORKER_KEY_PREV.length > 0 && sameSecret(k, WORKER_KEY_PREV));
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

  // ── client: upload finished ──────────────────────────────────────
  if (action === "done") {
    const token = String(body.token ?? ""), upload = String(body.upload_id ?? "");
    if (!token || !upload) return J({ ok: false, error: "token and upload_id required" }, 400);
    const dur = body.duration == null ? null : Number(body.duration);
    const parts = Math.max(1, Number(body.parts ?? 1) || 1);
    const { data, error } = await db.rpc("client_upload_done", { p_token: token, p_upload: upload, p_duration: dur, p_parts: parts });
    if (error) return J({ ok: false, error: error.message }, 500);
    if (data?.ok && !data.already) {
      // one line per thing that arrived, worded for what it actually is
      const msg = data.purpose === "brand_guide"
        ? (String(body.mime ?? "").startsWith("image/")
            ? `🖼 ${data.client} added a file to their brand guide (${data.question})${fmtMB(data.bytes)}.`
            : `🎙 ${data.client} recorded an answer in their brand guide (${data.question})${fmtDur(dur)}.`)
        : `🎥 ${data.client} sent a recording for "${data.ask_title}"${fmtDur(dur)}${fmtMB(data.bytes)}. It is transcoding; attach it from /studio.`;
      data.notified = await talk(msg);
    }
    return J(data);
  }

  // ── staff: playback URL for a raw recording ───────────────────────────
  if (action === "sign") {
    const token = String(body.staff_token ?? ""), path = safePath(String(body.path ?? ""));
    if (!token || !path) return J({ ok: false, error: "staff_token and path required" }, 400);
    const { data: s, error } = await db.rpc("studio_resolve_staff", { p_token: token });
    const staff = Array.isArray(s) ? s[0] : s;
    if (error || !staff?.id) return J({ ok: false, error: "not_found" }, 401);
    const { data, error: e2 } = await db.storage.from(RAW_BUCKET).createSignedUrl(path, 3600);
    if (e2) return J({ ok: false, error: e2.message }, 500);
    return J({ ok: true, url: data.signedUrl, expires_in: 3600 });
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
  if (!k || !okWorkerKey(k)) return J({ ok: false, error: "unauthorized" }, 401);

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
