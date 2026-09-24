// CY-MIG-01: Server-side entitlement check. Replaces the client's raw anon
// reads of subscriptions/granted_access/activation_codes (which rcqfq RLS
// correctly blocks). Uses the service role internally; returns only a
// boolean + plan for the supplied email, never bulk subscriber data.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ isPremium: false, error: "method_not_allowed" }, 405);

  let body = {};
  try { body = await req.json(); } catch { /* empty */ }
  const email = String(body.email ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) return json({ isPremium: false });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = SB_SECRET;
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    // 1. Admin-granted comp access wins first.
    const { data: grant } = await db.from("granted_access").select("email").eq("email", email).limit(1);
    if (grant && grant.length > 0) {
      return json({ isPremium: true, plan: "granted" });
    }

    // 2. Active subscription.
    const { data: subs } = await db.from("subscriptions")
      .select("plan,status,current_period_end")
      .eq("email", email).eq("status", "active");
    if (subs && subs.length > 0) {
      const sub = subs[0];
      const periodEnd = sub.current_period_end ? new Date(sub.current_period_end) : null;
      if (!periodEnd || periodEnd > new Date()) {
        // Self-heal: surface an existing active activation code if present.
        const { data: codes } = await db.from("activation_codes")
          .select("code").eq("email", email).eq("active", true)
          .order("activated_at", { ascending: false }).limit(1);
        if (codes && codes.length > 0) {
          return json({ isPremium: true, plan: sub.plan, hasSubscription: true, activationCode: codes[0].code });
        }
        return json({ isPremium: true, plan: sub.plan, hasSubscription: true, needsActivation: true });
      }
    }

    return json({ isPremium: false });
  } catch (e) {
    // Fail-open is unsafe for a paywall; fail-closed but signal the error.
    return json({ isPremium: false, error: String(e) }, 200);
  }
});
