// Jared's Bestly email signature, shared by everything that sends mail as him (2026-10-06).
//
// It mirrors the "Bestly" signature in Apple Mail on the Mac mini: the animated GIF headshot (72x72, shown at 64x64)
// beside name, title, email, phone, site and LinkedIn. The GIF lives in claims_assets as 'jared-signature.gif'
// (base64) and rides as an inline attachment (cid:jared-sig), so it shows in Gmail, Apple Mail and Outlook without
// loading a remote image. Claims Closer had its own copy first; Scout (send_email) and bestly-send-mail use this one.
//
// If the GIF can't be read, the mail still goes out with the text signature (never a broken image).

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any };

export const SENDER = "Jared Best <jared@bestly.tech>";
export const SIG_TEXT = "\n\n--\nJared Best\nPrincipal Consultant · Bestly\njared@bestly.tech · (816) 500-7236\nbestly.tech · linkedin.com/in/bestjared";

export const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function sigHtml(hasGif: boolean): string {
  const a = (h: string, t: string) => `<a href="${h}" style="color:#0a66c2;text-decoration:none">${t}</a>`;
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:18px"><tr>`
    + (hasGif ? `<td style="padding-right:12px;vertical-align:top"><img src="cid:jared-sig" width="64" height="64" alt="Jared Best" style="display:block;width:64px;height:64px;border:0"></td>` : "")
    + `<td style="font:13px/1.45 -apple-system,Helvetica,Arial,sans-serif;color:#1d1d1f;vertical-align:top"><div style="font-weight:600">Jared Best</div>`
    + `<div>Principal Consultant &middot; Bestly</div><div>${a("mailto:jared@bestly.tech", "jared@bestly.tech")} &middot; ${a("tel:+18165007236", "(816)&nbsp;500-7236")}</div>`
    + `<div>${a("https://bestly.tech", "bestly.tech")} &middot; ${a("https://linkedin.com/in/bestjared", "linkedin.com/in/bestjared")}</div></td></tr></table>`;
}

let cached: { b64: string | null; at: number } | null = null;
/** The headshot GIF as base64, cached for 10 minutes per instance. */
export async function signatureGif(db: Db): Promise<string | null> {
  if (cached && Date.now() - cached.at < 600_000) return cached.b64;
  try {
    const { data } = await db.from("claims_assets").select("b64").eq("name", "jared-signature.gif").maybeSingle();
    cached = { b64: (data?.b64 as string | undefined) ?? null, at: Date.now() };
  } catch {
    cached = { b64: null, at: Date.now() };
  }
  return cached.b64;
}

/** Plain text in, Bestly HTML out: paragraphs on blank lines, line breaks kept, signature underneath. */
export function bodyHtml(text: string, hasGif: boolean, signed = true): string {
  const paras = text.trim().split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  return `<div style="font:15px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#1d1d1f">${paras}${signed ? sigHtml(hasGif) : ""}</div>`;
}

export type Attachment = { filename: string; content: string; content_id?: string; content_type?: string };

/**
 * Send one email as Jared through Resend, signature included. Jared is bcc'd so it lands in his mailbox (and
 * bestly_mail) like anything he sends himself; replies go to jared@bestly.tech.
 * Spam Desk reports (2026-10-07) go out plain: signature:false drops the signature and GIF, bcc:false keeps the
 * report copies out of his inbox. Both default to true, so every other caller is unchanged.
 */
export async function sendAsJared(db: Db, o: {
  to: string[]; cc?: string[]; subject: string; text: string; key?: string; attachments?: Attachment[];
  signature?: boolean; bcc?: boolean;
}): Promise<{ ok: boolean; id?: string; error?: string; signature: "gif" | "text" }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set on this project", signature: "text" };
  const signed = o.signature !== false;
  const gif = signed ? await signatureGif(db) : null;
  const attachments = [...(o.attachments ?? []), ...(gif ? [{ filename: "jared.gif", content: gif, content_id: "jared-sig" }] : [])];
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
  if (o.key) headers["Idempotency-Key"] = o.key.slice(0, 256);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: SENDER, to: o.to, ...(o.cc?.length ? { cc: o.cc } : {}), ...(o.bcc === false ? {} : { bcc: ["jared@bestly.tech"] }), reply_to: "jared@bestly.tech",
      subject: o.subject, text: signed ? o.text.trim() + SIG_TEXT : o.text.trim(),
      html: bodyHtml(o.text, !!gif, signed), attachments,
    }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ message: String(e) }) }) as unknown as Response);
  const j = await r.json().catch(() => ({}));
  return r.ok
    ? { ok: true, id: j?.id, signature: gif ? "gif" : "text" }
    : { ok: false, error: `Resend ${r.status}: ${JSON.stringify(j).slice(0, 200)}`, signature: gif ? "gif" : "text" };
}
