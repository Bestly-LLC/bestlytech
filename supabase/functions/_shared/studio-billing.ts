// studio-billing — the only place Studio talks to Stripe.
//
// Three things live here and nothing else does:
//   1. The key. Vault first (stripe_secret RPC), env as the fallback, exactly
//      like stripe-webhook. No key ever reaches a browser.
//   2. The price. Read from studio_prices, never guessed from an amount, so the
//      file that shows a price and the price Stripe charges cannot disagree.
//   3. The three Stripe calls Studio needs: make a customer, open a checkout,
//      open the portal.
//
// Jared's locked rule: the card comes at the END of the wizard, there is a
// 7-day trial, and nothing posts before a card is on file. This module never
// decides who may post; studio_entitlement() does, from the database.

export type PlanId = "carousels" | "premium";
export type Cadence = "monthly" | "annual";

const API = "https://api.stripe.com/v1";

export type BillingCtx = {
  /** Supabase service-role client. */
  db: any;
  /** SUPABASE_URL, for the Vault RPC. */
  url: string;
  /** Service role key, for the Vault RPC's apikey header. */
  secret: string;
};

export async function stripeKey(ctx: BillingCtx): Promise<string | undefined> {
  try {
    const r = await fetch(`${ctx.url}/rest/v1/rpc/stripe_secret`, {
      method: "POST",
      headers: {
        apikey: ctx.secret,
        ...(ctx.secret.startsWith("sb_") ? {} : { Authorization: `Bearer ${ctx.secret}` }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_name: "stripe_secret_key" }),
    });
    if (r.ok) {
      const v = await r.json();
      if (typeof v === "string" && v) return v;
    }
  } catch (_) { /* fall back to env */ }
  return Deno.env.get("STRIPE_SECRET_KEY") || undefined;
}

/** Form-encode a flat-ish object the way Stripe's API expects. */
function form(obj: Record<string, unknown>, prefix = "", out: string[] = []): string {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === "object") form(item as Record<string, unknown>, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === "object") {
      form(v as Record<string, unknown>, key, out);
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out.join("&");
}

async function stripe(
  ctx: BillingCtx,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
): Promise<{ ok: boolean; status: number; data: any }> {
  const key = await stripeKey(ctx);
  if (!key) return { ok: false, status: 0, data: { error: "no_stripe_key" } };
  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (method === "POST") headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const r = await fetch(`${API}${path}`, {
    method,
    headers,
    body: method === "POST" ? form(body ?? {}) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

/** The Stripe price for a plan at a cadence, live mode only. */
export async function priceFor(ctx: BillingCtx, plan: PlanId, cadence: Cadence): Promise<string | null> {
  const { data } = await ctx.db
    .from("studio_prices")
    .select("stripe_price_id")
    .eq("plan", plan)
    .eq("cadence", cadence)
    .eq("livemode", true)
    .eq("active", true)
    .maybeSingle();
  return (data?.stripe_price_id as string) ?? null;
}

export async function extraVideoPrice(ctx: BillingCtx): Promise<string | null> {
  const { data } = await ctx.db
    .from("studio_prices")
    .select("stripe_price_id")
    .eq("plan", "extravideo")
    .eq("cadence", "once")
    .eq("livemode", true)
    .eq("active", true)
    .maybeSingle();
  return (data?.stripe_price_id as string) ?? null;
}

/**
 * One customer per signup. The id is kept on the signup row so a second tap on
 * "start my free week" reuses it instead of leaving a trail of half-made
 * customers in Stripe.
 */
export async function ensureCustomer(ctx: BillingCtx, signup: any): Promise<string | null> {
  const cached = signup?.answers?._stripe_customer;
  if (typeof cached === "string" && cached.startsWith("cus_")) return cached;

  const email = String(signup.email ?? "").toLowerCase().trim();
  if (!email) return null;
  const name = String(signup?.answers?.about?.name ?? "").slice(0, 120);

  const r = await stripe(ctx, "POST", "/customers", {
    email,
    name: name || undefined,
    metadata: { bestly_surface: "studio", studio_signup: signup.id },
  }, `studio-customer-${signup.id}`);
  if (!r.ok || !r.data?.id) return null;

  await ctx.db.from("studio_signups")
    .update({ answers: { ...(signup.answers ?? {}), _stripe_customer: r.data.id } })
    .eq("id", signup.id);
  return r.data.id as string;
}

/**
 * A subscription checkout with the 7-day trial. Metadata is the contract with
 * the webhook: surface=studio is what stops a Studio signup being written into
 * Cookie Yeti's subscriptions table.
 */
export async function createCheckout(
  ctx: BillingCtx,
  signup: any,
  plan: PlanId,
  cadence: Cadence,
  origin = "https://studio.bestly.tech",
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const price = await priceFor(ctx, plan, cadence);
  if (!price) return { ok: false, error: "We could not start the checkout. Nothing was charged. Try again, or email studio@bestly.tech." };

  const customer = await ensureCustomer(ctx, signup);
  const meta = {
    surface: "studio",
    signup_id: signup.id,
    plan,
    cadence,
  };

  const r = await stripe(ctx, "POST", "/checkout/sessions", {
    mode: "subscription",
    customer: customer ?? undefined,
    customer_email: customer ? undefined : String(signup.email),
    client_reference_id: signup.id,
    line_items: [{ price, quantity: 1 }],
    subscription_data: { trial_period_days: 7, metadata: meta },
    metadata: meta,
    allow_promotion_codes: false,
    billing_address_collection: "auto",
    success_url: `${origin}/start?done=1&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/start?step=11&cancelled=1`,
  }, `studio-checkout-${signup.id}-${plan}-${cadence}`);

  if (!r.ok || !r.data?.url) {
    console.error("studio checkout", r.status, r.data?.error?.message);
    return { ok: false, error: "Stripe would not open the checkout. Nothing was charged. Try again in a minute." };
  }
  return { ok: true, url: r.data.url as string };
}

/** Change plan, update the card, or cancel, without us in the middle. */
export async function createPortal(
  ctx: BillingCtx,
  customer: string,
  returnUrl = "https://studio.bestly.tech/",
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const cfg = await ctx.db.from("studio_settings").select("value").eq("key", "portal_configuration_id").maybeSingle();
  const configuration = typeof cfg?.data?.value === "string" ? cfg.data.value : undefined;

  const r = await stripe(ctx, "POST", "/billing_portal/sessions", {
    customer,
    configuration,
    return_url: returnUrl,
  });
  if (!r.ok || !r.data?.url) {
    console.error("studio portal", r.status, r.data?.error?.message);
    return { ok: false, error: "We could not open the billing page. Try again in a minute." };
  }
  return { ok: true, url: r.data.url as string };
}
