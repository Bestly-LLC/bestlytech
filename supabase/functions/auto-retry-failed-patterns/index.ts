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
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Find domains eligible for retry:
    // - Not resolved
    // - ai_attempts < 5 (after 5, it's permanently_failed)
    // - Not processed in last 24h
    const { data: candidates, error: fetchErr } = await supabase
      .from("missed_banner_reports")
      .select("*")
      .eq("resolved", false)
      .lt("ai_attempts", 5)
      .or(`ai_processed_at.is.null,ai_processed_at.lt.${twentyFourHoursAgo}`)
      .order("report_count", { ascending: false })
      .limit(10);

    if (fetchErr) throw fetchErr;
    if (!candidates || candidates.length === 0) {
      return new Response(
        JSON.stringify({ message: "No candidates for retry", processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Cross-reference with ai_generation_log to find failed OR never-processed domains
    const domains = candidates.map((c: any) => c.domain);
    const { data: allLogs } = await supabase
      .from("ai_generation_log")
      .select("domain, status")
      .in("domain", domains)
      .order("created_at", { ascending: false });

    // Domains that failed in the log
    const failedDomains = new Set(
      (allLogs ?? [])
        .filter((l: any) => ["needs_manual_review", "failed_not_cookie_banner", "error"].includes(l.status))
        .map((l: any) => l.domain)
    );

    // Domains that have NO log entries at all (never processed)
    const loggedDomains = new Set((allLogs ?? []).map((l: any) => l.domain));
    const neverProcessed = new Set(domains.filter((d: string) => !loggedDomains.has(d)));

    // Retry both failed and never-processed domains
    const retryable = candidates.filter(
      (c: any) => failedDomains.has(c.domain) || neverProcessed.has(c.domain)
    );

    let processed = 0;
    let succeeded = 0;
    let stillFailed = 0;
    let permanentlyFailed = 0;
    const results: any[] = [];

    for (const candidate of retryable) {
      processed++;

      try {
        // Call the existing ai-generate-pattern function via HTTP
        // Using service role key for auth (the function checks admin role,
        // but we'll call it with a flag to indicate it's a retry)
        // Actually, the ai-generate-pattern requires admin auth.
        // For the cron job, we need to bypass that. Instead, we'll inline the logic.
        
        // For simplicity and to avoid auth issues, we directly process here
        // by calling the function with service role key
        const res = await fetch(`${supabaseUrl}/functions/v1/ai-generate-pattern`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ domain: candidate.domain, is_retry: true }),
        });

        const data = await res.json();
        const result = data.results?.[0];

        if (result?.status?.startsWith("success")) {
          succeeded++;
          results.push({ domain: candidate.domain, status: result.status });
        } else {
          // Check if we've hit the retry limit
          const newAttempts = (candidate.ai_attempts || 0) + 1;
          if (newAttempts >= 5) {
            permanentlyFailed++;
            // Log permanently_failed status
            await supabase.from("ai_generation_log").insert({
              domain: candidate.domain,
              status: "permanently_failed",
              error_message: `Exhausted ${newAttempts} retry attempts. Last result: ${result?.status || "unknown"}`,
              ai_model: "auto-retry",
            });
            results.push({ domain: candidate.domain, status: "permanently_failed" });
          } else {
            stillFailed++;
            results.push({ domain: candidate.domain, status: result?.status || "still_failing", attempts: newAttempts });
          }
        }
      } catch (err: any) {
        stillFailed++;
        results.push({ domain: candidate.domain, status: "retry_error", error: err.message });
      }
    }

    return new Response(
      JSON.stringify({
        processed,
        succeeded,
        still_failed: stillFailed,
        permanently_failed: permanentlyFailed,
        results,
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
