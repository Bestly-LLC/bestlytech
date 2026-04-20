import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

// SEC-01: Lock CORS to known first-party origins instead of '*'.
// This endpoint is intentionally public (pre-signup Cookie Yeti checkout),
// so JWT verification stays off, but we defense-in-depth via Origin allowlist
// + email format validation.
const ALLOWED_ORIGINS = new Set([
  "https://bestly.tech",
  "https://www.bestly.tech",
  "https://cookieyeti.app",
  "https://www.cookieyeti.app",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function corsHeadersFor(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://bestly.tech";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = corsHeadersFor(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Reject requests that don't originate from a known first-party host.
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    console.warn("create-checkout: rejected origin", { origin });
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email: unknown = body?.email;
    const plan: unknown = body?.plan;

    if (typeof email !== "string" || typeof plan !== "string" || !email || !plan) {
      return new Response(JSON.stringify({ error: "email and plan are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (email.length > 254 || !EMAIL_RE.test(email)) {
      return new Response(JSON.stringify({ error: "Invalid email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    const priceMap: Record<string, string | undefined> = {
      monthly: Deno.env.get("STRIPE_PRICE_MONTHLY"),
      yearly: Deno.env.get("STRIPE_PRICE_YEARLY"),
      lifetime: Deno.env.get("STRIPE_PRICE_LIFETIME"),
    };

    if (!STRIPE_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const priceId = priceMap[plan];
    if (!priceId) {
      return new Response(JSON.stringify({ error: "Invalid plan. Must be monthly, yearly, or lifetime." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isSubscription = plan === "monthly" || plan === "yearly";

    const params = new URLSearchParams();
    params.append("customer_email", email);
    params.append("line_items[0][price]", priceId);
    params.append("line_items[0][quantity]", "1");
    params.append("mode", isSubscription ? "subscription" : "payment");
    params.append("success_url", "https://cookieyeti.app/success");
    params.append("cancel_url", "https://cookieyeti.app/cancel");

    const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });

    const session = await response.json();

    if (!response.ok) {
      console.error("Stripe error:", session);
      return new Response(JSON.stringify({ error: "Failed to create checkout session" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error:", error);
    return new Response(JSON.stringify({ error: "An error occurred" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
