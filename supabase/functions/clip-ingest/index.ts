// clip-ingest — a voice clip lands in Bestly.
//
// The Mac mini posts the raw audio bytes here (AirDrop a clip from the Soundcore app to the Mac and
// it is picked up automatically), and so can anything else that holds the worker key. The admin's
// browser uploads straight to storage instead, so this is the machine door.
//
//   POST  body: the audio bytes
//   headers: x-worker-key, x-file-name, x-source (airdrop|upload), x-recorded-at (optional ISO)
//   -> { ok, id, path }
//
// Big files come in parts (v2): storage caps any one object at 50MB project-wide, so the Mac splits
// anything larger and posts each piece with x-part (0-based) and x-parts (total). Part 0 gets a path
// back; the rest send it as x-path. The last part creates the voice_clips row with parts = total.
// Pieces are stored as <path>.part000 ...; the worker stitches them back before transcribing.
//
// x-sign: <path> (+ x-parts) with the worker key -> { ok, urls } signed download links. The bucket is
// admin-only, so the Mac can't read it with the anon key; before v2 it silently never could.
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-worker-key, x-file-name, x-source, x-recorded-at, x-part, x-parts, x-path, x-total-bytes, x-sign",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const MAX = 45 * 1024 * 1024;   // per request / per stored object (project cap is 50MB)
const TYPES: Record<string, string> = {
  m4a: "audio/mp4", mp4: "audio/mp4", mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac",
  caf: "audio/x-caf", amr: "audio/amr", ogg: "audio/ogg", opus: "audio/opus", flac: "audio/flac", aiff: "audio/aiff",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);

  const key = req.headers.get("x-worker-key") ?? "";
  const viaWorker = !!key && !!(await db.rpc("partner_ai_key_ok", { p_key: key })).data;
  if (!viaWorker) {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: u } = await db.auth.getUser(jwt);
    const { data: admin } = u?.user ? await db.rpc("has_role", { _user_id: u.user.id, _role: "admin" }) : { data: false };
    if (!admin) return J({ ok: false, error: "unauthorized" }, 401);
  }

  const sign = req.headers.get("x-sign");
  if (sign) {
    if (!viaWorker) return J({ ok: false, error: "worker key required" }, 401);
    const n = Math.max(0, Math.min(200, parseInt(req.headers.get("x-parts") ?? "0", 10) || 0));
    const names = n ? Array.from({ length: n }, (_, i) => `${sign}.part${String(i).padStart(3, "0")}`) : [sign];
    const { data, error } = await db.storage.from("voice-clips").createSignedUrls(names, 60 * 60);
    if (error) return J({ ok: false, error: error.message }, 500);
    const bad = (data ?? []).find((d) => d.error || !d.signedUrl);
    if (bad) return J({ ok: false, error: `missing ${bad.path}: ${bad.error ?? "no url"}` }, 404);
    return J({ ok: true, urls: (data ?? []).map((d) => d.signedUrl) });
  }

  const raw = String(req.headers.get("x-file-name") ?? "clip.m4a");
  const name = raw.replace(/[^\w.\- ]+/g, "").slice(-120) || "clip.m4a";
  const ext = (name.split(".").pop() ?? "m4a").toLowerCase();
  if (!TYPES[ext]) return J({ ok: false, error: `not an audio file (.${ext})` }, 415);

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return J({ ok: false, error: "empty" }, 400);
  if (bytes.length > MAX) return J({ ok: false, error: "part too big (45MB max per request - send parts)" }, 413);

  const source = (req.headers.get("x-source") ?? "airdrop").slice(0, 20);
  const parts = Math.max(0, Math.min(200, parseInt(req.headers.get("x-parts") ?? "0", 10) || 0));
  const part = Math.max(0, parseInt(req.headers.get("x-part") ?? "0", 10) || 0);
  if (parts && part >= parts) return J({ ok: false, error: "x-part out of range" }, 400);

  let path = String(req.headers.get("x-path") ?? "");
  if (parts && part > 0) {
    if (!path.startsWith(`${source}/`) || path.includes("..")) return J({ ok: false, error: "x-path required for parts after the first" }, 400);
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    path = `${source}/${stamp}-${name}`;
  }
  const objectPath = parts ? `${path}.part${String(part).padStart(3, "0")}` : path;
  const { error: upErr } = await db.storage.from("voice-clips").upload(objectPath, bytes, {
    contentType: parts ? "application/octet-stream" : TYPES[ext], upsert: true,
  });
  if (upErr) return J({ ok: false, error: upErr.message }, 500);
  if (parts && part < parts - 1) return J({ ok: true, path, part });

  const total = parts ? (parseInt(req.headers.get("x-total-bytes") ?? "0", 10) || bytes.length) : bytes.length;
  const recorded = req.headers.get("x-recorded-at");
  const { data: id, error } = await db.rpc("clip_new", {
    p_key: key || null, p_path: path, p_title: name.replace(/\.[^.]+$/, ""), p_bytes: total,
    p_source: source, p_recorded_at: recorded && !isNaN(Date.parse(recorded)) ? recorded : null,
    p_parts: parts || null,
  });
  if (error) {
    // No worker key (an admin posted): insert with the service role directly.
    const { data: row, error: insErr } = await db.from("voice_clips").insert({
      title: name.replace(/\.[^.]+$/, ""), path, bytes: total, source, parts: parts || null,
      recorded_at: recorded && !isNaN(Date.parse(recorded)) ? recorded : null,
    }).select("id").single();
    if (insErr) return J({ ok: false, error: insErr.message }, 500);
    return J({ ok: true, id: row.id, path });
  }
  return J({ ok: true, id, path });
});
