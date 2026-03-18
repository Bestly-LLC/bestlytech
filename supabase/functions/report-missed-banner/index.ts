import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    const { domain, page_url, banner_html, cmp_fingerprint } = await req.json();

    if (!domain || typeof domain !== "string" || domain.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: "domain is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const trimmedDomain = domain.trim().toLowerCase();

    // 1. Save the report via existing RPC
    const { error: rpcError } = await supabase.rpc("report_missed_banner_with_html", {
      _domain: trimmedDomain,
      _page_url: page_url || null,
      _banner_html: banner_html || null,
      _cmp_fingerprint: cmp_fingerprint || "unknown",
    });

    if (rpcError) {
      console.error("RPC error:", rpcError);
      return new Response(
        JSON.stringify({ error: "Failed to save report", detail: rpcError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Immediately trigger AI processing for this domain
    let aiResult: any = null;
    try {
      const aiRes = await fetch(`${supabaseUrl}/functions/v1/ai-generate-pattern`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({ domain: trimmedDomain }),
      });
      aiResult = await aiRes.json();
    } catch (aiErr: any) {
      console.error("AI processing error (non-fatal):", aiErr.message);
      aiResult = { error: aiErr.message, note: "Report saved, AI will retry later" };
    }

    return new Response(
      JSON.stringify({
        success: true,
        domain: trimmedDomain,
        report_saved: true,
        ai_processing: aiResult,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
