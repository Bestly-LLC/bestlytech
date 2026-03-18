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
  {
    name: "Usercentrics",
    signatures: ["usercentrics", "uc-banner"],
    selector: "[data-testid=\"uc-deny-all-button\"], .uc-btn-deny",
    action: "reject",
    cmp_fingerprint: "usercentrics",
  },
  {
    name: "Iubenda",
    signatures: ["iubenda"],
    selector: ".iubenda-cs-reject-btn, #iubenda-cs-banner .iubenda-cs-close-btn",
    action: "reject",
    cmp_fingerprint: "iubenda",
  },
  {
    name: "LiveRamp/PrivacyManager",
    signatures: ["privacymanager", "liveramp", "_brlbs"],
    selector: "._brlbs-decline, [data-brlbs-action=\"decline\"]",
    action: "reject",
    cmp_fingerprint: "liveramp",
  },
  {
    name: "CookieYes",
    signatures: ["cookieyes", "cky-consent"],
    selector: ".cky-btn-reject, [data-cky-tag=\"reject-button\"]",
    action: "reject",
    cmp_fingerprint: "cookieyes",
  },
  {
    name: "Termly",
    signatures: ["termly", "t-consentPrompt"],
    selector: "[data-tid=\"banner-decline\"], .t-declineAllButton",
    action: "reject",
    cmp_fingerprint: "termly",
  },
  {
    name: "Klaro",
    signatures: ["klaro", "cookie-modal"],
    selector: ".cm-btn-decline, .klaro .cn-decline",
    action: "reject",
    cmp_fingerprint: "klaro",
  },
  {
    name: "Civic/CookieControl",
    signatures: ["civicuk", "CookieControl", "civic-cookie"],
    selector: "#ccc-reject-settings, .ccc-reject-button",
    action: "reject",
    cmp_fingerprint: "civic",
  },
  {
    name: "Sourcepoint",
    signatures: ["sp-cc", "sourcepoint", "sp_choice"],
    selector: "[title=\"Reject\"], [title=\"REJECT ALL\"], .sp_choice_type_11",
    action: "reject",
    cmp_fingerprint: "sourcepoint",
  },
];

// CSS selectors / keywords that indicate cookie-related elements
const COOKIE_KEYWORDS = [
  "cookie", "consent", "gdpr", "ccpa", "privacy-banner", "privacy_banner",
  "onetrust", "cookiebot", "didomi", "quantcast", "truste", "complianz",
  "notice-cookie", "cookie-law", "cookie-notice", "cookie-banner",
  "sp-cc", "_brlbs-body", "qc-cmp", "usercentrics", "iubenda", "cookieyes",
  "termly", "klaro", "civicuk",
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

const AI_MODEL = "google/gemini-2.5-pro";
const AI_MODEL_LABEL = "gemini-2.5-pro";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Require admin auth (or service role for cron retries)
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const token = authHeader.replace("Bearer ", "");
  const isServiceRole = token === serviceRoleKey;

  if (!isServiceRole) {
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claimsData, error: claimsError } = await authClient.auth.getClaims(token);
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Verify admin role using service role client
    const svcCheck = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);
    const { data: isAdmin } = await svcCheck.rpc("has_role", { _user_id: claimsData.claims.sub, _role: "admin" });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  const svcClient = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

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
          ai_model: AI_MODEL_LABEL,
        });
        await supabase.rpc("mark_ai_processed", {
          _domain: candidate.domain,
          _resolved: false,
        });
        results.push({ domain: candidate.domain, status: "skipped_no_html" });
        continue;
      }

      try {
        // ========== LAYER 1: CMP check on extension HTML FIRST ==========
        const extensionCMP = detectKnownCMP(candidate.banner_html);
        if (extensionCMP) {
          console.log(`[${candidate.domain}] Known CMP detected in extension HTML: ${extensionCMP.name}`);
          await insertCMPPattern(supabase, candidate, extensionCMP);
          generated++;
          results.push({
            domain: candidate.domain,
            status: "success_cmp_fallback",
            cmp: extensionCMP.name,
            selector: extensionCMP.selector,
            action: extensionCMP.action,
            confidence: 0.55,
            note: "CMP detected in extension HTML (Layer 1)",
          });
          continue;
        }

        // ========== LAYER 2: AI analysis on extension HTML (Gemini 2.5 Pro) ==========
        const aiResult = await callAI(LOVABLE_API_KEY, candidate.banner_html, candidate.domain, candidate.cmp_fingerprint);

        if (aiResult.is_cookie_banner && aiResult.selector) {
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

        // ========== LAYER 3: Server-side fallback ==========
        const reason = aiResult.rejection_reason || "not a cookie banner";
        console.log(`[${candidate.domain}] Extension HTML rejected: ${reason}. Attempting server-side fallback...`);

        const serverHtml = await fetchPageHtml(candidate.domain, candidate.page_url);
        const serverFetchSuccess = !!serverHtml;

        if (serverHtml) {
          // 3a: CMP check on server HTML
          const serverCMP = detectKnownCMP(serverHtml);
          if (serverCMP) {
            console.log(`[${candidate.domain}] Known CMP detected in server HTML: ${serverCMP.name}`);
            await insertCMPPattern(supabase, candidate, serverCMP);
            generated++;
            results.push({
              domain: candidate.domain,
              status: "success_cmp_fallback",
              cmp: serverCMP.name,
              selector: serverCMP.selector,
              action: serverCMP.action,
              confidence: 0.55,
              note: "CMP detected in server HTML (Layer 3a)",
            });
            continue;
          }

          // 3b: Extract cookie elements → 2nd AI attempt
          const extractedHtml = extractCookieElements(serverHtml);

          if (extractedHtml && extractedHtml.length >= 50) {
            console.log(`[${candidate.domain}] Attempting second AI analysis with ${extractedHtml.length} chars of extracted elements`);
            const aiResult2 = await callAI(LOVABLE_API_KEY, extractedHtml, candidate.domain, candidate.cmp_fingerprint);

            if (aiResult2.is_cookie_banner && aiResult2.selector) {
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
          }
        }

        // ========== ALL PATHS FAILED → check retry limit ==========
        const diagnostics = [
          `Extension HTML: AI rejected (${reason})`,
          `Server fetch: ${serverFetchSuccess ? "OK" : "FAILED"}`,
          serverFetchSuccess ? `Server CMP check: no match` : null,
          serverFetchSuccess ? `Server AI: ${serverHtml ? "no cookie elements or AI rejected" : "N/A"}` : null,
        ].filter(Boolean).join("; ");

        // After 5 attempts total, mark as permanently_failed (auto-retry will stop)
        const currentAttempts = candidate.ai_attempts ?? 0;
        const failStatus = currentAttempts >= 4 ? "permanently_failed" : "needs_manual_review";

        await supabase.from("ai_generation_log").insert({
          domain: candidate.domain,
          status: failStatus,
          error_message: `${diagnostics}${failStatus === "permanently_failed" ? ` [Exhausted ${currentAttempts + 1} attempts]` : ""}`.substring(0, 500),
          ai_model: AI_MODEL_LABEL,
          prompt_tokens: aiResult.usage?.prompt_tokens ?? null,
          completion_tokens: aiResult.usage?.completion_tokens ?? null,
          html_source: candidate.banner_html?.substring(0, 500),
        });
        await supabase.rpc("mark_ai_processed", {
          _domain: candidate.domain,
          _resolved: false,
        });

        failed++;
        results.push({ domain: candidate.domain, status: "needs_manual_review", error: diagnostics });

      } catch (err: any) {
        failed++;
        await supabase.from("ai_generation_log").insert({
          domain: candidate.domain,
          status: "error",
          error_message: err.message?.substring(0, 500),
          ai_model: AI_MODEL_LABEL,
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
  const systemPrompt = `You are a cookie consent banner analysis expert. Your job is to determine whether provided HTML is a cookie/consent/privacy/GDPR banner, and if so, extract the best CSS selector to dismiss or reject cookies.

CRITICAL VALIDATION RULES:
1. The selector you output MUST match an element present in the provided HTML.
2. If the HTML is a signup form, newsletter popup, registration modal, promotional overlay, age gate, login form, or any non-cookie element — set is_cookie_banner to false.
3. Cookie banners typically contain words like: "cookie", "consent", "privacy", "GDPR", "CCPA", "tracking", "preferences", "accept", "reject", "decline", "necessary only".
4. Signup/promo popups typically contain words like: "sign up", "register", "email address", "subscribe", "discount", "offer", "newsletter", "create account".

EXAMPLES OF COOKIE BANNERS (is_cookie_banner = true):
- "We use cookies to improve your experience. Accept All | Reject All | Manage Preferences"
- "This site uses cookies for analytics and personalized content. By continuing, you agree to our cookie policy."
- Elements with classes/IDs containing: cookie-banner, consent-modal, gdpr-notice, privacy-bar

EXAMPLES OF NON-COOKIE ELEMENTS (is_cookie_banner = false):
- "Sign up for 15% off your first order! Enter your email..."
- "Create an account to save your favorites"
- "Subscribe to our newsletter"
- Age verification gates ("Are you 18+?")
- Login/registration forms`;

  const userPrompt = `Analyze this HTML and determine if it's a cookie consent banner.

If it IS a cookie banner, identify the best CSS selector to DISMISS or REJECT cookies (prefer reject/decline over accept).

Rules when is_cookie_banner is true:
- Prefer reject/decline/necessary-only buttons over accept buttons
- If no reject button exists, use a close/dismiss button
- If only accept exists, use it but set confidence lower
- The selector must be specific enough to not match other elements
- The selector MUST reference an element that exists in the provided HTML

Domain: ${domain}
${cmpFingerprint && cmpFingerprint !== "unknown" ? `CMP hint: ${cmpFingerprint}` : ""}

HTML to analyze:
${html}`;

  const aiRes = await fetch(
    "https://ai.gateway.lovable.dev/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "analyze_cookie_banner",
              description: "Report the analysis results for the provided HTML.",
              parameters: {
                type: "object",
                properties: {
                  is_cookie_banner: {
                    type: "boolean",
                    description: "True if the HTML is a cookie/consent/privacy/GDPR banner, false otherwise.",
                  },
                  rejection_reason: {
                    type: "string",
                    description: "If is_cookie_banner is false, a short explanation of what the HTML actually is (e.g. 'signup popup', 'newsletter modal').",
                  },
                  selector: {
                    type: "string",
                    description: "CSS selector for the reject/decline/dismiss button. Only set if is_cookie_banner is true.",
                  },
                  action: {
                    type: "string",
                    enum: ["click", "hide"],
                    description: "Whether to click the button or hide the banner element. Only set if is_cookie_banner is true.",
                  },
                  confidence: {
                    type: "number",
                    description: "Confidence score 0-1. Only set if is_cookie_banner is true.",
                  },
                },
                required: ["is_cookie_banner"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "analyze_cookie_banner" } },
      }),
    }
  );

  if (!aiRes.ok) {
    const errText = await aiRes.text();
    throw new Error(`AI gateway error ${aiRes.status}: ${errText}`);
  }

  const aiData = await aiRes.json();
  const usage = aiData.usage ?? {};

  // Parse tool call response
  const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
  let parsed: any;

  if (toolCall?.function?.arguments) {
    parsed = JSON.parse(toolCall.function.arguments);
  } else {
    // Fallback: try parsing content as JSON
    const content = aiData.choices?.[0]?.message?.content;
    if (!content) throw new Error("No content or tool call in AI response");
    let jsonStr = content.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();
    parsed = JSON.parse(jsonStr);
  }

  return {
    is_cookie_banner: parsed.is_cookie_banner !== false,
    selector: parsed.selector,
    action: parsed.action === "hide" ? "hide" : "click",
    confidence: parsed.confidence,
    rejection_reason: parsed.rejection_reason,
    usage: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens },
  };
}

async function insertCMPPattern(supabase: any, candidate: any, cmp: typeof KNOWN_CMPS[number]) {
  const { error: upsertErr } = await supabase.rpc("upsert_pattern", {
    _domain: candidate.domain,
    _selector: cmp.selector,
    _action_type: cmp.action,
    _cmp_fingerprint: cmp.cmp_fingerprint,
    _source: "ai_generated",
  });
  if (upsertErr) throw upsertErr;

  await supabase
    .from("cookie_patterns")
    .update({ confidence: 0.55 })
    .eq("domain", candidate.domain)
    .eq("selector", cmp.selector);

  await supabase.from("ai_generation_log").insert({
    domain: candidate.domain,
    status: "success_cmp_fallback",
    selector_generated: cmp.selector,
    action_type: cmp.action,
    confidence: 0.55,
    ai_model: `cmp_detection:${cmp.name}`,
    html_source: `CMP detected: ${cmp.name} (signatures: ${cmp.signatures.join(", ")})`.substring(0, 500),
  });

  await supabase.rpc("mark_ai_processed", {
    _domain: candidate.domain,
    _resolved: true,
  });
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
    ai_model: AI_MODEL_LABEL,
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
    ai_model: AI_MODEL_LABEL,
    prompt_tokens: usage?.prompt_tokens ?? null,
    completion_tokens: usage?.completion_tokens ?? null,
    html_source: candidate.banner_html?.substring(0, 500),
  });
  await supabase.rpc("mark_ai_processed", {
    _domain: candidate.domain,
    _resolved: false,
  });
}
