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
// POST { library_id, to, to_name?, subject, html_sha, attempt }  ->  { ok, id }
// POST { ..., dry_run: true } checks everything and reports what it would send; Resend is not called.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";
import { sha256Hex } from "../_shared/email-render.ts";

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
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;

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

  const to = String(b.to ?? "").trim();
  const toName = String(b.to_name ?? "").replace(/[<>"\r\n]/g, "").trim().slice(0, 80);
  const subject = String(b.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (!EMAIL.test(to)) return J({ ok: false, error: "That is not one email address." }, 400);
  if (!subject) return J({ ok: false, error: "The subject is empty." }, 400);
  if (typeof b.html_sha !== "string" || b.html_sha.length !== 64) return J({ ok: false, error: "Confirm the preview first." }, 400);

  const { data: row, error } = await db.from("email_library").select("id, brand_kit, html, text_body, subject").eq("id", String(b.library_id ?? "")).maybeSingle();
  if (error || !row) return J({ ok: false, error: "That email is not in the library." }, 404);
  if (!row.html || row.html.length < 200) return J({ ok: false, error: "The email is empty." }, 400);
  const sha = await sha256Hex(row.html);
  if (sha !== b.html_sha) return J({ ok: false, error: "The email changed after you confirmed it. Open the preview again.", changed: true }, 409);

  const { data: kit } = await db.from("email_brand_kits").select("default_sender").eq("slug", row.brand_kit).maybeSingle();
  const s = (kit?.default_sender ?? {}) as Record<string, string>;
  const fromEmail = /^[\w.+-]+@bestly\.tech$/i.test(s.from_email ?? "") ? s.from_email : "jared@bestly.tech";
  const fromName = (s.from_name ?? "Jared Best").replace(/[<>"\r\n]/g, "");
  const replyTo = /^[\w.+-]+@bestly\.tech$/i.test(s.reply_to ?? "") ? s.reply_to : "jared@bestly.tech";
  const bcc = /^[\w.+-]+@bestly\.tech$/i.test(s.bcc ?? "") ? s.bcc : "jared@bestly.tech";
  const from = `${fromName} <${fromEmail}>`;
  const toHeader = toName ? `${toName} <${to}>` : to;

  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from("email_send_log").select("id", { count: "exact", head: true }).eq("template_name", "email-builder").eq("status", "sent").gte("created_at", since.toISOString());
  if ((count ?? 0) >= DAILY_MAX) return J({ ok: false, error: `Daily send limit reached (${DAILY_MAX}).` }, 429);

  if (b.dry_run === true) return J({ ok: true, dry_run: true, from, to: toHeader, reply_to: replyTo, bcc, subject, html_bytes: row.html.length, sha });

  const key = Deno.env.get("RESEND_API_KEY");
  const log = (status: "sent" | "failed", providerId: string | null, err: string | null) =>
    // email_send_log is the shared transactional log: builder details ride in metadata.
    db.from("email_send_log").insert({
      template_name: "email-builder", recipient_email: to, message_id: providerId, status, error_message: err,
      metadata: { library_id: row.id, to_name: toName || null, subject, from_email: fromEmail, provider: "resend", html_sha: sha, sent_by: uid },
    }).then(({ error }) => { if (error) console.error("email_send_log insert failed:", error.message); });
  if (!key) {
    await log("failed", null, "RESEND_API_KEY is not set");
    await raiseSend("Email builder: send failed", "RESEND_API_KEY is not set on this project. Nothing was sent.");
    return J({ ok: false, error: "Sending is not set up (no Resend key). Nothing was sent." }, 200);
  }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `eb-${row.id}-${String(b.attempt ?? crypto.randomUUID()).slice(0, 64)}` },
    body: JSON.stringify({ from, to: [toHeader], bcc: [bcc], reply_to: replyTo, subject, html: row.html, text: row.text_body || undefined }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ message: String(e) }) }) as unknown as Response);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = `Resend ${r.status}: ${JSON.stringify(j).slice(0, 200)}`;
    await log("failed", null, msg);
    await raiseSend("Email builder: send failed", `${msg}. Nothing reached ${to}.`);
    return J({ ok: false, error: "The mail service refused it. Nothing was sent.", detail: msg }, 200);
  }
  await log("sent", j?.id ?? null, null);
  await db.from("email_library").update({ status: "sent", recipient_email: to, recipient_name: toName || null, sent_at: new Date().toISOString() }).eq("id", row.id);
  return J({ ok: true, id: j?.id ?? null, from, to: toHeader });
});
