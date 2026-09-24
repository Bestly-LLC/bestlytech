// Cookie Yeti — a user closed a banner by hand; learn from it, carefully.
//
// POST { domain, clicked_selector, banner_selector?, banner_html? }
//
// 2026-09-16 fix: this used to turn ONE click on ANY overlay into a live pattern, which taught
// the extension to click menu buttons (Shopify Settings, "More actions", Bestly's own admin rows)
// and reopen what the user had just closed, over and over. Now:
//   * the thing the user closed must look like a cookie/consent banner, or nothing is learned
//   * Bestly's own sites are never learned
//   * whatever is learned goes through the cy_pattern_gate trigger: a selector that isn't
//     obviously a cookie control stays OFF until the robot browser proves it (validate-pattern).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BANNED_SELECTORS = ["body", "html", "head", "body *", "html *", "*"];
const EXCLUDED_DOMAINS = [
  "icloud.com", "mail.google.com", "drive.google.com", "docs.google.com",
  "outlook.live.com", "outlook.office.com", "teams.microsoft.com",
  "accounts.google.com", "appleid.apple.com", "bestly.tech",
];

// Words that show up in real consent banners (ids, classes, visible text), in several languages.
const CONSENT_RE = /cookie|consent|gdpr|ccpa|onetrust|optanon|didomi|cookiebot|usercentrics|trustarc|truste-|quantcast|qc-cmp|sourcepoint|sp_message|osano|iubenda|cookieyes|(^|[^a-z])cky-|cmplz|complianz|termly|klaro|borlabs|axeptio|tarteaucitron|datenschutz|einwilligung|rgpd|privacy (settings|preferences|choices)|your privacy|we value your privacy|tracking technologies/i;

function inferActionType(selector: string): string {
  const s = (selector || "").toLowerCase();
  if (/reject|decline|deny|refuse/i.test(s)) return "reject";
  if (/necessary|essential|required-only/i.test(s)) return "necessary";
  if (/accept|agree|allow|got-it|gotit|ok-button/i.test(s)) return "accept";
  if (/save|confirm|preferences/i.test(s)) return "save";
  return "close";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { domain, clicked_selector, banner_selector, banner_html } = await req.json();
    if (!domain || !clicked_selector) return json({ error: "domain and clicked_selector are required" }, 400);

    if (BANNED_SELECTORS.includes(String(clicked_selector).trim().toLowerCase())) {
      return json({ error: "Rejected banned selector", skipped: true });
    }
    const domainLower = String(domain).toLowerCase();
    if (EXCLUDED_DOMAINS.some((ed) => domainLower === ed || domainLower.endsWith("." + ed))) {
      return json({ error: "Excluded domain", skipped: true });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET);

    // Only learn from something that is actually a cookie banner.
    const context = `${banner_selector || ""} ${String(banner_html || "").slice(0, 5000)} ${clicked_selector}`;
    if (!CONSENT_RE.test(context)) {
      await supabase.from("ai_generation_log").insert({
        domain, status: "skipped_not_cookie_banner", selector_generated: clicked_selector, ai_model: "user_consensus",
        html_source: `Ignored a dismissal: the closed element (${banner_selector || "unknown"}) doesn't look like a cookie banner.`.substring(0, 500),
      });
      return json({ skipped: true, reason: "not_a_cookie_banner" });
    }

    await supabase.from("dismissal_reports").insert({
      domain,
      clicked_selector,
      banner_selector: banner_selector || null,
      banner_html: banner_html ? String(banner_html).substring(0, 5000) : null,
    });

    const { data: existing } = await supabase
      .from("cookie_patterns").select("id").eq("domain", domain).eq("is_active", true).gte("confidence", 5).limit(1);
    if (existing && existing.length > 0) return json({ message: "Pattern already exists", domain, skipped: true });

    const { count } = await supabase
      .from("dismissal_reports").select("id", { count: "exact", head: true })
      .eq("domain", domain).eq("clicked_selector", clicked_selector);
    const reportCount = count || 1;
    const actionType = inferActionType(clicked_selector);

    await supabase.rpc("upsert_pattern", {
      _domain: domain, _selector: clicked_selector, _action_type: actionType, _cmp_fingerprint: "generic", _source: "user_consensus",
    });
    // The gate trigger zeroes this again for selectors that still need a robot check.
    const confidence = Math.min(5 + reportCount, 9);
    const { data: row } = await supabase.from("cookie_patterns").update({ confidence })
      .eq("domain", domain).eq("selector", clicked_selector).eq("action_type", actionType)
      .select("is_active, validation_status").maybeSingle();

    const live = !!row?.is_active;
    await supabase.from("ai_generation_log").insert({
      domain,
      status: live ? "success_consensus" : "consensus_needs_robot_check",
      selector_generated: clicked_selector,
      action_type: actionType,
      confidence: live ? confidence : 0,
      ai_model: "user_consensus",
      html_source: `From ${reportCount} dismissal(s). Banner: ${banner_selector || "unknown"}. ${live ? "Live." : "Held until the robot confirms it closes a cookie banner."}`.substring(0, 500),
    });
    if (live) {
      await supabase.rpc("mark_ai_processed", { _domain: domain, _resolved: true });
      await supabase.from("dismissal_reports").delete().eq("domain", domain);
    }

    return json({ message: live ? "Pattern created" : "Pattern held for robot check", domain, selector: clicked_selector, action_type: actionType, live, reports: reportCount });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
});
