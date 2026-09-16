// Cookie Yeti — loop breaker. The extension calls this when a pattern it clicked keeps
// coming back (it clicked, the thing reappeared or the user undid it) so no other user
// gets stuck in the same open/close cycle.
//
// POST { domain, selector, reason? }   anonymous (verify_jwt = false), like report-dismissal
//
// Effect: the pattern is switched off and queued for the robot browser, which turns it back on
// only if the button sits in a real cookie banner and clicking it closes the banner.
// Switching off is the safe direction, so one report is enough.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "JSON body required" }, 400); }
  const domain = String(body.domain || "").trim().toLowerCase().replace(/^www\./, "");
  const selector = String(body.selector || "").trim();
  const reason = String(body.reason || "loop").slice(0, 60);
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain) || !selector || selector.length > 500) {
    return json({ error: "domain and selector required" }, 400);
  }

  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows } = await svc.from("cookie_patterns")
    .select("id, domain, selector, source, is_active, confidence, validation_status")
    .in("domain", [domain, `www.${domain}`]).eq("selector", selector);

  let paused = 0;
  for (const r of rows ?? []) {
    if (!r.is_active && !(r.confidence > 0)) continue;
    await svc.from("cy_pattern_quarantine_log").insert({
      pattern_id: r.id, domain: r.domain, selector: r.selector, previous: r, reason: `extension_${reason}`,
    });
    // admin_guided rows skip the gate trigger, so set every field explicitly.
    await svc.from("cookie_patterns").update({
      is_active: false, confidence: 0, validation_status: "needs_robot_check", validated_at: null,
    }).eq("id", r.id);
    paused++;
  }

  await svc.from("ai_generation_log").insert({
    domain, status: paused ? "paused_by_loop_report" : "loop_report_no_match", selector_generated: selector,
    ai_model: "extension", html_source: `Extension reported a click loop (${reason}). Paused ${paused} pattern(s) for a robot check.`,
  });
  return json({ ok: true, paused });
});
