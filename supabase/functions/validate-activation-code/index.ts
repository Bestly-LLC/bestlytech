import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// SEC-04: DB-backed rate limit — the previous in-memory Map reset on every
// Deno isolate cold start, letting an attacker with patience brute-force a
// 6-digit code. Now gated by public.check_activation_rate_limit() which
// stores attempts in the activation_code_attempts table.

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, code, platform } = await req.json();

    if (!email || !code) {
      return new Response(
        JSON.stringify({ error: "email and code are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // DB-backed rate limit (SEC-04).
    const { data: rl, error: rlError } = await supabase.rpc(
      "check_activation_rate_limit",
      { p_email: normalizedEmail, p_action: "validate" }
    );
    if (rlError) {
      console.error("rate-limit rpc error:", rlError);
      return new Response(
        JSON.stringify({ error: "rate_limit_unavailable" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (rl && rl.allowed === false) {
      return new Response(
        JSON.stringify({
          error: "Too many attempts. Please wait a few minutes.",
          retry_after: rl.retry_after ?? 0,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": String(rl.retry_after ?? 60),
          },
        }
      );
    }

    const { data: rows, error: selectError } = await supabase
      .from("activation_codes")
      .select("*")
      .eq("email", normalizedEmail)
      .eq("code", code)
      .eq("active", false)
      .gt("expires_at", new Date().toISOString())
      .limit(1);

    if (selectError) {
      console.error("Select error:", selectError);
      return new Response(
        JSON.stringify({ error: "Database error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!rows || rows.length === 0) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const row = rows[0];
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      || req.headers.get("cf-connecting-ip")
      || "unknown";

    const { error: updateError } = await supabase
      .from("activation_codes")
      .update({
        active: true,
        activated_at: new Date().toISOString(),
        ip_address: ip,
        platform: platform || row.platform,
      })
      .eq("id", row.id);

    if (updateError) {
      console.error("Update error:", updateError);
      return new Response(
        JSON.stringify({ error: "Failed to activate code" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Reset the rate-limit counter on success so legitimate retries after
    // a successful activation aren't penalised.
    await supabase
      .from("activation_code_attempts")
      .delete()
      .eq("email", normalizedEmail)
      .eq("action", "validate");

    return new Response(
      JSON.stringify({ success: true, activated: true, code }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("validate-activation-code error:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
