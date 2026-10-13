// agent-checkout: Bestly Agent signup -> Stripe Checkout (docs/maya-sales-opusplan.md, part 5).
//
// Public endpoint (verify_jwt = false). Called by the Pay securely button on bestly.tech/agent#pricing, which is a visitor's own tap.
// Maya never calls this, and nothing here ever sees a card: the buyer pays on Stripe's page.
//
//   POST { plan, name, email, company, phone?, conversation_id? }  ->  { ok: true, url }   (url = a Stripe Checkout page)
//   GET  ?ping=1                                                   ->  { ok, problems, prices }   creates nothing; the watchdog's hourly check
//
// Rules enforced here, never in the browser:
//   - The price always comes from ../_shared/agent-plans.ts. The request only names a plan.
//   - Origin must be bestly.tech or www.bestly.tech (localhost only when this runs on a local Supabase stack).
//   - 5 sessions per email and 20 per IP per hour (in memory per instance, and counted in agent_orders).
//   - Stripe key: Vault (stripe_secret RPC) first, then STRIPE_SECRET_KEY. It is never logged or returned.
//   - An agent_orders row (status checkout_started) is written before the URL goes back.
//   - Stripe or database failures raise a Maya sales alert (maya.sales), signed by Maya.
import { createClient } from "npm:@supabase/supabase-js@2";
import { AGENT_PLANS, isPlanId, planById, type AgentPlan } from "../_shared/agent-plans.ts";

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: any;

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_KEY: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sb = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const SITE = "https://bestly.tech";
const ALLOWED_ORIGINS = new Set(["https://bestly.tech", "https://www.bestly.tech"]);
const LOCAL_STACK = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(SB_URL);
const PER_EMAIL_HOUR = 5;
const PER_IP_HOUR = 20;
const PHONE_LINE = "(213) 641-0074";
// Call Guard: the exact line shown above Pay securely when a phone number is given. Keep identical to CALL_CONSENT_TEXT in src/lib/callConsent.ts.
const CALL_CONSENT_TEXT = "By sending, you agree Bestly may call or text you about your request, including with an AI assistant. Consent isn't required to buy anything.";

const clean = (s: unknown, n: number) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const later = (p: PromiseLike<unknown>) => { const q = Promise.resolve(p).catch(() => {}); try { EdgeRuntime.waitUntil(q); } catch (_) { /* not on the edge runtime */ } };
const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n))).map((b) => b.toString(16).padStart(2, "0")).join("");
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))).map((b) => b.toString(16).padStart(2, "0")).join("");

function originOk(origin: string): boolean {
  return ALLOWED_ORIGINS.has(origin) || (LOCAL_STACK && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin));
}
function corsFor(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": originOk(origin) ? origin : "https://bestly.tech",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Vary": "Origin",
  };
}
function json(b: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(b), { status, headers: { ...corsFor(origin), "Content-Type": "application/json" } });
}

// ---------- Stripe (key from Vault, like maya-billing) ----------
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
async function stripe(method: "GET" | "POST", path: string, params?: Record<string, string>, idem?: string): Promise<{ ok: boolean; status: number; data: any }> {
  const key = await stripeKey();
  const q = params && method === "GET" ? "?" + new URLSearchParams(params).toString() : "";
  const r = await fetch(`https://api.stripe.com/v1${path}${q}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(method !== "GET" ? { "Content-Type": "application/x-www-form-urlencoded" } : {}), ...(idem ? { "Idempotency-Key": idem } : {}) },
    body: method !== "GET" && params ? new URLSearchParams(params).toString() : undefined,
  });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}

// ---------- alerts (signed by Maya through the owner of maya.sales) ----------
async function raiseProblem(reason: string) {
  try {
    await sb.rpc("bestly_raise", {
      p_key: "maya.sales", p_kind: "problem", p_severity: "warning",
      p_title: `I can't take payments: ${reason}`.slice(0, 160), p_body: "Bestly Agent signups on bestly.tech/agent are failing, so nobody can pay right now.",
      p_area: "maya", p_needs_jared: "Check the Stripe key in the Vault and the Stripe dashboard; signups work again by themselves once Stripe answers.",
    });
  } catch (_) { /* an alert must never be the thing that fails a signup */ }
}

// ---------- prices: found by lookup key, created on first use ----------
type PriceState = { id: string | null; state: "ok" | "missing" | "mismatch" };
async function findPrice(plan: AgentPlan): Promise<PriceState> {
  const r = await stripe("GET", "/prices", { "lookup_keys[]": plan.lookupKey, active: "true", limit: "1" });
  if (!r.ok) throw new Error(`stripe prices ${r.status}`);
  const p = r.data?.data?.[0];
  if (!p) return { id: null, state: "missing" };
  const same = p.unit_amount === plan.monthlyCents && p.currency === "usd" && p.recurring?.interval === "month" && (p.recurring?.interval_count ?? 1) === 1;
  return { id: p.id, state: same ? "ok" : "mismatch" };
}

async function productFor(plan: AgentPlan): Promise<string> {
  // Search first so a missing price never makes a second product. If search is unavailable, create (idempotent for a day).
  try {
    const s = await stripe("GET", "/products/search", { query: `metadata['bestly_plan']:'${plan.id}' AND active:'true'`, limit: "1" });
    const id = s.data?.data?.[0]?.id;
    if (s.ok && id) return id as string;
  } catch (_) { /* fall through to create */ }
  const c = await stripe("POST", "/products", {
    name: `Bestly Agent ${plan.name}`,
    description: `Bestly Agent ${plan.name}: ${plan.includedMinutes} minutes of calls a month.`,
    "metadata[bestly_plan]": plan.id,
    "metadata[product]": "bestly_agent",
  }, `bestly-agent-product-${plan.id}`);
  if (!c.ok || !c.data?.id) throw new Error(`stripe product ${c.status}`);
  return c.data.id as string;
}

async function ensurePrice(plan: AgentPlan): Promise<string> {
  const found = await findPrice(plan);
  if (found.id && found.state === "ok") return found.id;
  const product = await productFor(plan);
  // A price whose amount no longer matches the plans file is replaced: the new one takes over the lookup key.
  const r = await stripe("POST", "/prices", {
    product,
    currency: "usd",
    unit_amount: String(plan.monthlyCents),
    "recurring[interval]": "month",
    lookup_key: plan.lookupKey,
    transfer_lookup_key: "true",
    nickname: `${plan.name} monthly`,
    "metadata[bestly_plan]": plan.id,
  }, `bestly-agent-price-${plan.lookupKey}-${plan.monthlyCents}`);
  if (!r.ok || !r.data?.id) throw new Error(`stripe price ${r.status}`);
  return r.data.id as string;
}

// ---------- watchdog ping ----------
let pingCache: { at: number; body: Record<string, unknown>; ok: boolean } | null = null;
async function ping(origin: string): Promise<Response> {
  if (pingCache && Date.now() - pingCache.at < 45_000) return json(pingCache.body, pingCache.ok ? 200 : 503, origin);
  const problems: string[] = [];
  const prices: Record<string, string> = {};
  try { await stripeKey(); } catch { problems.push("no Stripe key (Vault stripe_secret_key or STRIPE_SECRET_KEY)"); }
  if (!problems.length) {
    for (const p of AGENT_PLANS) {
      try {
        prices[p.id] = (await findPrice(p)).state; // missing / mismatch are fine: the first checkout creates or replaces them
      } catch (e) {
        prices[p.id] = "error";
        problems.push(`Stripe would not list the ${p.name} price (${String((e as Error).message).slice(0, 60)})`);
      }
    }
  }
  const t = await sb.from("agent_orders").select("id", { count: "exact", head: true });
  if (t.error) problems.push("the agent_orders table is not readable");
  const body = { ok: problems.length === 0, problems, prices };
  pingCache = { at: Date.now(), body, ok: body.ok };
  return json(body, body.ok ? 200 : 503, origin);
}

// ---------- rate limit ----------
const hits = new Map<string, number[]>();
function memHit(key: string, limit: number): boolean {
  const now = Date.now();
  const a = (hits.get(key) ?? []).filter((t) => now - t < 3600_000);
  if (a.length >= limit) { hits.set(key, a); return false; }
  a.push(now);
  hits.set(key, a);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3600_000)) hits.delete(k);
  return true;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsFor(origin) });

  const url = new URL(req.url);
  if (req.method === "GET") {
    if (url.searchParams.get("ping") === "1") return await ping(origin);
    return json({ ok: false, error: "not found" }, 404, origin);
  }
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405, origin);
  if (!originOk(origin)) return json({ ok: false, error: "This can only be started from bestly.tech." }, 403, origin);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "That request wasn't readable. Please try again." }, 400, origin); }

  const plan = String(body?.plan ?? "").toLowerCase();
  if (!isPlanId(plan)) return json({ ok: false, error: "Please pick a plan." }, 400, origin);
  const name = clean(body.name, 100);
  const email = clean(body.email, 254).toLowerCase();
  const company = clean(body.company, 120);
  const phoneRaw = clean(body.phone, 40);
  const phone = phoneRaw && phoneRaw.replace(/\D/g, "").length >= 7 ? phoneRaw : "";
  const conv = /^conv_[A-Za-z0-9]{4,76}$/.test(String(body.conversation_id ?? "")) ? String(body.conversation_id) : null;
  if (!name) return json({ ok: false, error: "Please add your name." }, 400, origin);
  if (!EMAIL_RE.test(email)) return json({ ok: false, error: "That email doesn't look right. Please check it." }, 400, origin);
  if (!company) return json({ ok: false, error: "Please add your business name." }, 400, origin);
  if (phoneRaw && !phone) return json({ ok: false, error: "That phone number looks too short. Fix it or leave it blank." }, 400, origin);

  const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  const ipHash = (await sha(`bestly-agent|${ip}`)).slice(0, 32);
  const tooMany = { ok: false, error: `Too many tries. Please wait a while, or call ${PHONE_LINE}.` };
  if (!memHit(`e:${email}`, PER_EMAIL_HOUR) || !memHit(`i:${ipHash}`, PER_IP_HOUR)) return json(tooMany, 429, origin);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const [byEmail, byIp] = await Promise.all([
    sb.from("agent_orders").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", since),
    sb.from("agent_orders").select("id", { count: "exact", head: true }).eq("ip_hash", ipHash).gte("created_at", since),
  ]);
  if (byEmail.error || byIp.error) {
    console.error("agent-checkout: order count failed", byEmail.error?.code ?? byIp.error?.code);
    later(raiseProblem("the orders table did not answer"));
    return json({ ok: false, error: `We couldn't open the payment page. Please try again, or call ${PHONE_LINE}.` }, 500, origin);
  }
  if ((byEmail.count ?? 0) >= PER_EMAIL_HOUR || (byIp.count ?? 0) >= PER_IP_HOUR) return json(tooMany, 429, origin);

  const p = planById(plan);
  const token = hex(24); // 48 hex characters: the welcome link
  const { data: order, error: insErr } = await sb.from("agent_orders").insert({
    token, plan, monthly_cents: p.monthlyCents, status: "checkout_started", name, email, phone: phone || null, company, conversation_id: conv, ip_hash: ipHash,
  }).select("id").single();
  if (insErr || !order) {
    console.error("agent-checkout: order insert failed", insErr?.code);
    later(raiseProblem("the orders table did not save"));
    return json({ ok: false, error: `We couldn't open the payment page. Please try again, or call ${PHONE_LINE}.` }, 500, origin);
  }

  try {
    const priceId = await ensurePrice(p);
    const base = LOCAL_STACK && originOk(origin) ? origin : SITE;
    const common: Record<string, string> = {
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      customer_email: email,
      allow_promotion_codes: "false",
      billing_address_collection: "auto",
      client_reference_id: order.id,
      "metadata[product]": "bestly_agent",
      "metadata[plan]": plan,
      "metadata[order_id]": order.id,
      "subscription_data[metadata][product]": "bestly_agent",
      "subscription_data[metadata][plan]": plan,
      "subscription_data[metadata][order_id]": order.id,
      success_url: `${base}/agent/welcome?o=${token}`,
      cancel_url: `${base}/agent#pricing`,
    };
    // Terms acceptance on Stripe's page. That needs a terms link saved in the Stripe dashboard; if there isn't one, Stripe refuses,
    // so fall back to the same promise as text under the Pay button (still linking /terms) instead of failing the signup.
    let s = await stripe("POST", "/checkout/sessions", {
      ...common,
      "consent_collection[terms_of_service]": "required",
      "custom_text[terms_of_service_acceptance][message]": `I agree to the [Bestly terms](${SITE}/terms).`,
    }, `bestly-agent-session-${order.id}`);
    if (!s.ok && s.status === 400 && /terms/i.test(String(s.data?.error?.message ?? ""))) {
      s = await stripe("POST", "/checkout/sessions", {
        ...common,
        "custom_text[submit][message]": `By paying you agree to the [Bestly terms](${SITE}/terms). No setup fee, 30-day money back, cancel anytime.`,
      }, `bestly-agent-session-${order.id}-b`);
    }
    if (!s.ok || !s.data?.url || !s.data?.id) throw new Error(`stripe session ${s.status}`);

    await sb.from("agent_orders").update({ stripe_session_id: s.data.id }).eq("id", order.id);
    if (phone) {
      // Proof of the consent line shown above the button (Call Guard). The order is saved, so a failure here never fails the signup.
      const { error: cErr } = await sb.from("call_consents").insert({
        phone, seller: "bestly", source: "agent_checkout", consent_text: CALL_CONSENT_TEXT, form_ref: `agent_orders:${order.id}`,
      });
      if (cErr) console.error("agent-checkout: consent record failed", cErr.code);
    }
    // The watchdog's problem alert clears the next time its ping passes; a good signup is the same proof, so close it now.
    later(sb.rpc("bestly_raise", { p_key: "maya.sales", p_kind: "resolved", p_severity: "info", p_title: "Payments are working again", p_area: "maya" }));
    return json({ ok: true, url: s.data.url }, 200, origin);
  } catch (e) {
    const why = String((e as Error)?.message ?? e).slice(0, 80);
    console.error("agent-checkout: failed", why);
    await sb.from("agent_orders").delete().eq("id", order.id).eq("status", "checkout_started"); // no session was made, so there is nothing to keep
    later(raiseProblem(why.startsWith("no stripe key") ? "the Stripe key is missing" : `Stripe did not answer (${why})`));
    return json({ ok: false, error: `We couldn't open the payment page. Please try again, or call ${PHONE_LINE}.` }, 502, origin);
  }
});
