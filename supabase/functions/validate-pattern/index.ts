// Cookie Yeti — Pattern Validation Gate
// The robot browser (/api/cy-render, Frankfurt) loads the real page, CLICKS the selector and checks
// two things: the button sits inside a cookie/consent banner, and the banner goes away.
//
// Queue 1 (first): validation_status = 'needs_robot_check'. Learned patterns the cy_pattern_gate
//   trigger holds OFF because their selector doesn't look like a cookie control (user dismissals,
//   extension reports, loop reports). Only a full pass turns them on.
// Queue 2: AI-generated patterns not validated yet (served at confidence 1-6).
//
//   passed                      in a cookie banner + closes it  -> on, confidence 8
//   rejected_not_cookie_banner  button isn't in a cookie banner -> off for good
//   not_dismissed               in a banner, click didn't close -> off (AI domains re-queued)
//   not_seen                    button never appeared           -> held patterns stay off; AI ones keep serving
//   inconclusive                page failed                     -> retried later
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const RENDER_URL = Deno.env.get("CY_RENDER_URL") ?? "https://www.bestly.tech/api/cy-render";
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Verdict = { found: boolean; dismissed: boolean; inConsent: boolean; error: string | null };

async function runValidation(key: string, url: string, selector: string): Promise<Verdict | null> {
  try {
    const res = await fetch(RENDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-render-key": key },
      signal: AbortSignal.timeout(58_000),
      body: JSON.stringify({ action: "validate", url, selector }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) { console.log(`validate ${res.status} ${url} ${body?.error ?? ""}`); return null; }
    if (typeof body.inConsent !== "boolean") return null; // older robot build: don't judge without the banner check
    return { found: !!body.found, dismissed: !!body.dismissed, inConsent: body.inConsent, error: body.error ?? null };
  } catch (e) {
    console.log(`validation error: ${e}`);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const SERVICE = SB_SECRET;
  const auth = req.headers.get("Authorization") || "";
  const maint = req.headers.get("x-maintenance-secret");
  if (!(isSvc(req) || (!!maint && maint === Deno.env.get("MAINTENANCE_SECRET")))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE);
  const { data: key } = await supabase.rpc("cy_render_key");
  if (!key) return json({ skipped: "render key missing from Vault", validated: 0 });

  let limit = 3;
  let only: string | null = null;
  try { const b = await req.json(); if (b.limit) limit = Math.min(b.limit, 5); if (b.domain) only = b.domain; } catch { /* no body */ }

  const cols = "id,domain,selector,action_type,confidence,source,validation_status";
  let held = supabase.from("cookie_patterns").select(cols).eq("validation_status", "needs_robot_check");
  held = only ? held.eq("domain", only) : held;
  const { data: heldRows, error: heldErr } = await held.order("updated_at", { ascending: true }).limit(limit);
  if (heldErr) return json({ error: heldErr.message }, 500);

  let aiRows: any[] = [];
  const room = limit - (heldRows?.length ?? 0);
  if (room > 0) {
    let q = supabase.from("cookie_patterns").select(cols)
      .eq("source", "ai_generated").is("validated_at", null).eq("is_active", true)
      .gte("confidence", 1).lt("confidence", 7)
      .or("validation_status.is.null,validation_status.eq.inconclusive");
    q = only ? q.eq("domain", only) : q;
    const { data, error } = await q.order("validation_status", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false }).limit(room);
    if (error) return json({ error: error.message }, 500);
    aiRows = data ?? [];
  }

  const results: any[] = [];
  const tally: Record<string, number> = {};
  const now = () => new Date().toISOString();

  for (const p of [...(heldRows ?? []).map((r) => ({ ...r, held: true })), ...aiRows.map((r) => ({ ...r, held: false }))]) {
    let testUrl = `https://${p.domain}`;
    try {
      const { data: rep } = await supabase.from("missed_banner_reports").select("page_url")
        .eq("domain", p.domain).order("last_reported", { ascending: false }).limit(1);
      if (rep && rep[0]?.page_url) testUrl = rep[0].page_url;
    } catch (_e) { /* default */ }

    const v = await runValidation(String(key), testUrl, p.selector);
    let status: string;

    if (!v || v.error) {
      status = "inconclusive";
      // Held patterns stay held (and rotate to the back of the queue); AI ones get marked.
      await supabase.from("cookie_patterns").update({ validation_status: p.held ? "needs_robot_check" : "inconclusive" }).eq("id", p.id);
    } else if (v.found && !v.inConsent) {
      status = "rejected_not_cookie_banner";
      await supabase.from("cookie_patterns").update({
        is_active: false, confidence: 0, validated_at: now(), validation_status: status,
      }).eq("id", p.id);
    } else if (v.found && v.dismissed) {
      status = "passed";
      await supabase.from("cookie_patterns").update({
        is_active: true, confidence: 8, validated_at: now(), validation_status: status,
      }).eq("id", p.id);
      try { await supabase.rpc("mark_ai_processed", { _domain: p.domain, _resolved: true }); } catch (_e) { /* best effort */ }
    } else if (v.found) {
      status = "not_dismissed";
      await supabase.from("cookie_patterns").update({
        is_active: false, confidence: 0, validated_at: now(), validation_status: status,
      }).eq("id", p.id);
      if (!p.held) {
        try { await supabase.from("missed_banner_reports").update({ resolved: false, ai_processed_at: null }).eq("domain", p.domain); } catch (_e) { /* best effort */ }
      }
    } else {
      status = "not_seen";
      // The gate trigger keeps a held (non-cookie-looking) pattern off; AI cookie selectors keep serving.
      await supabase.from("cookie_patterns").update({ validation_status: status }).eq("id", p.id);
    }

    tally[status] = (tally[status] ?? 0) + 1;
    results.push({ domain: p.domain, selector: p.selector, held: p.held, status });
  }

  return json({ checked: results.length, ...tally, results });
});
