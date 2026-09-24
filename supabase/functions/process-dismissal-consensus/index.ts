import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_PUBLISHABLE: string = __keys("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

// Cookie Yeti — turn repeated user dismissals into patterns.
// 2026-09-16: only learns from real cookie banners and never from Bestly's own sites. Selectors
// that aren't obviously cookie controls are held OFF by the cy_pattern_gate trigger until the
// robot browser confirms them (validate-pattern).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CONSENT_RE = /cookie|consent|gdpr|ccpa|onetrust|optanon|didomi|cookiebot|usercentrics|trustarc|truste-|quantcast|qc-cmp|sourcepoint|sp_message|osano|iubenda|cookieyes|(^|[^a-z])cky-|cmplz|complianz|termly|klaro|borlabs|axeptio|tarteaucitron|datenschutz|einwilligung|rgpd|privacy (settings|preferences|choices)|your privacy/i;
const BANNED_SELECTORS = ["body", "html", "head", "body *", "html *", "*"];
const EXCLUDED_DOMAINS = [
  "icloud.com", "mail.google.com", "drive.google.com", "docs.google.com",
  "outlook.live.com", "outlook.office.com", "teams.microsoft.com",
  "accounts.google.com", "appleid.apple.com", "bestly.tech",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const J = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const secret = req.headers.get("x-maintenance-secret");
  const authHeader = req.headers.get("Authorization");
  const serviceRoleKey = SB_SECRET;
  let authorized = false;
  if (secret && secret === Deno.env.get("MAINTENANCE_SECRET")) {
    authorized = true;
  } else if (isSvc(req)) {
    authorized = true;
  } else if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.replace("Bearer ", "");
    if (token === serviceRoleKey) {
      authorized = true;
    } else {
      const authClient = createClient(Deno.env.get("SUPABASE_URL")!, SB_PUBLISHABLE, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData } = await authClient.auth.getUser(token);
      if (userData?.user) {
        const svcCheck = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);
        const { data: isAdmin } = await svcCheck.rpc("has_role", { _user_id: userData.user.id, _role: "admin" });
        if (isAdmin) authorized = true;
      }
    }
  }
  if (!authorized) return J({ error: "Unauthorized" }, 401);

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);
    const { data: consensus, error: rpcErr } = await supabase.rpc("find_dismissal_consensus" as any);
    if (rpcErr) throw rpcErr;
    const entries = (consensus as any[]) ?? [];
    if (entries.length === 0) return J({ message: "No consensus found", processed: 0 });

    let created = 0;
    const results: any[] = [];

    for (const entry of entries) {
      try {
        if (BANNED_SELECTORS.includes((entry.clicked_selector || "").trim().toLowerCase())) {
          results.push({ domain: entry.domain, error: `Rejected banned selector: ${entry.clicked_selector}` });
          continue;
        }
        const domainLower = (entry.domain || "").toLowerCase();
        if (EXCLUDED_DOMAINS.some((ed) => domainLower === ed || domainLower.endsWith("." + ed))) {
          results.push({ domain: entry.domain, error: "Excluded domain" });
          continue;
        }
        // Only learn from dismissals of real cookie banners.
        if (!CONSENT_RE.test(`${entry.banner_selector || ""} ${entry.clicked_selector || ""}`)) {
          const { data: htmlRows } = await supabase.from("dismissal_reports").select("banner_html")
            .eq("domain", entry.domain).not("banner_html", "is", null).limit(5);
          if (!(htmlRows ?? []).some((r: any) => CONSENT_RE.test(String(r.banner_html)))) {
            results.push({ domain: entry.domain, skipped: "not_a_cookie_banner" });
            continue;
          }
        }

        const s = (entry.clicked_selector || "").toLowerCase();
        let inferredAction = "close";
        if (/reject|decline|deny|refuse/i.test(s)) inferredAction = "reject";
        else if (/necessary|essential|required-only/i.test(s)) inferredAction = "necessary";
        else if (/accept|agree|allow|got-it|gotit|ok-button/i.test(s)) inferredAction = "accept";
        else if (/save|confirm|preferences/i.test(s)) inferredAction = "save";

        await supabase.rpc("upsert_pattern", {
          _domain: entry.domain, _selector: entry.clicked_selector, _action_type: inferredAction,
          _cmp_fingerprint: "generic", _source: "user_consensus",
        });
        const confidence = Math.min(5 + entry.report_count, 9);
        const { data: row } = await supabase.from("cookie_patterns").update({ confidence })
          .eq("domain", entry.domain).eq("selector", entry.clicked_selector).eq("action_type", inferredAction)
          .select("is_active").maybeSingle();
        const live = !!row?.is_active;

        await supabase.from("ai_generation_log").insert({
          domain: entry.domain,
          status: live ? "success_consensus" : "consensus_needs_robot_check",
          selector_generated: entry.clicked_selector,
          action_type: inferredAction,
          confidence: live ? confidence : 0,
          ai_model: "user_consensus",
          html_source: `Consensus from ${entry.report_count} user dismissals. Banner: ${entry.banner_selector || "unknown"}. ${live ? "Live." : "Held for robot check."}`.substring(0, 500),
        });
        if (live) {
          await supabase.rpc("mark_ai_processed", { _domain: entry.domain, _resolved: true });
          await supabase.from("dismissal_reports").delete().eq("domain", entry.domain);
          created++;
        }
        results.push({ domain: entry.domain, selector: entry.clicked_selector, action_type: inferredAction, live, reports: entry.report_count });
      } catch (err: any) {
        results.push({ domain: entry.domain, error: err.message });
      }
    }
    return J({ processed: entries.length, created, results });
  } catch (err: any) {
    return J({ error: err.message }, 500);
  }
});
