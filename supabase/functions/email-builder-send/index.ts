// email-builder-send — sends ONE saved library email, exactly as rendered, as Jared (Resend).
//
// Never automatic: it runs only from the confirm dialog in /admin/emails after Jared taps Send, with an admin JWT
// (the service key is refused). The dialog shows recipient + subject + preview and posts the SHA-256 of the HTML it
// showed; if the saved email no longer hashes to that, nothing is sent (409). One recipient per call.
//
// From: Jared Best <jared@bestly.tech> (the kit may name another @bestly.tech sender), reply-to jared@, bcc jared@.
// Every attempt, sent or failed, is a row in email_send_log. A failure raises bestly_raise('email-builder.send'),
// owned by Scout through notification_owners('email-builder').
//
// Attachments (2026-11-04): email_library.attachments = [{path, name, type, size}] in the private bucket
// email-attachments. They are downloaded here with the service key and sent through Resend. The dialog posts the
// paths it showed (`attachments`); if the saved list differs, nothing is sent (409). Max 10 files, 25 MB in all.
//
// Recipients (2026-11-04): `to`, `cc`, `bcc` are lists of { email, name? } (the old single `to` + `to_name` still
// works). Up to 20 people per email; Jared (or the kit's bcc) is always added to Bcc.
//
// Sent folder (2026-11-04): every successful send is snapshotted into email_sent_copies; Hermes's Hestia job
// sent_copies files it into jared@bestly.tech -> Sent.
//
// POST { library_id, to, cc?, bcc?, subject, html_sha, attempt, attachments? }  ->  { ok, id }
// POST { ..., dry_run: true } checks everything and reports what it would send; Resend is not called.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";
// Same as sha256Hex in ../_shared/email-render.ts (kept local so this function deploys without the 42 KB render module).
async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const secretKeys = (() => {
  const out: string[] = [];
  try { const j = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); for (const v of Object.values(j)) if (typeof v === "string") out.push(v); } catch { /* none */ }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"); if (legacy) out.push(legacy);
  return out;
})();
const SECRET = secretKeys[0];
const db = createClient(Deno.env.get("SUPABASE_URL")!, SECRET, { auth: { persistSession: false }, global: { headers: { apikey: SECRET } } });
const CORS = corsWith({ headers: "authorization, content-type, apikey, x-client-info", methods: "POST, OPTIONS" });
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

const DAILY_MAX = 40;
const ATT_MAX_FILES = 10;
const ATT_MAX_TOTAL = 25 * 1024 * 1024;
type Att = { path: string; name: string; type?: string; size?: number };

function b64(bytes: Uint8Array): string {
  let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
const MAX_PEOPLE = 20;
type Person = { email: string; name: string };
const cleanName = (v: unknown) => String(v ?? "").replace(/[<>"\r\n,;]/g, "").trim().slice(0, 80);
/** A list of { email, name? } (or one address string) -> clean people; null when any address is bad. */
function people(v: unknown, legacyName?: unknown): Person[] | null {
  const raw = Array.isArray(v) ? v : (v == null || v === "" ? [] : [{ email: v, name: legacyName }]);
  const out: Person[] = [];
  for (const r of raw) {
    const email = String((r as Record<string, unknown>)?.email ?? r ?? "").trim();
    if (!EMAIL.test(email)) return null;
    out.push({ email, name: cleanName((r as Record<string, unknown>)?.name) });
  }
  return out;
}
const header = (p: Person) => (p.name ? `${p.name} <${p.email}>` : p.email);

async function adminId(req: Request): Promise<string | null> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer || bearer.split(".").length !== 3 || secretKeys.includes(bearer)) return null;
  const { data } = await db.auth.getUser(bearer);
  if (!data?.user) return null;
  const { data: ok } = await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return ok ? data.user.id : null;
}

async function raiseSend(title: string, body: string) {
  try { await db.rpc("bestly_raise", { p_key: "email-builder.send", p_kind: "problem", p_severity: "warning", p_title: title, p_body: body.slice(0, 400), p_area: "email", p_healed: false }); } catch { /* never break the request */ }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const uid = await adminId(req);
  if (!uid) return J({ ok: false, error: "Sign in as an admin to send." }, 401);
  let b: Record<string, any> = {};
  try { b = await req.json(); } catch { return J({ ok: false, error: "json" }, 400); }

  const toList = people(b.to, b.to_name), ccList = people(b.cc), bccList = people(b.bcc);
  if (!toList || !ccList || !bccList) return J({ ok: false, error: "One of the addresses is not a real email address." }, 400);
  if (!toList.length) return J({ ok: false, error: "Add at least one person in To." }, 400);
  // one person, one line: To beats Cc beats Bcc
  const seen = new Set<string>();
  const uniq = (l: Person[]) => l.filter((p) => { const k = p.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  const toP = uniq(toList), ccP = uniq(ccList), bccP = uniq(bccList);
  if (toP.length + ccP.length + bccP.length > MAX_PEOPLE) return J({ ok: false, error: `Up to ${MAX_PEOPLE} people per email.` }, 400);
  const to = toP[0].email, toName = toP[0].name;
  const subject = String(b.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (!subject) return J({ ok: false, error: "The subject is empty." }, 400);
  if (typeof b.html_sha !== "string" || b.html_sha.length !== 64) return J({ ok: false, error: "Confirm the preview first." }, 400);

  const { data: row, error } = await db.from("email_library").select("id, brand_kit, html, text_body, subject, attachments").eq("id", String(b.library_id ?? "")).maybeSingle();
  if (error || !row) return J({ ok: false, error: "That email is not in the library." }, 404);
  if (!row.html || row.html.length < 200) return J({ ok: false, error: "The email is empty." }, 400);
  const sha = await sha256Hex(row.html);
  if (sha !== b.html_sha) return J({ ok: false, error: "The email changed after you confirmed it. Open the preview again.", changed: true }, 409);

  const atts: Att[] = (Array.isArray(row.attachments) ? row.attachments : []).filter((a: Att) => a && typeof a.path === "string" && a.path && !a.path.includes(".."));
  if (Array.isArray(b.attachments)) {
    const shown = b.attachments.map(String).sort().join("\n"), saved = atts.map((a) => a.path).sort().join("\n");
    if (shown !== saved) return J({ ok: false, error: "The attachments changed after you confirmed. Open the preview again.", changed: true }, 409);
  }
  if (atts.length > ATT_MAX_FILES) return J({ ok: false, error: `Too many attachments (max ${ATT_MAX_FILES}).` }, 400);

  const { data: kit } = await db.from("email_brand_kits").select("default_sender").eq("slug", row.brand_kit).maybeSingle();
  const s = (kit?.default_sender ?? {}) as Record<string, string>;
  const fromEmail = /^[\w.+-]+@bestly\.tech$/i.test(s.from_email ?? "") ? s.from_email : "jared@bestly.tech";
  const fromName = (s.from_name ?? "Jared Best").replace(/[<>"\r\n]/g, "");
  const replyTo = /^[\w.+-]+@bestly\.tech$/i.test(s.reply_to ?? "") ? s.reply_to : "jared@bestly.tech";
  const bcc = /^[\w.+-]+@bestly\.tech$/i.test(s.bcc ?? "") ? s.bcc : "jared@bestly.tech";
  const from = `${fromName} <${fromEmail}>`;
  const bccAll = [...bccP.map(header), ...(seen.has(bcc.toLowerCase()) ? [] : [bcc])];
  const everyone = [...toP, ...ccP, ...bccP].map((p) => p.email);

  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from("email_send_log").select("id", { count: "exact", head: true }).eq("template_name", "email-builder").eq("status", "sent").gte("created_at", since.toISOString());
  if ((count ?? 0) >= DAILY_MAX) return J({ ok: false, error: `Daily send limit reached (${DAILY_MAX}).` }, 429);

  if (b.dry_run === true) return J({ ok: true, dry_run: true, from, to: toP.map(header), cc: ccP.map(header), bcc: bccAll, reply_to: replyTo, subject, html_bytes: row.html.length, sha, attachments: atts.map((a) => ({ name: a.name, size: a.size ?? null })) });

  // Read every file before calling the mail service: a missing file means nothing is sent.
  const files: { filename: string; content: string; content_type?: string }[] = [];
  let total = 0;
  for (const a of atts) {
    const { data: blob, error: dlErr } = await db.storage.from("email-attachments").download(a.path);
    if (dlErr || !blob) {
      await raiseSend("Email builder: attachment missing", `${a.name} (${a.path}) could not be read: ${dlErr?.message ?? "no data"}. Nothing was sent to ${to}.`);
      return J({ ok: false, error: `${a.name} could not be read. Remove it and attach it again. Nothing was sent.` }, 200);
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    total += bytes.length;
    if (total > ATT_MAX_TOTAL) return J({ ok: false, error: "The attachments are over 25 MB in all. Nothing was sent." }, 400);
    files.push({ filename: String(a.name || "file").replace(/[\r\n"]/g, "_").slice(0, 200), content: b64(bytes), ...(a.type ? { content_type: a.type } : {}) });
  }

  const key = Deno.env.get("RESEND_API_KEY");
  const log = (status: "sent" | "failed", providerId: string | null, err: string | null) =>
    // email_send_log is the shared transactional log: builder details ride in metadata.
    db.from("email_send_log").insert({
      template_name: "email-builder", recipient_email: to, message_id: providerId, status, error_message: err,
      metadata: { library_id: row.id, to_name: toName || null, to: toP.map((p) => p.email), cc: ccP.map((p) => p.email), bcc: bccP.map((p) => p.email), subject, from_email: fromEmail, provider: "resend", html_sha: sha, sent_by: uid, attachments: atts.map((a) => a.name), attachment_bytes: total },
    }).then(({ error }) => { if (error) console.error("email_send_log insert failed:", error.message); });
  if (!key) {
    await log("failed", null, "RESEND_API_KEY is not set");
    await raiseSend("Email builder: send failed", "RESEND_API_KEY is not set on this project. Nothing was sent.");
    return J({ ok: false, error: "Sending is not set up (no Resend key). Nothing was sent." }, 200);
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `eb-${row.id}-${String(b.attempt ?? crypto.randomUUID()).slice(0, 64)}` },
    body: JSON.stringify({ from, to: toP.map(header), ...(ccP.length ? { cc: ccP.map(header) } : {}), bcc: bccAll, reply_to: replyTo, subject, html: row.html, text: row.text_body || undefined, ...(files.length ? { attachments: files } : {}) }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ message: String(e) }) }) as unknown as Response);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = `Resend ${r.status}: ${JSON.stringify(j).slice(0, 200)}`;
    await log("failed", null, msg);
    await raiseSend("Email builder: send failed", `${msg}. Nothing reached ${everyone.join(", ")}.`);
    return J({ ok: false, error: "The mail service refused it. Nothing was sent.", detail: msg }, 200);
  }
  await log("sent", j?.id ?? null, null);
  // Resend sends from outside the mailbox, so nothing lands in Sent. Hermes's Hestia job (sent_copies) files this
  // snapshot into jared@bestly.tech -> Sent. A failure here never fails the send: the email already went out.
  try {
    const { error: qErr } = await db.from("email_sent_copies").insert({
      provider_id: j?.id ?? null, library_id: row.id, from_header: from, reply_to: replyTo,
      to_list: toP.map(header), cc_list: ccP.map(header), bcc_list: bccAll, subject, html: row.html, text_body: row.text_body || null,
      attachments: atts.map((a) => ({ path: a.path, name: a.name, type: a.type ?? null })),
    });
    if (qErr) throw new Error(qErr.message);
  } catch (e) {
    await raiseSend("Email builder: no Sent copy", `Sent to ${everyone.join(", ")}, but the copy for your Sent folder could not be queued: ${(e as Error).message}`);
  }
  await db.from("email_library").update({ status: "sent", recipient_email: to, recipient_name: toName || null, sent_at: new Date().toISOString() }).eq("id", row.id);
  return J({ ok: true, id: j?.id ?? null, from, to: toP.map(header), cc: ccP.map(header), bcc: bccP.map(header) });
});
