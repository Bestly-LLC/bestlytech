// studio-recover — the way back in when a passkey is gone.
//
// Two doors, both anonymous by necessity: the person asking has no session.
//
//   start   {who}     who = staff name or email. Always answers the same,
//                     whether or not that person exists, so the endpoint
//                     cannot be used to find out who works here.
//   redeem  {token}   spends one of the link's uses and returns a one-hour
//                     enrolment code, so the browser goes straight into the
//                     passkey ceremony with nothing to type.
//   invite  {staff_token, staff_slug}   a colleague sends the same link, worded
//                     as an invitation and good for seven days.
//   invite_client {staff_token, slug}   emails a client their board and guide
//                     link — the link is their credential, so this IS sign-up.
//
// A link is worth exactly what an enrolment code is worth: permission to
// register a NEW passkey. It grants no session and no data. The mailbox is the
// second factor — the same trust as a code handed over in person, minus the
// person. It stands up a few browsers inside its own window, because one
// person signs in from more than one of them.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const APP = "https://studio.bestly.tech";
const FROM = "Bestly Studio <studio@bestly.tech>";

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// One look for every email Bestly Studio sends: the site's lockup up top,
// a white card, one action, a quiet footer. Inline styles only — that is
// what mail clients honour.
/* The mark, at a URL that changes when the mark changes. Pointing at
   /studio-icon-192.png looked right and was wrong: Gmail proxies and caches
   an image by URL more or less forever, so a mailbox that had seen the old
   mark kept showing it. Bump this hash whenever the mark is redrawn. */
const LOGO = "https://rcqfqhguwpmaarseifqg.supabase.co/storage/v1/object/public/review/app/studio-icon-192.b34da1b5e8.png";
const FONT = "-apple-system,BlinkMacSystemFont,'SF Pro Text','Helvetica Neue',Helvetica,Arial,sans-serif";
function layout(opts: { title: string; intro?: string; body: string; cta?: { href: string; label: string }; note?: string; footer?: string }): string {
  const { title, intro, body, cta, note, footer } = opts;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#F5F5F7;-webkit-font-smoothing:antialiased">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F5F5F7"><tr><td align="center" style="padding:36px 16px 48px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px">
  <tr><td style="padding:0 6px 18px">
    <table role="presentation" cellspacing="0" cellpadding="0"><tr>
      <td style="vertical-align:middle;padding-right:10px"><img src="${LOGO}" width="28" height="28" alt="" style="display:block;width:28px;height:28px;border-radius:7px"></td>
      <td style="vertical-align:middle;font:600 17px/1 ${FONT};letter-spacing:-.01em;color:#1D1D1F">Bestly <span style="font-weight:400;color:#A1A1A6;padding:0 5px">|</span><span style="font-weight:500;color:#1F7F77">Studio</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="background:#FFFFFF;border-radius:18px;padding:34px 34px 30px;box-shadow:0 1px 2px rgba(0,0,0,.04),0 10px 30px -18px rgba(0,0,0,.18)">
    <h1 style="margin:0 0 ${intro ? "10px" : "18px"};font:600 24px/1.25 ${FONT};letter-spacing:-.02em;color:#1D1D1F">${esc(title)}</h1>
    ${intro ? `<p style="margin:0 0 20px;font:400 15px/1.55 ${FONT};color:#6E6E73">${esc(intro)}</p>` : ""}
    <div style="font:400 15.5px/1.6 ${FONT};color:#1D1D1F">${body}</div>
    ${cta ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 8px"><tr><td style="border-radius:12px;background:#1F7F77"><a href="${esc(cta.href)}" style="display:inline-block;padding:14px 24px;font:600 15px/1 ${FONT};color:#FFFFFF;text-decoration:none;border-radius:12px">${esc(cta.label)}</a></td></tr></table>` : ""}
    ${note ? `<p style="margin:16px 0 0;font:400 13px/1.55 ${FONT};color:#6E6E73">${note}</p>` : ""}
  </td></tr>
  <tr><td style="padding:18px 8px 0;font:400 12px/1.6 ${FONT};color:#A1A1A6;text-align:center">${footer ?? "Bestly Studio · the review desk behind your posts"}</td></tr>
</table></td></tr></table></body></html>`;
}
const p = (s: string) => `<p style="margin:0 0 14px">${s}</p>`;

function body(name: string, link: string) {
  const text =
`${name},

Here is your link to set up Bestly Studio on this device:

${link}

Open it on the device you want to sign in from — it asks for Face ID, Touch ID or your screen lock, and that becomes your new passkey.

When it asks where to keep the passkey, choose iCloud Keychain: that one passkey then works in Safari, Chrome and on your phone. A passkey saved into one browser's own password manager only ever works in that browser.

The link expires in 30 minutes and will set up several browsers inside that window.

If you did not ask for this, ignore it. Nobody can get in without the link, and nothing has changed on your account.`;
  const html = layout({
    title: "Set up this device",
    intro: `${name}, here is your way back in.`,
    body: p("Open the button on the device you want to sign in from. It asks for Face ID, Touch ID or your screen lock — that becomes your new passkey.")
      + p("When it asks <b>where to keep the passkey</b>, choose <b>iCloud Keychain</b>. That one passkey then works in Safari, Chrome and on your phone. A passkey saved into a single browser's own password manager only ever works in that browser.")
      + p("The link expires in 30 minutes, and will set up several browsers inside that window."),
    cta: { href: link, label: "Set up this device" },
    note: "If you did not ask for this, ignore it. Nobody can get in without the link, and nothing has changed on your account.",
  });
  return { text, html };
}

async function sendMail(key: string, to: string, subject: string, text: string, html: string): Promise<boolean> {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, html }),
  });
  if (!r.ok) console.error("resend", r.status, (await r.text()).slice(0, 200));
  return r.ok;
}

function inviteBody(name: string, by: string, link: string, tier: string) {
  const text =
`${name},

${by} added you to Bestly Studio${tier}.

Open this on the phone or computer you will work from:

${link}

It asks for Face ID, Touch ID or your screen lock — that becomes your sign-in on that device. Choose iCloud Keychain when it asks where to keep it, and the same passkey works in Safari, Chrome and on your phone.

The link is good for seven days and will set up several browsers.`;
  const html = layout({
    title: `${by} added you to Bestly Studio`,
    intro: `${name}, you are in${tier}.`,
    body: p("Open the button on the phone or computer you will work from. It asks for Face ID, Touch ID or your screen lock — that becomes your sign-in on that device. No password, nothing to remember.")
      + p("When it asks <b>where to keep the passkey</b>, choose <b>iCloud Keychain</b> — the same passkey then works in Safari, Chrome and on your phone.")
      + p("The link is good for seven days and will set up several browsers."),
    cta: { href: link, label: "Set up this device" },
    note: "To add another device later, sign in and mint a code under Settings › People.",
  });
  return { text, html };
}
function clientBody(contact: string, client: string, by: string, board: string, guide: string) {
  const text =
`${contact},

Your ${client} workspace is open. It starts with one thing: your brand guide.

${guide}

It is about twenty minutes, one question per screen. You can talk instead of type — tap the mic on your keyboard and just say it — skip anything, and come back later. It saves as you go.

At the bottom of every screen there is a line: using this means you agree to our terms. They are short and in plain English, and they cover how we work together, exactly how we use AI to draft your content, who owns what, and what we do not promise. The link opens them, and they stay in Settings. Any line you do not like, say so and we will change it.

Two things to send while you are in there:

1. The cards. The question called "What you sell" takes photographs — the card fronts you used in the Still Here flyer are exactly right, plus any others you have, the box front and back, the deck fanned out. The more cards we have, the less we have to invent.
2. Everything else. The last question is a place to drop the lot: flyers, headshots, event photos, graphics a designer made for you, screenshots of posts that felt right. Send it all.

And the one thing I cannot do from my side — please add me back under user management on:

- TikTok Shop
- Amazon Seller Central
- Shopify

Same as the invites I sent before. Each one has a proper "invite a user" screen, so you never send me a password. Happy to do all three with you on a screen share if it is quicker — it is fiddly in all three.

The posts, the calendar and the recording requests are switched off for now. They turn on the moment your guide is in and I have something worth showing you.

Keep this email: the link is your key. Nothing to sign up for, no password.`;
  const html = layout({
    title: `Your ${client} workspace is open`,
    intro: `${contact}, it starts with one thing — your brand guide. About twenty minutes, one question per screen.`,
    body:
        p("You can talk instead of type: tap the mic on your phone keyboard and just say it. Skip anything, come back later, it saves as you go.")
      + p("At the bottom of every screen there is a line: using this means you agree to <b>our terms</b>. They are short and in plain English, and they cover how we work together, exactly how we use AI to draft your content, who owns what, and what we do not promise. The link opens them, and they stay in Settings. Any line you do not like, say so and we will change it.")
      + p("<b>Two things to send while you are in there:</b>")
      + `<ol style="margin:0 0 14px;padding-left:22px">
           <li style="margin-bottom:8px"><b>The cards.</b> The question called <i>What you sell</i> takes photographs — the card fronts you used in the <i>Still Here</i> flyer are exactly right, plus any others you have, the box front and back, the deck fanned out. The more cards we have, the less we have to invent.</li>
           <li><b>Everything else.</b> The last question is a place to drop the lot: flyers, headshots, event photos, graphics a designer made for you, screenshots of posts that felt right. Send it all.</li>
         </ol>`
      + p("And the one thing I cannot do from my side — please add me back under <b>user management</b> on <b>TikTok Shop</b>, <b>Amazon Seller Central</b> and <b>Shopify</b>. Same as the invites I sent before; each has a proper “invite a user” screen, so you never send me a password. Happy to do all three on a screen share if that is quicker.")
      + p("The posts, the calendar and the recording requests are switched off for now. They turn on the moment your guide is in and I have something worth showing you."),
    cta: { href: guide, label: "Start my brand guide" },
    note: "Keep this email: the link is your key. Nothing to sign up for, no password.",
  });
  return { text, html };
}

async function staffFromToken(token: string) {
  const { data: s, error } = await db.rpc("studio_resolve_staff", { p_token: token });
  const staff = (Array.isArray(s) ? s[0] : s) as Record<string, any> | null;
  if (error || !staff?.id) return null;
  return staff;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);

  let input: Record<string, any> = {};
  try { input = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }
  const action = String(input.action ?? "");

  if (action === "start") {
    const who = String(input.who ?? "").trim().slice(0, 160);
    // One answer for every case. A wrong name, a missing address and a sent
    // mail must be indistinguishable from outside.
    const same = J({ ok: true, sent: true });
    if (!who) return J({ ok: false, error: "Enter your name or email." }, 400);

    const { data, error } = await db.rpc("staff_recovery_start", { p_who: who });
    const r = data as Record<string, any>;
    if (error) { console.error("recovery_start", error.message); return same; }
    if (!r?.ok) { console.warn("recovery_start declined:", r?.error); return same; }

    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) { console.error("no RESEND_API_KEY — cannot send recovery mail"); return same; }

    const link = `${APP}/#r=${r.token}`;
    const { text, html } = body(String(r.name ?? "Hello"), link);
    const send = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [r.email], subject: "Set up Bestly Studio on this device", text, html }),
    });
    if (!send.ok) console.error("resend", send.status, (await send.text()).slice(0, 200));
    return same;
  }

  // ── colleague invites: signed-in and can_promote, or nothing ────────────
  if (action === "invite" || action === "invite_client") {
    const staff = await staffFromToken(String(input.staff_token ?? ""));
    if (!staff) return J({ ok: false, error: "not_found" }, 401);
    if (!staff.can_promote) return J({ ok: false, error: "not_permitted" }, 403);
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return J({ ok: false, error: "no_mail" }, 500);

    if (action === "invite") {
      const { data, error } = await db.rpc("staff_invite_link", { p_token: input.staff_token, p_staff_slug: String(input.staff_slug ?? "") });
      const r = data as Record<string, any>;
      if (error) return J({ ok: false, error: error.message }, 500);
      if (!r?.ok) return J(r, 400);
      const link = `${APP}/#r=${r.token}`;
      const tier = r.can_promote ? " as a producer — you can approve work and send it to clients" : " to review work";
      const { text, html } = inviteBody(String(r.name), String(r.invited_by), link, tier);
      const sent = await sendMail(key, r.email, `${r.invited_by} added you to Bestly Studio`, text, html);
      return J({ ok: sent, sent, email: r.email, error: sent ? undefined : "mail_failed" });
    }

    const { data, error } = await db.rpc("studio_client_invite_info", { p_token: input.staff_token, p_slug: String(input.slug ?? "") });
    const r = data as Record<string, any>;
    if (error) return J({ ok: false, error: error.message }, 500);
    if (!r?.ok) return J(r, 400);
    const { text, html } = clientBody(String(r.contact), String(r.client), String(r.invited_by), String(r.board_url), String(r.guide_url));
    const sent = await sendMail(key, r.email, `Your ${r.client} workspace is open`, text, html);
    return J({ ok: sent, sent, email: r.email, error: sent ? undefined : "mail_failed" });
  }

  if (action === "redeem") {
    const token = String(input.token ?? "").trim();
    const { data, error } = await db.rpc("staff_recovery_redeem", { p_token: token });
    if (error) return J({ ok: false, error: "bad_link" }, 200);
    return J(data);
  }

  return J({ ok: false, error: "unknown action" }, 400);
});
