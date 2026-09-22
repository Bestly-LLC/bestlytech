// clip-ingest — a voice clip lands in Bestly.
//
// The Mac mini posts the raw audio bytes here (AirDrop a clip from the Soundcore app to the Mac and
// it is picked up automatically), and so can anything else that holds the worker key. The admin's
// browser uploads straight to storage instead, so this is the machine door.
//
//   POST  body: the audio bytes
//   headers: x-worker-key, x-file-name, x-source (airdrop|upload), x-recorded-at (optional ISO)
//   -> { ok, id, path }
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-worker-key, x-file-name, x-source, x-recorded-at",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const MAX = 200 * 1024 * 1024;
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

  const raw = String(req.headers.get("x-file-name") ?? "clip.m4a");
  const name = raw.replace(/[^\w.\- ]+/g, "").slice(-120) || "clip.m4a";
  const ext = (name.split(".").pop() ?? "m4a").toLowerCase();
  if (!TYPES[ext]) return J({ ok: false, error: `not an audio file (.${ext})` }, 415);

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.length) return J({ ok: false, error: "empty" }, 400);
  if (bytes.length > MAX) return J({ ok: false, error: "too big (200MB max)" }, 413);

  const source = (req.headers.get("x-source") ?? "airdrop").slice(0, 20);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `${source}/${stamp}-${name}`;
  const { error: upErr } = await db.storage.from("voice-clips").upload(path, bytes, { contentType: TYPES[ext], upsert: false });
  if (upErr) return J({ ok: false, error: upErr.message }, 500);

  const recorded = req.headers.get("x-recorded-at");
  const { data: id, error } = await db.rpc("clip_new", {
    p_key: key || null, p_path: path, p_title: name.replace(/\.[^.]+$/, ""), p_bytes: bytes.length,
    p_source: source, p_recorded_at: recorded && !isNaN(Date.parse(recorded)) ? recorded : null,
  });
  if (error) {
    // No worker key (an admin posted): insert with the service role directly.
    const { data: row, error: insErr } = await db.from("voice_clips").insert({
      title: name.replace(/\.[^.]+$/, ""), path, bytes: bytes.length, source,
      recorded_at: recorded && !isNaN(Date.parse(recorded)) ? recorded : null,
    }).select("id").single();
    if (insErr) return J({ ok: false, error: insErr.message }, 500);
    return J({ ok: true, id: row.id, path });
  }
  return J({ ok: true, id, path });
});
