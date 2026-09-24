// Cookie Yeti — Banner Render Worker (Phase 1, autonomous auto-fix)
// For unresolved missed-banner reports that arrived WITHOUT usable HTML (JS-
// rendered sites, shadow DOM, content-script couldn't capture), this worker
// renders the page with headless Chromium, captures the real cookie banner HTML,
// writes it back to the report, and kicks the existing AI pattern generator.
//
// Engine: Bestly's own renderer at www.bestly.tech/api/cy-render (Vercel +
// Chromium). Its key lives in Supabase Vault (cy_render_key), read via RPC.
// Scheduled by pg_cron 'render-missed-banners' every 10 min via invoke_edge_function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const sbHeaders = (k: string): Record<string, string> => k.startsWith("sb_") ? { apikey: k } : { apikey: k, Authorization: `Bearer ${k}` };
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const RENDER_URL = Deno.env.get("CY_RENDER_URL") ?? "https://www.bestly.tech/api/cy-render";

const CONSENT_PATTERNS: RegExp[] = [
  /(<div[^>]*id="(?:onetrust|optanon|didomi|cookiebot|CybotCookiebot|quantcast|qc-cmp|sp_message|sp-cc|cmp|cookie-?consent|privacy-?consent|gdpr|cookie-?banner|cookie-?notice|cookie-?popup|cookie-?modal|consent-?banner|consent-?modal|consent-?popup|cookie-?wall|cookie-?overlay|cookie-?bar|usercentrics|iubenda|cky-consent|truste|osano)[^"]*"[^>]*>[\s\S]*?<\/div>)/i,
  /(<div[^>]*class="[^"]*(?:cookie-?consent|cookie-?banner|cookie-?notice|consent-?banner|consent-?modal|privacy-?banner|gdpr-?banner|cmp-?container|cookie-?popup|cookie-?wall|cookie-?overlay|cky-consent|osano-cm)[^"]*"[^>]*>[\s\S]*?<\/div>)/i,
  /(<(?:div|section|aside|dialog|form)[^>]*>(?:[^<]|\n)*(?:cookie|consent|privacy|gdpr|datenschutz|Einwilligung)(?:[^<]|\n)*(?:<(?:button|a|input)[^>]*>[\s\S]*?<\/(?:button|a|input)>[\s\S]*?){1,12}<\/(?:div|section|aside|dialog|form)>)/i,
];

function extractConsentRegion(html: string): string | null {
  for (const p of CONSENT_PATTERNS) {
    const m = html.match(p);
    if (m && (m[1] || m[0])) return (m[1] || m[0]).slice(0, 8000);
  }
  return null;
}

async function renderHtml(key: string, url: string): Promise<string | null> {
  try {
    const res = await fetch(RENDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-render-key": key },
      signal: AbortSignal.timeout(55_000),
      body: JSON.stringify({ action: "content", url }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) { console.log(`render ${res.status} ${url} ${body?.error ?? ""}`); return null; }
    return typeof body.html === "string" && body.html.length ? body.html : null;
  } catch (e) {
    console.log(`render error ${url}: ${e}`);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SERVICE = SB_SECRET;
  const auth = req.headers.get("Authorization") || "";
  const maint = req.headers.get("x-maintenance-secret");
  const ok = isSvc(req) || (!!maint && maint === Deno.env.get("MAINTENANCE_SECRET"));
  if (!ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE);
  const { data: key } = await supabase.rpc("cy_render_key");
  if (!key) {
    return new Response(JSON.stringify({ skipped: "render key missing from Vault", rendered: 0, captured: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Each render takes ~10-20s; 3 per run keeps us well inside the edge wall clock.
  let limit = 3;
  let only: string | null = null;
  try { const b = await req.json(); if (b.limit) limit = Math.min(b.limit, 5); if (b.domain) only = b.domain; } catch { /* no body */ }

  let query = supabase
    .from("missed_banner_reports")
    .select("id,domain,page_url,banner_html,render_attempts,report_count")
    .eq("resolved", false);
  query = only
    ? query.eq("domain", only).limit(1)
    : query.lt("render_attempts", 3).order("report_count", { ascending: false }).limit(limit);

  const { data: rows, error } = await query;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const candidates = (rows ?? []).filter((r: any) => only || !r.banner_html || String(r.banner_html).length < 50);
  const results: any[] = [];
  let rendered = 0, captured = 0;

  for (const r of candidates) {
    const url = r.page_url || `https://${r.domain}`;
    const html = await renderHtml(String(key), url);
    rendered++;
    const updates: Record<string, unknown> = {
      render_attempts: (r.render_attempts ?? 0) + 1,
      render_last_at: new Date().toISOString(),
    };
    let status = "render_failed";
    if (html) {
      const region = extractConsentRegion(html) || (html.length > 200 ? html.slice(0, 8000) : null);
      if (region) {
        updates.banner_html = region;
        updates.ai_processed_at = null; // clear cooldown so the AI re-processes with real HTML
        updates.ai_attempts = 0;        // fresh material → give the AI a clean attempt budget
        captured++;
        status = "captured";
      } else {
        status = "no_consent_region";
      }
    }
    await supabase.from("missed_banner_reports").update(updates).eq("id", r.id);
    results.push({ domain: r.domain, status });

    if (status === "captured") {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/ai-generate-pattern`, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...sbHeaders(SERVICE) },
          body: JSON.stringify({ domain: r.domain }),
        });
      } catch (_e) { /* the periodic AI cron will still pick it up */ }
    }
  }

  return new Response(JSON.stringify({ rendered, captured, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
