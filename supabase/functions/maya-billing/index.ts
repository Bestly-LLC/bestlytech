// maya-billing: Maya's "hands" on the phone line (Phase 3).
//
// Public endpoint (verify_jwt = false). Same auth as maya-ticket: every request must carry an
// ElevenLabs conversation_id that ElevenLabs confirms belongs to Maya, started in the last 2 hours,
// is still live, and is an INBOUND phone call. Outbound cold calls can never touch billing.
//
// Everything that matters is enforced here, never in the prompt:
//   - the caller proves they own the account with a 6-digit code emailed to the address on file
//   - every billing action acts only on that one verified customer, in that one conversation
//   - refunds: cap per refund, 1 per customer per cooldown, daily ceiling, kill switch (maya_refund_reserve)
//   - anything over a limit becomes a billing ticket for Jared instead of an error
//   - every action is written to maya_billing_actions (emails masked, no card data, no secrets)
// dry_run:true on cancel / pause / refund runs every check and skips the Stripe write.
import { createClient } from "npm:@supabase/supabase-js@2";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

const AGENT_ID = "agent_3701m4jbjnyef6ga4ys73xtbz37s";
const TZ = "America/Los_Angeles";
const VERIFY_TTL_MIN = 10;
const VERIFIED_FOR_MIN = 30;
const MAX_CODE_ATTEMPTS = 3;
const MAX_SENDS_PER_CONV = 3;
const MAX_SENDS_PER_EMAIL_HOUR = 3;
const MAX_PAYLINKS_PER_CONV = 3;
const FROM = "Maya at Bestly <maya@bestly.tech>";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const maskEmail = (e: string) => { const [u, d] = e.split("@"); return `${(u ?? "").slice(0, 1)}***@${d ?? ""}`; };
const dateUS = (ms: number) => new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "long", day: "numeric", year: "numeric" }).format(new Date(ms));
const cleanText = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const isTrue = (v: unknown) => v === true || v === "true";
const sha256 = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");
const randCode = () => String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
const randToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
const later = (p: PromiseLike<unknown>) => { const q = Promise.resolve(p).catch(() => {}); try { EdgeRuntime.waitUntil(q); } catch (_) { /* not on the edge runtime */ } };

// ---------- Stripe ----------
let keyCache: { v: string; t: number } | null = null;
async function stripeKey(): Promise<string> {
  if (keyCache && Date.now() - keyCache.t < 60_000) return keyCache.v;
  let v = "";
  try { const { data } = await sb.rpc("stripe_secret", { p_name: "stripe_secret_key" }); if (typeof data === "string") v = data; } catch (_) { /* env fallback */ }
  if (!v) v = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!v) throw new Error("no stripe key");
  keyCache = { v, t: Date.now() };
  return v;
}
// deno-lint-ignore no-explicit-any
async function stripe(method: "GET" | "POST" | "DELETE", path: string, params?: Record<string, string>, idem?: string): Promise<{ ok: boolean; status: number; data: any }> {
  const key = await stripeKey();
  const q = params && method === "GET" ? "?" + new URLSearchParams(params).toString() : "";
  const r = await fetch(`https://api.stripe.com/v1${path}${q}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(method !== "GET" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(idem ? { "Idempotency-Key": idem } : {}) },
    body: method !== "GET" && params ? new URLSearchParams(params).toString() : undefined,
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

// ---------- email (Resend, signed by Maya) ----------
async function sendMail(to: string, subject: string, text: string, key: string): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return false;
  const body = text.trim() + "\n\nMaya\nBestly\n(213) 641-0074";
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#111;max-width:520px">${
    body.split("\n").map((l) => l.trim() === "" ? "<br>" : `<div>${l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/(https:\/\/\S+)/g, '<a href="$1">$1</a>')}</div>`).join("")}</div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": key.slice(0, 200) },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: "jared@bestly.tech", subject, text: body, html }),
  }).catch(() => null);
  return !!r && r.ok;
}

// ---------- logging / alerts ----------
type Ctx = { conv: string; phone: string | null };
async function log(c: Ctx | null, action: string, f: { customer?: string | null; email?: string | null; amount?: number | null; obj?: string | null; result?: string; detail?: Record<string, unknown> }) {
  const detail = { ...(f.detail ?? {}), ...(c?.phone ? { phone_last4: c.phone.slice(-4) } : {}) };
  await sb.from("maya_billing_actions").insert({
    conversation_id: c?.conv ?? null, stripe_customer_id: f.customer ?? null, email: f.email ? maskEmail(f.email) : null,
    action, amount_cents: f.amount ?? null, stripe_object_id: f.obj ?? null, result: f.result ?? null, detail,
  });
}
async function raise(title: string, body: string) {
  try { await sb.rpc("bestly_raise", { p_key: "maya.billing", p_kind: "problem", p_severity: "warning", p_title: title, p_body: body.slice(0, 300), p_area: "maya" }); } catch (_) { /* never block a call on an alert */ }
}

// ---------- conversation auth ----------
async function authConversation(p: Record<string, unknown>, write: boolean): Promise<Ctx | Response> {
  const conv = String(p.conversation_id ?? "");
  if (!/^conv_[A-Za-z0-9]+$/.test(conv)) return json({ ok: false, error: "no conversation" }, 401);
  const { data: elKey } = await sb.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${conv}`, { headers: { "xi-api-key": String(elKey) } });
  if (!r.ok) return json({ ok: false, error: "unknown conversation" }, 401);
  const c = await r.json();
  const started = Number(c?.metadata?.start_time_unix_secs ?? 0) * 1000;
  if (c?.agent_id !== AGENT_ID || !started || Date.now() - started > 2 * 3600 * 1000) return json({ ok: false, error: "not a live Maya call" }, 401);
  if (write && (c?.status === "done" || c?.status === "failed")) return json({ ok: false, error: "call is over" }, 401);
  const pc = c?.metadata?.phone_call;
  if (pc?.direction !== "inbound") return json({ ok: false, reason: "inbound_only", message: "Account tools only work on calls the customer made to Bestly. Offer a callback ticket instead." }, 403);
  const ext = String(pc?.external_number ?? "").replace(/[^\d+]/g, "");
  return { conv, phone: ext.length >= 7 ? ext : null };
}

// ---------- verification state ----------
async function verified(c: Ctx): Promise<{ customer: string; email: string } | null> {
  const since = new Date(Date.now() - VERIFIED_FOR_MIN * 60_000).toISOString();
  const { data } = await sb.from("maya_verifications").select("stripe_customer_id,email,verified_at")
    .eq("conversation_id", c.conv).not("verified_at", "is", null).gt("verified_at", since)
    .order("verified_at", { ascending: false }).limit(1);
  const v = data?.[0];
  return v ? { customer: v.stripe_customer_id, email: v.email } : null;
}
const needVerify = () => json({ ok: false, reason: "not_verified", message: "This caller is not verified yet. Ask for the email on the account and use verify_start, then verify_check, before anything else." }, 403);

// deno-lint-ignore no-explicit-any
async function activeSubs(customer: string): Promise<any[]> {
  const r = await stripe("GET", "/subscriptions", { customer, status: "all", limit: "10" });
  // deno-lint-ignore no-explicit-any
  return (r.data?.data ?? []).filter((s: any) => ["active", "trialing", "past_due", "unpaid"].includes(s.status));
}
// deno-lint-ignore no-explicit-any
const periodEnd = (s: any): number | null => { const t = s?.current_period_end ?? s?.items?.data?.[0]?.current_period_end; return t ? Number(t) * 1000 : null; };
// deno-lint-ignore no-explicit-any
const subLabel = (s: any) => cleanText(s?.items?.data?.[0]?.price?.nickname || s?.items?.data?.[0]?.plan?.nickname || s?.description || "your Bestly subscription", 60);

// ---------- actions ----------
async function startVerify(c: Ctx, p: Record<string, unknown>) {
  const neutral = { ok: true, message: "If that email has an account, a six-digit code is on its way to it. Ask the caller to read the code once it arrives. Do not say whether the account exists." };
  const email = cleanText(p.email, 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, reason: "bad_email", message: "That does not sound like a full email address. Ask them to say it again slowly, including the part after the at sign." });

  const { count: sent } = await sb.from("maya_billing_actions").select("id", { count: "exact", head: true }).eq("conversation_id", c.conv).eq("action", "verify_sent").eq("result", "attempt");
  if ((sent ?? 0) >= MAX_SENDS_PER_CONV) {
    await log(c, "blocked", { email, result: "verify_rate_limit_conv" });
    return json({ ok: false, reason: "too_many", message: "I have sent a few codes already on this call. Open a ticket so Jared can verify them directly, and do not try again." });
  }
  // Every attempt (match or not) counts the same, so the count does not reveal which emails exist.
  await log(c, "verify_sent", { email, result: "attempt" });

  const pattern = email.replace(/[\\%_]/g, "\\$&");
  const { data: subs } = await sb.from("subscriptions").select("email,stripe_customer_id,created_at").ilike("email", pattern).not("stripe_customer_id", "is", null).order("created_at", { ascending: false }).limit(1);
  const sub = subs?.[0];
  if (!sub?.stripe_customer_id) { await log(c, "verify_sent", { email, result: "no_match" }); return json(neutral); }

  const hourAgo = new Date(Date.now() - 3600_000).toISOString();
  const { count: recent } = await sb.from("maya_verifications").select("id", { count: "exact", head: true }).ilike("email", pattern).gt("created_at", hourAgo);
  if ((recent ?? 0) >= MAX_SENDS_PER_EMAIL_HOUR) { await log(c, "verify_sent", { email, customer: sub.stripe_customer_id, result: "email_rate_limited" }); return json(neutral); }

  const code = randCode();
  const { error } = await sb.from("maya_verifications").insert({
    conversation_id: c.conv, email, stripe_customer_id: sub.stripe_customer_id,
    code_hash: await sha256(`${c.conv}:${email}:${code}`), expires_at: new Date(Date.now() + VERIFY_TTL_MIN * 60_000).toISOString(),
  });
  if (error) { await raise("Maya: I couldn't save a verification code", error.message); return json(neutral); }
  // Sent after we answer so a real account and a missing one take the same time.
  later((async () => {
    const ok = await sendMail(sub.email, "Your Bestly verification code",
      `Your Bestly code is ${code}.\n\nIt works for ${VERIFY_TTL_MIN} minutes. Read it to Maya on the phone to confirm it is you.\n\nIf you did not call Bestly, ignore this email. Nobody can change your account without this code.`,
      `maya-verify-${c.conv}-${code}`);
    await log(c, "verify_sent", { email, customer: sub.stripe_customer_id, result: ok ? "sent" : "send_failed" });
    if (!ok) await raise("Maya: a verification email failed to send", "Resend rejected or RESEND_API_KEY is missing.");
  })());
  return json(neutral);
}

async function checkCode(c: Ctx, p: Record<string, unknown>) {
  const code = String(p.code ?? "").replace(/\D/g, "");
  if (code.length !== 6) return json({ ok: false, reason: "bad_code", message: "The code is six digits. Ask them to read it again, digit by digit." });
  const already = await verified(c);
  if (already) return json({ ok: true, verified: true, message: "This caller is already verified." });

  const { data: rows } = await sb.from("maya_verifications").select("*").eq("conversation_id", c.conv).is("verified_at", null).order("created_at", { ascending: false }).limit(1);
  const v = rows?.[0];
  if (!v) return json({ ok: false, reason: "no_code", message: "No code is waiting on this call. Start verification with the email on the account first." });
  if (new Date(v.expires_at).getTime() < Date.now()) return json({ ok: false, reason: "expired", message: "That code has expired. Offer to send a new one." });
  if (v.attempts >= MAX_CODE_ATTEMPTS) return json({ ok: false, reason: "too_many_attempts", message: "Too many wrong tries. Stop, open a ticket so Jared can verify them, and do not try again." });

  const { data: bumped } = await sb.from("maya_verifications").update({ attempts: v.attempts + 1 }).eq("id", v.id).eq("attempts", v.attempts).select("id");
  if (!bumped?.length) return json({ ok: false, reason: "busy", message: "Try that again." });
  const good = (await sha256(`${c.conv}:${v.email}:${code}`)) === v.code_hash;
  if (!good) {
    await log(c, "verify_fail", { customer: v.stripe_customer_id, email: v.email, result: "wrong_code", detail: { attempts: v.attempts + 1 } });
    const left = MAX_CODE_ATTEMPTS - (v.attempts + 1);
    return json({ ok: false, reason: "wrong_code", attempts_left: left, message: left > 0 ? `That is not the code. ${left} tries left.` : "That is not the code and there are no tries left. Stop and open a ticket." });
  }
  await sb.from("maya_verifications").update({ verified_at: new Date().toISOString() }).eq("id", v.id);
  await log(c, "verify_ok", { customer: v.stripe_customer_id, email: v.email, result: "ok" });
  return json({ ok: true, verified: true, message: "Verified. You can now look at their billing." });
}

async function billingStatus(c: Ctx) {
  const v = await verified(c); if (!v) return needVerify();
  const { data: rows } = await sb.from("subscriptions").select("plan,status,current_period_end").eq("stripe_customer_id", v.customer).order("created_at", { ascending: false }).limit(1);
  const row = rows?.[0];
  const subs = await activeSubs(v.customer);
  const subOut = subs.map((s) => ({ subscription_id: s.id, name: subLabel(s), status: s.status, renews_on: periodEnd(s) ? dateUS(periodEnd(s)!) : null,
    cancels_at_period_end: !!s.cancel_at_period_end, paused: !!s.pause_collection }));
  const ch = await stripe("GET", "/charges", { customer: v.customer, limit: "5" });
  // deno-lint-ignore no-explicit-any
  const charges = (ch.data?.data ?? []).map((x: any) => ({
    charge_id: x.id, amount: money(x.amount), amount_cents: x.amount, date: dateUS(x.created * 1000),
    status: x.refunded ? "refunded" : x.amount_refunded ? `partly refunded (${money(x.amount_refunded)})` : x.paid ? "paid" : x.status,
    card_last4: x.payment_method_details?.card?.last4 ?? null, refundable_cents: Math.max(0, x.amount - (x.amount_refunded ?? 0)),
    for: cleanText(x.description, 60) || null,
  }));
  await log(c, "status", { customer: v.customer, email: v.email, result: "ok", detail: { subs: subOut.length, charges: charges.length } });
  const lifetime = row?.plan === "lifetime" && subOut.length === 0;
  return json({ ok: true, plan: row?.plan ?? null, account_status: row?.status ?? null, recurring_subscriptions: subOut, charges,
    note: lifetime ? "This is a lifetime plan, so there is no renewal date and nothing to cancel." : undefined });
}

async function sendPayLink(c: Ctx) {
  const v = await verified(c); if (!v) return needVerify();
  const { count } = await sb.from("maya_billing_actions").select("id", { count: "exact", head: true }).eq("conversation_id", c.conv).eq("action", "pay_link");
  if ((count ?? 0) >= MAX_PAYLINKS_PER_CONV) return json({ ok: false, reason: "too_many", message: "I already sent links on this call. Ask them to check their inbox and spam folder." });
  const token = randToken();
  const { error } = await sb.from("maya_pay_links").insert({ token, stripe_customer_id: v.customer, email_masked: maskEmail(v.email), conversation_id: c.conv, expires_at: new Date(Date.now() + 24 * 3600_000).toISOString() });
  if (error) { await raise("Maya: I couldn't make a card-update link", error.message); return json({ ok: false, reason: "failed", message: "I could not make the link. Open a billing ticket." }, 500); }
  const ok = await sendMail(v.email, "Update your card with Bestly",
    `Here is your secure link to update your card or see your invoices:\n\nhttps://bestly.tech/pay/${token}\n\nIt works for 24 hours. The page is run by Stripe, so Bestly never sees your card number.\n\nIf you did not ask for this, you can ignore it.`, `maya-paylink-${token}`);
  await log(c, "pay_link", { customer: v.customer, email: v.email, result: ok ? "sent" : "send_failed" });
  if (!ok) { await raise("Maya: a card-update email failed to send", "Resend rejected or RESEND_API_KEY is missing."); return json({ ok: false, reason: "send_failed", message: "The email would not send. Open a billing ticket." }, 502); }
  return json({ ok: true, sent_to: maskEmail(v.email), message: "Sent to the email on the account. It works for 24 hours. Tell them to check spam if it does not show up. Texting is not available." });
}

async function changeSubscription(c: Ctx, p: Record<string, unknown>, kind: "cancel_period_end" | "cancel_now" | "pause") {
  const v = await verified(c); if (!v) return needVerify();
  if (!isTrue(p.confirmed)) return json({ ok: false, reason: "need_confirmation", message: "Say exactly what will happen, get a clear yes from the caller, then call again with confirmed true." });
  const dry = isTrue(p.dry_run);
  const subs = await activeSubs(v.customer);
  if (!subs.length) {
    await log(c, kind === "pause" ? "pause" : "cancel", { customer: v.customer, email: v.email, result: "no_subscription", detail: { dry } });
    return json({ ok: false, reason: "no_subscription", message: "There is no recurring subscription on this account, so there is nothing to cancel or pause. If they have a lifetime plan it never renews." });
  }
  const wanted = cleanText(p.subscription_id, 80);
  const pick = wanted ? subs.find((s) => s.id === wanted) : (subs.length === 1 ? subs[0] : null);
  if (!pick) return json({ ok: false, reason: "which_one", choices: subs.map((s) => ({ subscription_id: s.id, name: subLabel(s), renews_on: periodEnd(s) ? dateUS(periodEnd(s)!) : null })), message: "More than one subscription. Ask which one, then call again with its subscription_id." });
  if (pick.customer !== v.customer) return json({ ok: false, reason: "not_theirs" }, 403);

  const action = kind === "pause" ? "pause" : "cancel";
  const end = periodEnd(pick);
  if (dry) { await log(c, action, { customer: v.customer, email: v.email, obj: pick.id, result: "dry_run", detail: { kind } }); return json({ ok: true, dry_run: true, would: kind, subscription: subLabel(pick) }); }

  const idem = `maya-${kind}-${c.conv}-${pick.id}`;
  const r = kind === "cancel_now" ? await stripe("DELETE", `/subscriptions/${pick.id}`, { prorate: "false" }, idem)
    : kind === "cancel_period_end" ? await stripe("POST", `/subscriptions/${pick.id}`, { cancel_at_period_end: "true" }, idem)
    : await stripe("POST", `/subscriptions/${pick.id}`, { "pause_collection[behavior]": "void" }, idem);
  if (!r.ok) {
    await log(c, action, { customer: v.customer, email: v.email, obj: pick.id, result: "stripe_error", detail: { kind, status: r.status, type: r.data?.error?.type } });
    await raise("Maya: a cancel or pause failed at Stripe", `${kind} returned ${r.status} ${cleanText(r.data?.error?.message, 120)}`);
    return json({ ok: false, reason: "stripe_error", message: "That did not go through. Open a billing ticket and tell them Jared will follow up." }, 502);
  }
  await log(c, action, { customer: v.customer, email: v.email, obj: pick.id, result: "ok", detail: { kind } });
  const label = subLabel(pick);
  const text = kind === "cancel_now" ? `Your ${label} was canceled today, as you asked on the phone.`
    : kind === "cancel_period_end" ? `Your ${label} will not renew. You keep access through ${end ? dateUS(end) : "the end of your current period"}.`
    : `Billing for your ${label} is paused. Nothing will be charged until it is resumed. Call or email us any time to turn it back on.`;
  later(sendMail(v.email, kind === "pause" ? "Your Bestly billing is paused" : "Your Bestly cancellation", text, `maya-${kind}-mail-${c.conv}-${pick.id}`));
  later(sb.rpc("maya_billing_alert", { p_title: `${kind === "pause" ? "paused billing" : "canceled"} ${label}${kind === "cancel_period_end" ? " at period end" : ""} for ${maskEmail(v.email)}`, p_body: `Caller asked on the phone. Mode: ${kind}.`, p_dedupe: `maya-${kind}-${c.conv}-${pick.id}` }));
  return json({ ok: true, done: kind, subscription: label, access_until: kind === "cancel_period_end" && end ? dateUS(end) : null,
    message: kind === "cancel_period_end" ? `Done. It will not renew and they keep access until ${end ? dateUS(end) : "the end of the period"}. A confirmation email is on its way.` : kind === "pause" ? "Done. Billing is paused. A confirmation email is on its way." : "Done. It is canceled now. A confirmation email is on its way." });
}

const BLOCK_SPEECH: Record<string, string> = {
  over_cap: "That is more than I am allowed to refund on my own.",
  cooldown: "This account already had a refund recently, and I can only do one in that window.",
  daily_ceiling: "I have reached my limit for refunds today.",
  refunds_disabled: "I cannot do refunds right now.",
  disputed: "That charge is under a bank dispute.",
};

async function refund(c: Ctx, p: Record<string, unknown>) {
  const v = await verified(c); if (!v) return needVerify();
  if (!isTrue(p.confirmed)) return json({ ok: false, reason: "need_confirmation", message: "Say the exact amount and which charge, get a clear yes, then call again with confirmed true." });
  const dry = isTrue(p.dry_run);
  const chargeId = cleanText(p.charge_id, 80);
  const amount = Number(p.amount_cents);
  const reason = cleanText(p.reason, 140) || "customer request";
  if (!/^(ch|py)_[A-Za-z0-9]+$/.test(chargeId)) return json({ ok: false, reason: "bad_charge", message: "Use a charge id from billing_status." });
  if (!Number.isInteger(amount) || amount <= 0) return json({ ok: false, reason: "bad_amount", message: "The amount must be a whole number of cents, above zero." });

  const ch = await stripe("GET", `/charges/${chargeId}`);
  if (!ch.ok || ch.data?.customer !== v.customer) {
    await log(c, "blocked", { customer: v.customer, email: v.email, obj: chargeId, amount, result: "charge_not_theirs" });
    return json({ ok: false, reason: "charge_not_found", message: "I do not see that charge on this account." });
  }
  const remaining = Math.max(0, Number(ch.data.amount) - Number(ch.data.amount_refunded ?? 0));
  if (!ch.data.paid || ch.data.status !== "succeeded" || remaining <= 0) return json({ ok: false, reason: "not_refundable", message: "That charge is already refunded or did not go through." });
  if (amount > remaining) return json({ ok: false, reason: "exceeds_remaining", refundable: money(remaining), message: `Only ${money(remaining)} of that charge is left to refund.` });

  const ticketFor = async (why: string) => {
    const { data: prior } = await sb.from("maya_billing_actions").select("detail").eq("conversation_id", c.conv).eq("action", "refund_blocked").eq("stripe_object_id", chargeId).order("created_at", { ascending: false }).limit(1);
    const existing = (prior?.[0]?.detail as Record<string, unknown> | undefined)?.ticket;
    if (existing) return String(existing);
    const { data: t } = await sb.rpc("maya_file_ticket", { p: { kind: "billing", email: v.email, phone: c.phone, conversation_id: c.conv,
      issue: `Refund ${money(amount)} on charge ${chargeId.slice(-6)} (${money(Number(ch.data.amount))}, ${dateUS(ch.data.created * 1000)}). Reason: ${reason}. Maya could not do it herself: ${why}. Caller was verified by email code.` } });
    return t?.ticket ? String(t.ticket) : null;
  };

  const disputed = !!ch.data.disputed; // a disputed charge never reaches the gate, so it cannot hold a reservation
  const gate = disputed ? { data: { ok: false, reason: "disputed" }, error: null }
    : await sb.rpc("maya_refund_reserve", { p_conv: c.conv, p_customer: v.customer, p_email_masked: maskEmail(v.email), p_charge: chargeId, p_amount: amount, p_dry: dry });
  if (gate.error) { await raise("Maya: the refund gate failed", gate.error.message); return json({ ok: false, reason: "gate_error", message: "I cannot do a refund right now. Open a billing ticket." }, 500); }
  const g = gate.data as { ok: boolean; reason?: string; id?: string };
  if (!g.ok) {
    const why = String(g.reason);
    if (dry) { await log(c, "refund_blocked", { customer: v.customer, email: v.email, obj: chargeId, amount, result: why, detail: { dry: true } }); return json({ ok: false, dry_run: true, reason: why }); }
    const code = await ticketFor(why);
    await log(c, "refund_blocked", { customer: v.customer, email: v.email, obj: chargeId, amount, result: why, detail: { ticket: code } });
    return json({ ok: false, reason: why, ticket_code: code, message: `${BLOCK_SPEECH[why] ?? "I cannot do that one myself."} I opened a ticket${code ? `, code ${code}` : ""}, and Jared will review it within one business day. Do not promise the refund.` });
  }
  if (dry) return json({ ok: true, dry_run: true, would_refund: money(amount), charge: chargeId });

  const r = await stripe("POST", "/refunds", { charge: chargeId, amount: String(amount), reason: "requested_by_customer", "metadata[maya_conversation]": c.conv, "metadata[maya_reason]": reason.slice(0, 200) }, `maya-refund-${c.conv}-${chargeId}`);
  if (!r.ok) {
    await sb.rpc("maya_refund_finish", { p_id: g.id, p_ok: false, p_refund_id: null, p_detail: { status: r.status, type: r.data?.error?.type } });
    await raise("Maya: a refund failed at Stripe", `${r.status} ${cleanText(r.data?.error?.message, 120)}`);
    const code = await ticketFor("Stripe refused the refund");
    await log(c, "refund_blocked", { customer: v.customer, email: v.email, obj: chargeId, amount, result: "stripe_error", detail: { ticket: code } });
    return json({ ok: false, reason: "stripe_error", ticket_code: code, message: `The refund did not go through. I opened a ticket${code ? `, code ${code}` : ""} and Jared will follow up.` }, 502);
  }
  await sb.rpc("maya_refund_finish", { p_id: g.id, p_ok: true, p_refund_id: r.data.id, p_detail: { reason, charge_tail: chargeId.slice(-6) } });

  const { data: rows } = await sb.from("subscriptions").select("plan").eq("stripe_customer_id", v.customer).limit(1);
  const cust = await stripe("GET", `/customers/${v.customer}`);
  const first = cleanText(String(cust.data?.name ?? "").split(" ")[0], 30) || "a customer";
  const product = cleanText(ch.data.description, 50) || rows?.[0]?.plan || "Bestly";
  later(sb.rpc("maya_billing_alert", { p_title: `refunded ${money(amount)} to ${first} (${product}) — ${reason}`, p_body: `Refund ${String(r.data.id).slice(-8)} on the phone, verified by email code. Limits held: cap, 1 per 30 days, daily ceiling.`, p_dedupe: `maya-refund-${c.conv}-${chargeId}` }));
  later(sendMail(v.email, "Your Bestly refund", `We refunded ${money(amount)} to your card. Most banks show it within 5 to 10 business days.\n\nReason: ${reason}`, `maya-refund-mail-${c.conv}-${chargeId}`));
  return json({ ok: true, refunded: money(amount), message: `Done. ${money(amount)} is going back to the card, and most banks show it in 5 to 10 business days. A confirmation email is on its way.` });
}

// Service-key only: the watchdog calls this. Reports problems, never customer data.
async function health(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const keys = [SB_KEY];
  try { keys.push(...(Object.values(JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")) as string[])); } catch (_) { /* none */ }
  if (!keys.some((k) => k && auth === `Bearer ${k}`)) return json({ ok: false, error: "not allowed" }, 401);
  const problems: string[] = [];
  try { const r = await stripe("GET", "/customers", { limit: "1" }); if (!r.ok) problems.push(`Stripe key rejected (${r.status})`); } catch (e) { problems.push("Stripe key missing: " + cleanText((e as Error).message, 60)); }
  try { const r = await stripe("GET", "/billing_portal/configurations", { limit: "1", is_default: "true" }); if (r.ok && !(r.data?.data ?? []).length) problems.push("Stripe has no default customer portal set up"); } catch (_) { /* already reported */ }
  for (const t of ["maya_billing_settings", "maya_verifications", "maya_billing_actions", "maya_pay_links"]) {
    const { error } = await sb.from(t).select("*", { head: true, count: "exact" }).limit(1);
    if (error) problems.push(`table ${t} unreadable`);
  }
  const { data: s } = await sb.from("maya_billing_settings").select("enabled,refund_cap_cents").eq("id", true).maybeSingle();
  if (!s) problems.push("billing settings row missing");
  if (!Deno.env.get("RESEND_API_KEY")) problems.push("RESEND_API_KEY missing, codes cannot be emailed");
  const { data: el } = await sb.rpc("ava_secret", { p_name: "elevenlabs_api_key" });
  if (!el) problems.push("ElevenLabs key missing, conversations cannot be verified");
  return json({ ok: problems.length === 0, problems, refunds_enabled: s?.enabled ?? null });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false }, 405);
  let p: Record<string, unknown>;
  try { p = await req.json(); } catch { return json({ ok: false, error: "bad json" }, 400); }
  const action = String(p.action ?? "");
  try {
    if (action === "health") return await health(req);
    // A dry run never moves money or changes a subscription, so it may run after the call ends (used by tests).
    const write = ["cancel", "pause", "cancel_or_pause", "refund"].includes(action) && !isTrue(p.dry_run);
    if (!["start_verify", "check_code", "billing_status", "send_pay_link", "cancel", "pause", "cancel_or_pause", "refund"].includes(action)) return json({ ok: false, error: "unknown action" }, 400);
    const a = await authConversation(p, write || action === "send_pay_link");
    if (a instanceof Response) return a;
    switch (action) {
      case "start_verify": return await startVerify(a, p);
      case "check_code": return await checkCode(a, p);
      case "billing_status": return await billingStatus(a);
      case "send_pay_link": return await sendPayLink(a);
      case "refund": return await refund(a, p);
      case "pause": return await changeSubscription(a, p, "pause");
      case "cancel": return await changeSubscription(a, p, p.mode === "now" ? "cancel_now" : "cancel_period_end");
      default: { // cancel_or_pause: one tool for the phone, `choice` says which
        const choice = String(p.choice ?? "");
        if (choice === "pause") return await changeSubscription(a, p, "pause");
        if (choice === "cancel_now") return await changeSubscription(a, p, "cancel_now");
        if (choice === "cancel_at_period_end") return await changeSubscription(a, p, "cancel_period_end");
        return json({ ok: false, reason: "bad_choice", message: "choice must be pause, cancel_at_period_end or cancel_now." });
      }
    }
  } catch (e) {
    await raise("Maya: a billing tool crashed", cleanText((e as Error).message, 200));
    return json({ ok: false, error: "could not complete", message: "Something went wrong on my side. Open a billing ticket and tell the caller Jared will follow up." }, 500);
  }
});
