import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Known CMP signatures: detection keywords → standard reject selectors
const KNOWN_CMPS: { name: string; signatures: string[]; selector: string; action: string; cmp_fingerprint: string }[] = [
  {
    name: "OneTrust",
    signatures: ["onetrust", "optanon", "otBannerSdk"],
    selector: "#onetrust-reject-all-handler, .ot-pc-refuse-all-btn",
    action: "reject",
    cmp_fingerprint: "onetrust",
  },
  {
    name: "Cookiebot",
    signatures: ["cookiebot", "CybotCookiebot"],
    selector: "#CybotCookiebotDialogBodyButtonDecline",
    action: "reject",
    cmp_fingerprint: "cookiebot",
  },
  {
    name: "Didomi",
    signatures: ["didomi"],
    selector: ".didomi-continue-without-agreeing, [data-testid=\"notice-disagree-button\"]",
    action: "reject",
    cmp_fingerprint: "didomi",
  },
  {
    name: "Quantcast",
    signatures: ["quantcast", "qc-cmp"],
    selector: "#qc-cmp2-container [mode=\"secondary\"], .qc-cmp2-summary-buttons button:first-child",
    action: "reject",
    cmp_fingerprint: "quantcast",
  },
  {
    name: "TrustArc",
    signatures: ["truste", "consent.trustarc", "trustarc"],
    selector: ".truste-consent-required, #truste-consent-button",
    action: "reject",
    cmp_fingerprint: "trustarc",
  },
  {
    name: "Complianz",
    signatures: ["complianz", "cmplz"],
    selector: ".cmplz-deny",
    action: "reject",
    cmp_fingerprint: "complianz",
  },
  {
    name: "Osano",
    signatures: ["osano"],
    selector: ".osano-cm-deny, .osano-cm-denyAll",
    action: "reject",
    cmp_fingerprint: "osano",
  },
];

// CSS selectors / keywords that indicate cookie-related elements
const COOKIE_KEYWORDS = [
  "cookie", "consent", "gdpr", "ccpa", "privacy-banner", "privacy_banner",
  "onetrust", "cookiebot", "didomi", "quantcast", "truste", "complianz",
  "notice-cookie", "cookie-law", "cookie-notice", "cookie-banner",
  "sp-cc", "_brlbs-body", "qc-cmp",
];

function detectKnownCMP(html: string): typeof KNOWN_CMPS[number] | null {
  const lower = html.toLowerCase();
  for (const cmp of KNOWN_CMPS) {
    if (cmp.signatures.some((sig) => lower.includes(sig.toLowerCase()))) {
      return cmp;
    }
  }
  return null;
}

function extractCookieElements(html: string): string {
  // Simple regex-based extraction of elements with cookie-related class/id attributes
  const elements: string[] = [];
  const pattern = /<[^>]+(class|id)\s*=\s*["'][^"']*(?:cookie|consent|gdpr|ccpa|privacy|banner|notice|cmp|onetrust|cookiebot|didomi|quantcast|truste|complianz)[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi;
  let match;
  let totalLen = 0;
  while ((match = pattern.exec(html)) !== null && totalLen < 4000) {
    elements.push(match[0]);
    totalLen += match[0].length;
  }
  return elements.join("\n");
}

async function fetchPageHtml(domain: string, pageUrl?: string): Promise<string | null> {
  const url = pageUrl || `https://${domain}`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
      },
      redirect: "follow",
    });
    if (!res.ok) return null;
    const text = await res.text();
    // Limit to first 50KB to avoid memory issues
    return text.substring(0, 50000);
  } catch (e) {
    console.error(`Failed to fetch ${url}:`, e);
    return null;
  }
}

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
        // --- Step 1: AI analyzes extension-provided HTML ---
        const aiResult = await callAI(LOVABLE_API_KEY, candidate.banner_html, candidate.domain, candidate.cmp_fingerprint);

        if (aiResult.is_cookie_banner) {
          // Extension HTML was valid — generate pattern (existing flow)
          await insertPattern(supabase, candidate, aiResult, "success");
          generated++;
          results.push({
            domain: candidate.domain,
            status: "success",
            selector: aiResult.selector,
            action: aiResult.action,
            confidence: aiResult.confidence,
          });
          continue;
        }

        // --- Step 3: is_cookie_banner === false — begin server-side fallback ---
        const reason = aiResult.rejection_reason || "not a cookie banner";
        console.log(`[${candidate.domain}] Extension HTML rejected: ${reason}. Attempting server-side fallback...`);

        // Step 3a: Fetch page server-side
        const serverHtml = await fetchPageHtml(candidate.domain, candidate.page_url);

        if (!serverHtml) {
          // Can't fetch — fail with original reason
          await logFailure(supabase, candidate, reason, aiResult.usage);
          failed++;
          results.push({ domain: candidate.domain, status: "failed_not_cookie_banner", error: `Extension HTML rejected (${reason}) and server-side fetch failed` });
          continue;
        }

        // Step 3b: Check for known CMP signatures
        const detectedCMP = detectKnownCMP(serverHtml);
        if (detectedCMP) {
          console.log(`[${candidate.domain}] Known CMP detected: ${detectedCMP.name}`);

          // Insert standard pattern directly — no AI needed
          const { error: upsertErr } = await supabase.rpc("upsert_pattern", {
            _domain: candidate.domain,
            _selector: detectedCMP.selector,
            _action_type: detectedCMP.action,
            _cmp_fingerprint: detectedCMP.cmp_fingerprint,
            _source: "ai_generated",
          });
          if (upsertErr) throw upsertErr;

          // Cap confidence at 0.55 for CMP fallback patterns
          await supabase
            .from("cookie_patterns")
            .update({ confidence: 0.55 })
            .eq("domain", candidate.domain)
            .eq("selector", detectedCMP.selector);

          await supabase.from("ai_generation_log").insert({
            domain: candidate.domain,
            status: "success_cmp_fallback",
            selector_generated: detectedCMP.selector,
            action_type: detectedCMP.action,
            confidence: 0.55,
            ai_model: `cmp_detection:${detectedCMP.name}`,
            html_source: `CMP detected: ${detectedCMP.name} (signatures: ${detectedCMP.signatures.join(", ")})`.substring(0, 500),
          });

          await supabase.rpc("mark_ai_processed", {
            _domain: candidate.domain,
            _resolved: true,
          });

          generated++;
          results.push({
            domain: candidate.domain,
            status: "success_cmp_fallback",
            cmp: detectedCMP.name,
            selector: detectedCMP.selector,
            action: detectedCMP.action,
            confidence: 0.55,
          });
          continue;
        }

        // Step 3c: No known CMP — extract cookie-related elements for second AI attempt
        const extractedHtml = extractCookieElements(serverHtml);

        if (!extractedHtml || extractedHtml.length < 50) {
          // No cookie-related elements found in server HTML
          await logFailure(supabase, candidate, `${reason}; server-side: no cookie elements found`, aiResult.usage);
          failed++;
          results.push({ domain: candidate.domain, status: "failed_not_cookie_banner", error: `Extension HTML rejected and no cookie elements in server HTML` });
          continue;
        }

        // Step 3d: Second AI attempt with server-extracted HTML
        console.log(`[${candidate.domain}] Attempting second AI analysis with ${extractedHtml.length} chars of extracted elements`);
        const aiResult2 = await callAI(LOVABLE_API_KEY, extractedHtml, candidate.domain, candidate.cmp_fingerprint);

        if (aiResult2.is_cookie_banner && aiResult2.selector) {
          // Second attempt succeeded
          await insertPattern(supabase, candidate, aiResult2, "success", extractedHtml);
          generated++;
          results.push({
            domain: candidate.domain,
            status: "success",
            selector: aiResult2.selector,
            action: aiResult2.action,
            confidence: aiResult2.confidence,
            note: "server-side fallback (2nd AI attempt)",
          });
          continue;
        }

        // Step 3e: Second attempt also failed
        const reason2 = aiResult2.rejection_reason || "not a cookie banner (2nd attempt)";
        await logFailure(supabase, candidate, `1st: ${reason}; 2nd: ${reason2}`, {
          prompt_tokens: (aiResult.usage?.prompt_tokens ?? 0) + (aiResult2.usage?.prompt_tokens ?? 0),
          completion_tokens: (aiResult.usage?.completion_tokens ?? 0) + (aiResult2.usage?.completion_tokens ?? 0),
        });
        failed++;
        results.push({ domain: candidate.domain, status: "failed_not_cookie_banner", error: `Both AI attempts failed. 1st: ${reason}; 2nd: ${reason2}` });

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

// ---------- Helper Functions ----------

interface AIResult {
  is_cookie_banner: boolean;
  selector?: string;
  action?: string;
  confidence?: number;
  rejection_reason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

async function callAI(apiKey: string, html: string, domain: string, cmpFingerprint?: string): Promise<AIResult> {
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
${html}

Domain: ${domain}
${cmpFingerprint && cmpFingerprint !== "unknown" ? `CMP: ${cmpFingerprint}` : ""}`;

  const aiRes = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
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

  return {
    is_cookie_banner: parsed.is_cookie_banner !== false,
    selector: parsed.selector,
    action: parsed.action === "hide" ? "hide" : "click",
    confidence: parsed.confidence,
    rejection_reason: parsed.rejection_reason,
    usage: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens },
  };
}

async function insertPattern(supabase: any, candidate: any, aiResult: AIResult, status: string, htmlOverride?: string) {
  const selector = aiResult.selector!;
  const action = aiResult.action === "hide" ? "close" : "reject";
  const rawConfidence = Number(aiResult.confidence) || 0.5;
  const confidence = Math.min(rawConfidence, 0.6);

  const { error: upsertErr } = await supabase.rpc("upsert_pattern", {
    _domain: candidate.domain,
    _selector: selector,
    _action_type: action,
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
    status,
    selector_generated: selector,
    action_type: action,
    confidence,
    ai_model: "gemini-3-flash",
    prompt_tokens: aiResult.usage?.prompt_tokens ?? null,
    completion_tokens: aiResult.usage?.completion_tokens ?? null,
    html_source: (htmlOverride || candidate.banner_html)?.substring(0, 500),
  });

  await supabase.rpc("mark_ai_processed", {
    _domain: candidate.domain,
    _resolved: true,
  });
}

async function logFailure(supabase: any, candidate: any, reason: string, usage?: any) {
  await supabase.from("ai_generation_log").insert({
    domain: candidate.domain,
    status: "failed_not_cookie_banner",
    error_message: `Captured HTML is not a cookie banner: ${reason}`.substring(0, 500),
    ai_model: "gemini-3-flash",
    prompt_tokens: usage?.prompt_tokens ?? null,
    completion_tokens: usage?.completion_tokens ?? null,
    html_source: candidate.banner_html?.substring(0, 500),
  });
  await supabase.rpc("mark_ai_processed", {
    _domain: candidate.domain,
    _resolved: false,
  });
}
