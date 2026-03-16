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

  const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const results: any[] = [];
  let processed = 0, generated = 0, skipped = 0, failed = 0;

  try {
    // Fetch candidates
    const { data: candidates, error: fetchErr } = await supabase.rpc(
      "get_ai_generation_candidates",
      { _limit: 5 }
    );
    if (fetchErr) throw fetchErr;

    const items = (candidates as any[]) ?? [];

    for (const candidate of items) {
      processed++;

      if (!candidate.banner_html) {
        // Skip - no HTML
        skipped++;
        await supabase.from("ai_generation_log").insert({
          domain: candidate.domain,
          status: "skipped_no_html",
          ai_model: "claude-sonnet",
        });
        await supabase.rpc("mark_ai_processed", {
          _domain: candidate.domain,
          _resolved: false,
        });
        results.push({ domain: candidate.domain, status: "skipped_no_html" });
        continue;
      }

      try {
        // Call Claude API
        const prompt = `You are a cookie banner analysis expert. Analyze this cookie consent banner HTML and identify the best CSS selector to DISMISS or REJECT cookies (prefer reject/decline over accept).

Return ONLY valid JSON with these fields:
- "selector": a CSS selector for the reject/decline/dismiss button (prefer specific selectors like IDs or data attributes)
- "action": either "click" or "hide"
- "confidence": a number 0-1 indicating how confident you are

Rules:
- Prefer reject/decline/necessary-only buttons over accept buttons
- If no reject button exists, use a close/dismiss button
- If only accept exists, use it but set confidence lower
- The selector must be specific enough to not match other elements

HTML to analyze:
${candidate.banner_html}

Domain: ${candidate.domain}
${candidate.cmp_fingerprint !== "unknown" ? `CMP: ${candidate.cmp_fingerprint}` : ""}`;

        const anthropicRes = await fetch(
          "https://api.anthropic.com/v1/messages",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": ANTHROPIC_API_KEY,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 300,
              messages: [{ role: "user", content: prompt }],
            }),
          }
        );

        if (!anthropicRes.ok) {
          const errText = await anthropicRes.text();
          throw new Error(`Anthropic API error ${anthropicRes.status}: ${errText}`);
        }

        const anthropicData = await anthropicRes.json();
        const textBlock = anthropicData.content?.find(
          (b: any) => b.type === "text"
        );
        if (!textBlock?.text) throw new Error("No text in Claude response");

        const usage = anthropicData.usage ?? {};

        // Parse JSON from response (handle markdown code blocks)
        let jsonStr = textBlock.text.trim();
        const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (jsonMatch) jsonStr = jsonMatch[1].trim();

        const parsed = JSON.parse(jsonStr);
        const selector = parsed.selector;
        const action = parsed.action === "hide" ? "hide" : "click";
        const rawConfidence = Number(parsed.confidence) || 0.5;
        const confidence = Math.min(rawConfidence, 0.6);

        if (!selector) throw new Error("No selector in AI response");

        // Insert into cookie_patterns via upsert_pattern
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

        // Log success
        await supabase.from("ai_generation_log").insert({
          domain: candidate.domain,
          status: "success",
          selector_generated: selector,
          action_type: action === "hide" ? "close" : "reject",
          confidence,
          ai_model: "claude-sonnet",
          prompt_tokens: usage.input_tokens ?? null,
          completion_tokens: usage.output_tokens ?? null,
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
          ai_model: "claude-sonnet",
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
