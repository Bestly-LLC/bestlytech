import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

// SEC-01: Lock CORS to known first-party origins instead of '*'.
// This endpoint is intentionally public (pre-signup Cookie Yeti checkout),
// so JWT verification stays off, but we defense-in-depth via Origin allowlist
// + email format validation.
// CY-01: Cookie Yeti lives under bestly.tech/cookie-yeti; the standalone
// cookieyeti.app domain is not registered, so we don't accept it as an origin.
const ALLOWED_ORIGINS = new Set([
  "https://bestly.tech",
  "https://www.bestly.tech",
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
    if (!STRIPE_SECRET_KEY) {
      console.error("create-checkout: STRIPE_SECRET_KEY missing");
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // CY-01: Pull price IDs from Vault via the get_stripe_config() RPC, with
    // env-var fallback for backwards compatibility.
    let priceMap: Record<string, string | undefined> = {};
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const { data: cfg, error: cfgErr } = await supabase.rpc("get_stripe_config");
        if (cfgErr) {
          console.warn("get_stripe_config rpc failed, falling back to env vars:", cfgErr.message);
        } else if (cfg) {
          priceMap = {
            monthly: (cfg as { monthly?: string }).monthly ?? undefined,
            yearly: (cfg as { yearly?: string }).yearly ?? undefined,
            lifetime: (cfg as { lifetime?: string }).lifetime ?? undefined,
          };
        }
      } catch (e) {
        console.warn("get_stripe_config rpc threw:", e);
      }
    }
    priceMap.monthly = priceMap.monthly || Deno.env.get("STRIPE_PRICE_MONTHLY");
    priceMap.yearly = priceMap.yearly || Deno.env.get("STRIPE_PRICE_YEARLY");
    priceMap.lifetime = priceMap.lifetime || Deno.env.get("STRIPE_PRICE_LIFETIME");

    const priceId = priceMap[plan];
    if (!priceId) {
      console.error("create-checkout: no price ID for plan", { plan, hasMonthly: !!priceMap.monthly, hasYearly: !!priceMap.yearly, hasLifetime: !!priceMap.lifetime });
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
    // CY-01: Stripe redirects after checkout. Point at the bestly.tech
    // landing page routes since cookieyeti.app isn't a registered domain.
    params.append("success_url", "https://www.bestly.tech/cookie-yeti/success?session_id={CHECKOUT_SESSION_ID}");
    params.append("cancel_url", "https://www.bestly.tech/cookie-yeti/cancel");

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
