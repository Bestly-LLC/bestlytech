// insurance-filer: the cloud half of Claims Closer's Insurance Filer (docs: tools/insurance-filer/README.md,
// migration 20261029140000_insurance_filer.sql). Everything with a brain or a bucket lives here; the Mac mini only drives browsers and Mail.
//
//   {op:"tick"}                       cron/invoke (service key). Copies existing claim photos into the private bucket (copy_evidence jobs),
//                                     and writes every draft in status 'writing' with FREE AI only (paid: never). A draft that breaks a hard
//                                     rule, or an AI that is out of room, falls back to a plain template so a reply is never lost.
//   {op:"photo_put", ...}             Pi Turo reader (x-tesla-worker): one damage-report / check-in / return photo as jpeg_b64.
//   {op:"shot_put" | "doc_put", ...}  Mac mini filer (x-ins-mac = the watchdog token): a screenshot, or a document saved from an email
//                                     (the finalized repair estimate). Stored in insurance-photos, never public.
//   {op:"signed_urls", paths:[...]}   Mac mini: short-lived (10 minute) signed URLs for photos of an open case, to upload or attach. Nothing else.
//   {op:"approval_media", code}       the approval page (admin JWT): signed URLs so Jared sees the exact photos and screenshots before he taps.
//
// Hard rules (the same ones Claims Closer already lives by): no Turo plan talk, no host damage responsibility figure, no coverage figures,
// no dollar amount except the finalized estimate, no reviews. Signed "Claims Closer, for Jared Best". Nothing here sends mail: a draft only
// ever waits for Jared's tap (ins_draft_ready makes the approval); the Mac sends it after the tap.
//
// Auth: service key, an admin JWT, x-tesla-worker (photo_put only), x-ins-mac (shot_put, doc_put, signed_urls). verify_jwt = false.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { llm, LlmUnavailable } from "../_shared/free-llm.ts";
import { corsWith } from "../_shared/cors.ts";
import { guard, templateBody, withSig } from "./rules.ts";

const SECRETS: string[] = (() => {
  const out: string[] = [];
  try { const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); for (const v of Object.values(j)) if (typeof v === "string") out.push(v); } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legacy) out.push(legacy);
  return out;
})();
const db = createClient(Deno.env.get("SUPABASE_URL")!, SECRETS[0], { auth: { persistSession: false }, global: { headers: { apikey: SECRETS[0] } } });
const CORS = corsWith({ headers: "authorization, content-type, apikey, x-client-info, x-tesla-worker, x-ins-mac", methods: "POST, OPTIONS" });
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

const BUCKET = "insurance-photos";
const FROM_BUCKET = "claim-evidence";
const SLUG = "insurance-filer";
const SIGN_SECONDS = 600;
const SOURCES = ["guest_report", "checkin", "return", "before", "after"] as const;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const cleanName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 80) || "file";
const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f-]{36}$/i.test(s);

async function who(req: Request): Promise<"service" | "admin" | "pi" | "mac" | null> {
  const apikey = req.headers.get("apikey") ?? "";
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (SECRETS.includes(apikey) || SECRETS.includes(bearer)) return "service";
  const tw = req.headers.get("x-tesla-worker") ?? "";
  if (tw && (await db.rpc("tesla_worker_ok", { p_token: tw })).data) return "pi";
  const mac = req.headers.get("x-ins-mac") ?? "";
  if (mac && (await db.rpc("db_watchdog_ok", { p_token: mac })).data) return "mac";
  if (bearer && bearer.split(".").length === 3) {
    const { data } = await db.auth.getUser(bearer);
    if (data?.user) {
      const { data: ok } = await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
      if (ok) return "admin";
    }
  }
  return null;
}

// ---- drafting -----------------------------------------------------------------------------------------------------------------------
const WRITER = `You write one short, polite email from "Claims Closer", the claims assistant of Jared Best, a Tesla owner whose rental car was damaged by a renter. You write to an insurance adjuster at the renter's insurer.
Use ONLY the facts given. Never invent a fact, a date, a name, a number or a promise. If they ask for something you do not have, say you will get it to them and ask nothing else of them.
Say plainly what is attached (use the attachment list: photos, and the repair estimate if present). Answer each question they asked, in order, in plain words.
NEVER write: anything about Turo's protection plans, the host's damage responsibility, a deductible, coverage limits, out-of-pocket amounts, reviews or ratings. NEVER write a dollar amount, except the finalized estimate total if one is given in "estimate".
If a Turo claim number is given and this is the first email or they asked who else is involved, mention once that Turo has its own claim open for the same loss (give the Turo claim number).
Do not write a greeting line other than "Hello <first name>," and do not write a sign-off: the sign-off is added for you.
Reply with JSON only: {"reply_needed": true|false, "subject": string, "body": string}. Set reply_needed to false only when their email asks for nothing and needs no answer (a plain receipt or "we received your photos"); then body is empty.`;

async function writeDraft(draftId: string): Promise<string> {
  const { data: c, error } = await db.rpc("ins_draft_context", { p_draft: draftId });
  if (error || !c) return `context failed: ${error?.message ?? "empty"}`;
  const estimate = c.estimate?.amount != null ? Number(c.estimate.amount) : null;
  const kind = String(c.draft?.kind ?? "");
  const user = JSON.stringify({
    kind, subject_hint: c.draft?.subject, adjuster: c.case?.adjuster_name, insurer: c.case?.insurer, claim_number: c.case?.claim_no, policy_number: c.case?.policy_no,
    facts: c.facts, turo_claim_number: c.turo_claim_no, estimate, attachments: (c.attachments ?? []).map((a: Row) => a.name),
    their_email: c.their_mail, what_we_already_said: c.we_said,
  });
  let out: { subject: string; body: string } | null = null;
  let note = "";
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    try {
      const r = await llm({
        task: "write", system: WRITER + (attempt ? "\nYour last draft broke a hard rule. Remove every dollar figure (unless it is the estimate) and every word about plans, caps, deductibles and reviews." : ""),
        user, json: true, job: SLUG, ref: draftId, fn: SLUG, paid: "never", privacy: "private", deadlineMs: 45_000, maxTokens: 700,
        validate: (j: Row) => typeof j?.reply_needed === "boolean" && (j.reply_needed === false || (typeof j.body === "string" && j.body.trim().length >= 40 && j.body.length <= 2500))
          ? null : "reply_needed or body missing or wrong length",
      });
      const j = r.json as Row;
      if (j.reply_needed === false && kind === "adjuster_reply") {
        const ocId = await ocOf(draftId);
        await db.from("ins_drafts").update({ status: "dismissed", error: "No reply needed" }).eq("id", draftId);
        if (ocId) await db.rpc("ins_event", { p_oc: ocId, p_kind: "no_reply_needed", p_title: "Their email needs no answer. I did not write one.", p_detail: { draft_id: draftId } });
        return "dismissed";
      }
      const body = withSig(String(j.body ?? ""));
      const why = guard(body, estimate);
      if (why) { note = why; continue; }
      out = { subject: String(j.subject ?? "").trim() || String(c.draft?.subject ?? ""), body };
    } catch (e) {
      if (e instanceof LlmUnavailable) { note = "the free writers were out of room"; break; }
      throw e;
    }
  }
  if (!out) {
    const t = templateBody(c);
    const why = guard(t.body, estimate);
    if (why) return `template blocked: ${why}`;
    out = t;
  }
  const { data: code, error: e2 } = await db.rpc("ins_draft_ready", { p_draft: draftId, p_subject: out.subject, p_body: out.body, p_attach: null });
  if (e2) return `ready failed: ${e2.message}`;
  return code ? (note ? `written from the template (${note})` : "written") : "blocked by the guard";
}

async function ocOf(draftId: string): Promise<string | null> {
  const { data } = await db.from("ins_drafts").select("oc_id").eq("id", draftId).maybeSingle();
  return data?.oc_id ?? null;
}

// ---- copy the photos Claims Closer already holds into the private insurance bucket -------------------------------------------------------
async function copyEvidence(job: Row): Promise<Row> {
  const { data: rows, error } = await db.from("claim_evidence").select("uuid,kind,step,description,storage_path,taken_at,width,height,bytes").eq("case_id", job.case_id);
  if (error) throw new Error(error.message);
  let added = 0, known = 0;
  for (const r of rows ?? []) {
    const source = r.kind === "before" ? "before" : "after";
    const path = `${job.oc_id}/${source}/${cleanName(String(r.uuid))}.jpg`;
    const { data: dup } = await db.from("ins_photos").select("id").eq("oc_id", job.oc_id).eq("storage_path", path).maybeSingle();
    if (dup) { known++; continue; }
    const dl = await db.storage.from(FROM_BUCKET).download(String(r.storage_path));
    if (dl.error || !dl.data) continue;
    const bytes = new Uint8Array(await dl.data.arrayBuffer());
    const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: "image/jpeg", upsert: true });
    if (up.error) continue;
    const ins = await db.from("ins_photos").insert({ oc_id: job.oc_id, case_id: job.case_id, source, turo_uuid: String(r.uuid), step: r.step, description: r.description,
      storage_path: path, mime: "image/jpeg", bytes: bytes.length, width: r.width, height: r.height, taken_at: r.taken_at });
    if (!ins.error) added++;
  }
  return { added, known, seen: (rows ?? []).length };
}

async function tick(): Promise<Row> {
  const done: Row = { copied: [], drafts: [] };
  for (let i = 0; i < 5; i++) {
    const { data } = await db.rpc("ins_edge_take");
    const job = data?.job;
    if (!job) break;
    try {
      const r = job.kind === "copy_evidence" ? await copyEvidence(job) : { skipped: job.kind };
      await db.rpc("ins_job_done", { p_job: job.id, p_status: "done", p_result: r, p_error: null });
      done.copied.push({ job: job.id, ...r });
    } catch (e) {
      await db.rpc("ins_job_done", { p_job: job.id, p_status: "failed", p_result: null, p_error: String((e as Error).message ?? e).slice(0, 400) });
    }
  }
  const { data: writing } = await db.from("ins_drafts").select("id").eq("status", "writing").order("created_at").limit(5);
  for (const d of writing ?? []) {
    try { done.drafts.push({ id: d.id, result: await writeDraft(d.id) }); }
    catch (e) { done.drafts.push({ id: d.id, result: "error: " + String((e as Error).message ?? e).slice(0, 200) }); }
  }
  return done;
}

// ---- photos and documents in ------------------------------------------------------------------------------------------------------------
async function putFile(b: Row, kind: "photo" | "shot" | "doc"): Promise<Response> {
  const ocId = String(b.oc_id ?? "");
  if (!isUuid(ocId)) return J({ ok: false, error: "bad oc_id" }, 400);
  const { data: oc } = await db.from("outside_claims").select("id,case_id,status,kind").eq("id", ocId).maybeSingle();
  if (!oc || oc.kind !== "guest_insurer") return J({ ok: false, error: "no such claim" }, 404);
  const b64 = String(b.jpeg_b64 ?? b.png_b64 ?? b.b64 ?? "");
  if (b64.length < 100) return J({ ok: false, error: "no file" }, 400);
  const bytes = b64ToBytes(b64);
  if (bytes.length > 12_000_000) return J({ ok: false, error: "file too large" }, 413);

  let source: string, mime: string, ext: string, name: string;
  if (kind === "photo") {
    source = (SOURCES as readonly string[]).includes(b.source) ? b.source : "guest_report";
    mime = "image/jpeg"; ext = "jpg"; name = cleanName(String(b.turo_uuid ?? crypto.randomUUID()));
    if (b.turo_uuid) {
      const { data: dup } = await db.from("ins_photos").select("id").eq("oc_id", ocId).eq("turo_uuid", String(b.turo_uuid)).maybeSingle();
      if (dup) return J({ ok: true, known: true });
    }
  } else if (kind === "shot") {
    source = "shot"; mime = "image/png"; ext = "png"; name = cleanName(String(b.name ?? Date.now())).replace(/\.png$/i, "");
  } else {
    source = b.source === "estimate_doc" ? "estimate_doc" : "after";
    mime = String(b.mime ?? "application/pdf"); ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
    name = cleanName(String(b.name ?? crypto.randomUUID())).replace(/\.(pdf|png|jpe?g)$/i, "");
  }
  const path = `${ocId}/${source === "shot" ? "shots" : source}/${name}.${ext}`;
  const up = await db.storage.from(BUCKET).upload(path, bytes, { contentType: mime, upsert: true });
  if (up.error) return J({ ok: false, error: up.error.message }, 500);
  const { error } = await db.from("ins_photos").upsert({
    oc_id: ocId, case_id: oc.case_id, source, turo_uuid: b.turo_uuid ? String(b.turo_uuid) : null, step: b.step ? String(b.step).slice(0, 60) : null,
    description: b.description ? String(b.description).slice(0, 300) : null, storage_path: path, mime, bytes: bytes.length,
    width: Number(b.width) || null, height: Number(b.height) || null, taken_at: b.taken_at ? new Date(b.taken_at).toISOString() : null }, { onConflict: "oc_id,storage_path" });
  if (error) return J({ ok: false, error: error.message }, 500);
  return J({ ok: true, path, bytes: bytes.length });
}

// ---- signed URLs out (short-lived, only for files that belong to an insurer claim) ----------------------------------------------------
async function signedUrls(paths: string[]): Promise<Response> {
  const want = [...new Set(paths.map(String))].filter((p) => p && !p.includes("..")).slice(0, 40);
  if (!want.length) return J({ ok: true, urls: {} });
  const { data: rows } = await db.from("ins_photos").select("storage_path").in("storage_path", want);
  const okPaths = (rows ?? []).map((r) => r.storage_path as string);
  if (!okPaths.length) return J({ ok: true, urls: {} });
  const { data, error } = await db.storage.from(BUCKET).createSignedUrls(okPaths, SIGN_SECONDS);
  if (error) return J({ ok: false, error: error.message }, 500);
  const urls: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) urls[d.path] = d.signedUrl;
  return J({ ok: true, urls, expires_in: SIGN_SECONDS });
}

async function approvalMedia(code: string): Promise<Response> {
  const { data: a } = await db.from("ins_approvals").select("oc_id").eq("code", String(code).toLowerCase().trim()).maybeSingle();
  if (!a) return J({ ok: false, error: "not found" }, 404);
  const { data: rows } = await db.from("ins_photos").select("id,source,step,description,storage_path,mime,created_at").eq("oc_id", a.oc_id).order("created_at").limit(60);
  const paths = (rows ?? []).map((r) => r.storage_path as string);
  const { data: signed } = paths.length ? await db.storage.from(BUCKET).createSignedUrls(paths, SIGN_SECONDS) : { data: [] as { path: string | null; signedUrl: string }[] };
  const by: Record<string, string> = {};
  for (const s of signed ?? []) if (s.path && s.signedUrl) by[s.path] = s.signedUrl;
  const items = (rows ?? []).map((r) => ({ id: r.id, source: r.source, step: r.step, description: r.description, mime: r.mime, url: by[r.storage_path as string] ?? null }));
  return J({ ok: true, photos: items.filter((i) => i.source !== "shot"), shots: items.filter((i) => i.source === "shot"), expires_in: SIGN_SECONDS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const as = await who(req);
  if (!as) return J({ ok: false, error: "unauthorized" }, 401);
  const b = (await req.json().catch(() => null)) as Row | null;
  if (!b) return J({ ok: false, error: "expected JSON" }, 400);

  try {
    switch (b.op) {
      case "tick": if (as !== "service" && as !== "admin") break; return J({ ok: true, ...(await tick()) });
      case "photo_put": if (as !== "pi" && as !== "service") break; return await putFile(b, "photo");
      case "shot_put": if (as !== "mac" && as !== "service") break; return await putFile(b, "shot");
      case "doc_put": if (as !== "mac" && as !== "service") break; return await putFile(b, "doc");
      case "signed_urls": if (as !== "mac" && as !== "service") break; return await signedUrls(Array.isArray(b.paths) ? b.paths : []);
      case "approval_media": if (as !== "admin" && as !== "service") break; return await approvalMedia(String(b.code ?? ""));
      default: return J({ ok: false, error: "unknown op" }, 400);
    }
    return J({ ok: false, error: "not allowed for this caller" }, 403);
  } catch (e) {
    return J({ ok: false, error: String((e as Error).message ?? e).slice(0, 300) }, 500);
  }
});
