import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// v12 (2026-09-23 spend audit): this endpoint is public (the Cookie Yeti extension calls it) and asked
// Gemini 2.5 Pro on every request. The free layer (known-CMP detection) still runs for everyone; the
// paid AI layer only runs when ai_gate allows it (ai_caps: per-day cap, and per hashed IP per hour),
// and each call is logged with its cost in ai_spend.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Known CMP signatures + CDN/script URL patterns (mirrored from ai-generate-pattern)
const KNOWN_CMPS: { name: string; signatures: string[]; scriptSignatures: string[]; selector: string; action: string; cmp_fingerprint: string }[] = [
  { name: "OneTrust", signatures: ["onetrust", "optanon", "otBannerSdk"], scriptSignatures: ["cdn.cookielaw.org", "onetrust.com/consent", "otSDKStub", "otBannerSdk"], selector: "#onetrust-reject-all-handler, .ot-pc-refuse-all-btn, .save-preference-btn-handler, .onetrust-close-btn-handler", action: "reject", cmp_fingerprint: "onetrust" },
  { name: "Cookiebot", signatures: ["cookiebot", "CybotCookiebot"], scriptSignatures: ["consent.cookiebot.com", "cookiebot.com/uc.js", "CookieConsent.js"], selector: "#CybotCookiebotDialogBodyButtonDecline", action: "reject", cmp_fingerprint: "cookiebot" },
  { name: "Didomi", signatures: ["didomi"], scriptSignatures: ["sdk.privacy-center.org", "didomi.io/sdk", "didomi-sdk"], selector: '.didomi-continue-without-agreeing, [data-testid="notice-disagree-button"]', action: "reject", cmp_fingerprint: "didomi" },
  { name: "Quantcast", signatures: ["quantcast", "qc-cmp"], scriptSignatures: ["quantcast.mgr.consensu.org", "cmp2.js", "quantcast.com/choice"], selector: '#qc-cmp2-container [mode="secondary"], .qc-cmp2-summary-buttons button:first-child', action: "reject", cmp_fingerprint: "quantcast" },
  { name: "TrustArc", signatures: ["truste", "consent.trustarc", "trustarc"], scriptSignatures: ["consent.trustarc.com", "trustarc.com/notice", "truste.com"], selector: ".truste-consent-required, #truste-consent-button", action: "reject", cmp_fingerprint: "trustarc" },
  { name: "Complianz", signatures: ["complianz", "cmplz"], scriptSignatures: ["complianz-gdpr", "cmplz-cookiebanner"], selector: ".cmplz-deny", action: "reject", cmp_fingerprint: "complianz" },
  { name: "Osano", signatures: ["osano"], scriptSignatures: ["cmp.osano.com", "osano.com/webcmp"], selector: ".osano-cm-deny, .osano-cm-denyAll", action: "reject", cmp_fingerprint: "osano" },
  { name: "Usercentrics", signatures: ["usercentrics", "uc-banner"], scriptSignatures: ["usercentrics.eu", "app.usercentrics.eu"], selector: '[data-testid="uc-deny-all-button"], .uc-btn-deny', action: "reject", cmp_fingerprint: "usercentrics" },
  { name: "Iubenda", signatures: ["iubenda"], scriptSignatures: ["cdn.iubenda.com", "iubenda.com/cs"], selector: ".iubenda-cs-reject-btn, #iubenda-cs-banner .iubenda-cs-close-btn", action: "reject", cmp_fingerprint: "iubenda" },
  { name: "LiveRamp/PrivacyManager", signatures: ["privacymanager", "liveramp", "_brlbs"], scriptSignatures: ["liveramp.com", "privacymanager.io"], selector: '._brlbs-decline, [data-brlbs-action="decline"]', action: "reject", cmp_fingerprint: "liveramp" },
  { name: "CookieYes", signatures: ["cookieyes", "cky-consent"], scriptSignatures: ["cdn-cookieyes.com", "cookieyes.com/client_data"], selector: '.cky-btn-reject, [data-cky-tag="reject-button"]', action: "reject", cmp_fingerprint: "cookieyes" },
  { name: "Termly", signatures: ["termly", "t-consentPrompt"], scriptSignatures: ["app.termly.io/embed", "termly.io/resource-blocker"], selector: '[data-tid="banner-decline"], .t-declineAllButton', action: "reject", cmp_fingerprint: "termly" },
  { name: "Klaro", signatures: ["klaro", "cookie-modal"], scriptSignatures: ["kiprotect.com/klaro", "klaro.js", "klaro-config"], selector: ".cm-btn-decline, .klaro .cn-decline", action: "reject", cmp_fingerprint: "klaro" },
  { name: "Civic/CookieControl", signatures: ["civicuk", "CookieControl", "civic-cookie"], scriptSignatures: ["cc.cdn.civiccomputing.com", "cookiecontrol"], selector: "#ccc-reject-settings, .ccc-reject-button", action: "reject", cmp_fingerprint: "civic" },
  { name: "Sourcepoint", signatures: ["sp-cc", "sourcepoint", "sp_choice"], scriptSignatures: ["sourcepoint.mgr.consensu.org", "cdn.privacy-mgmt.com", "sourcepoint.com"], selector: '[title="Reject"], [title="REJECT ALL"], .sp_choice_type_11', action: "reject", cmp_fingerprint: "sourcepoint" },
  { name: "CookieFirst", signatures: ["cookiefirst", "cf-container"], scriptSignatures: ["consent.cookiefirst.com", "cookiefirst.com/widget"], selector: ".cookiefirst-reject-all, button[data-cookiefirst-action='reject']", action: "reject", cmp_fingerprint: "cookiefirst" },
  { name: "Admiral", signatures: ["admiral-cmp", "admiral"], scriptSignatures: ["cdn.admiral.com", "admiral.com/cmp"], selector: ".admiral-cmp button[class*='reject'], .admiral-cmp button:last-child", action: "reject", cmp_fingerprint: "admiral" },
];

function detectKnownCMP(html: string): typeof KNOWN_CMPS[number] | null {
  const lower = html.toLowerCase();
  for (const cmp of KNOWN_CMPS) {
    if (cmp.signatures.some((sig) => lower.includes(sig.toLowerCase()))) {
      return cmp;
    }
    if (cmp.scriptSignatures.some((sig) => lower.includes(sig.toLowerCase()))) {
      return cmp;
    }
  }
  return null;
}

// The caller's IP, hashed (never stored raw), for the per-caller hourly cap.
async function callerKey(req: Request): Promise<string> {
  const ip = (req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") ||
    (req.headers.get("x-forwarded-for") ?? "").split(",")[0] || "unknown").trim();
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`cy-probe:${ip}`));
  return "ip:" + [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { domain, probeResults } = await req.json();

    if (!domain || typeof domain !== "string" || domain.length > 253 || !Array.isArray(probeResults) || probeResults.length === 0) {
      return new Response(
        JSON.stringify({ error: "Missing domain or probeResults" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Pick the best probe result: visible, largest HTML
    const bestMatch = probeResults.slice(0, 50)
      .filter((r: any) => r.visible && r.html && r.html.length > 50)
      .sort((a: any, b: any) => (b.html?.length || 0) - (a.html?.length || 0))[0];

    if (!bestMatch) {
      return new Response(
        JSON.stringify({ status: "no_viable_probe", message: "No visible probe results with sufficient HTML" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Layer 1: CMP detection on probe HTML
    const cmpMatch = detectKnownCMP(bestMatch.html);
    if (cmpMatch) {
      // Insert pattern
      await supabase.rpc("upsert_pattern", {
        _domain: domain,
        _selector: cmpMatch.selector,
        _action_type: cmpMatch.action,
        _cmp_fingerprint: cmpMatch.cmp_fingerprint,
        _source: "probe_cmp",
      });

      await supabase.from("cookie_patterns")
        .update({ confidence: 6 })
        .eq("domain", domain)
        .eq("selector", cmpMatch.selector);

      await supabase.from("ai_generation_log").insert({
        domain,
        status: "success_probe",
        selector_generated: cmpMatch.selector,
        action_type: cmpMatch.action,
        confidence: 6,
        ai_model: `probe_cmp:${cmpMatch.name}`,
        html_source: `Probe found CMP: ${cmpMatch.name} via selector ${bestMatch.selector}`.substring(0, 500),
      });

      await supabase.rpc("mark_ai_processed", { _domain: domain, _resolved: true });

      return new Response(
        JSON.stringify({ status: "success_probe", cmp: cmpMatch.name, selector: cmpMatch.selector }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Layer 2: AI analysis on probe HTML (paid, so it asks the spend guard first)
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(
        JSON.stringify({ error: "LOVABLE_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const { data: gate, error: gateErr } = await supabase.rpc("ai_gate", { p_fn: "probe-report", p_who: await callerKey(req) });
    if (gateErr || (gate as any)?.ok !== true) {
      return new Response(
        JSON.stringify({ status: "rate_limited", message: "AI analysis is paused for now; try again later" }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = `You are a cookie consent banner analysis expert. Analyze the provided HTML (captured from a live DOM probe) and extract a CSS selector to dismiss/reject cookies. The probe already identified this element as a likely cookie banner at selector: ${String(bestMatch.selector).slice(0, 300)}. Your job is to find the best button to click.

RULES:
1. Prefer reject/decline/necessary-only buttons
2. If no reject, use close/dismiss
3. If only accept, use it with lower confidence
4. Output a specific CSS selector that would work on this page. Confidence is on a 1-10 scale.`;

    const userPrompt = `Domain: ${domain}
Banner found at selector: ${String(bestMatch.selector).slice(0, 300)}

HTML:
${bestMatch.html.substring(0, 8000)}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "analyze_cookie_banner",
            description: "Report analysis results for cookie banner HTML from DOM probe.",
            parameters: {
              type: "object",
              properties: {
                is_cookie_banner: { type: "boolean" },
                selector: { type: "string", description: "CSS selector for reject/dismiss button" },
                action: { type: "string", enum: ["click", "hide"] },
                confidence: { type: "number", description: "Confidence score 1-10" },
              },
              required: ["is_cookie_banner"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "analyze_cookie_banner" } },
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      throw new Error(`AI gateway error ${aiRes.status}: ${errText}`);
    }

    const aiData = await aiRes.json();
    const usage = aiData.usage ?? {};
    {
      const i = Number(usage.prompt_tokens ?? 0), o = Number(usage.completion_tokens ?? 0);
      await supabase.from("ai_spend").insert({
        fn: "probe-report", scope: "public", job: "probe", model: "gemini-2.5-pro",
        input_tokens: i, output_tokens: o, cost_usd: (i * 1.25 + o * 10) / 1e6, ref: domain,
      });
    }
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: any;

    if (toolCall?.function?.arguments) {
      parsed = JSON.parse(toolCall.function.arguments);
    } else {
      const content = aiData.choices?.[0]?.message?.content;
      if (!content) throw new Error("No AI response");
      let jsonStr = content.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1].trim();
      parsed = JSON.parse(jsonStr);
    }

    if (parsed.is_cookie_banner && parsed.selector) {
      const action = parsed.action === "hide" ? "close" : "reject";
      const confidence = Math.min(Math.round(Number(parsed.confidence)) || 5, 6);

      await supabase.rpc("upsert_pattern", {
        _domain: domain,
        _selector: parsed.selector,
        _action_type: action,
        _cmp_fingerprint: "generic",
        _source: "probe_ai",
      });

      await supabase.from("cookie_patterns")
        .update({ confidence })
        .eq("domain", domain)
        .eq("selector", parsed.selector);

      await supabase.from("ai_generation_log").insert({
        domain,
        status: "success_probe",
        selector_generated: parsed.selector,
        action_type: action,
        confidence,
        ai_model: "gemini-2.5-pro",
        prompt_tokens: usage.prompt_tokens ?? null,
        completion_tokens: usage.completion_tokens ?? null,
        html_source: `Probe selector: ${bestMatch.selector}`.substring(0, 500),
      });

      await supabase.rpc("mark_ai_processed", { _domain: domain, _resolved: true });

      return new Response(
        JSON.stringify({ status: "success_probe", selector: parsed.selector, action, confidence }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Probe AI also failed
    await supabase.from("ai_generation_log").insert({
      domain,
      status: "needs_manual_review",
      error_message: `Probe found element at ${bestMatch.selector} but AI did not identify a dismiss button`,
      ai_model: "gemini-2.5-pro",
      prompt_tokens: usage.prompt_tokens ?? null,
      completion_tokens: usage.completion_tokens ?? null,
    });

    return new Response(
      JSON.stringify({ status: "probe_ai_failed", message: "Probe HTML analyzed but no dismiss button found" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
