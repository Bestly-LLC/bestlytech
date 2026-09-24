import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

/**
 * Generate a Stripe Payment Link for a deal's deposit.
 * Auth: admin role required (uses service role behind admin-auth gate).
 *
 * Body: { deal_id: string, amount_cents: number, description: string }
 * Returns: { url, payment_link_id }
 *
 * Stores stripe_customer_id (on deal) once created so subsequent links reuse
 * the same customer record.
 *
 * Each link accepts exactly one completed payment (restrictions.completed_sessions.limit = 1)
 * so a forwarded or bookmarked link can't take the deposit twice.
 *
 * Also makes sure the deal has an intake_token before the customer can pay, so the
 * "deposit paid" email sent by stripe-webhook always carries the intake link.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function ok(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bad(reason: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: reason }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function stripeForm(path: string, params: Record<string, string>) {
  const key = Deno.env.get("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  const body = new URLSearchParams(params);
  const r = await fetch(`https://api.stripe.com/v1${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`stripe ${path}: ${data?.error?.message ?? r.status}`);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return bad("method not allowed", 405);

  // Admin gate — caller must present a Supabase JWT with admin role.
  const authz = req.headers.get("authorization") || "";
  const token = authz.replace(/^Bearer\s+/i, "");
  if (!token) return bad("authentication required", 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = SB_SECRET;

  // Verify the caller's JWT and get their user_id, then check has_role(uid, 'admin')
  const sbAuth = createClient(supabaseUrl, serviceKey);
  const { data: userRes } = await sbAuth.auth.getUser(token);
  const uid = userRes?.user?.id;
  if (!uid) return bad("invalid auth", 401);

  const sb = createClient(supabaseUrl, serviceKey);
  const { data: roleCheck } = await sb.rpc("has_role", { _user_id: uid, _role: "admin" });
  if (!roleCheck) return bad("admin only", 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("invalid json");
  }

  const dealId = body?.deal_id;
  const amountCents = Number(body?.amount_cents);
  const description = String(body?.description || "Bestly In-House Cloud — deployment deposit");

  if (!dealId || typeof dealId !== "string") return bad("deal_id required");
  if (!amountCents || amountCents < 100) return bad("amount_cents must be >= 100");

  // Fetch deal + lead
  const { data: deal, error: dealErr } = await sb
    .from("cloud_deals")
    .select("id, lead_id, company_name, primary_contact_name, primary_contact_email, stripe_customer_id, intake_token")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr || !deal) return bad("deal not found", 404);

  // Intake link must exist before payment: stripe-webhook puts it in the receipt email.
  // Same format as the admin "Copy intake link" button (24 random bytes, 48 hex chars).
  // Only fills an empty slot, so a link already sent to the customer keeps working.
  if (!deal.intake_token) {
    const { error: tokErr } = await sb
      .from("cloud_deals")
      .update({ intake_token: randomHex(24) })
      .eq("id", deal.id)
      .is("intake_token", null);
    if (tokErr) {
      console.error("intake_token create error", tokErr);
      return bad("could not create the intake link for this deal", 500);
    }
  }

  try {
    // 1. Create or reuse Stripe customer
    let customerId = deal.stripe_customer_id;
    if (!customerId) {
      const customer = await stripeForm("/customers", {
        email: deal.primary_contact_email,
        name: deal.primary_contact_name,
        "metadata[deal_id]": deal.id,
        "metadata[company_name]": deal.company_name,
      });
      customerId = customer.id;
      await sb.from("cloud_deals").update({ stripe_customer_id: customerId }).eq("id", deal.id);
    }

    // 2. Create one-off product + price (each deal can have unique amount)
    const product = await stripeForm("/products", {
      name: `Bestly Cloud — ${deal.company_name}`,
      description,
      "metadata[deal_id]": deal.id,
    });
    const price = await stripeForm("/prices", {
      product: product.id,
      unit_amount: String(amountCents),
      currency: "usd",
    });

    // 3. Create payment link
    const link = await stripeForm("/payment_links", {
      "line_items[0][price]": price.id,
      "line_items[0][quantity]": "1",
      "metadata[deal_id]": deal.id,
      "metadata[company_name]": deal.company_name,
      "after_completion[type]": "redirect",
      "after_completion[redirect][url]": `https://bestly.tech/get-started?paid=${deal.id}`,
      // One successful payment per link — Stripe deactivates the link after it.
      "restrictions[completed_sessions][limit]": "1",
    });

    await sb.from("cloud_deal_events").insert({
      deal_id: deal.id,
      lead_id: deal.lead_id,
      event_type: "stripe_link_created",
      event_payload: {
        amount_cents: amountCents,
        description,
        payment_link_id: link.id,
        url: link.url,
      },
      triggered_by: "admin",
    });

    return ok({ ok: true, url: link.url, payment_link_id: link.id });
  } catch (err: any) {
    console.error("stripe error", err);
    return bad(err.message || "stripe error", 500);
  }
});
