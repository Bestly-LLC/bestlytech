// family-upload — a card photo from the Family Cookbook app. Owner: Basil.
// multipart/form-data: token, side ("front" | "back"), photo (jpeg/png/webp, the phone has already shrunk it to about 0.5 MB),
// capture_id (only when adding the back of a card that is already queued).
// 1. checks the session token (family_sessions) 2. stores the photo in the private family-cards bucket
// 3. queues the read (recipe-parse, kind family) 4. copies the photo into Bestly Cloud Files > Family Recipes > <Mom|Jared|Mariah>
//    (the Nextcloud copy is best effort: if it fails the app keeps working and Basil's watchdog retries it).

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SUPA_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SUPA_URL, SB, { auth: { persistSession: false } });
const ORIGINS = new Set(["https://www.bestly.tech", "https://bestly.tech", "http://localhost:4173", "http://localhost:5173", "http://127.0.0.1:4173"]);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": ORIGINS.has(req.headers.get("origin") ?? "") ? req.headers.get("origin")! : "https://www.bestly.tech",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin",
});
const J = (req: Request, o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });

const OWNER_DIR: Record<string, string> = { mom: "Mom", jared: "Jared", mariah: "Mariah" };

function sniff(b: Uint8Array): { mime: string; ext: string } | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return { mime: "image/webp", ext: "webp" };
  return null;
}

// ---- Bestly Cloud Files (WebDAV, the house account) ----
async function ncCreds() {
  const { data } = await db.rpc("get_nextcloud_credentials");
  const r = Array.isArray(data) ? data[0] : data;
  if (!r?.base_url) throw new Error("Bestly Cloud is not connected");
  return { base: String(r.base_url).replace(/\/+$/, ""), user: String(r.username), auth: "Basic " + btoa(`${r.username}:${r.app_password}`) };
}
const seg = (s: string) => s.split("/").map(encodeURIComponent).join("/");
async function mkcols(c: Awaited<ReturnType<typeof ncCreds>>, path: string) {
  let cur = "";
  for (const part of path.split("/").filter(Boolean)) {
    cur += "/" + part;
    const r = await fetch(`${c.base}/remote.php/dav/files/${encodeURIComponent(c.user)}${seg(cur)}`, { method: "MKCOL", headers: { Authorization: c.auth }, signal: AbortSignal.timeout(15_000) });
    if (![201, 405, 301].includes(r.status)) throw new Error(`MKCOL ${cur} ${r.status}`);   // 405 = already there
  }
}
async function ncPut(role: string, name: string, bytes: Uint8Array, mime: string): Promise<string> {
  const c = await ncCreds();
  const dir = `/Family Recipes/${OWNER_DIR[role] ?? "Jared"}`;
  await mkcols(c, dir);
  const path = `${dir}/${name}`;
  const r = await fetch(`${c.base}/remote.php/dav/files/${encodeURIComponent(c.user)}${seg(path)}`, {
    method: "PUT", headers: { Authorization: c.auth, "Content-Type": mime }, body: bytes, signal: AbortSignal.timeout(30_000),
  });
  if (![201, 204].includes(r.status)) throw new Error(`PUT ${r.status}`);
  return path;
}

async function afterStore(captureId: string, photoId: string, role: string, bytes: Uint8Array, mime: string, side: string, ext: string) {
  // start the read first: the family is waiting on it
  try {
    await fetch(`${SUPA_URL}/functions/v1/recipe-parse`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${SB}`, apikey: SB },
      body: JSON.stringify({ capture_id: captureId, force: true }), signal: AbortSignal.timeout(20_000),
    });
  } catch { /* the watchdog restarts a read that never began */ }
  try {
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
    const path = await ncPut(role, `${day} card ${captureId.slice(0, 6)} ${side}.${ext}`, bytes, mime);
    await db.from("family_photos").update({ nc_path: path, nc_synced_at: new Date().toISOString(), nc_error: null }).eq("id", photoId);
  } catch (e) {
    const { data: row } = await db.from("family_photos").select("nc_tries").eq("id", photoId).maybeSingle();
    await db.from("family_photos").update({ nc_error: (e as Error).message.slice(0, 200), nc_tries: (row?.nc_tries ?? 0) + 1 }).eq("id", photoId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return J(req, { ok: false, error: "POST only" }, 405);
  let form: FormData;
  try { form = await req.formData(); } catch { return J(req, { ok: false, error: "That upload did not arrive. Try again." }, 400); }
  const token = String(form.get("token") ?? "");
  const side = form.get("side") === "back" ? "back" : "front";
  const file = form.get("photo");
  let captureId = String(form.get("capture_id") ?? "");
  if (token.length < 40 || !(file instanceof File)) return J(req, { ok: false, error: "That upload did not arrive. Try again." }, 400);

  const { data: me } = await db.rpc("_family_me", { p_token: token });
  const member = Array.isArray(me) ? me[0] : me;
  if (!member?.id) return J(req, { ok: false, error: "Please sign in again." }, 401);

  if (file.size < 1000 || file.size > 3_000_000) return J(req, { ok: false, error: "That photo is too big or too small. Take it again." }, 413);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniff(bytes);
  if (!kind) return J(req, { ok: false, error: "That is not a photo I can read. Use the camera, or a JPEG." }, 415);

  if (captureId) {
    if (!/^[0-9a-f-]{36}$/i.test(captureId)) return J(req, { ok: false, error: "bad card" }, 400);
    const { data: cap } = await db.from("family_captures").select("id, status, member_id").eq("id", captureId).maybeSingle();
    if (!cap || cap.member_id !== member.id || !["reading", "closer", "ready", "failed"].includes(cap.status)) return J(req, { ok: false, error: "That card is no longer waiting." }, 404);
    if (side === "front") return J(req, { ok: false, error: "That card already has a front." }, 409);
    const { count } = await db.from("family_photos").select("id", { count: "exact", head: true }).eq("capture_id", captureId).eq("side", "back");
    if ((count ?? 0) > 0) return J(req, { ok: false, error: "That card already has a back." }, 409);
  } else {
    if (side === "back") return J(req, { ok: false, error: "Add the front first." }, 400);
    const { count } = await db.from("family_captures").select("id", { count: "exact", head: true }).eq("member_id", member.id).gte("created_at", new Date(Date.now() - 3_600_000).toISOString());
    if ((count ?? 0) >= 40) return J(req, { ok: false, error: "That is a lot of cards at once. Give it a few minutes." }, 429);
    const { data: cap, error } = await db.from("family_captures").insert({ member_id: member.id }).select("id").single();
    if (error) return J(req, { ok: false, error: "Could not start that card. Try again." }, 500);
    captureId = cap.id;
  }

  const photoId = crypto.randomUUID();
  const storagePath = `${captureId}/${side}-${photoId}.${kind.ext}`;
  const up = await db.storage.from("family-cards").upload(storagePath, bytes, { contentType: kind.mime, upsert: false });
  if (up.error) return J(req, { ok: false, error: "Could not save that photo. Try again." }, 500);
  const { error: pe } = await db.from("family_photos").insert({ id: photoId, capture_id: captureId, side, storage_path: storagePath, bytes: bytes.length });
  if (pe) { await db.storage.from("family-cards").remove([storagePath]); return J(req, { ok: false, error: "Could not save that photo. Try again." }, 500); }
  if (side === "back") await db.from("family_captures").update({ has_back: true, updated_at: new Date().toISOString() }).eq("id", captureId);

  const work = afterStore(captureId, photoId, member.role, bytes, kind.mime, side, kind.ext);
  // @ts-ignore EdgeRuntime is provided by Supabase's runtime
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work); else await work;
  return J(req, { ok: true, capture_id: captureId, photo_id: photoId });
});
