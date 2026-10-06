// Claims Closer v2: the estimate pipeline (docs/claims-closer-v2-opusplan.md phases 2, 3, 4, 7).
//
//   request   photo-estimate emails to the best-ranked shops (from jared@bestly.tech through Resend, with Jared's "Bestly" mail
//             signature, the photos attached); shops with no public email get a call from Ava asking where to send photos
//   parse     shop replies (bestly_mail, matched by the claims_shop_mail_trg trigger) -> amount, OEM, repair vs replace (free AI)
//   follow up one nudge after 24 h, an Ava call after 48 h, no_reply after 72 h (claims_watch) and the next shop is asked
//   choose    cheapest QUALITY option within 25% of the lowest; OEM / Tesla-approved quotes only when a third party pays it all
//   invoice   queue the Turo invoice (claim_turo_actions) with the estimate summary PDF + photos; the Pi reader posts it
// Free AI only (paid: "never"). Never spends Jared's money; nothing here books or pays a shop.
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

type Row = Record<string, any>;
export type Ctx = {
  db: any; llm: any; LlmUnavailable: any;
  notify: (title: string, body: string, dedupe: string, severity?: string) => Promise<void>;
  event: (c: Row, kind: string, title: string, detail?: unknown) => Promise<void>;
  fmt: (iso?: string | null) => string | null;
  money: (n: number) => string;
  supabaseUrl: string; serviceKey: string;
};

const MAIL_FROM = "Jared Best <jared@bestly.tech>";
const SLUG = "claims-closer";
const MAX_ATTACH_BYTES = 8_000_000;
const HOUR = 36e5;

// ---------------------------------------------------------------- mail (Resend) with Jared's Bestly signature
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const SIG_TEXT = "\n\n--\nJared Best\nPrincipal Consultant · Bestly\njared@bestly.tech · (816) 500-7236\nbestly.tech · linkedin.com/in/bestjared";
function sigHtml(hasGif: boolean) {
  const a = (h: string, t: string) => `<a href="${h}" style="color:#0a66c2;text-decoration:none">${t}</a>`;
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin-top:18px"><tr>`
    + (hasGif ? `<td style="padding-right:12px;vertical-align:top"><img src="cid:jared-sig" width="64" height="64" alt="Jared Best" style="display:block;width:64px;height:64px;border:0"></td>` : "")
    + `<td style="font:13px/1.45 -apple-system,Helvetica,Arial,sans-serif;color:#1d1d1f;vertical-align:top"><div style="font-weight:600">Jared Best</div>`
    + `<div>Principal Consultant &middot; Bestly</div><div>${a("mailto:jared@bestly.tech", "jared@bestly.tech")} &middot; ${a("tel:+18165007236", "(816) 500-7236")}</div>`
    + `<div>${a("https://bestly.tech", "bestly.tech")} &middot; ${a("https://linkedin.com/in/bestjared", "linkedin.com/in/bestjared")}</div></td></tr></table>`;
}

async function signatureGif(ctx: Ctx): Promise<string | null> {
  const { data } = await ctx.db.from("claims_assets").select("b64").eq("name", "jared-signature.gif").maybeSingle();
  return data?.b64 ?? null;
}

export async function sendMail(ctx: Ctx, o: { to: string; subject: string; text: string; key: string; attachments?: { filename: string; content: string }[] }):
  Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set on this project" };
  const gif = await signatureGif(ctx);
  const html = `<div style="font:15px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#1d1d1f">${o.text.split(/\n{2,}/).map((p) =>
    `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("")}${sigHtml(!!gif)}</div>`;
  const attachments = [...(o.attachments ?? []), ...(gif ? [{ filename: "jared.gif", content: gif, content_id: "jared-sig" }] : [])];
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": o.key },
    body: JSON.stringify({ from: MAIL_FROM, to: [o.to], bcc: ["jared@bestly.tech"], reply_to: "jared@bestly.tech", subject: o.subject, text: o.text + SIG_TEXT, html, attachments }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ message: String(e) }) } as any));
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, id: j?.id } : { ok: false, error: `Resend ${r.status}: ${JSON.stringify(j).slice(0, 200)}` };
}

// ---------------------------------------------------------------- Ava (personal assistant) phone calls
async function avaCall(ctx: Ctx, o: { phone: string; name: string; purpose: string; first_line: string }): Promise<{ ok: boolean; call_id?: string; error?: string }> {
  const r = await fetch(`${ctx.supabaseUrl}/functions/v1/ava-assistant`, {
    method: "POST", headers: { Authorization: `Bearer ${ctx.serviceKey}`, apikey: ctx.serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "call", ...o }),
  }).catch(() => null);
  const j = await r?.json().catch(() => ({}));
  return r?.ok && j?.ok ? { ok: true, call_id: j.call_id } : { ok: false, error: String(j?.error ?? `ava-assistant ${r?.status ?? "no answer"}`).slice(0, 200) };
}

// ---------------------------------------------------------------- shops: rank + pick
export const shopScore = (s: Row) => Number(s.rating ?? 0) * Math.log(1 + Number(s.rating_count ?? 0)) + (s.tesla_experience ? 3 : 0) - 0.5 * Number(s.distance_mi ?? 0);

async function rankShops(ctx: Ctx, settings: Row, covered: boolean, excludeIds: string[]) {
  const { data } = await ctx.db.from("claim_shops").select("*").eq("active", true).eq("photo_estimates", true);
  return ((data ?? []) as Row[])
    .filter((s) => !excludeIds.includes(s.id) && Number(s.distance_mi ?? 0) <= Number(settings.max_shop_miles ?? 15) && (covered || !s.oem_only))
    .sort((a, b) => shopScore(b) - shopScore(a));
}

// ---------------------------------------------------------------- photos for the email
async function photoAttachments(ctx: Ctx, caseId: string): Promise<{ list: { filename: string; content: string }[]; after: number; before: number }> {
  const { data } = await ctx.db.from("claim_evidence").select("kind, storage_path, bytes, taken_at").eq("case_id", caseId).order("taken_at", { ascending: true });
  const ev = (data ?? []) as Row[];
  const pick = [...ev.filter((e) => e.kind === "after").slice(0, 8), ...ev.filter((e) => e.kind === "before").slice(0, 2)];
  const list: { filename: string; content: string }[] = []; let total = 0, after = 0, before = 0;
  for (const e of pick) {
    if (total + Number(e.bytes ?? 0) > MAX_ATTACH_BYTES) continue;
    const { data: blob } = await ctx.db.storage.from("claim-evidence").download(e.storage_path);
    if (!blob) continue;
    const buf = new Uint8Array(await blob.arrayBuffer());
    total += buf.length;
    let bin = ""; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    if (e.kind === "after") after++; else before++;
    list.push({ filename: e.kind === "after" ? `damage-${after}.jpg` : `before-trip-${before}.jpg`, content: btoa(bin) });
  }
  return { list, after, before };
}

async function damageSentence(ctx: Ctx, c: Row): Promise<string> {
  const host = (c.damage_report?.answers ?? {}) as Record<string, string>;
  const raw = host["Please describe the damage to the vehicle as best you can."] ?? "";
  const src = `${raw}\n${c.facts ?? ""}`.slice(0, 1500);
  try {
    const r = await ctx.llm({ task: "write", system: "You write one plain sentence (under 45 words) describing the physical damage to a car for a body shop, from the notes. Only damage and location. No dollar amounts, no names, no blame, no mention of Turo, guests, claims or insurance. Reply ONLY JSON {\"sentence\": \"...\"}.",
      user: src, json: true, job: SLUG, ref: String(c.reservation_id), fn: SLUG, paid: "never", privacy: "private", deadlineMs: 30_000, maxTokens: 200,
      validate: (j: Row) => typeof j?.sentence === "string" && j.sentence.length > 20 && j.sentence.length < 400 && !/\$/.test(j.sentence) ? null : "bad sentence" });
    return String(r.json.sentence).trim();
  } catch (e) {
    if (!(e instanceof ctx.LlmUnavailable)) throw e;
  }
  return "new scrapes and paint damage on the passenger-side front bumper corner and the front wheel area, with the bumper cover pushed out of line with the fender";
}

const refCode = () => "CC-" + Array.from(crypto.getRandomValues(new Uint8Array(5))).map((b) => "23456789ABCDEFGHJKMNPQRSTUVWXYZ"[b % 31]).join("");
const carName = (c: Row) => (c.car ?? "2020 Tesla Model 3").replace(/\s+\(.*\)$/, "").replace(/^Tesla Model 3 2020$/, "2020 Tesla Model 3");

function requestBody(shop: Row, c: Row, damage: string, n: { after: number; before: number }, ref: string) {
  const first = String(shop.name).replace(/\s+\(.*\)$/, "");
  return `Hi ${first} team,

I'm Jared, a car-sharing host in West Hollywood. My ${carName(c)} came back from a rental with new damage: ${damage.replace(/\.$/, "")}. The car is drivable.

I attached ${n.after} photo${n.after === 1 ? "" : "s"} of the damage${n.before ? ` and ${n.before} from before the rental showing the same corner undamaged` : ""}. Could you send an itemized estimate from the photos? Please include:
- the total
- repair vs replace on the bumper cover, and paint blend
- OEM vs aftermarket parts, if replacing
- how many days you would need the car, and your earliest drop-off

The estimate goes to the driver's insurance and to Turo, so please put the total and line items in the body of your reply (a PDF is welcome too). If you would rather see the car first, tell me and I will bring it by.

Thanks,
Jared

Ref ${ref}`;
}

const AVA_PURPOSE = (c: Row) => `Ask how to send photos to get a damage estimate for a ${carName(c)}: new scrapes, a paint chip and a pushed-in bumper cover on the passenger-side front corner. Get the best email address or web form for photos, and whether they quote from photos or need to see the car (earliest walk-in time). If they can give a rough total by phone, take it with OEM vs aftermarket. Do NOT agree to work, book, or share payment details. If they want an email address for Jared, it is jared@bestly.tech. Keep it short.`;

// ---------------------------------------------------------------- request estimates
async function requestEstimates(ctx: Ctx, c: Row, settings: Row, notes: string[]) {
  const { data: have } = await ctx.db.from("claim_estimates").select("shop_id").eq("case_id", c.id);
  const asked = ((have ?? []) as Row[]).map((e) => e.shop_id);
  const want = Math.max(1, Number(settings.shops_per_request ?? 3)) - asked.length;
  if (want <= 0) return;
  const covered = !!(c.insurer?.covers_full);
  const shops = (await rankShops(ctx, settings, covered, asked)).slice(0, want);
  if (!shops.length) return;
  const photos = await photoAttachments(ctx, c.id);
  if (!photos.after) { await ctx.db.from("claim_cases").update({ next_check_at: new Date(Date.now() + 10 * 60_000).toISOString() }).eq("id", c.id); notes.push("waiting for the damage photos"); return; }
  const damage = await damageSentence(ctx, c);
  await ctx.db.from("claim_cases").update({ estimates_requested_at: new Date().toISOString() }).eq("id", c.id);
  const sent: string[] = [];
  for (const shop of shops) {
    const ref = refCode();
    const channel = shop.email ? "email" : "call";
    const { data: est } = await ctx.db.from("claim_estimates").insert({ case_id: c.id, shop_id: shop.id, channel, ref, status: "requested" }).select("*").single();
    if (!est) continue;
    if (channel === "email") {
      const subject = `Photo estimate request: ${carName(c)} bumper damage [${ref}]`;
      const r = await sendMail(ctx, { to: shop.email, subject, text: requestBody(shop, c, damage, photos, ref), key: `claims-est-${est.id}`, attachments: photos.list });
      if (r.ok) { sent.push(`${shop.name} (email)`); await ctx.event(c, "estimate_request", `Asked ${shop.name} for a photo estimate`, { shop: shop.name, channel: "email", ref, mail_id: r.id }); }
      else {
        await ctx.db.from("claim_estimates").update({ status: "no_reply", notes: `send failed: ${r.error}` }).eq("id", est.id);
        await ctx.event(c, "estimate_request_failed", `Could not email ${shop.name}`, { error: r.error });
        notes.push(`email to ${shop.name} failed`);
      }
    } else {
      await callShop(ctx, c, est, shop, notes, sent);
    }
  }
  if (sent.length) {
    await ctx.notify(`Asked ${sent.length} shop${sent.length === 1 ? "" : "s"} for estimates on ${c.guest_first ?? "the"} claim`, sent.join(", ") + ". I'll pick the best one and post it to Turo.", `claims-estreq-${c.id}`);
    notes.push(`asked ${sent.length} shops`);
  }
  await ctx.db.from("claim_cases").update({ next_check_at: new Date(Date.now() + 30 * 60_000).toISOString() }).eq("id", c.id);
}

async function callShop(ctx: Ctx, c: Row, est: Row, shop: Row, notes: string[], sent?: string[]) {
  const tries = Number(est.line_items?.tries ?? 0);
  if (!shop.phone) { await ctx.db.from("claim_estimates").update({ status: "no_reply", notes: "no phone or email on file" }).eq("id", est.id); return; }
  const r = await avaCall(ctx, { phone: shop.phone, name: shop.name, purpose: AVA_PURPOSE(c),
    first_line: `Hi, it's Ava, Jared Best's AI assistant, on a recorded line. I'm calling to ask how to send photos for a quick bumper damage estimate.` });
  if (r.ok) {
    await ctx.db.from("claim_estimates").update({ call_id: r.call_id, call_at: new Date().toISOString(), line_items: { tries: tries + 1 } }).eq("id", est.id);
    await ctx.event(c, "estimate_request", `Ava is calling ${shop.name} to ask how to send photos`, { shop: shop.name, channel: "call", call_id: r.call_id });
    sent?.push(`${shop.name} (Ava call)`);
  } else {
    await ctx.db.from("claim_estimates").update({ line_items: { tries: tries + 1 }, notes: `call not placed: ${r.error}` }).eq("id", est.id);
    if (tries + 1 >= 2) {
      await ctx.db.from("claim_estimates").update({ status: "no_reply" }).eq("id", est.id);
      await ctx.event(c, "estimate_request_failed", `Could not call ${shop.name}`, { error: r.error });
      notes.push(`call to ${shop.name} failed`);
    }
  }
}

// ---------------------------------------------------------------- reading what comes back
function cleanReply(body: string) {
  const cut = body.split(/\n\s*(On .{5,80} wrote:|-----Original Message-----|From: .*@)/)[0];
  return cut.replace(/\r/g, "").trim().slice(0, 5000);
}

const EXTRACT_SYS = `You read a body shop's reply to a request for a photo estimate on a car. Reply ONLY JSON:
{"is_estimate": bool, "total": number|null, "oem": bool|null, "repair_vs_replace": "repair"|"replace"|"both"|null,
 "line_items": [{"item": string, "amount": number|null}], "earliest_dropoff": string|null, "days": number|null,
 "needs_in_person": bool, "declined": bool, "asks_for": string|null, "attachment_only": bool, "notes": string}
total = the final estimate total in dollars exactly as the shop wrote it (tax included if they say so), null if no number is given.
Never invent numbers. needs_in_person = they must see the car. asks_for = what they need from Jared (more photos, VIN, insurance details), else null.
attachment_only = the reply just points at an attachment and gives no total. notes <= 200 chars.`;

function regexTotal(text: string): number | null {
  const m = /(?:grand\s+total|total(?:\s+estimate)?|estimate(?:d)?(?:\s+total)?)[^$\d\n]{0,25}\$\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/i.exec(text);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

async function parseReply(ctx: Ctx, c: Row, e: Row, shop: Row, notes: string[]) {
  const { data: mail } = await ctx.db.from("bestly_mail").select("subject, body_text, has_attach, from_addr, sent_at").eq("id", e.mail_id).maybeSingle();
  if (!mail) { await ctx.db.from("claim_estimates").update({ status: "requested" }).eq("id", e.id); return; }
  const body = cleanReply(String(mail.body_text ?? ""));
  let x: Row | null = null;
  try {
    const r = await ctx.llm({ task: "extract", system: EXTRACT_SYS, user: `SHOP: ${shop.name}\nSUBJECT: ${mail.subject}\nHAS ATTACHMENT: ${mail.has_attach}\nREPLY:\n${body}`,
      json: true, job: SLUG, ref: String(c.reservation_id), fn: SLUG, paid: "never", privacy: "private", deadlineMs: 45_000, maxTokens: 600,
      validate: (j: Row) => typeof j === "object" && j ? null : "not an object" });
    x = r.json;
  } catch (err) { if (!(err instanceof ctx.LlmUnavailable)) throw err; }
  let total: number | null = x && typeof x.total === "number" ? x.total : null;
  // never trust a number the shop did not write
  if (total !== null) {
    const asText = [total.toLocaleString("en-US"), total.toFixed(2), String(Math.round(total))];
    if (!asText.some((t) => body.replace(/,/g, "").includes(t.replace(/,/g, "")))) total = null;
  }
  if (total === null && !x) total = regexTotal(body);
  const upd: Row = { notes: String(x?.notes ?? body.slice(0, 200)).slice(0, 300), replied_at: new Date().toISOString() };
  if (total !== null && total > 0) {
    Object.assign(upd, { status: "received", amount: total, oem: x?.oem ?? null, repair_vs_replace: x?.repair_vs_replace ?? null,
      line_items: { items: x?.line_items ?? [], earliest_dropoff: x?.earliest_dropoff ?? null, days: x?.days ?? null, reply: body.slice(0, 2500) } });
    await ctx.db.from("claim_estimates").update(upd).eq("id", e.id);
    await ctx.event(c, "estimate", `${shop.name} quoted ${ctx.money(total)}`, { estimate_id: e.id, total, oem: x?.oem ?? null });
    notes.push(`${shop.name}: ${ctx.money(total)}`);
  } else if (x?.declined) {
    await ctx.db.from("claim_estimates").update({ ...upd, status: "declined" }).eq("id", e.id);
    await ctx.event(c, "estimate", `${shop.name} declined`, { estimate_id: e.id });
  } else if (x?.needs_in_person) {
    await ctx.db.from("claim_estimates").update({ ...upd, status: "needs_visit" }).eq("id", e.id);
    await ctx.event(c, "estimate", `${shop.name} wants to see the car`, { estimate_id: e.id });
  } else if (x?.asks_for) {
    await ctx.db.from("claim_estimates").update({ ...upd, status: "needs_visit" }).eq("id", e.id);
    await ctx.event(c, "estimate", `${shop.name} asked: ${String(x.asks_for).slice(0, 100)}`, { estimate_id: e.id });
    await ctx.db.rpc("claims_ask", { p_case: c.id, p_question: `${shop.name} replied and needs: ${String(x.asks_for).slice(0, 240)}. How should I answer?`, p_options: [], p_key: `shop-asks-${e.id}`, p_kind: "decision" });
  } else if ((x?.attachment_only || mail.has_attach) && !e.line_items?.asked_total) {
    // the mail bridge doesn't carry attachments: ask once for the total in the body
    const r = await sendMail(ctx, { to: mail.from_addr, subject: `Re: ${mail.subject ?? "estimate"} [${e.ref}]`, key: `claims-est-total-${e.id}`,
      text: "Thank you. I can't open attachments in the system I use for this. Could you reply with the total and the main line items typed in the email body? A PDF as well is fine.\n\nThanks,\nJared" });
    await ctx.db.from("claim_estimates").update({ ...upd, status: "requested", requested_at: e.requested_at, line_items: { ...(e.line_items ?? {}), asked_total: r.ok } }).eq("id", e.id);
    await ctx.event(c, "estimate", `Asked ${shop.name} to put the total in the email`, {});
  } else {
    await ctx.db.from("claim_estimates").update({ ...upd, status: "requested" }).eq("id", e.id);
  }
}

async function readCall(ctx: Ctx, c: Row, e: Row, shop: Row, notes: string[]) {
  const { data: call } = await ctx.db.from("ava_calls").select("status, summary, transcript, ended_at, created_at").eq("id", e.call_id).maybeSingle();
  if (!call) return;
  if (call.status !== "completed") {
    if (Date.now() - Date.parse(call.created_at) > 3 * HOUR) await ctx.db.from("claim_estimates").update({ call_id: null }).eq("id", e.id);
    return;
  }
  const text = `${call.summary ?? ""}\n${JSON.stringify(call.transcript ?? "").slice(0, 5000)}`;
  let x: Row | null = null;
  try {
    const r = await ctx.llm({ task: "extract", json: true, job: SLUG, ref: String(c.reservation_id), fn: SLUG, paid: "never", privacy: "private", deadlineMs: 45_000, maxTokens: 400,
      system: `You read the summary of a phone call where an assistant asked a body shop how to send photos for a damage estimate. Reply ONLY JSON {"email": string|null, "web_form": string|null, "walk_in": string|null, "total": number|null, "oem": bool|null, "reached_human": bool, "notes": string}. Never invent: email only if spoken/spelled in the call; total only if a dollar figure was given for this repair.`,
      user: text, validate: (j: Row) => typeof j === "object" && j ? null : "not an object" });
    x = r.json;
  } catch (err) { if (!(err instanceof ctx.LlmUnavailable)) throw err; return; }
  const email = typeof x?.email === "string" && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(x.email.trim()) && text.toLowerCase().includes(x.email.split("@")[0].toLowerCase()) ? x.email.trim().toLowerCase() : null;
  await ctx.event(c, "estimate", `Ava called ${shop.name}`, { reached_human: x?.reached_human ?? null, email, walk_in: x?.walk_in ?? null, notes: x?.notes ?? null });
  if (email) {
    await ctx.db.from("claim_shops").update({ email }).eq("id", shop.id);
    const photos = await photoAttachments(ctx, c.id); const damage = await damageSentence(ctx, c);
    const ref = e.ref ?? refCode();
    const r = await sendMail(ctx, { to: email, subject: `Photo estimate request: ${carName(c)} bumper damage [${ref}]`, key: `claims-est-${e.id}`, attachments: photos.list,
      text: `Thanks for the help on the phone. ${requestBody({ ...shop, name: shop.name }, c, damage, photos, ref).replace(/^Hi .*? team,\n\n/, "")}` });
    await ctx.db.from("claim_estimates").update({ channel: "email", ref, requested_at: new Date().toISOString(), status: r.ok ? "requested" : "no_reply", call_id: null, notes: r.ok ? `got ${email} from the call` : r.error }).eq("id", e.id);
    notes.push(`${shop.name}: emailed after the call`);
  } else if (typeof x?.total === "number" && x.total > 0 && text.replace(/,/g, "").includes(String(Math.round(x.total)))) {
    await ctx.db.from("claim_estimates").update({ status: "received", amount: x.total, oem: x.oem ?? null, channel: "call", notes: String(x.notes ?? "").slice(0, 300), replied_at: new Date().toISOString() }).eq("id", e.id);
    notes.push(`${shop.name}: ${ctx.money(x.total)} by phone`);
  } else if (x?.walk_in) {
    await ctx.db.from("claim_estimates").update({ status: "needs_visit", notes: String(x.walk_in).slice(0, 300) }).eq("id", e.id);
  } else {
    await ctx.db.from("claim_estimates").update({ status: "no_reply", notes: String(x?.notes ?? "call got no usable answer").slice(0, 300) }).eq("id", e.id);
  }
}

// ---------------------------------------------------------------- choose
function chooseFrom(received: Row[], shops: Map<string, Row>, covered: boolean) {
  let pool = received.filter((e) => covered || e.oem !== true);
  const oemOnly = pool.length === 0;
  if (oemOnly) pool = received;
  const low = Math.min(...pool.map((e) => Number(e.amount)));
  const near = pool.filter((e) => Number(e.amount) <= low * 1.25);
  near.sort((a, b) => shopScore(shops.get(b.shop_id) ?? {}) - shopScore(shops.get(a.shop_id) ?? {}) || Number(a.amount) - Number(b.amount));
  const best = near[0];
  const lowest = pool.find((e) => Number(e.amount) === low)!;
  return { best, lowest, oemOnly };
}

// ---------------------------------------------------------------- the estimate summary PDF (transcribed from the shop's reply)
async function summaryPdf(ctx: Ctx, c: Row, e: Row, shop: Row): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const f = await pdf.embedFont(StandardFonts.Helvetica), fb = await pdf.embedFont(StandardFonts.HelveticaBold);
  let y = 740;
  const line = (t: string, o: { bold?: boolean; size?: number; gap?: number } = {}) => {
    const size = o.size ?? 11; const font = o.bold ? fb : f;
    const words = t.split(" "); let cur = "";
    for (const w of words) {
      if (font.widthOfTextAtSize(cur + w, size) > 500) { page.drawText(cur, { x: 56, y, size, font, color: rgb(0.1, 0.1, 0.12) }); y -= size + 4; cur = ""; }
      cur += w + " ";
    }
    page.drawText(cur, { x: 56, y, size, font, color: rgb(0.1, 0.1, 0.12) }); y -= size + (o.gap ?? 5);
  };
  line("Repair estimate summary", { bold: true, size: 20, gap: 14 });
  line(`Vehicle: ${carName(c)}${c.vin ? "   VIN: " + c.vin : ""}`);
  line(`Turo reservation ${c.reservation_id}   Claim ${c.turo_claim_no ?? ""}`, { gap: 12 });
  line(`Shop: ${shop.name}`, { bold: true });
  line(`${shop.address ?? ""}   ${shop.phone ?? ""}`, { gap: 12 });
  line(`Estimate total: ${ctx.money(Number(e.amount))}`, { bold: true, size: 15, gap: 8 });
  if (e.repair_vs_replace) line(`Repair or replace: ${e.repair_vs_replace}`);
  if (e.oem !== null && e.oem !== undefined) line(`Parts: ${e.oem ? "OEM" : "aftermarket / refinish"}`);
  const items = (e.line_items?.items ?? []) as Row[];
  if (items.length) { line("Line items:", { bold: true }); for (const it of items.slice(0, 14)) line(`  ${String(it.item).slice(0, 90)}${typeof it.amount === "number" ? "  " + ctx.money(it.amount) : ""}`); }
  if (e.line_items?.earliest_dropoff) line(`Earliest drop-off: ${e.line_items.earliest_dropoff}`);
  y -= 8;
  line("The shop's reply, as received:", { bold: true });
  for (const para of String(e.line_items?.reply ?? e.notes ?? "").split(/\n+/).slice(0, 22)) if (para.trim()) line(para.trim().slice(0, 400), { size: 10, gap: 3 });
  y -= 10;
  line(`Transcribed from the shop's email reply received ${ctx.fmt(e.replied_at)} (Pacific). Prepared by Jared Best, host. The original email is available on request.`, { size: 9 });
  return await pdf.save();
}

// ---------------------------------------------------------------- the pipeline
export async function estimatePipeline(ctx: Ctx, c: Row, settings: Row, notes: string[]): Promise<void> {
  if (c.history || c.path !== "resolve_directly" || ["paid", "closed", "escalated"].includes(c.status)) return;
  const now = Date.now();
  const { data: rows } = await ctx.db.from("claim_estimates").select("*").eq("case_id", c.id);
  let ests = (rows ?? []) as Row[];
  const { data: shopRows } = await ctx.db.from("claim_shops").select("*");
  const shops = new Map<string, Row>(((shopRows ?? []) as Row[]).map((s) => [s.id, s]));

  // 1. read what came back
  for (const e of ests.filter((x) => x.status === "replied" && x.mail_id)) await parseReply(ctx, c, e, shops.get(e.shop_id)!, notes);
  for (const e of ests.filter((x) => x.channel === "call" && x.status === "requested" && x.call_id)) await readCall(ctx, c, e, shops.get(e.shop_id)!, notes);
  for (const e of ests.filter((x) => x.channel === "call" && x.status === "requested" && !x.call_id && Number(x.line_items?.tries ?? 0) < 2 && now - Date.parse(x.requested_at) > 20 * 60_000))
    await callShop(ctx, c, e, shops.get(e.shop_id)!, notes);

  // 2. nothing chosen yet: ask, nudge, replace the silent
  if (!c.estimate_amount && !c.chosen_estimate_id) {
    if (!ests.length) { await requestEstimates(ctx, c, settings, notes); }
    else {
      // follow up once after 24 h, an Ava call after 48 h
      for (const e of ests.filter((x) => x.status === "requested" && x.channel === "email")) {
        const age = now - Date.parse(e.requested_at); const shop = shops.get(e.shop_id)!;
        if (age > 24 * HOUR && !e.followup_at && shop.email) {
          const r = await sendMail(ctx, { to: shop.email, subject: `Re: Photo estimate request: ${carName(c)} bumper damage [${e.ref}]`, key: `claims-est-fu-${e.id}`,
            text: `Hi ${shop.name} team, just checking you got the photos I sent yesterday. Could you send the estimate total when you have a minute? Thanks, Jared` });
          if (r.ok) await ctx.db.from("claim_estimates").update({ followup_at: new Date().toISOString() }).eq("id", e.id);
        } else if (age > 48 * HOUR && !e.call_at && shop.phone) {
          const r = await avaCall(ctx, { phone: shop.phone, name: shop.name, purpose: `Follow up on an emailed photo estimate request (ref ${e.ref}) for a ${carName(c)} bumper. Ask whether they got the email and when Jared can expect the estimate total. Do not agree to work or share payment details.`,
            first_line: "Hi, it's Ava, Jared Best's AI assistant, on a recorded line. I'm calling about a photo estimate request he emailed you." });
          await ctx.db.from("claim_estimates").update({ call_at: new Date().toISOString(), call_id: r.ok ? r.call_id : null, notes: r.ok ? "Ava called to follow up" : `follow-up call failed: ${r.error}` }).eq("id", e.id);
        }
      }
      // every asked shop is a no-show / declined and nothing is received: ask the next-ranked shops
      ests = ((await ctx.db.from("claim_estimates").select("*").eq("case_id", c.id)).data ?? []) as Row[];
      const live = ests.filter((x) => ["requested", "replied", "received", "needs_visit"].includes(x.status));
      if (live.length < Number(settings.shops_per_request ?? 3) && !ests.some((x) => x.status === "received")) {
        const before = ests.length;
        const covered = !!(c.insurer?.covers_full);
        const next = (await rankShops(ctx, settings, covered, ests.map((x) => x.shop_id))).slice(0, Number(settings.shops_per_request ?? 3) - live.length);
        if (next.length) {
          await ctx.db.from("claim_cases").update({ estimates_requested_at: null }).eq("id", c.id);
          await requestEstimates(ctx, { ...c, estimates_requested_at: null }, { ...settings, shops_per_request: before + next.length }, notes);
        }
      }
    }
    // 18 h before Turo's estimate deadline with nothing usable: ask Scout
    if (c.estimate_due_at && !ests.some((x) => x.status === "received")) {
      const hrs = (Date.parse(c.estimate_due_at) - now) / HOUR;
      if (hrs < 18 && hrs > -48) {
        await ctx.db.rpc("claims_ask", { p_case: c.id, p_kind: "decision",
          p_question: `Turo wants a professional estimate shared with ${c.guest_first ?? "the guest"} by ${ctx.fmt(c.estimate_due_at)} and no shop has sent a total yet (${ests.filter((x) => x.status === "requested").length} still waiting). Want me to keep waiting, or should you walk the car into a shop?`,
          p_options: [{ value: "wait", label: "Keep waiting" }, { value: "walk_in", label: "I will walk it in" }], p_key: "estimate-deadline" });
      }
    }
  }

  // 3. choose when it is time
  ests = ((await ctx.db.from("claim_estimates").select("*").eq("case_id", c.id)).data ?? []) as Row[];
  const received = ests.filter((x) => x.status === "received" && Number(x.amount) > 0);
  if (!c.estimate_amount && received.length) {
    const open = ests.filter((x) => ["requested", "replied", "needs_visit"].includes(x.status));
    const dueHrs = c.estimate_due_at ? (Date.parse(c.estimate_due_at) - now) / HOUR : 999;
    const oldest = Math.min(...ests.map((x) => Date.parse(x.requested_at)));
    const ready = open.length === 0 || dueHrs < 4 || (received.length >= 2 && now - oldest > 18 * HOUR) || now - oldest > 48 * HOUR;
    if (!ready) {
      await ctx.db.from("claim_cases").update({ next_check_at: new Date(now + 30 * 60_000).toISOString() }).eq("id", c.id);
      notes.push(`${received.length} estimate(s) in, waiting on ${open.length} more`);
    } else {
      const covered = !!(c.insurer?.covers_full);
      const { best, lowest, oemOnly } = chooseFrom(received, shops, covered);
      const shop = shops.get(best.shop_id)!; const lowShop = shops.get(lowest.shop_id)!;
      const reason = `${shop.name} at ${ctx.money(Number(best.amount))}, ${shop.distance_mi} mi away`
        + (best.id === lowest.id ? ", the lowest quote" : `; lowest was ${ctx.money(Number(lowest.amount))} at ${lowShop.name}, this one is within 25% and rated higher or closer`)
        + (oemOnly ? ". Every quote was OEM parts." : "");
      await ctx.db.from("claim_estimates").update({ chosen: true, chosen_reason: reason }).eq("id", best.id);
      await ctx.db.from("claim_cases").update({ estimate_amount: best.amount, chosen_shop_id: best.shop_id, chosen_estimate_id: best.id, next_check_at: null, needs_work: true, work_reason: "estimate chosen" }).eq("id", c.id);
      c.estimate_amount = best.amount; c.chosen_shop_id = best.shop_id; c.chosen_estimate_id = best.id;
      await ctx.event(c, "estimate_chosen", `Chose ${shop.name}: ${ctx.money(Number(best.amount))}`, { reason });
      await ctx.notify(`Chose ${shop.name} for ${c.guest_first ?? "the"} repair: ${ctx.money(Number(best.amount))}`, reason + " I'll post it to Turo now. Booking waits for your Book it tap.", `claims-chosen-${best.id}`);
      notes.push(`chose ${shop.name} ${ctx.money(Number(best.amount))}`);
      if (received.length === 1 || Number(received.reduce((m, x) => Math.max(m, Number(x.amount)), 0)) > 2 * low(received))
        await ctx.db.rpc("claims_ask", { p_case: c.id, p_kind: "fyi", p_key: `estimate-spread-${c.id}`, p_options: [],
          p_question: received.length === 1 ? `Only one shop quoted (${shop.name}, ${ctx.money(Number(best.amount))}). I went ahead with it.` : `The quotes are far apart (${ctx.money(low(received))} to ${ctx.money(Math.max(...received.map((x) => Number(x.amount))))}). I chose ${shop.name} at ${ctx.money(Number(best.amount))}.` });
    }
  }

  // 4. post the Turo invoice once an estimate is chosen
  if (c.estimate_amount && c.chosen_estimate_id) {
    const { data: acts } = await ctx.db.from("claim_turo_actions").select("id, status").eq("case_id", c.id).eq("kind", "create_invoice").in("status", ["queued", "sending", "done"]);
    const invoiceThere = (acts ?? []).length > 0 || (c.turo_invoice && Object.keys(c.turo_invoice).length > 0) || (c.invoices ?? []).some((i: Row) => i.amount);
    if (!invoiceThere) {
      const e = ests.find((x) => x.id === c.chosen_estimate_id)!; const shop = shops.get(e.shop_id)!;
      const max = Number(c.invoice_max ?? c.guest_max ?? 500);
      const amount = Math.min(Number(c.estimate_amount), max);
      const pdf = await summaryPdf(ctx, c, e, shop);
      const docPath = `${c.id}/estimate/${e.id}.pdf`;
      await ctx.db.storage.from("claim-evidence").upload(docPath, pdf, { contentType: "application/pdf", upsert: true });
      await ctx.db.from("claim_estimates").update({ doc_path: docPath }).eq("id", e.id);
      // Turo's invoice form only takes photos already on the reservation (its media picker lists /api/reservation/imagesV2), so the
      // evidence is the damage photos; the estimate itself goes in the message (500 character limit).
      const { data: ev } = await ctx.db.from("claim_evidence").select("uuid, kind").eq("case_id", c.id).order("taken_at");
      const evRows = (ev ?? []) as Row[];
      const evidenceIds = [...evRows.filter((p) => p.kind === "after").slice(0, 8), ...evRows.filter((p) => p.kind === "before").slice(0, 2)].map((p) => p.uuid);
      const shopShort = String(shop.name).replace(/ Collision Center.*$/i, "").replace(/ Body Shop.*$/i, "");
      const msg = [`Repair estimate: ${ctx.money(Number(c.estimate_amount))} from ${shop.name}`,
        e.repair_vs_replace ? ` (${e.repair_vs_replace === "both" ? "repair and replace" : e.repair_vs_replace})` : "",
        `, for the passenger-side front bumper damage found at check-in. This invoice is ${ctx.money(amount)}, the most Turo allows here under your protection plan.`,
        Number(c.estimate_amount) > amount ? " The photos are attached. If you have personal auto insurance, send me your insurer and policy number and I'll run the full repair through it." : " The photos are attached."].join("");
      const message = msg.length <= 500 ? msg : msg.replace(` from ${shop.name}`, ` from ${shopShort}`).slice(0, 500);
      await ctx.db.from("claim_turo_actions").insert({ case_id: c.id, kind: "create_invoice",
        payload: { amount, message, estimate_total: Number(c.estimate_amount), shop: shop.name, doc_path: docPath, evidence_ids: evidenceIds, incident_number: String(c.turo_claim_no ?? "") } });
      await ctx.db.from("turo_reader_state").update({ poke_at: new Date().toISOString() }).eq("id", 1);
      await ctx.event(c, "turo_action", `Queued the Turo invoice: ${ctx.money(amount)}`, { amount, shop: shop.name });
      notes.push(`queued Turo invoice ${ctx.money(amount)}`);
    }
  }

  // 5. still waiting on shops: look again in 30 minutes (follow-ups, replies, calls)
  const { data: left } = await ctx.db.from("claim_estimates").select("status").eq("case_id", c.id);
  if (!c.estimate_amount && ((left ?? []) as Row[]).some((x) => ["requested", "replied", "needs_visit"].includes(x.status)))
    await ctx.db.from("claim_cases").update({ next_check_at: new Date(Date.now() + 30 * 60_000).toISOString() }).eq("id", c.id);
}
const low = (rs: Row[]) => Math.min(...rs.map((x) => Number(x.amount)));

// op preview_request: what the first email would say and who would be asked; nothing is sent or saved
export async function previewRequest(ctx: Ctx, c: Row, settings: Row) {
  const shops = (await rankShops(ctx, settings, !!(c.insurer?.covers_full), [])).slice(0, Number(settings.shops_per_request ?? 3));
  const { data: ev } = await ctx.db.from("claim_evidence").select("kind").eq("case_id", c.id);
  const n = { after: ((ev ?? []) as Row[]).filter((x) => x.kind === "after").length, before: ((ev ?? []) as Row[]).filter((x) => x.kind === "before").length };
  const damage = await damageSentence(ctx, c);
  return { shops: shops.map((s) => ({ name: s.name, channel: s.email ? "email" : "call", score: Math.round(shopScore(s) * 10) / 10 })),
    subject: `Photo estimate request: ${carName(c)} bumper damage [CC-XXXXX]`, body: requestBody(shops[0] ?? { name: "Shop" }, c, damage, { after: Math.min(n.after, 8), before: Math.min(n.before, 2) }, "CC-XXXXX") };
}

// op preview_parse {shop, subject, body}: run the reply reader on sample text and show what it would record; nothing is saved
export async function previewParse(ctx: Ctx, shop: string, subject: string, bodyText: string) {
  const body = cleanReply(bodyText);
  const r = await ctx.llm({ task: "extract", system: EXTRACT_SYS, user: `SHOP: ${shop}\nSUBJECT: ${subject}\nHAS ATTACHMENT: false\nREPLY:\n${body}`,
    json: true, job: SLUG, ref: "preview", fn: SLUG, paid: "never", privacy: "private", deadlineMs: 45_000, maxTokens: 600, validate: (j: Row) => typeof j === "object" && j ? null : "not an object" });
  const x = r.json as Row;
  let total: number | null = typeof x.total === "number" ? x.total : null;
  if (total !== null) {
    const asText = [total.toLocaleString("en-US"), total.toFixed(2), String(Math.round(total))];
    if (!asText.some((t) => body.replace(/,/g, "").includes(t.replace(/,/g, "")))) total = null;
  }
  return { parsed: x, total_accepted: total, regex_total: regexTotal(body) };
}
