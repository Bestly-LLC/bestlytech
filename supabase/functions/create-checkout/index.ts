import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Stripe secrets (2026-09-24): Vault first (stripe_secret_key / stripe_webhook_secret via the
// service-only stripe_secret RPC), then the env var. Env secrets can't be set from Bestly's tooling;
// Vault can, through the clipboard intake slot, so the key never enters a chat.
async function stripeSecret(vaultName: string, envName: string): Promise<string | undefined> {
  try {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/stripe_secret`, {
      method: "POST",
      headers: { apikey: SB_SECRET, ...(SB_SECRET.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_SECRET}` }), "Content-Type": "application/json" },
      body: JSON.stringify({ p_name: vaultName }),
    });
    if (r.ok) { const v = await r.json(); if (typeof v === "string" && v) return v; }
  } catch (_) { /* fall back to env */ }
  return Deno.env.get(envName) || undefined;
}

// SEC-01 / CY-MIG-01: This endpoint is intentionally public (pre-signup Cookie
// Yeti checkout), so JWT verification stays off and we defend in depth via an
// Origin gate + email validation.
//
// First-party *web* origins are allowlisted below. First-party *extension /
// native* callers are ALSO first-party and must be allowed: the Chrome / Firefox
// / Safari web-extension popups send an extension-scheme Origin
// (chrome-extension:// | moz-extension:// | safari-web-extension://), and the
// background service worker (and native apps) send NO Origin header at all.
// Those are exactly the clients that start checkout from "Upgrade to Pro".
//
// Only a genuine third-party website doing a browser CORS call — Origin present,
// not on the allowlist, and not an extension scheme — is rejected with 403.
const ALLOWED_ORIGINS = new Set([
  "https://bestly.tech",
  "https://www.bestly.tech",
]);

const EXTENSION_ORIGIN_RE = /^(chrome-extension|moz-extension|safari-web-extension):\/\//i;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// A first-party caller is: no Origin (extension service worker / native fetch),
// an allowlisted first-party web origin, or a browser-extension-scheme origin.
function isFirstPartyOrigin(origin: string | null): boolean {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  if (EXTENSION_ORIGIN_RE.test(origin)) return true;
  return false;
}

function corsHeadersFor(origin: string | null): Record<string, string> {
  // Echo back a first-party origin so browser callers receive a valid ACAO;
  // fall back to the canonical site for everything else.
  const allowed = origin && isFirstPartyOrigin(origin) ? origin : "https://bestly.tech";
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

  // Reject genuine third-party web callers; allow first-party web + extension/native.
  if (!isFirstPartyOrigin(origin)) {
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

    const STRIPE_SECRET_KEY = await stripeSecret("stripe_secret_key", "STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) {
      console.error("create-checkout: STRIPE_SECRET_KEY missing");
      return new Response(JSON.stringify({ error: "Server configuration error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // CY-LIVE-01: Resolve the price set that matches the ACTIVE Stripe key's mode.
    // get_stripe_config(p_livemode) returns the LIVE price slot when the key is a
    // live key (sk_live_ / rk_live_) and the TEST slot otherwise. This keeps test
    // checkout working and makes live prices take effect automatically the instant
    // a live STRIPE_SECRET_KEY is set — no code change or redeploy needed.
    const isLiveMode = /^(sk|rk)_live_/.test(STRIPE_SECRET_KEY);

    // Pull price IDs from Vault via the get_stripe_config() RPC, with env-var
    // fallback for backwards compatibility.
    let priceMap: Record<string, string | undefined> = {};
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = SB_SECRET;
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const { data: cfg, error: cfgErr } = await supabase.rpc("get_stripe_config", { p_livemode: isLiveMode });
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
      console.error("create-checkout: no price ID for plan", { plan, livemode: isLiveMode, hasMonthly: !!priceMap.monthly, hasYearly: !!priceMap.yearly, hasLifetime: !!priceMap.lifetime });
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
    params.append("metadata[source]", "extension");
    params.append("metadata[plan]", plan);

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
