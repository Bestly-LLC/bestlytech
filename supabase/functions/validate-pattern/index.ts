// Cookie Yeti — Pattern Validation Gate (Phase 2, autonomous auto-fix)
// Before an AI-generated pattern is trusted, this worker loads the real page in
// headless Chromium, CLICKS the generated selector, and confirms the banner goes away.
//   passed        banner found and dismissed      -> promote (confidence 8)
//   not_dismissed banner found, click did nothing -> pull from serving, re-queue for AI
//   not_seen      selector never appeared         -> keep serving, stop re-checking.
//                 (The renderer runs from a US datacenter, so many sites never show
//                 it a GDPR banner. Absence is not proof the selector is wrong.)
//   inconclusive  page failed to load             -> untouched, retried after fresh ones
//
// Engine: www.bestly.tech/api/cy-render, key from Vault (cy_render_key).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const RENDER_URL = Deno.env.get("CY_RENDER_URL") ?? "https://www.bestly.tech/api/cy-render";

type Verdict = { found: boolean; dismissed: boolean; error: string | null };

async function runValidation(key: string, url: string, selector: string): Promise<Verdict | null> {
  try {
    const res = await fetch(RENDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-render-key": key },
      signal: AbortSignal.timeout(55_000),
      body: JSON.stringify({ action: "validate", url, selector }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) { console.log(`validate ${res.status} ${url} ${body?.error ?? ""}`); return null; }
    return { found: !!body.found, dismissed: !!body.dismissed, error: body.error ?? null };
  } catch (e) {
    console.log(`validation error: ${e}`);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") || "";
  const maint = req.headers.get("x-maintenance-secret");
  const ok = auth === `Bearer ${SERVICE}` || (!!maint && maint === Deno.env.get("MAINTENANCE_SECRET"));
  if (!ok) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE);
  const { data: key } = await supabase.rpc("cy_render_key");
  if (!key) {
    return new Response(JSON.stringify({ skipped: "render key missing from Vault", validated: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let limit = 3;
  let only: string | null = null;
  try { const b = await req.json(); if (b.limit) limit = Math.min(b.limit, 5); if (b.domain) only = b.domain; } catch { /* no body */ }

  // Unproven AI patterns: generated, not yet validated, currently served (conf 1..6).
  // Never-checked first, then earlier inconclusive runs.
  let q = supabase
    .from("cookie_patterns")
    .select("id,domain,selector,action_type,confidence,source,validated_at,validation_status")
    .eq("source", "ai_generated")
    .is("validated_at", null)
    .eq("is_active", true)
    .gte("confidence", 1)
    .lt("confidence", 7)
    .or("validation_status.is.null,validation_status.eq.inconclusive");
  q = only
    ? q.eq("domain", only).limit(limit)
    : q.order("validation_status", { ascending: true, nullsFirst: true }).order("created_at", { ascending: false }).limit(limit);

  const { data: pats, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const results: any[] = [];
  let passed = 0, failed = 0, notSeen = 0, inconclusive = 0;

  for (const p of (pats ?? [])) {
    let testUrl = `https://${p.domain}`;
    try {
      const { data: rep } = await supabase
        .from("missed_banner_reports")
        .select("page_url")
        .eq("domain", p.domain)
        .order("last_reported", { ascending: false })
        .limit(1);
      if (rep && rep[0]?.page_url) testUrl = rep[0].page_url;
    } catch (_e) { /* default to https://domain */ }

    const v = await runValidation(String(key), testUrl, p.selector);

    if (!v || v.error) {
      await supabase.from("cookie_patterns").update({ validation_status: "inconclusive" }).eq("id", p.id);
      inconclusive++;
      results.push({ domain: p.domain, status: "inconclusive", error: v?.error ?? "engine" });
      continue;
    }

    if (v.found && v.dismissed) {
      await supabase.from("cookie_patterns").update({
        confidence: 8, is_active: true, validated_at: new Date().toISOString(), validation_status: "passed",
      }).eq("id", p.id);
      try { await supabase.rpc("mark_ai_processed", { _domain: p.domain, _resolved: true }); } catch (_e) {}
      passed++;
      results.push({ domain: p.domain, status: "passed", selector: p.selector });
    } else if (v.found) {
      // Proven failure: the banner was there and the click didn't clear it.
      await supabase.from("cookie_patterns").update({
        confidence: 0, is_active: false, validated_at: new Date().toISOString(), validation_status: "not_dismissed",
      }).eq("id", p.id);
      try {
        await supabase.from("missed_banner_reports")
          .update({ resolved: false, ai_processed_at: null })
          .eq("domain", p.domain);
      } catch (_e) {}
      failed++;
      results.push({ domain: p.domain, status: "not_dismissed", selector: p.selector });
    } else {
      await supabase.from("cookie_patterns").update({ validation_status: "not_seen" }).eq("id", p.id);
      notSeen++;
      results.push({ domain: p.domain, status: "not_seen", selector: p.selector });
    }
  }

  return new Response(JSON.stringify({ checked: (pats ?? []).length, passed, failed, not_seen: notSeen, inconclusive, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
