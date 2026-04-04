import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { alertEmail } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Known CMP signatures: detection keywords + CDN/script URL patterns → standard reject selectors
const KNOWN_CMPS: { name: string; signatures: string[]; scriptSignatures: string[]; selector: string; action: string; cmp_fingerprint: string }[] = [
  {
    name: "OneTrust",
    signatures: ["onetrust", "optanon", "otBannerSdk"],
    scriptSignatures: ["cdn.cookielaw.org", "onetrust.com/consent", "otSDKStub", "otBannerSdk"],
    selector: "#onetrust-reject-all-handler, .ot-pc-refuse-all-btn, .save-preference-btn-handler, .onetrust-close-btn-handler",
    action: "reject",
    cmp_fingerprint: "onetrust",
  },
  {
    name: "Cookiebot",
    signatures: ["cookiebot", "CybotCookiebot"],
    scriptSignatures: ["consent.cookiebot.com", "cookiebot.com/uc.js", "CookieConsent.js"],
    selector: "#CybotCookiebotDialogBodyButtonDecline",
    action: "reject",
    cmp_fingerprint: "cookiebot",
  },
  {
    name: "Didomi",
    signatures: ["didomi"],
    scriptSignatures: ["sdk.privacy-center.org", "didomi.io/sdk", "didomi-sdk"],
    selector: ".didomi-continue-without-agreeing, [data-testid=\"notice-disagree-button\"]",
    action: "reject",
    cmp_fingerprint: "didomi",
  },
  {
    name: "Quantcast",
    signatures: ["quantcast", "qc-cmp"],
    scriptSignatures: ["quantcast.mgr.consensu.org", "cmp2.js", "quantcast.com/choice"],
    selector: "#qc-cmp2-container [mode=\"secondary\"], .qc-cmp2-summary-buttons button:first-child",
    action: "reject",
    cmp_fingerprint: "quantcast",
  },
  {
    name: "TrustArc",
    signatures: ["truste", "consent.trustarc", "trustarc"],
    scriptSignatures: ["consent.trustarc.com", "trustarc.com/notice", "truste.com"],
    selector: ".truste-consent-required, #truste-consent-button",
    action: "reject",
    cmp_fingerprint: "trustarc",
  },
  {
    name: "Complianz",
    signatures: ["complianz", "cmplz"],
    scriptSignatures: ["complianz-gdpr", "cmplz-cookiebanner"],
    selector: ".cmplz-deny",
    action: "reject",
    cmp_fingerprint: "complianz",
  },
  {
    name: "Osano",
    signatures: ["osano"],
    scriptSignatures: ["cmp.osano.com", "osano.com/webcmp"],
    selector: ".osano-cm-deny, .osano-cm-denyAll",
    action: "reject",
    cmp_fingerprint: "osano",
  },
  {
    name: "Usercentrics",
    signatures: ["usercentrics", "uc-banner"],
    scriptSignatures: ["usercentrics.eu", "app.usercentrics.eu"],
    selector: "[data-testid=\"uc-deny-all-button\"], .uc-btn-deny",
    action: "reject",
    cmp_fingerprint: "usercentrics",
  },
  {
    name: "Iubenda",
    signatures: ["iubenda"],
    scriptSignatures: ["cdn.iubenda.com", "iubenda.com/cs"],
    selector: ".iubenda-cs-reject-btn, #iubenda-cs-banner .iubenda-cs-close-btn",
    action: "reject",
    cmp_fingerprint: "iubenda",
  },
  {
    name: "LiveRamp/PrivacyManager",
    signatures: ["privacymanager", "liveramp", "_brlbs"],
    scriptSignatures: ["liveramp.com", "privacymanager.io"],
    selector: "._brlbs-decline, [data-brlbs-action=\"decline\"]",
    action: "reject",
    cmp_fingerprint: "liveramp",
  },
  {
    name: "CookieYes",
    signatures: ["cookieyes", "cky-consent"],
    scriptSignatures: ["cdn-cookieyes.com", "cookieyes.com/client_data"],
    selector: ".cky-btn-reject, [data-cky-tag=\"reject-button\"]",
    action: "reject",
    cmp_fingerprint: "cookieyes",
  },
  {
    name: "Termly",
    signatures: ["termly", "t-consentPrompt"],
    scriptSignatures: ["app.termly.io/embed", "termly.io/resource-blocker"],
    selector: "[data-tid=\"banner-decline\"], .t-declineAllButton",
    action: "reject",
    cmp_fingerprint: "termly",
  },
  {
    name: "Klaro",
    signatures: ["klaro", "cookie-modal"],
    scriptSignatures: ["kiprotect.com/klaro", "klaro.js", "klaro-config"],
    selector: ".cm-btn-decline, .klaro .cn-decline",
    action: "reject",
    cmp_fingerprint: "klaro",
  },
  {
    name: "Civic/CookieControl",
    signatures: ["civicuk", "CookieControl", "civic-cookie"],
    scriptSignatures: ["cc.cdn.civiccomputing.com", "cookiecontrol"],
    selector: "#ccc-reject-settings, .ccc-reject-button",
    action: "reject",
    cmp_fingerprint: "civic",
  },
  {
    name: "Sourcepoint",
    signatures: ["sp-cc", "sourcepoint", "sp_choice"],
    scriptSignatures: ["sourcepoint.mgr.consensu.org", "cdn.privacy-mgmt.com", "sourcepoint.com"],
    selector: "[title=\"Reject\"], [title=\"REJECT ALL\"], .sp_choice_type_11",
    action: "reject",
    cmp_fingerprint: "sourcepoint",
  },
  {
    name: "CookieFirst",
    signatures: ["cookiefirst", "cf-container"],
    scriptSignatures: ["consent.cookiefirst.com", "cookiefirst.com/widget"],
    selector: ".cookiefirst-reject-all, button[data-cookiefirst-action='reject']",
    action: "reject",
    cmp_fingerprint: "cookiefirst",
  },
  {
    name: "Admiral",
    signatures: ["admiral-cmp", "admiral"],
    scriptSignatures: ["cdn.admiral.com", "admiral.com/cmp"],
    selector: ".admiral-cmp button[class*='reject'], .admiral-cmp button:last-child",
    action: "reject",
    cmp_fingerprint: "admiral",
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
    // Check banner element signatures (class names, IDs, text)
    if (cmp.signatures.some((sig) => lower.includes(sig.toLowerCase()))) {
      return cmp;
    }
    // Check script/CDN URL signatures in raw HTML
    if (cmp.scriptSignatures.some((sig) => lower.includes(sig.toLowerCase()))) {
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

// Banned selectors that would match entire page structures
const BANNED_SELECTORS = ['body', 'html', 'head', 'body *', 'html *', '*'];

// Domains that should never get cookie patterns (major web apps without standard banners)
const EXCLUDED_DOMAINS = [
  'icloud.com', 'mail.google.com', 'drive.google.com', 'docs.google.com',
  'outlook.live.com', 'outlook.office.com', 'teams.microsoft.com',
  'accounts.google.com', 'appleid.apple.com',
];

function isDomainExcluded(domain: string): boolean {
  const d = domain.toLowerCase();
  return EXCLUDED_DOMAINS.some(ed => d === ed || d.endsWith('.' + ed));
}

function isSelectorBanned(selector: string): boolean {
  return BANNED_SELECTORS.includes(selector.trim().toLowerCase());
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Auth: require maintenance secret OR valid admin Bearer token OR service role
  const maintenanceSecret = req.headers.get("x-maintenance-secret");
  const authHeader = req.headers.get("Authorization");
  let authorized = false;

  if (maintenanceSecret && maintenanceSecret === Deno.env.get("MAINTENANCE_SECRET")) {
    authorized = true;
  } else if (authHeader?.startsWith("Bearer ")) {
    const serviceRoleKey2 = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const token = authHeader.replace("Bearer ", "");
    if (token === serviceRoleKey2) {
      authorized = true;
    } else {
      const authClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: userData } = await authClient.auth.getUser(token);
      if (userData?.user) {
        const svcCheck = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey2);
        const { data: isAdmin } = await svcCheck.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
        if (isAdmin) authorized = true;
      }
    }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

      // ========== GUARD: Excluded domains ==========
      if (isDomainExcluded(candidate.domain)) {
        console.log(`[${candidate.domain}] Skipping — excluded domain`);
        skipped++;
        await supabase.from("ai_generation_log").insert({
          domain: candidate.domain,
          status: "skipped_excluded_domain",
          error_message: "Domain is on the exclusion list (major web app without standard cookie banners)",
          ai_model: AI_MODEL_LABEL,
        });
        await supabase.rpc("mark_ai_processed", { _domain: candidate.domain, _resolved: true });
        results.push({ domain: candidate.domain, status: "skipped_excluded_domain" });
        continue;
      }

      // ========== LAYER 0: cmp_fingerprint field check ==========
      // If the extension already identified the CMP, use known selectors immediately
      if (candidate.cmp_fingerprint && candidate.cmp_fingerprint !== "unknown" && candidate.cmp_fingerprint !== "generic") {
        const knownCMP = KNOWN_CMPS.find(
          (cmp) => cmp.cmp_fingerprint === candidate.cmp_fingerprint.toLowerCase() ||
                   cmp.name.toLowerCase() === candidate.cmp_fingerprint.toLowerCase()
        );
        if (knownCMP) {
          console.log(`[${candidate.domain}] CMP identified via cmp_fingerprint field: ${knownCMP.name} — using known selectors`);
          await insertCMPPattern(supabase, candidate, knownCMP);
          // Override confidence to 9 and set strategy for fingerprint-matched patterns
          await supabase
            .from("cookie_patterns")
            .update({ confidence: 9, strategy: knownCMP.cmp_fingerprint } as any)
            .eq("domain", candidate.domain)
            .eq("selector", knownCMP.selector);
          generated++;
          results.push({
            domain: candidate.domain,
            status: "success_cmp_fingerprint",
            cmp: knownCMP.name,
            selector: knownCMP.selector,
            action: knownCMP.action,
            confidence: 9,
            note: "CMP matched via cmp_fingerprint field (Layer 0)",
          });
          continue;
        }
      }

      if (!candidate.banner_html) {
        // Instead of skipping, try server-side fetch + CMP detection
        console.log(`[${candidate.domain}] No extension HTML — attempting server-side fetch for CMP detection`);
        const serverHtml = await fetchPageHtml(candidate.domain, candidate.page_url);

        if (serverHtml) {
          // Check for known CMP via script tags / elements
          const serverCMP = detectKnownCMP(serverHtml);
          if (serverCMP) {
            console.log(`[${candidate.domain}] Known CMP detected via server fetch (no extension HTML): ${serverCMP.name}`);
            await insertCMPPattern(supabase, candidate, serverCMP);
            generated++;
            results.push({
              domain: candidate.domain,
              status: "success_cmp_fallback",
              cmp: serverCMP.name,
              selector: serverCMP.selector,
              action: serverCMP.action,
              confidence: 7,
              note: "CMP detected via server fetch (no extension HTML)",
            });
            continue;
          }

          // No CMP found — try extracting cookie elements and running AI
          const extractedHtml = extractCookieElements(serverHtml);
          if (extractedHtml && extractedHtml.length >= 50) {
            console.log(`[${candidate.domain}] No CMP match, trying AI on ${extractedHtml.length} chars of server-extracted elements`);
            try {
              const aiResult = await callAI(LOVABLE_API_KEY, extractedHtml, candidate.domain, candidate.cmp_fingerprint);
              if (aiResult.is_cookie_banner && aiResult.selector) {
                await insertPattern(supabase, candidate, aiResult, "success", extractedHtml);
                generated++;
                results.push({
                  domain: candidate.domain,
                  status: "success",
                  selector: aiResult.selector,
                  action: aiResult.action,
                  confidence: aiResult.confidence,
                  note: "AI analysis on server HTML (no extension HTML)",
                });
                continue;
              }
            } catch (aiErr: any) {
              console.log(`[${candidate.domain}] AI fallback failed: ${aiErr.message}`);
            }
          }
        }

        // All server-side attempts failed — now skip
        skipped++;
        const currentAttempts = candidate.ai_attempts ?? 0;
        const skipStatus = currentAttempts >= 4 ? "permanently_failed" : "skipped_no_html";
        await supabase.from("ai_generation_log").insert({
          domain: candidate.domain,
          status: skipStatus,
          error_message: serverHtml
            ? "Server fetched but no CMP detected and no usable cookie elements"
            : "No extension HTML and server fetch failed",
          ai_model: AI_MODEL_LABEL,
        });
        await supabase.rpc("mark_ai_processed", {
          _domain: candidate.domain,
          _resolved: false,
        });
        results.push({ domain: candidate.domain, status: skipStatus });
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
            confidence: 7,
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
            confidence: 7,
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

        // ========== LAYER 4: Gemini Flash failsafe — different model, different prompt ==========
        const fullHtmlForGemini = serverHtml || candidate.banner_html || "";
        if (fullHtmlForGemini.length > 100) {
          console.log(`[${candidate.domain}] All layers failed, trying Gemini Flash failsafe...`);
          const geminiResult = await geminiFailsafe(LOVABLE_API_KEY, candidate.domain, fullHtmlForGemini);
          if (geminiResult) {
            await insertPattern(supabase, candidate, {
              is_cookie_banner: true,
              selector: geminiResult.selector,
              action_type: geminiResult.action,
              confidence: geminiResult.confidence,
            }, "success_gemini_failsafe", fullHtmlForGemini.substring(0, 500));

            if (geminiResult.strategy) {
              await supabase
                .from("cookie_patterns")
                .update({ strategy: geminiResult.strategy.toLowerCase() } as any)
                .eq("domain", candidate.domain)
                .eq("selector", geminiResult.selector);
            }

            generated++;
            results.push({
              domain: candidate.domain,
              status: "success_gemini_failsafe",
              selector: geminiResult.selector,
              action: geminiResult.action,
              confidence: geminiResult.confidence,
              note: `Gemini failsafe${geminiResult.strategy ? ` (strategy: ${geminiResult.strategy})` : ""}`,
            });
            continue;
          }
        }

        // ========== ALL PATHS FAILED → check retry limit ==========
        const diagnostics = [
          `Extension HTML: AI rejected (${reason})`,
          `Server fetch: ${serverFetchSuccess ? "OK" : "FAILED"}`,
          serverFetchSuccess ? `Server CMP check: no match` : null,
          serverFetchSuccess ? `Server AI: ${serverHtml ? "no cookie elements or AI rejected" : "N/A"}` : null,
          `Gemini failsafe: no result`,
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
        results.push({ domain: candidate.domain, status: failStatus, error: diagnostics });

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

    // ========== HEALTH ALERT: Email if batch has issues ==========
    const failureRate = processed > 0 ? failed / processed : 0;
    const shouldAlert = (failureRate > 0.5 && processed >= 2) || (processed >= 3 && generated === 0);

    if (shouldAlert) {
      try {
        const smtpEmail = Deno.env.get("PRIVATEMAIL_EMAIL");
        const smtpPassword = Deno.env.get("PRIVATEMAIL_PASSWORD");
        if (smtpEmail && smtpPassword) {
          const failedItems = results
            .filter((r: any) => r.status === "error" || r.status === "needs_manual_review" || r.status === "permanently_failed")
            .map((r: any) => ({ label: r.domain, detail: r.error || r.status }));

          const severity = generated === 0 ? "danger" : "warning";
          const html = alertEmail({
            title: "AI Generation Health Alert",
            severity,
            summary: generated === 0
              ? `The AI pattern generator processed <strong>${processed} candidate(s)</strong> but generated <strong>zero</strong> successful patterns.`
              : `The AI pattern generator had a <strong>${Math.round(failureRate * 100)}% failure rate</strong> (${failed}/${processed} candidates failed).`,
            stats: [
              { label: "Processed", value: processed },
              { label: "Generated", value: generated },
              { label: "Failed", value: failed },
              { label: "Skipped", value: skipped },
            ],
            items: failedItems.length > 0 ? failedItems : undefined,
            timestamp: new Date().toISOString(),
          });

          const client = new SMTPClient({
            connection: { hostname: "mail.privateemail.com", port: 465, tls: true, auth: { username: smtpEmail, password: smtpPassword } },
          });
          try {
            await client.send({ from: smtpEmail, to: Deno.env.get("EMAIL_TO") || "jaredbest@icloud.com", subject: "Cookie Yeti: AI Generation Health Alert", html });
            console.log("Health alert email sent");
          } finally {
            await client.close();
          }
        }
      } catch (emailErr: any) {
        console.error("Failed to send health alert email:", emailErr.message);
      }
    }

    return new Response(
      JSON.stringify({ processed, generated, skipped, failed, results, alert_sent: shouldAlert }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    // Critical error — send alert for unexpected failures
    try {
      const smtpEmail = Deno.env.get("PRIVATEMAIL_EMAIL");
      const smtpPassword = Deno.env.get("PRIVATEMAIL_PASSWORD");
      if (smtpEmail && smtpPassword) {
        const html = alertEmail({
          title: "AI Generation Critical Error",
          severity: "danger",
          summary: `The AI pattern generator encountered an <strong>unhandled error</strong> and could not complete its batch.`,
          stats: [
            { label: "Processed Before Crash", value: processed },
            { label: "Generated Before Crash", value: generated },
          ],
          items: [{ label: "Error", detail: err.message || "Unknown error" }],
          timestamp: new Date().toISOString(),
        });
        const client = new SMTPClient({
          connection: { hostname: "mail.privateemail.com", port: 465, tls: true, auth: { username: smtpEmail, password: smtpPassword } },
        });
        try {
          await client.send({ from: smtpEmail, to: Deno.env.get("EMAIL_TO") || "jaredbest@icloud.com", subject: "Cookie Yeti: AI Generation CRITICAL ERROR", html });
        } finally {
          await client.close();
        }
      }
    } catch { /* don't let email failure mask the real error */ }

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
  action_type?: string;
  confidence?: number;
  rejection_reason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

// Validate that selector text and action_type are not contradictory
function validateSelectorAction(selector: string, actionType: string): { valid: boolean; corrected?: string; reason?: string } {
  const lower = selector.toLowerCase();
  const acceptPatterns = /accept|agree|allow|got-it|gotit|ok-button/i;
  const rejectPatterns = /reject|decline|deny|refuse|opt-out|optout/i;
  const closePatterns = /close|dismiss|x-button|btn-close/i;
  const necessaryPatterns = /necessary|essential|required-only/i;

  if (acceptPatterns.test(lower) && actionType === "reject") {
    return { valid: false, corrected: "accept", reason: `Selector "${selector}" contains accept-like text but was labeled as reject` };
  }
  if (rejectPatterns.test(lower) && actionType === "accept") {
    return { valid: false, corrected: "reject", reason: `Selector "${selector}" contains reject-like text but was labeled as accept` };
  }
  if (closePatterns.test(lower) && !["close", "reject"].includes(actionType)) {
    return { valid: false, corrected: "close", reason: `Selector "${selector}" contains close-like text but was labeled as ${actionType}` };
  }
  if (necessaryPatterns.test(lower) && actionType !== "necessary") {
    return { valid: false, corrected: "necessary", reason: `Selector "${selector}" contains necessary-like text but was labeled as ${actionType}` };
  }
  return { valid: true };
}

// Check if domain already has a high-confidence active pattern
async function hasExistingHighConfidencePattern(supabase: any, domain: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("cookie_patterns")
    .select("id, confidence")
    .eq("domain", domain)
    .eq("is_active", true)
    .gte("confidence", 7)
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
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
- If only accept exists, use it — but set action_type to "accept" (NOT "reject")
- CRITICAL: action_type must match what the button ACTUALLY DOES:
  - "accept" = accepts all cookies (button says "Accept", "OK", "Got it", "Agree", "Allow all")
  - "reject" = rejects/declines cookies (button says "Reject", "Decline", "Deny", "Refuse")
  - "necessary" = keeps only essential cookies (button says "Necessary only", "Essential only")
  - "save" = saves current cookie preferences (button says "Save preferences", "Confirm choices")
  - "close" = closes/hides the banner without making a cookie choice (X button, close icon)
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
                  action_type: {
                    type: "string",
                    enum: ["accept", "reject", "necessary", "save", "close"],
                    description: "What the button ACTUALLY DOES. 'accept' = accepts all cookies, 'reject' = rejects/declines, 'necessary' = essential only, 'save' = saves current preferences, 'close' = closes/hides banner. Must match the button's real function, NOT the user's desired outcome.",
                  },
                  confidence: {
                    type: "number",
                    description: "Confidence score 1-10. Only set if is_cookie_banner is true.",
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

  // Support both old "action" field and new "action_type" field
  const actionType = parsed.action_type || (parsed.action === "hide" ? "close" : "reject");

  return {
    is_cookie_banner: parsed.is_cookie_banner !== false,
    selector: parsed.selector,
    action: parsed.action,
    action_type: actionType,
    confidence: parsed.confidence,
    rejection_reason: parsed.rejection_reason,
    usage: { prompt_tokens: usage.prompt_tokens, completion_tokens: usage.completion_tokens },
  };
}

async function insertCMPPattern(supabase: any, candidate: any, cmp: typeof KNOWN_CMPS[number]) {
  // Check for existing high-confidence pattern
  if (await hasExistingHighConfidencePattern(supabase, candidate.domain)) {
    console.log(`[${candidate.domain}] Skipping CMP insert — existing high-confidence pattern found`);
    await supabase.from("ai_generation_log").insert({
      domain: candidate.domain,
      status: "skipped_already_covered",
      selector_generated: cmp.selector,
      action_type: cmp.action,
      confidence: 7,
      ai_model: `cmp_detection:${cmp.name}`,
      html_source: `Domain already has high-confidence pattern. CMP: ${cmp.name}`.substring(0, 500),
    });
    await supabase.rpc("mark_ai_processed", { _domain: candidate.domain, _resolved: true });
    return;
  }

  const { error: upsertErr } = await supabase.rpc("upsert_pattern", {
    _domain: candidate.domain,
    _selector: cmp.selector,
    _action_type: cmp.action,
    _cmp_fingerprint: cmp.cmp_fingerprint,
    _source: "ai_generated",
  });
  if (upsertErr) throw upsertErr;

  // CMP-detected patterns start at confidence 7 + set strategy for built-in handler routing
  await supabase
    .from("cookie_patterns")
    .update({ confidence: 7, strategy: cmp.cmp_fingerprint } as any)
    .eq("domain", candidate.domain)
    .eq("selector", cmp.selector);

  await supabase.from("ai_generation_log").insert({
    domain: candidate.domain,
    status: "success_cmp_fallback",
    selector_generated: cmp.selector,
    action_type: cmp.action,
    confidence: 7,
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

  // Reject banned selectors
  if (isSelectorBanned(selector)) {
    console.warn(`[${candidate.domain}] Rejected dangerous selector "${selector}"`);
    await supabase.from("ai_generation_log").insert({
      domain: candidate.domain,
      status: "rejected_dangerous_selector",
      selector_generated: selector,
      error_message: `Selector "${selector}" is a banned structural element`,
      ai_model: AI_MODEL_LABEL,
    });
    await supabase.rpc("mark_ai_processed", { _domain: candidate.domain, _resolved: false });
    return;
  }

  let actionType = aiResult.action_type || (aiResult.action === "hide" ? "close" : "reject");

  // Validate selector/action_type for contradictions
  const validation = validateSelectorAction(selector, actionType);
  if (!validation.valid && validation.corrected) {
    console.log(`[${candidate.domain}] Selector/action contradiction: ${validation.reason}. Auto-correcting to "${validation.corrected}"`);
    actionType = validation.corrected;
    status = status + "_autocorrected";
  }

  // Check for existing high-confidence pattern
  if (await hasExistingHighConfidencePattern(supabase, candidate.domain)) {
    console.log(`[${candidate.domain}] Skipping AI insert — existing high-confidence pattern found`);
    await supabase.from("ai_generation_log").insert({
      domain: candidate.domain,
      status: "skipped_already_covered",
      selector_generated: selector,
      action_type: actionType,
      confidence: Number(aiResult.confidence) || 5,
      ai_model: AI_MODEL_LABEL,
      prompt_tokens: aiResult.usage?.prompt_tokens ?? null,
      completion_tokens: aiResult.usage?.completion_tokens ?? null,
      html_source: `Domain already has high-confidence pattern`.substring(0, 500),
    });
    await supabase.rpc("mark_ai_processed", { _domain: candidate.domain, _resolved: true });
    return;
  }

  const rawConfidence = Number(aiResult.confidence) || 5;
  // AI patterns cap at 6, let success tracking promote them
  const confidence = Math.min(Math.round(rawConfidence), 6);

  const { error: upsertErr } = await supabase.rpc("upsert_pattern", {
    _domain: candidate.domain,
    _selector: selector,
    _action_type: actionType,
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
    action_type: actionType,
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

// ---------- Gemini Flash Failsafe ----------
const GEMINI_FAILSAFE_MODEL = "google/gemini-2.5-flash";

async function geminiFailsafe(apiKey: string, domain: string, html: string): Promise<{ selector: string; action: string; confidence: number; strategy?: string } | null> {
  const prompt = `You are analyzing the HTML of ${domain} to find how to dismiss its cookie consent banner.

The HTML may not contain the actual banner elements (they might be injected by JavaScript), but it WILL contain clues:
- <script> tags loading consent management platforms (CMPs)
- Meta tags or config objects referencing cookie consent
- CSS classes or IDs that hint at the consent system

Your job:
1. Identify what consent system this site uses (e.g., Usercentrics, OneTrust, CookieBot, custom, etc.)
2. Based on that system, provide the best CSS selector to click to REJECT or DENY cookies
3. If it's a known CMP that uses shadow DOM (like Usercentrics), say so — the extension has built-in handlers

Rules:
- Prefer reject/deny over accept
- If you can identify the CMP but can't determine a specific selector, return the CMP name as "strategy"
- Only return JSON, no markdown

HTML (first 15000 chars):
${html.substring(0, 15000)}`;

  try {
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GEMINI_FAILSAFE_MODEL,
        messages: [
          { role: "system", content: "You analyze web pages to identify cookie consent management platforms and how to dismiss them. Return only valid JSON." },
          { role: "user", content: prompt },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "identify_cookie_consent",
              description: "Report the cookie consent system and how to dismiss it.",
              parameters: {
                type: "object",
                properties: {
                  cmp_detected: { type: "string", description: "Name of CMP or 'custom' or 'unknown'" },
                  strategy: { type: "string", description: "CMP name in lowercase if known CMP, null if custom. Used for built-in handler routing." },
                  selector: { type: "string", description: "CSS selector for reject/deny button" },
                  action: { type: "string", enum: ["reject", "accept", "close", "necessary", "save"], description: "What the button does" },
                  confidence: { type: "number", description: "1-10 confidence score" },
                  reasoning: { type: "string", description: "Brief explanation" },
                },
                required: ["cmp_detected", "selector", "action", "confidence"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "identify_cookie_consent" } },
      }),
    });

    if (!response.ok) {
      console.log(`Gemini failsafe HTTP error for ${domain}: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const toolCall = data.choices?.[0]?.message?.tool_calls?.[0];
    let parsed: any;

    if (toolCall?.function?.arguments) {
      parsed = JSON.parse(toolCall.function.arguments);
    } else {
      const content = data.choices?.[0]?.message?.content;
      if (!content) return null;
      let jsonStr = content.trim();
      const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) jsonStr = jsonMatch[1].trim();
      parsed = JSON.parse(jsonStr);
    }

    if (parsed.strategy && parsed.strategy !== "custom" && parsed.strategy !== "unknown" && parsed.strategy !== "null") {
      return {
        selector: parsed.selector || "",
        action: parsed.action || "reject",
        confidence: Math.min(parsed.confidence || 5, 7),
        strategy: parsed.strategy,
      };
    }
    if (parsed.selector) {
      return {
        selector: parsed.selector,
        action: parsed.action || "reject",
        confidence: Math.min(parsed.confidence || 4, 6),
      };
    }
  } catch (e) {
    console.log(`Gemini failsafe error for ${domain}: ${e}`);
  }
  return null;
}
