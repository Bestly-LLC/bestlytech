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

  // Auth: require maintenance secret
  const secret = req.headers.get("x-maintenance-secret");
  if (!secret || secret !== Deno.env.get("MAINTENANCE_SECRET")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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

    const BANNED_SELECTORS = ['body', 'html', 'head', 'body *', 'html *', '*'];
    const EXCLUDED_DOMAINS = [
      'icloud.com', 'mail.google.com', 'drive.google.com', 'docs.google.com',
      'outlook.live.com', 'outlook.office.com', 'teams.microsoft.com',
      'accounts.google.com', 'appleid.apple.com',
    ];

    for (const entry of entries) {
      try {
        // Guard: skip banned selectors and excluded domains
        if (BANNED_SELECTORS.includes((entry.clicked_selector || '').trim().toLowerCase())) {
          results.push({ domain: entry.domain, error: `Rejected banned selector: ${entry.clicked_selector}` });
          continue;
        }
        const domainLower = (entry.domain || '').toLowerCase();
        if (EXCLUDED_DOMAINS.some((ed: string) => domainLower === ed || domainLower.endsWith('.' + ed))) {
          results.push({ domain: entry.domain, error: 'Excluded domain' });
          continue;
        }
        // Infer action_type from the clicked_selector text
        const selectorLower = (entry.clicked_selector || "").toLowerCase();
        let inferredAction = "reject"; // default
        if (/accept|agree|allow|got-it|gotit|ok-button/i.test(selectorLower)) {
          inferredAction = "accept";
        } else if (/close|dismiss|x-button|btn-close/i.test(selectorLower)) {
          inferredAction = "close";
        } else if (/necessary|essential|required-only/i.test(selectorLower)) {
          inferredAction = "necessary";
        } else if (/save|confirm|preferences/i.test(selectorLower)) {
          inferredAction = "save";
        }

        // Insert pattern from consensus
        await supabase.rpc("upsert_pattern", {
          _domain: entry.domain,
          _selector: entry.clicked_selector,
          _action_type: inferredAction,
          _cmp_fingerprint: "generic",
          _source: "user_consensus",
        });

        // Set confidence based on report count
        const confidence = Math.min(5 + entry.report_count, 9);
        await supabase.from("cookie_patterns")
          .update({ confidence })
          .eq("domain", entry.domain)
          .eq("selector", entry.clicked_selector);

        // Log success
        await supabase.from("ai_generation_log").insert({
          domain: entry.domain,
          status: "success_consensus",
          selector_generated: entry.clicked_selector,
          action_type: inferredAction,
          confidence,
          ai_model: "user_consensus",
          html_source: `Consensus from ${entry.report_count} user dismissals. Banner: ${entry.banner_selector || "unknown"}. Inferred action: ${inferredAction}`.substring(0, 500),
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
        results.push({ domain: entry.domain, selector: entry.clicked_selector, action_type: inferredAction, confidence, reports: entry.report_count });
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
