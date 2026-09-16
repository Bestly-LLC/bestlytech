// Cookie Yeti — Auto-Fix orchestrator.
//
// POST /functions/v1/cy-autofix
//   { domain, url? }  one domain, run now (admin JWT). `url` = a page where the banner shows.
//   { sweep: true }   the next stuck domain (service role; pg_cron every 15 min).
//
// For a stuck domain it does everything a human would have tried:
//   1. drops reports that point at an ad/tracker script instead of a real site
//   2. loads the page in real Chromium from Frankfurt (sites show EU visitors their banner)
//   3. hands the banner / consent-manager scripts to ai-generate-pattern
//   4. clicks the new selector in Chromium to prove it works
// and records one outcome, so the admin only asks Jared for the one thing a robot can't do.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

const RENDER_URL = Deno.env.get("CY_RENDER_URL") ?? "https://www.bestly.tech/api/cy-render";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Ad-tech / consent-vendor hosts: a "missed banner" filed against these is a script
// running inside some other site, not a site anyone visits.
const THIRD_PARTY = /(^|\.)(criteo\.com|criteo\.net|doubleclick\.net|googlesyndication\.com|googletagmanager\.com|google-analytics\.com|adnxs\.com|taboola\.com|outbrain\.com|amazon-adsystem\.com|scorecardresearch\.com|cookielaw\.org|onetrust\.com|privacy-mgmt\.com|consensu\.org|facebook\.net|rubiconproject\.com|pubmatic\.com|casalemedia\.com|demdex\.net|adsrvr\.org|quantserve\.com|hotjar\.com|segment\.io|cloudfront\.net|akamaihd\.net)$/i;

const CMP_SIGNS = [
  "onetrust", "optanon", "cookielaw.org", "cookiebot", "didomi", "privacy-center.org", "qc-cmp", "quantcast.mgr",
  "trustarc", "complianz", "cmplz", "osano-cm", "cmp.osano", "usercentrics", "iubenda", "cookieyes", "cky-consent",
  "app.termly.io", "kiprotect", "civiccomputing", "sourcepoint", "privacy-mgmt.com", "sp_message", "cookiefirst",
  "consentmanager.net", "cookie-script.com", "axeptio", "borlabs", "_brlbs", "tarteaucitron", "gdpr-lmd-wall",
];

const CONSENT_REGIONS: RegExp[] = [
  /(<div[^>]*id="(?:onetrust|optanon|didomi|cookiebot|CybotCookiebot|quantcast|qc-cmp|sp_message|sp-cc|cmp|cookie-?consent|privacy-?consent|gdpr|cookie-?banner|cookie-?notice|cookie-?popup|cookie-?modal|consent-?banner|consent-?modal|consent-?popup|cookie-?wall|cookie-?overlay|cookie-?bar|usercentrics|iubenda|cky-consent|truste|osano)[^"]*"[^>]*>[\s\S]*?<\/div>)/i,
  /(<div[^>]*class="[^"]*(?:cookie-?consent|cookie-?banner|cookie-?notice|consent-?banner|consent-?modal|privacy-?banner|gdpr-?banner|gdpr-[a-z]+-wall|cmp-?container|cookie-?popup|cookie-?wall|cookie-?overlay|cky-consent|osano-cm)[^"]*"[^>]*>[\s\S]*?<\/div>)/i,
  /(<(?:div|section|aside|dialog|form)[^>]*>(?:[^<]|\n)*(?:cookie|consent|gdpr|datenschutz|Einwilligung)(?:[^<]|\n)*(?:<(?:button|a|input)[^>]*>[\s\S]*?<\/(?:button|a|input)>[\s\S]*?){1,12}<\/(?:div|section|aside|dialog|form)>)/i,
];

function bannerEvidence(html: string): string | null {
  let region: string | null = null;
  for (const p of CONSENT_REGIONS) {
    const m = html.match(p);
    if (m) { region = (m[1] || m[0]).slice(0, 6000); break; }
  }
  const lower = html.toLowerCase();
  const scripts = (html.match(/<script[^>]+src="[^"]+"[^>]*>/gi) || [])
    .filter((s) => CMP_SIGNS.some((k) => s.toLowerCase().includes(k)))
    .slice(0, 6);
  const cmpInPage = CMP_SIGNS.some((k) => lower.includes(k));
  if (!region && !scripts.length && !cmpInPage) return null;
  const parts = [region ?? "", ...scripts];
  if (!region && !scripts.length) {
    // CMP named inline (config object); give the AI the surrounding text.
    const k = CMP_SIGNS.find((s) => lower.includes(s))!;
    const i = lower.indexOf(k);
    parts.push(html.slice(Math.max(0, i - 1500), i + 1500));
  }
  return parts.join("\n").slice(0, 8000);
}

async function engine(key: string, body: Record<string, unknown>) {
  try {
    const res = await fetch(RENDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-render-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(58_000),
    });
    const out = await res.json().catch(() => null);
    return res.ok && out?.ok ? out : null;
  } catch {
    return null;
  }
}

const hostOf = (u?: string | null) => { try { return u ? new URL(u).hostname.toLowerCase() : null; } catch { return null; } };
const originOf = (u?: string | null) => { try { return u ? new URL(u).origin : null; } catch { return null; } };

async function isAdmin(req: Request, svc: any): Promise<boolean> {
  const auth = req.headers.get("Authorization") || "";
  if (auth === `Bearer ${SERVICE}`) return true;
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await svc.auth.getUser(token);
  if (!data?.user) return false;
  const { data: ok } = await svc.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
  return ok === true;
}

type Outcome = "fixed" | "fixed_unverified" | "wrong_site" | "blocked" | "no_banner_seen" | "ai_failed" | "ai_wrong";

async function autofix(svc: any, key: string, domain: string, urlOverride?: string | null) {
  const { data: row } = await svc.from("missed_banner_reports")
    .select("id,domain,page_url,resolved,autofix_runs").eq("domain", domain).maybeSingle();
  if (!row) return { domain, outcome: "not_found", note: "No report for this domain." };
  if (row.resolved) return { domain, outcome: "fixed", note: "Already resolved." };

  const finish = async (outcome: Outcome, note: string, extra: Record<string, unknown> = {}) => {
    await svc.from("missed_banner_reports").update({
      autofix_outcome: outcome, autofix_note: note, autofix_last_at: new Date().toISOString(), ...extra,
    }).eq("id", row.id);
    return { domain, outcome, note };
  };

  await svc.from("missed_banner_reports").update({
    autofix_outcome: "running", autofix_note: null, autofix_last_at: new Date().toISOString(),
    autofix_runs: (row.autofix_runs ?? 0) + 1,
  }).eq("id", row.id);

  // 1. Reports filed against an ad/tracker script inside another site.
  const pageHost = hostOf(row.page_url);
  if (THIRD_PARTY.test(domain) && pageHost && !pageHost.endsWith(domain)) {
    return finish("wrong_site", `${domain} is an ad or tracking script that ran inside ${pageHost}, not a site with its own banner. Closed.`,
      { resolved: true, resolved_at: new Date().toISOString() });
  }

  // 2. Load it for real.
  const override = urlOverride && /^https?:\/\//i.test(urlOverride) ? urlOverride : null;
  const target = override || row.page_url || `https://${domain}`;
  const page = await engine(key, { action: "content", url: target });
  if (!page?.html) {
    return finish("blocked", `The page wouldn't load for our browser (bot protection or login wall) at ${hostOf(target)}.`);
  }
  const evidence = bannerEvidence(page.html);
  if (!evidence) {
    return finish("no_banner_seen", `Loaded ${hostOf(page.finalUrl) ?? hostOf(target)} from Europe and no cookie banner or consent manager showed up.`,
      override ? { page_url: originOf(override) } : {});
  }

  // 3. Fresh material for the AI, with a clean attempt budget.
  await svc.from("missed_banner_reports").update({
    banner_html: evidence, ai_attempts: 0, ai_processed_at: null, render_attempts: 0,
    ...(override ? { page_url: originOf(override) } : {}),
  }).eq("id", row.id);

  let ai: any = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/ai-generate-pattern`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({ domain }),
      signal: AbortSignal.timeout(60_000),
    });
    ai = await r.json().catch(() => null);
  } catch { /* handled below */ }
  const res0 = ai?.results?.[0] ?? {};
  const status: string = res0.status ?? "";

  if (status === "skipped_already_covered") return finish("fixed", "A working pattern already existed. Closed.");
  if (!status.startsWith("success") || !res0.selector) {
    // ai-generate-pattern may have bumped attempts; keep the domain visible.
    return finish("ai_failed", "Found the cookie banner, but the AI couldn't pick a button to click.");
  }

  // 4. Prove it: click the selector on the live page.
  const { data: pat } = await svc.from("cookie_patterns").select("id")
    .eq("domain", domain).eq("selector", res0.selector).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const v = await engine(key, { action: "validate", url: target, selector: res0.selector });
  if (v && !v.error && v.found && v.dismissed) {
    if (pat) await svc.from("cookie_patterns").update({
      confidence: 8, is_active: true, validated_at: new Date().toISOString(), validation_status: "passed",
    }).eq("id", pat.id);
    return finish("fixed", `Fixed and tested: clicking ${res0.selector} closes the banner.`,
      { resolved: true, resolved_at: new Date().toISOString(), has_working_pattern: true });
  }
  if (v && !v.error && v.found && !v.dismissed) {
    if (pat) await svc.from("cookie_patterns").update({
      confidence: 0, is_active: false, validated_at: new Date().toISOString(), validation_status: "not_dismissed",
    }).eq("id", pat.id);
    return finish("ai_wrong", "The AI picked a button, but clicking it didn't close the banner. Pulled it.",
      { resolved: false });
  }
  // Selector not visible to our browser: the AI's pattern stays live (ai-generate-pattern resolved it).
  return finish("fixed_unverified", `New pattern is live (${res0.selector}). Our browser couldn't click-test it, so users confirm it.`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const svc = createClient(SUPABASE_URL, SERVICE);
  if (!(await isAdmin(req, svc))) return json({ error: "Unauthorized" }, 401);

  const { data: key } = await svc.rpc("cy_render_key");
  if (!key) return json({ error: "Render engine key missing" }, 503);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  if (body.sweep) {
    const { data: domains } = await svc.rpc("cy_autofix_candidates", { p_limit: 1 });
    const results = [];
    for (const d of (domains ?? []) as unknown[]) {
      const name = typeof d === "string" ? d : (d as any)?.cy_autofix_candidates;
      if (name) results.push(await autofix(svc, String(key), String(name)));
    }
    return json({ swept: results.length, results });
  }

  const domain = String(body.domain || "").trim().toLowerCase();
  if (!domain) return json({ error: "domain required" }, 400);
  return json(await autofix(svc, String(key), domain, body.url ? String(body.url) : null));
});
