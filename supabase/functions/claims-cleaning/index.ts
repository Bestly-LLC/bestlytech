// claims-cleaning: Claims Closer's cleaning-report helper (2026-10-29, migration 20261029230000_claims_cleaning.sql).
// The Pi Turo reader (hestia) hands over trip photos and asks for a free-AI read of them. Nothing here talks to Turo.
// Auth: x-tesla-worker (same gate as claims-evidence / turo-ingest) or the service key.
//
//   {op:"put", reservation_id, uuid, side:"pre"|"post"|"guest_post", step?, taken_at?, jpeg_b64}
//        -> claim-evidence bucket cleaning/<reservation>/<side>/<uuid>.jpg + a claim_cleaning_photos row (a known uuid is skipped)
//   {op:"check", reservation_id}
//        -> {ok, verdict:"abuse"|"normal"|"unclear", confidence, reasons, support_uuids, model}
//        Free AI only (Groq vision for the photos, free text models for the call). Never paid.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { llm, llmVision } from "../_shared/free-llm.ts";

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
const MAX_POST = 15;   // return photos looked at (Jared's check-out first, then the guest's own)
const MAX_PRE = 10;    // check-in photos looked at, spread across the set

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
function bytesToB64(u: Uint8Array) {
  let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < u.length; i += chunk) bin += String.fromCharCode(...u.subarray(i, i + chunk));
  return btoa(bin);
}
/** n items spread evenly across a list (keeps the first and last) */
export function spread<T>(xs: T[], n: number): T[] {
  if (xs.length <= n) return xs;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(xs[Math.round(i * (xs.length - 1) / (n - 1))]);
  return out;
}

const LOOK = `You are checking photos of a rental car for a cleaning claim. Go through the images in order.
For each image write exactly one line: "<number> | <interior|exterior|dashboard|other> | <mess 0-3> | <what you see>".
Mess scale: 0 clean, 1 light everyday use (a little dust, a few crumbs, light footprints), 2 noticeable (some trash, small stains, sand, crumbs on several surfaces),
3 heavy (piles of trash, food or drink spills, large stains, mud, pet hair, ash, vomit, sticky residue).
Describe only what is visible. Do not guess. No other text.`;

const JUDGE = `You decide whether a car-sharing host has a valid cleaning violation against a guest.
The rule: a guest should return the car about as clean as they got it, allowing dirt from everyday use, weather and where they drove.
Only a mess that could only come from irresponsible or abusive use counts: trash left behind, food or drink spills, stains, heavy sand or mud inside,
pet hair, smoke or ash, sticky residue, bodily fluids. Dust, light crumbs, light footprints, exterior road dirt and rain spots do NOT count.
You get notes on the BEFORE photos (host check-in) and the AFTER photos (host check-out and the guest's own return photos).
Answer with JSON only: {"verdict":"abuse"|"normal"|"unclear","confidence":0.0-1.0,"reasons":"one plain sentence naming what is dirty and where",
"support":[AFTER image numbers that show the mess]}
Use "abuse" only when the AFTER photos clearly show an interior mess that the BEFORE photos do not. Use "unclear" when the AFTER photos do not
show the interior well enough to tell. Never mention money, fees, insurance or policies in reasons.`;

type Photo = { uuid: string; side: string; taken_at: string | null; storage_path: string };

async function load(p: Photo): Promise<{ b64: string; mime: string } | null> {
  const { data, error } = await db.storage.from(BUCKET).download(p.storage_path);
  if (error || !data) return null;
  return { b64: bytesToB64(new Uint8Array(await data.arrayBuffer())), mime: "image/jpeg" };
}

async function look(photos: Photo[], label: string, res: number) {
  const imgs = (await Promise.all(photos.map(load))).map((x, i) => x ? { ...x, i } : null).filter(Boolean) as { b64: string; mime: string; i: number }[];
  if (!imgs.length) return { notes: "", model: "", kept: [] as number[] };
  const r = await llmVision({ images: imgs.map(({ b64, mime }) => ({ b64, mime })), prompt: `${LOOK}\n(These are the ${label} photos.)`,
    job: "claims-cleaning-look", ref: String(res), fn: "claims-cleaning", scope: "background", paid: "never", maxTokens: 900, deadlineMs: 70_000 });
  return { notes: r.text, model: r.model, kept: imgs.map((x) => x.i) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const tw = req.headers.get("x-tesla-worker") ?? "";
  let allowed = SECRETS.includes(bearer) || SECRETS.includes(req.headers.get("apikey") ?? "");
  if (!allowed && tw) allowed = !!(await db.rpc("tesla_worker_ok", { p_token: tw })).data;
  let admin = false;
  if (!allowed && bearer) {   // the Claims page: Jared's own sign-in, photo links only
    const { data } = await db.auth.getUser(bearer);
    if (data?.user) admin = !!(await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" })).data;
  }
  if (!allowed && !admin) return J({ ok: false, error: "unauthorized" }, 401);

  const b = await req.json().catch(() => null);
  if (!b) return J({ ok: false, error: "expected JSON" }, 400);
  const res = Number(b.reservation_id);
  if (!Number.isFinite(res) || res <= 0) return J({ ok: false, error: "bad reservation_id" }, 400);

  if (b.op === "urls") {   // signed photo links for the Claims page (1 hour)
    const { data } = await db.from("claim_cleaning_photos").select("uuid, storage_path").eq("reservation_id", res);
    const out: Record<string, string> = {};
    for (const p of (data ?? []) as { uuid: string; storage_path: string }[]) {
      const { data: u } = await db.storage.from(BUCKET).createSignedUrl(p.storage_path, 3600);
      if (u?.signedUrl) out[p.uuid] = u.signedUrl;
    }
    return J({ ok: true, urls: out });
  }
  if (!allowed) return J({ ok: false, error: "unauthorized" }, 401);

  if (b.op === "put") {
    const uuid = String(b.uuid ?? "");
    const side = ["pre", "post", "guest_post"].includes(b.side) ? b.side : null;
    if (!/^[0-9a-f-]{8,64}$/i.test(uuid) || !side) return J({ ok: false, error: "bad uuid or side" }, 400);
    const { data: known } = await db.from("claim_cleaning_photos").select("uuid").eq("uuid", uuid).maybeSingle();
    if (known) return J({ ok: true, known: true });
    if (typeof b.jpeg_b64 !== "string" || b.jpeg_b64.length < 200) return J({ ok: false, error: "no image" }, 400);
    const path = `cleaning/${res}/${side}/${uuid}.jpg`;
    const up = await db.storage.from(BUCKET).upload(path, b64ToBytes(b.jpeg_b64), { contentType: "image/jpeg", upsert: true });
    if (up.error) return J({ ok: false, error: up.error.message }, 500);
    const { error } = await db.from("claim_cleaning_photos").insert({ uuid, reservation_id: res, side, step: b.step ? String(b.step).slice(0, 60) : null,
      taken_at: b.taken_at ? new Date(b.taken_at).toISOString() : null, storage_path: path });
    if (error) return J({ ok: false, error: error.message }, 500);
    return J({ ok: true, path });
  }

  if (b.op === "check") {
    const { data: rows, error } = await db.from("claim_cleaning_photos").select("uuid, side, taken_at, storage_path").eq("reservation_id", res).order("taken_at");
    if (error) return J({ ok: false, error: error.message }, 500);
    const all = (rows ?? []) as Photo[];
    const pre = spread(all.filter((p) => p.side === "pre"), MAX_PRE);
    const host = all.filter((p) => p.side === "post");
    const guest = all.filter((p) => p.side === "guest_post");
    const post = [...host, ...spread(guest, Math.max(0, MAX_POST - host.length))].slice(0, MAX_POST);
    if (!pre.length || !post.length) return J({ ok: false, error: `need photos on both sides (before ${pre.length}, after ${post.length})` });
    try {
      const [a, z] = await Promise.all([look(post, "AFTER (return)", res), look(pre, "BEFORE (check-in)", res)]);
      if (!a.notes || !z.notes) return J({ ok: false, error: "the photo read came back empty" });
      const j = await llm({ task: "judge", system: JUDGE, json: true, maxTokens: 500, job: "claims-cleaning-judge", ref: String(res), fn: "claims-cleaning",
        scope: "background", paid: "never", privacy: "private",
        user: `BEFORE photos (${pre.length}):\n${z.notes}\n\nAFTER photos (${post.length}; 1 to ${host.length} are the host's check-out, the rest are the guest's own return photos):\n${a.notes}`,
        validate: (o) => ["abuse", "normal", "unclear"].includes(o?.verdict) ? null : "verdict must be abuse, normal or unclear" });
      const o = j.json ?? {};
      const conf = Math.max(0, Math.min(1, Number(o.confidence) || 0));
      const support = (Array.isArray(o.support) ? o.support : []).map((n: unknown) => Number(n)).filter((n: number) => n >= 1 && n <= post.length)
        .map((n: number) => post[n - 1].uuid);
      return J({ ok: true, verdict: o.verdict, confidence: conf, reasons: String(o.reasons ?? "").slice(0, 300),
        support_uuids: support.length ? support : host.map((p) => p.uuid), model: `${a.model} + ${j.model}`, looked: { before: pre.length, after: post.length } });
    } catch (e) {
      return J({ ok: false, error: `free AI unavailable: ${(e as Error).message}`.slice(0, 300) });
    }
  }
  return J({ ok: false, error: "unknown op" }, 400);
});
