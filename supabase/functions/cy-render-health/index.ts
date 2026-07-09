// Cookie Yeti — render-engine health probe (admin-facing).
//
// GET /functions/v1/cy-render-health
// Returns whether the headless render engine is actually configured, based on a
// REAL secret check (BROWSERLESS_TOKEN). Supabase Edge secrets are project-wide,
// so this reflects the true config the render/validate stages see — not an
// inferred "render_attempts > 0" heuristic. Used by CYAutoFixMonitor to show an
// honest "render engine offline" state instead of a fake-green pipeline.
//
// No PII, no DB access. Anonymous (verify_jwt = false) so the admin client can
// call it with the anon key.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const token = Deno.env.get("BROWSERLESS_TOKEN") ?? "";
  const configured = token.trim().length > 0;

  return new Response(
    JSON.stringify({
      configured,
      // Coarse, non-secret signal only. Never echo the token.
      status: configured ? "configured" : "not_configured",
      checked_at: new Date().toISOString(),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
