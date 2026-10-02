// wall-badge-email — emails a guest the take-home badge they made on bestly.tech/sign.
// Auth: the guest's signing session token (from an NFC coaster tap), checked + rate limited by wall_badge_email_gate.
// One-off transactional mail: nothing is added to any list. Logged in email_send_log (template 'wall-badge');
// the wall_sign_watchdog raises a Scout incident when these fail.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders as cors } from "../_shared/cors.ts";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET);

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const MESSAGES: Record<string, string> = {
  expired: "This signing session ended. Tap a coaster to start again.",
  sign_first: "Sign the wall first, then we can send your badge.",
  limit: "Your badge is already on its way.",
  bad_email: "That email doesn't look right.",
  busy: "Lots of badges going out right now. Save it to your phone instead?",
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);

  let token = "", email = "", png = "", name = "";
  try {
    const b = await req.json();
    token = String(b.token ?? "").slice(0, 64);
    email = String(b.email ?? "").trim().toLowerCase().slice(0, 254);
    png = String(b.png ?? "").replace(/^data:image\/png;base64,/, "");
    name = String(b.name ?? "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 32);
  } catch {
    return json({ ok: false, error: "Bad request" }, 400);
  }
  if (!token || !email || !png) return json({ ok: false, error: "Missing token, email, or badge" }, 400);
  if (png.length > 2_800_000 || !png.startsWith("iVBORw0KGgo")) return json({ ok: false, error: "That badge image didn't come through." }, 400);

  const { data: gate, error: gateErr } = await sb.rpc("wall_badge_email_gate", { p_token: token, p_email: email });
  if (gateErr) return json({ ok: false, error: "Something went wrong. Try again?" }, 500);
  if (!gate?.ok) return json({ ok: false, reason: gate?.reason, error: MESSAGES[gate?.reason] ?? "Can't send that right now." }, 400);

  const { data: suppressed } = await sb.from("suppressed_emails").select("id").eq("email", email).maybeSingle();
  const messageId = crypto.randomUUID();
  if (suppressed) {
    await sb.from("email_send_log").insert({ message_id: messageId, template_name: "wall-badge", recipient_email: email, status: "suppressed" });
    return json({ ok: false, error: "That address has opted out of email from us." }, 400);
  }

  const key = Deno.env.get("RESEND_API_KEY");
  const meta = { signature_id: gate.signature_id };
  await sb.from("email_send_log").insert({ message_id: messageId, template_name: "wall-badge", recipient_email: email, status: "pending", metadata: meta });
  if (!key) {
    await sb.from("email_send_log").insert({ message_id: messageId, template_name: "wall-badge", recipient_email: email, status: "failed", error_message: "RESEND_API_KEY missing", metadata: meta });
    return json({ ok: false, error: "Email is down right now. Save it to your phone instead?" }, 503);
  }

  const hi = name ? `Hey ${esc(name)},` : "Hey there,";
  const html = `<!doctype html><html><body style="margin:0;background:#0b0714;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#fff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0714"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="font-size:15px;line-height:22px;color:#cfc6e6;padding-bottom:6px">${hi}</td></tr>
<tr><td style="font-size:26px;line-height:32px;font-weight:800;padding-bottom:10px">You signed the wall on Kings Road.</td></tr>
<tr><td style="font-size:16px;line-height:24px;color:#cfc6e6;padding-bottom:22px">Here's your badge from West Hollywood. It's attached too, so you can save it.</td></tr>
<tr><td align="center"><img src="cid:badge" alt="Your Kings Road wall badge" width="480" style="display:block;width:100%;max-width:480px;height:auto;border-radius:24px"></td></tr>
<tr><td style="font-size:12px;line-height:18px;color:#8a80a6;padding-top:24px">You asked for this one email. You're not on any list, and we won't write again.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${name ? `Hey ${name},` : "Hey there,"}\n\nYou signed the wall on Kings Road. Your West Hollywood badge is attached.\n\nYou asked for this one email. You're not on any list, and we won't write again.`;

  let ok = false, err = "";
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `wall-badge-${messageId}` },
      body: JSON.stringify({
        from: "Kings Road Wall <noreply@bestly.tech>",
        to: [email],
        subject: "Your Kings Road wall badge",
        html, text,
        attachments: [{ filename: "kings-road-badge.png", content: png, content_type: "image/png", content_id: "badge" }],
      }),
    });
    const body = await r.text();
    ok = r.ok;
    if (!ok) err = `${r.status} ${body.slice(0, 200)}`;
  } catch (e) {
    err = e instanceof Error ? e.message : String(e);
  }
  await sb.from("email_send_log").insert({
    message_id: messageId, template_name: "wall-badge", recipient_email: email,
    status: ok ? "sent" : "failed", error_message: ok ? null : err, metadata: { ...meta, provider: "resend" },
  });
  return ok ? json({ ok: true }) : json({ ok: false, error: "That didn't send. Save it to your phone instead?" }, 502);
});
