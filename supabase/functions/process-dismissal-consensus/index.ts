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

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Find domains with 3+ matching dismissal reports
    const { data: consensus, error: rpcErr } = await supabase.rpc("find_dismissal_consensus" as any);
    if (rpcErr) throw rpcErr;

    const entries = (consensus as any[]) ?? [];

    if (entries.length === 0) {
      return new Response(
        JSON.stringify({ message: "No consensus found", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let created = 0;
    const results: any[] = [];

    for (const entry of entries) {
      try {
        // Insert pattern from consensus
        await supabase.rpc("upsert_pattern", {
          _domain: entry.domain,
          _selector: entry.clicked_selector,
          _action_type: "reject", // User dismissed = reject intent
          _cmp_fingerprint: "generic",
          _source: "user_consensus",
        });

        // Set confidence based on report count
        const confidence = Math.min(0.5 + (entry.report_count * 0.05), 0.85);
        await supabase.from("cookie_patterns")
          .update({ confidence })
          .eq("domain", entry.domain)
          .eq("selector", entry.clicked_selector);

        // Log success
        await supabase.from("ai_generation_log").insert({
          domain: entry.domain,
          status: "success_consensus",
          selector_generated: entry.clicked_selector,
          action_type: "reject",
          confidence,
          ai_model: "user_consensus",
          html_source: `Consensus from ${entry.report_count} user dismissals. Banner: ${entry.banner_selector || "unknown"}`.substring(0, 500),
        });

        // Mark missed_banner_reports as resolved
        await supabase.rpc("mark_ai_processed", {
          _domain: entry.domain,
          _resolved: true,
        });

        // Clean up processed dismissal reports for this domain
        await supabase.from("dismissal_reports")
          .delete()
          .eq("domain", entry.domain);

        created++;
        results.push({ domain: entry.domain, selector: entry.clicked_selector, confidence, reports: entry.report_count });
      } catch (err: any) {
        results.push({ domain: entry.domain, error: err.message });
      }
    }

    return new Response(
      JSON.stringify({ processed: entries.length, created, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
