import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BANNED_SELECTORS = ["body", "html", "head", "body *", "html *", "*"];
const EXCLUDED_DOMAINS = [
  "icloud.com", "mail.google.com", "drive.google.com", "docs.google.com",
  "outlook.live.com", "outlook.office.com", "teams.microsoft.com",
  "accounts.google.com", "appleid.apple.com",
];

function inferActionType(selector: string): string {
  const s = (selector || "").toLowerCase();
  if (/accept|agree|allow|got-it|gotit|ok-button/i.test(s)) return "accept";
  if (/close|dismiss|x-button|btn-close/i.test(s)) return "close";
  if (/necessary|essential|required-only/i.test(s)) return "necessary";
  if (/save|confirm|preferences/i.test(s)) return "save";
  return "reject";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { domain, clicked_selector, banner_selector, banner_html } = await req.json();

    if (!domain || !clicked_selector) {
      return new Response(
        JSON.stringify({ error: "domain and clicked_selector are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Guard: banned selectors
    if (BANNED_SELECTORS.includes((clicked_selector || "").trim().toLowerCase())) {
      return new Response(
        JSON.stringify({ error: "Rejected banned selector", skipped: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Guard: excluded domains
    const domainLower = (domain || "").toLowerCase();
    if (EXCLUDED_DOMAINS.some((ed) => domainLower === ed || domainLower.endsWith("." + ed))) {
      return new Response(
        JSON.stringify({ error: "Excluded domain", skipped: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Save the dismissal report
    await supabase.from("dismissal_reports").insert({
      domain,
      clicked_selector,
      banner_selector: banner_selector || null,
      banner_html: banner_html ? banner_html.substring(0, 5000) : null,
    });

    // 2. Check if domain already has a high-confidence pattern (skip if so)
    const { data: existing } = await supabase
      .from("cookie_patterns")
      .select("id, confidence")
      .eq("domain", domain)
      .eq("is_active", true)
      .gte("confidence", 5)
      .limit(1);

    if (existing && existing.length > 0) {
      return new Response(
        JSON.stringify({ message: "Pattern already exists", domain, skipped: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Count total dismissal reports for this domain+selector
    const { count } = await supabase
      .from("dismissal_reports")
      .select("id", { count: "exact", head: true })
      .eq("domain", domain)
      .eq("clicked_selector", clicked_selector);

    const reportCount = count || 1;

    // 4. Infer action type and create pattern immediately
    const actionType = inferActionType(clicked_selector);

    await supabase.rpc("upsert_pattern", {
      _domain: domain,
      _selector: clicked_selector,
      _action_type: actionType,
      _cmp_fingerprint: "generic",
      _source: "user_consensus",
    });

    // 5. Set confidence based on report count
    const confidence = Math.min(5 + reportCount, 9);
    await supabase
      .from("cookie_patterns")
      .update({ confidence })
      .eq("domain", domain)
      .eq("selector", clicked_selector);

    // 6. Log to ai_generation_log
    await supabase.from("ai_generation_log").insert({
      domain,
      status: "success_consensus",
      selector_generated: clicked_selector,
      action_type: actionType,
      confidence,
      ai_model: "user_consensus",
      html_source: `Real-time consensus from ${reportCount} dismissal(s). Banner: ${banner_selector || "unknown"}. Action: ${actionType}`.substring(0, 500),
    });

    // 7. Mark any matching missed_banner_reports as resolved
    await supabase.rpc("mark_ai_processed", {
      _domain: domain,
      _resolved: true,
    });

    // 8. Clean up processed dismissal reports for this domain
    await supabase.from("dismissal_reports").delete().eq("domain", domain);

    return new Response(
      JSON.stringify({
        message: "Pattern created",
        domain,
        selector: clicked_selector,
        action_type: actionType,
        confidence,
        reports: reportCount,
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
