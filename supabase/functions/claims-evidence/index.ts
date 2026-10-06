// claims-evidence: the Pi Turo reader hands Claims Closer the photos it pulled out of Turo, and fetches back the documents it
// must upload to Turo (the chosen shop estimate). Private bucket claim-evidence. Auth: x-tesla-worker (same gate as turo-ingest)
// or the service key. Part of Claims Closer v2 (docs/claims-closer-v2-opusplan.md phase 1).
//
//   {op:"put", case_id, uuid, kind:"before"|"after", step?, description?, taken_at?, width?, height?, jpeg_b64}
//        -> stores <case_id>/<kind>/<uuid>.jpg and a claim_evidence row (a known uuid is never stored twice)
//   {op:"get", path}  -> {b64, content_type}  (only paths inside claim-evidence)
import { createClient } from "jsr:@supabase/supabase-js@2";

const SECRETS: string[] = (() => {
  const out: string[] = [];
  try { const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); for (const v of Object.values(j)) if (typeof v === "string") out.push(v); } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legacy) out.push(legacy);
  return out;
})();
const db = createClient(Deno.env.get("SUPABASE_URL")!, SECRETS[0], { auth: { persistSession: false }, global: { headers: { apikey: SECRETS[0] } } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-tesla-worker", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const BUCKET = "claim-evidence";

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function bytesToB64(u: Uint8Array) {
  let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < u.length; i += chunk) bin += String.fromCharCode(...u.subarray(i, i + chunk));
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const tw = req.headers.get("x-tesla-worker") ?? "";
  let allowed = SECRETS.includes(bearer) || SECRETS.includes(req.headers.get("apikey") ?? "");
  if (!allowed && tw) allowed = !!(await db.rpc("tesla_worker_ok", { p_token: tw })).data;
  if (!allowed) return J({ ok: false, error: "unauthorized" }, 401);

  const b = await req.json().catch(() => null);
  if (!b) return J({ ok: false, error: "expected JSON" }, 400);

  if (b.op === "get") {
    const path = String(b.path ?? "");
    if (!path || path.includes("..")) return J({ ok: false, error: "bad path" }, 400);
    const { data, error } = await db.storage.from(BUCKET).download(path);
    if (error || !data) return J({ ok: false, error: error?.message ?? "not found" }, 404);
    return J({ ok: true, b64: bytesToB64(new Uint8Array(await data.arrayBuffer())), content_type: data.type || "application/octet-stream" });
  }

  if (b.op === "put") {
    const caseId = String(b.case_id ?? ""), uuid = String(b.uuid ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(caseId) || !/^[0-9a-f-]{8,64}$/i.test(uuid)) return J({ ok: false, error: "bad ids" }, 400);
    const kind = b.kind === "before" ? "before" : "after";
    const { data: known } = await db.from("claim_evidence").select("id").eq("uuid", uuid).maybeSingle();
    if (known) return J({ ok: true, known: true });
    if (typeof b.jpeg_b64 !== "string" || b.jpeg_b64.length < 200) return J({ ok: false, error: "no image" }, 400);
    const bytes = b64ToBytes(b.jpeg_b64);
    const path = `${caseId}/${kind}/${uuid}.jpg`;
    const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (up.error) return J({ ok: false, error: up.error.message }, 500);
    const { error } = await db.from("claim_evidence").insert({
      case_id: caseId, uuid, kind, step: b.step ? String(b.step).slice(0, 60) : null, description: b.description ? String(b.description).slice(0, 300) : null,
      storage_path: path, taken_at: b.taken_at ? new Date(b.taken_at).toISOString() : null,
      width: Number(b.width) || null, height: Number(b.height) || null, bytes: bytes.length });
    if (error) return J({ ok: false, error: error.message }, 500);
    return J({ ok: true, path, bytes: bytes.length });
  }
  return J({ ok: false, error: "unknown op" }, 400);
});
