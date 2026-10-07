// bestly-send-mail: send ONE plain email as Jared, for things Claude or an AI employee is asked to send.
// (Spark, 2026-10-05, built for the ElevenLabs realtime-monitoring request.)
//
// Why this exists: the Mac's mail bridge PULLS mail in (bestly_mail) but there was no way to send any out.
// bestly_mail_queue is IMAP actions (move/delete/flag), and bestly_sent_mail is a record of the Sent folder,
// not a send queue. So nothing here could send an email until now.
//
// Deliberately narrow:
//   * From is always jared@bestly.tech. No arbitrary sender.
//   * Admin JWT or service key only.
//   * One recipient per call, plain text, no attachments.
//   * Every send is logged to vendor_requests when a request_id is given, so a follow-up can be tracked.
// Replies go to jared@bestly.tech, which the Mac's puller ingests into bestly_mail within about two minutes,
// so an AI employee can watch for the answer without anyone forwarding anything.
//
// 2026-10-06: now carries Jared's Bestly signature with the animated GIF headshot (_shared/bestly-signature.ts),
// the same one Scout's send_email and Claims Closer use.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendAsJared } from "../_shared/bestly-signature.ts";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const err = (error: string, status = 400) => Response.json({ ok: false, error }, { status, headers: CORS });
const ok = (b: Record<string, unknown>) => Response.json({ ok: true, ...b }, { headers: CORS });

async function isAdmin(req: Request): Promise<boolean> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (SERVICE_KEYS.has(token)) return true;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await isAdmin(req))) return new Response("unauthorized", { status: 401, headers: CORS });
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return err("RESEND_API_KEY is not set on this project.", 412);

  const b = await req.json().catch(() => ({}));
  const to = String(b.to ?? "").trim().toLowerCase();
  const subject = String(b.subject ?? "").trim();
  const text = String(b.text ?? "");
  const requestId = typeof b.request_id === "string" ? b.request_id : null;
  if (!EMAIL.test(to)) return err("Give one valid recipient.");
  if (!subject || subject.length > 200) return err("Give a subject under 200 characters.");
  if (text.length < 20 || text.length > 20000) return err("Give a body between 20 and 20,000 characters.");

  const sent = await sendAsJared(db, { to: [to], subject, text, key: requestId ? `vendor-${requestId}` : undefined });
  if (!sent.ok) return err(`The mail service refused it: ${sent.error}`, 502);
  const body = { id: sent.id };

  if (requestId) {
    await db.from("vendor_requests").update({
      status: "sent", sent_at: new Date().toISOString(), provider_message_id: body?.id ?? null,
      next_check_at: new Date(Date.now() + 2 * 864e5).toISOString(),
    }).eq("id", requestId);
  }
  return ok({ message_id: body?.id ?? null, to, subject });
});
