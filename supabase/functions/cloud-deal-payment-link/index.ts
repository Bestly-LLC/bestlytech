import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Generate a Stripe Payment Link for a deal's deposit.
 * Auth: admin role required (uses service role behind admin-auth gate).
 *
 * Body: { deal_id: string, amount_cents: number, description: string }
 * Returns: { url, payment_link_id }
 *
 * Stores stripe_customer_id (on deal) once created so subsequent links reuse
 * the same customer record.
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
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Verify the caller's JWT and get their user_id, then check has_role(uid, 'admin')
  const sbAuth = createClient(supabaseUrl, serviceKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
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
    .select("id, lead_id, company_name, primary_contact_name, primary_contact_email, stripe_customer_id")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr || !deal) return bad("deal not found", 404);

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
