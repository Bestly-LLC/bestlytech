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

  // Require admin auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(authHeader.replace("Bearer ", ""));
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Verify admin role using service role client
  const svcClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data: isAdmin } = await svcClient.rpc("has_role", { _user_id: claimsData.claims.sub, _role: "admin" });
  if (!isAdmin) {
    return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
  if (!LOVABLE_API_KEY) {
    return new Response(
      JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = svcClient;

  const results: any[] = [];
  let processed = 0, generated = 0, skipped = 0, failed = 0;

  try {
    // Check for optional single-domain mode
    let requestBody: any = {};
    try {
      requestBody = await req.json();
    } catch {
      // empty body is fine
    }

    let items: any[] = [];

    if (requestBody.domain) {
      // Single-domain mode: fetch that domain directly
      const { data: singleDomain, error: singleErr } = await supabase
        .from("missed_banner_reports")
        .select("*")
        .eq("domain", requestBody.domain)
        .eq("resolved", false)
        .limit(1);
      if (singleErr) throw singleErr;
      items = singleDomain ?? [];
    } else {
      // Batch mode: use RPC
      const { data: candidates, error: fetchErr } = await supabase.rpc(
        "get_ai_generation_candidates",
        { _limit: 5 }
      );
      if (fetchErr) throw fetchErr;
      items = (candidates as any[]) ?? [];
    }

    for (const candidate of items) {
      processed++;

      if (!candidate.banner_html) {
        skipped++;
        await supabase.from("ai_generation_log").insert({
          domain: candidate.domain,
          status: "skipped_no_html",
          ai_model: "gemini-3-flash",
        });
        await supabase.rpc("mark_ai_processed", {
          _domain: candidate.domain,
          _resolved: false,
        });
        results.push({ domain: candidate.domain, status: "skipped_no_html" });
        continue;
      }

      try {
        const prompt = `You are a cookie banner analysis expert. First, determine if this HTML is actually a cookie consent / privacy / GDPR banner. If it is a signup form, newsletter popup, registration modal, promotional overlay, age gate, or any non-cookie element, set "is_cookie_banner" to false.

If it IS a cookie banner, analyze it and identify the best CSS selector to DISMISS or REJECT cookies (prefer reject/decline over accept).

Return ONLY valid JSON with these fields:
- "is_cookie_banner": true if this is a cookie/consent/privacy banner, false otherwise
- "rejection_reason": if is_cookie_banner is false, a short explanation of what the HTML actually is (e.g. "signup popup", "newsletter modal")
- "selector": a CSS selector for the reject/decline/dismiss button (only if is_cookie_banner is true)
- "action": either "click" or "hide" (only if is_cookie_banner is true)
- "confidence": a number 0-1 indicating how confident you are (only if is_cookie_banner is true)

Rules (only apply when is_cookie_banner is true):
- Prefer reject/decline/necessary-only buttons over accept buttons
- If no reject button exists, use a close/dismiss button
- If only accept exists, use it but set confidence lower
- The selector must be specific enough to not match other elements

HTML to analyze:
${candidate.banner_html}

Domain: ${candidate.domain}
${candidate.cmp_fingerprint !== "unknown" ? `CMP: ${candidate.cmp_fingerprint}` : ""}`;

        const aiRes = await fetch(
          "https://ai.gateway.lovable.dev/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${LOVABLE_API_KEY}`,
            },
            body: JSON.stringify({
              model: "google/gemini-3-flash-preview",
              messages: [
                {
                  role: "system",
                  content: "You are a cookie banner analysis expert. Always respond with valid JSON only, no markdown or explanation. You must first determine whether the provided HTML is actually a cookie consent banner before analyzing it.",
                },
                { role: "user", content: prompt },
              ],
            }),
          }
        );

        if (!aiRes.ok) {
          const errText = await aiRes.text();
          throw new Error(`AI gateway error ${aiRes.status}: ${errText}`);
        }

        const aiData = await aiRes.json();
        const content = aiData.choices?.[0]?.message?.content;
        if (!content) throw new Error("No content in AI response");

        const usage = aiData.usage ?? {};

        // Parse JSON from response (handle markdown code blocks)
        let jsonStr = content.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();

        const parsed = JSON.parse(jsonStr);

        // Check if AI determined this is NOT a cookie banner
        if (parsed.is_cookie_banner === false) {
          const reason = parsed.rejection_reason || "not a cookie banner";
          await supabase.from("ai_generation_log").insert({
            domain: candidate.domain,
            status: "skipped_not_cookie_banner",
            error_message: reason.substring(0, 500),
            ai_model: "gemini-3-flash",
            prompt_tokens: usage.prompt_tokens ?? null,
            completion_tokens: usage.completion_tokens ?? null,
            html_source: candidate.banner_html?.substring(0, 500),
          });
          await supabase.rpc("mark_ai_processed", {
            _domain: candidate.domain,
            _resolved: false,
          });
          skipped++;
          results.push({ domain: candidate.domain, status: "skipped_not_cookie_banner", reason });
          continue;
        }

        const selector = parsed.selector;
        const action = parsed.action === "hide" ? "hide" : "click";
        const rawConfidence = Number(parsed.confidence) || 0.5;
        const confidence = Math.min(rawConfidence, 0.6);

        if (!selector) throw new Error("No selector in AI response");

        const { error: upsertErr } = await supabase.rpc("upsert_pattern", {
          _domain: candidate.domain,
          _selector: selector,
          _action_type: action === "hide" ? "close" : "reject",
          _cmp_fingerprint: candidate.cmp_fingerprint || "generic",
          _source: "ai_generated",
        });
        if (upsertErr) throw upsertErr;

        // Update confidence to capped value
        await supabase
          .from("cookie_patterns")
          .update({ confidence })
          .eq("domain", candidate.domain)
          .eq("selector", selector);

        await supabase.from("ai_generation_log").insert({
          domain: candidate.domain,
          status: "success",
          selector_generated: selector,
          action_type: action === "hide" ? "close" : "reject",
          confidence,
          ai_model: "gemini-3-flash",
          prompt_tokens: usage.prompt_tokens ?? null,
          completion_tokens: usage.completion_tokens ?? null,
          html_source: candidate.banner_html?.substring(0, 500),
        });

        await supabase.rpc("mark_ai_processed", {
          _domain: candidate.domain,
          _resolved: true,
        });

        generated++;
        results.push({
          domain: candidate.domain,
          status: "success",
          selector,
          action,
          confidence,
        });
      } catch (err: any) {
        failed++;
        await supabase.from("ai_generation_log").insert({
          domain: candidate.domain,
          status: "error",
          error_message: err.message?.substring(0, 500),
          ai_model: "gemini-3-flash",
        });
        await supabase.rpc("mark_ai_processed", {
          _domain: candidate.domain,
          _resolved: false,
        });
        results.push({
          domain: candidate.domain,
          status: "error",
          error: err.message,
        });
      }
    }

    return new Response(
      JSON.stringify({ processed, generated, skipped, failed, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
