import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, code, platform } = await req.json();

    if (!email || !code) {
      return new Response(JSON.stringify({ success: false, error: "missing_fields" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find matching pending code
    const { data: rows, error: selectError } = await supabase
      .from("activation_codes")
      .select("id")
      .eq("email", email.toLowerCase())
      .eq("code", code)
      .eq("active", false)
      .gt("expires_at", new Date().toISOString())
      .limit(1);

    if (selectError) throw selectError;

    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ success: false, error: "invalid_or_expired" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get IP from request headers
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("cf-connecting-ip") ||
               null;

    // Activate the code
    const { error: updateError } = await supabase
      .from("activation_codes")
      .update({
        active: true,
        activated_at: new Date().toISOString(),
        platform: platform || "unknown",
        ip_address: ip,
        expires_at: "2099-12-31T00:00:00.000Z",
      })
      .eq("id", rows[0].id);

    if (updateError) throw updateError;

    return new Response(JSON.stringify({ success: true, activated: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("validate-activation-code error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
