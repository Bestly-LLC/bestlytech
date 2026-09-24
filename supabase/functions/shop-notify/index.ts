// shop-notify — the customer's emails: confirmed, shipped, refunded, cancelled,
// and (v5) the one abandoned-checkout reminder.
//
// One outbox row per (order, kind) or (abandoned checkout, kind) in
// shop_notifications. A database trigger enqueues the row and nudges this
// function; a 5-minute sweeper retries what the nudge did not deliver. This
// function is the only thing that talks to Resend for shop mail, and it is
// deliberately separate from the newsletter pipeline (different sender, no
// unsubscribe token, no cross-product templates).
//
// Body:  { notification_id }                  send one row
//        { sweep: true }                      retry queued/failed rows, attempts < 5
//        { order_id, kind, resend:true }      re-queue and send (admin "Resend email")
//        { abandoned_id, resend:true }        re-queue and send the reminder
// Auth:  Authorization: Bearer <service_role_key>, or x-shop-key
//
// Idempotency-Key on the Resend call is <row id>:<attempt>, so a nudge and a
// sweep landing on the same row in the same second cannot mail twice.
//
// v8 (12 Sep 2026): branded shell. Order emails are headed by the bottle
// outline (brand_settings.email_mark_url) standing alone above the card and
// signed off with the lockup; everything else is headed by the lockup
// (email_logo_url). Each template also supplies a preheader -- the line the
// inbox shows beside the subject -- which previously defaulted to the logo's
// alt text.
//
// v5 (12 Sep 2026): kind 'abandoned'. The row's parent is a
// shop_abandoned_checkouts record instead of an order; the template is a
// single plain reminder with the Stripe recovery link — no discount, no
// claims, nothing the copy rules would refuse.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

// Inbound key (2026-09-24): no key literal in this file. Vault holds only sha256
// fingerprints (shop_key_sha256, plus shop_key_prev_sha256 while callers move
// over); edge_key_ok() (service-role only) checks them.
const __keyDb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
async function keyOk(k: string | null | undefined): Promise<boolean> {
  if (!k) return false;
  for (const n of ["shop_key_sha256", "shop_key_prev_sha256"]) {
    const { data } = await __keyDb.rpc("edge_key_ok", { p_name: n, p_key: k });
    if (data === true) return true;
  }
  return false;
}
const MAX_ATTEMPTS = 5;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-shop-key",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const makeDb = (url: string, key: string) => createClient(url, key);
type Db = ReturnType<typeof makeDb>;
type Row = Record<string, unknown>;

const esc = (s: unknown) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (c: unknown, cur = "usd") => {
  const n = Number(c ?? 0) / 100;
  const sym = cur.toLowerCase() === "usd" ? "$" : cur.toUpperCase() + " ";
  return sym + n.toFixed(2);
};
const dateLong = (iso: unknown) => {
  const d = new Date(String(iso ?? ""));
  return isNaN(d.getTime()) ? "" :
    d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
};

function trackingUrl(carrier: string, tracking: string): string {
  const c = carrier.toLowerCase(), t = encodeURIComponent(tracking);
  if (c.includes("ups"))   return `https://www.ups.com/track?tracknum=${t}`;
  if (c.includes("usps"))  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${t}`;
  if (c.includes("fedex")) return `https://www.fedex.com/fedextrack/?trknbr=${t}`;
  if (c.includes("dhl"))   return `https://www.dhl.com/us-en/home/tracking.html?tracking-id=${t}`;
  return "";
}

// ---------- templates ----------------------------------------------------

interface Ctx {
  brand: Row; tenant: Row; order: Row; items: Row[]; kind: string;
}

// Order emails are led by the bottle outline, standing on its own above the
// card: at the moment someone opens a receipt they are looking for the thing
// they bought, not for a brand. Everything else is led by the lockup, which
// carries the name. Whichever mark heads the email, the other signs it off, so
// the name is always somewhere on the page.
const ORDER_KINDS = new Set(["confirmed", "shipped", "cancelled", "refunded"]);

function shell(ctx: Ctx, title: string, bodyHtml: string, preheader = ""): string {
  const b = ctx.brand;
  const ink = esc(b.color_ink ?? "#25301f");
  const paper = esc(b.color_paper ?? "#f6f2ea");
  const muted = "#6a7164";
  const hair = "#e9e3d6";
  const name = esc(b.display_name ?? ctx.tenant.display_name ?? "");
  const site = `https://${ctx.tenant.domain}`;

  const lockupUrl = b.email_logo_url ? esc(String(b.email_logo_url)) : "";
  const markUrl = b.email_mark_url ? esc(String(b.email_mark_url)) : lockupUrl;
  const wordmark = `<span style="font-family:Georgia,'Times New Roman',serif;font-size:25px;letter-spacing:.2em;color:${ink}">${name}</span>`;

  const lockupImg = (w: number) => lockupUrl
    ? `<img src="${lockupUrl}" alt="${name}" width="${w}" style="width:${w}px;max-width:${w}px;height:auto;border:0;display:block;margin:0 auto">`
    : wordmark;

  const bottleLed = ORDER_KINDS.has(ctx.kind) && !!markUrl;

  // A mark alone at the top, centred, with room around it. The header is a
  // link so the whole thing behaves like a letterhead.
  const header = bottleLed
    ? `<img src="${markUrl}" alt="${name}" width="52" style="width:52px;max-width:52px;height:auto;border:0;display:block;margin:0 auto">`
    : lockupImg(148);

  // The sign-off carries whichever mark the header did not.
  const signoff = bottleLed ? lockupImg(104) : "";

  const addr = [b.address_line1, b.address_line2].filter(Boolean).map(esc).join(", ") +
    `, ${esc(b.address_city)}, ${esc(b.address_state)} ${esc(b.address_zip)}`;
  const support = esc(b.support_email ?? "");

  // The line the inbox shows next to the subject. Without it, clients fall back
  // to whatever text comes first -- usually the alt text of the logo.
  const pre = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preheader)}` +
      `${"&#8203;&nbsp;".repeat(60)}</div>`
    : "";

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(title)}</title>
<style>:root{color-scheme:light;supported-color-schemes:light}
a{color:${ink}}
@media (max-width:600px){.card{padding:26px 22px 24px 22px!important}.gut{padding:28px 14px!important}}</style></head>
<body style="margin:0;padding:0;background:${paper};-webkit-font-smoothing:antialiased;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI',Helvetica,Arial,sans-serif;color:${ink}">
${pre}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${paper}" style="background:${paper}">
<tr><td align="center" class="gut" style="padding:40px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:552px">
  <tr><td align="center" style="padding:0 0 26px 0">
    <a href="${site}" style="text-decoration:none;border:0">${header}</a>
  </td></tr>
  <tr><td class="card" bgcolor="#ffffff" style="background:#ffffff;border-radius:16px;padding:34px 32px 30px 32px;font-size:15.5px;line-height:1.6;color:${ink}">
    ${bodyHtml}
  </td></tr>
  ${signoff ? `<tr><td align="center" style="padding:30px 0 0 0">${signoff}</td></tr>` : ""}
  <tr><td align="center" style="padding:${signoff ? "18px" : "28px"} 10px 0 10px">
    <div style="height:1px;line-height:1px;font-size:0;background:${hair};margin:0 0 16px 0">&nbsp;</div>
    <div style="font-size:12px;line-height:1.65;color:${muted}">
      ${esc(b.legal_name ?? name)} · ${addr}<br>
      Questions? Reply to this email or write to
      <a href="mailto:${support}" style="color:${muted};text-decoration:underline">${support}</a>.
    </div>
  </td></tr>
</table></td></tr></table></body></html>`;
}

function itemsTable(ctx: Ctx, opts: { totalsOnly?: "subtotal" } = {}): string {
  const o = ctx.order, cur = String(o.currency ?? "usd");
  const rows = ctx.items.map((i) => `
    <tr>
      <td style="padding:8px 0;border-bottom:1px solid #eeeae2">${esc(i.description ?? i.sku)}
        <span style="color:#6a7164"> × ${esc(i.qty)}</span></td>
      <td align="right" style="padding:8px 0;border-bottom:1px solid #eeeae2;white-space:nowrap">${money(Number(i.unit_price_cents) * Number(i.qty), cur)}</td>
    </tr>`).join("");
  const line = (label: string, val: string, bold = false) =>
    `<tr><td style="padding:4px 0;color:${bold ? "inherit" : "#6a7164"};${bold ? "font-weight:600" : ""}">${label}</td>
     <td align="right" style="padding:4px 0;white-space:nowrap;${bold ? "font-weight:600" : ""}">${val}</td></tr>`;
  if (opts.totalsOnly === "subtotal") {
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
      ${rows}
      <tr><td colspan="2" style="height:8px"></td></tr>
      ${line("Subtotal", money(o.subtotal_cents, cur), true)}
      ${line("Shipping and any tax", "worked out at checkout")}
    </table>`;
  }
  const disc = Number(o.discount_cents ?? 0), ship = Number(o.shipping_cents ?? 0), tax = Number(o.tax_cents ?? 0);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
    ${rows}
    <tr><td colspan="2" style="height:8px"></td></tr>
    ${line("Subtotal", money(o.subtotal_cents, cur))}
    ${disc ? line(`Discount${o.promo_code ? ` (${esc(o.promo_code)})` : ""}`, "−" + money(disc, cur)) : ""}
    ${line("Shipping", ship ? money(ship, cur) : "Free")}
    ${tax ? line("Tax", money(tax, cur)) : ""}
    ${line("Total", money(o.total_cents, cur), true)}
  </table>`;
}

function addressBlock(ctx: Ctx): string {
  const o = ctx.order;
  const lines = [o.customer_name, o.ship_line1, o.ship_line2,
    [o.ship_city, o.ship_state].filter(Boolean).join(", ") + " " + (o.ship_postal ?? "")]
    .map((x) => String(x ?? "").trim()).filter(Boolean);
  return lines.map(esc).join("<br>");
}

function render(ctx: Ctx): { subject: string; html: string; text: string } {
  const o = ctx.order, b = ctx.brand;
  const name = String(b.display_name ?? "");
  const num = String(o.order_number ?? "");
  const first = String(o.customer_name ?? "").trim().split(/\s+/)[0] || "there";
  // The brand accent (a light gold) does not clear AA as text on white, so
  // links and the button use the ink colour instead.
  const accent = esc(b.color_ink ?? "#222");
  const viewUrl = `https://${ctx.tenant.domain}/?order=done&s=${encodeURIComponent(String(o.external_id ?? ""))}`;
  const btn = (href: string, label: string) =>
    `<p style="margin:26px 0 2px 0"><a href="${href}" style="display:inline-block;background:${accent};color:#ffffff;text-decoration:none;padding:14px 26px;border-radius:980px;font-weight:600;font-size:15px;line-height:1">${label}</a></p>`;
  const h1 = (t: string) => `<h1 style="margin:0 0 12px 0;font-size:25px;font-weight:600;line-height:1.22;letter-spacing:-.015em">${t}</h1>`;
  const p = (t: string) => `<p style="margin:0 0 15px 0">${t}</p>`;
  const h2 = (t: string) => `<p style="margin:28px 0 10px 0;font-size:11.5px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#6a7164">${t}</p>`;
  const small = (t: string) => `<p style="margin:22px 0 0 0;font-size:12.5px;line-height:1.55;color:#6a7164">${t}</p>`;

  if (ctx.kind === "abandoned") {
    // One reminder, no incentive, no claims. The recovery URL is Stripe's own
    // and reopens the same cart; it is valid for 30 days from expiry.
    const url = esc(String(o.recovery_url ?? `https://${ctx.tenant.domain}/`));
    const subject = `You left something in your ${name} cart`;
    const html = shell(ctx, subject,
      h1(`Still thinking it over, ${esc(first)}?`) +
      p(`Your cart is saved. Pick up where you left off — it takes about a minute.`) +
      h2("In your cart") + itemsTable(ctx, { totalsOnly: "subtotal" }) +
      btn(url, "Finish checkout") +
      small(`This is the only reminder we'll send about this cart. The link works for 30 days. If you already ordered, you can ignore this email.`),
      `Your cart is saved — pick up where you left off.`);
    const text = `Still thinking it over, ${first}?\n\nYour ${name} cart is saved:\n` +
      ctx.items.map((i) => `${i.description ?? i.sku} x ${i.qty}`).join("\n") +
      `\n\nFinish checkout: ${String(o.recovery_url ?? "")}\n\nThis is the only reminder we'll send about this cart. The link works for 30 days. If you already ordered, ignore this email.`;
    return { subject, html, text };
  }

  if (ctx.kind === "confirmed") {
    const subject = `${name} order ${num} confirmed`;
    const html = shell(ctx, subject,
      h1(`Thanks, ${esc(first)}.`) +
      p(`We've got your order <b>${esc(num)}</b> from ${esc(dateLong(o.placed_at))}. We'll email you again the moment it ships.`) +
      h2("Your order") + itemsTable(ctx) +
      h2("Shipping to") + p(addressBlock(ctx)) +
      btn(viewUrl, "View your order"),
      `Order ${num} · we'll email you again the moment it ships.`);
    const text = `Thanks, ${first}.\n\nWe've got your order ${num}. We'll email you again when it ships.\n\n` +
      ctx.items.map((i) => `${i.description ?? i.sku} x ${i.qty}`).join("\n") +
      `\n\nTotal ${money(o.total_cents, String(o.currency ?? "usd"))}\n\n${viewUrl}`;
    return { subject, html, text };
  }

  if (ctx.kind === "shipped") {
    const carrier = String(o.carrier ?? "").trim(), tracking = String(o.tracking ?? "").trim();
    const turl = trackingUrl(carrier, tracking);
    const subject = `Your ${name} order is on its way`;
    const trackLine = tracking
      ? p(`${carrier ? esc(carrier.toUpperCase()) + " tracking: " : "Tracking: "}${turl ? `<a href="${turl}" style="color:${accent}">${esc(tracking)}</a>` : `<b>${esc(tracking)}</b>`}`)
      : p("No tracking number was provided for this shipment.");
    const html = shell(ctx, subject,
      h1(`It's on the way, ${esc(first)}.`) +
      p(`Order <b>${esc(num)}</b> shipped ${esc(dateLong(o.shipped_at))}.`) + trackLine +
      h2("What's in the box") + itemsTable(ctx) +
      h2("Shipping to") + p(addressBlock(ctx)) +
      btn(turl || viewUrl, turl ? "Track your package" : "View your order"),
      `Order ${num} has left us${carrier ? ` with ${carrier.toUpperCase()}` : ""}.`);
    const text = `It's on the way, ${first}.\n\nOrder ${num} shipped.` +
      (tracking ? `\n${carrier ? carrier.toUpperCase() + " " : ""}tracking: ${tracking}${turl ? "\n" + turl : ""}` : "") +
      `\n\n${viewUrl}`;
    return { subject, html, text };
  }

  const amt = money(o.refunded_cents, String(o.currency ?? "usd"));
  if (ctx.kind === "cancelled") {
    const subject = `${name} order ${num} cancelled`;
    const html = shell(ctx, subject,
      h1(`Order ${esc(num)} has been cancelled.`) +
      p(Number(o.refunded_cents) > 0
        ? `A refund of <b>${amt}</b> has been issued to your original payment method. Banks usually show it within 5–10 business days.`
        : `Nothing was charged.`) +
      h2("Order") + itemsTable(ctx),
      Number(o.refunded_cents) > 0 ? `A refund of ${amt} is on its way back to you.` : `Nothing was charged.`);
    return { subject, html, text: `Order ${num} has been cancelled.` + (Number(o.refunded_cents) > 0 ? ` A refund of ${amt} has been issued.` : "") };
  }

  // refunded (full or partial)
  const partial = String(o.status) === "partially_refunded";
  const subject = `${partial ? "Partial refund" : "Refund"} issued for ${name} order ${num}`;
  const html = shell(ctx, subject,
    h1(`${partial ? "A partial refund" : "Your refund"} is on its way.`) +
    p(`We've refunded <b>${amt}</b> for order <b>${esc(num)}</b> to your original payment method. Banks usually show it within 5–10 business days.`) +
    h2("Order") + itemsTable(ctx),
    `${amt} is on its way back to your original payment method.`);
  return { subject, html, text: `We've refunded ${amt} for order ${num} to your original payment method.` };
}

// ---------- sending ------------------------------------------------------

async function sendOne(db: Db, n: Row): Promise<Row> {
  const attempt = Number(n.attempts ?? 0) + 1;
  const fail = async (err: string, terminal = false) => {
    await db.from("shop_notifications").update({
      attempts: attempt, status: terminal ? "skipped" : "failed", error: err.slice(0, 500),
    }).eq("id", n.id);
    return { id: n.id, ok: false, error: err };
  };

  // The parent is an order, or — for the reminder — an abandoned checkout
  // shaped like enough of an order for the shared templates to render.
  let order: Row | null = null;
  let items: Row[] = [];
  if (String(n.kind) === "abandoned") {
    const { data: a } = await db.from("shop_abandoned_checkouts").select("*").eq("id", n.abandoned_id).maybeSingle();
    if (!a) return fail("abandoned checkout not found", true);
    if (a.recovered_at) return fail("already recovered — not sending", true);
    order = { ...a, external_id: a.session_id, order_number: "", total_cents: a.subtotal_cents };
    items = Array.isArray(a.items) ? (a.items as Row[]) : [];
  } else {
    const { data: o } = await db.from("shop_orders").select("*").eq("id", n.order_id).maybeSingle();
    if (!o) return fail("order not found", true);
    order = o;
    const { data: its } = await db.from("shop_order_items").select("sku,description,qty,unit_price_cents")
      .eq("order_id", n.order_id).order("id", { ascending: true });
    items = its ?? [];
  }

  const { data: brand } = await db.from("brand_settings").select("*").eq("brand", n.brand).maybeSingle();
  const { data: tenant } = await db.from("tenants").select("*").eq("brand", n.brand).maybeSingle();
  if (!brand || !tenant) return fail("brand_settings or tenants row missing", true);
  if (!brand.mail_from_domain) return fail("brand_settings.mail_from_domain is not set", true);
  if (!n.to_email) return fail("no recipient", true);

  const ctx: Ctx = { brand, tenant, order: order!, items, kind: String(n.kind) };
  const mail = render(ctx);
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return fail("RESEND_API_KEY is not set");

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`, "Content-Type": "application/json",
      "Idempotency-Key": `shop-notify/${n.id}/${attempt}`,
    },
    body: JSON.stringify({
      from: `${brand.display_name} <orders@${brand.mail_from_domain}>`,
      to: [String(n.to_email)],
      reply_to: brand.support_email || undefined,
      subject: mail.subject, html: mail.html, text: mail.text,
      tags: [{ name: "brand", value: String(n.brand) }, { name: "kind", value: String(n.kind) }],
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return fail(`resend ${r.status}: ${body?.message ?? JSON.stringify(body).slice(0, 200)}`);

  await db.from("shop_notifications").update({
    attempts: attempt, status: "sent", provider_id: body?.id ?? null, error: null, sent_at: new Date().toISOString(),
  }).eq("id", n.id);
  return { id: n.id, ok: true, provider_id: body?.id, to: n.to_email, kind: n.kind };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  const svcKey = SB_SECRET;
  const ok = isSvc(req) || await keyOk(req.headers.get("x-shop-key"));
  if (!ok) return json({ error: "Unauthorized" }, 401);

  const db = makeDb(Deno.env.get("SUPABASE_URL")!, svcKey);
  let body: Row = {};
  try { body = await req.json(); } catch { /* empty ok */ }

  try {
    // Resend the abandoned-cart reminder (admin, or a test send).
    if (body.resend && body.abandoned_id) {
      const { data: a } = await db.from("shop_abandoned_checkouts").select("id,brand,email").eq("id", String(body.abandoned_id)).maybeSingle();
      if (!a) return json({ error: "abandoned checkout not found" }, 404);
      if (body.brand && String(body.brand) !== a.brand) return json({ error: "not found for this brand" }, 404);
      const { data: n, error } = await db.from("shop_notifications")
        .upsert({ brand: a.brand, abandoned_id: a.id, kind: "abandoned", to_email: a.email, status: "queued", error: null },
                { onConflict: "abandoned_id,kind" })
        .select("*").single();
      if (error) throw error;
      return json({ ok: true, result: await sendOne(db, n) });
    }

    if (body.resend && body.order_id && body.kind) {
      const { data: o } = await db.from("shop_orders").select("id,brand,email").eq("id", String(body.order_id)).maybeSingle();
      if (!o) return json({ error: "order not found" }, 404);
      if (body.brand && String(body.brand) !== o.brand) return json({ error: "order not found for this brand" }, 404);
      if (!o.email) return json({ error: "order has no email address" }, 400);
      const kind = String(body.kind);
      if (!["confirmed", "shipped", "refunded", "cancelled"].includes(kind)) return json({ error: "bad kind" }, 400);
      const { data: n, error } = await db.from("shop_notifications")
        .upsert({ brand: o.brand, order_id: o.id, kind, to_email: o.email, status: "queued", error: null },
                { onConflict: "order_id,kind" })
        .select("*").single();
      if (error) throw error;
      return json({ ok: true, result: await sendOne(db, n) });
    }

    if (body.notification_id) {
      const { data: n } = await db.from("shop_notifications").select("*")
        .eq("id", String(body.notification_id)).in("status", ["queued", "failed"]).maybeSingle();
      if (!n) return json({ ok: true, skipped: "not pending" });
      return json({ ok: true, result: await sendOne(db, n) });
    }

    if (body.sweep) {
      // Leave the freshest rows to their nudge; only pick up what it missed.
      const cutoff = new Date(Date.now() - 60_000).toISOString();
      const { data: rows } = await db.from("shop_notifications").select("*")
        .in("status", ["queued", "failed"]).lt("attempts", MAX_ATTEMPTS).lt("created_at", cutoff)
        .order("created_at", { ascending: true }).limit(25);
      const results: Row[] = [];
      for (const n of rows ?? []) results.push(await sendOne(db, n));
      return json({ ok: true, swept: results.length, results });
    }

    return json({ error: "notification_id, sweep, or resend required" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message ?? String(err) }, 500);
  }
});
