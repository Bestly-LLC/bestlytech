// Cookie Yeti — render-engine health probe (admin-facing).
//
// GET /functions/v1/cy-render-health
// Pings the self-hosted render engine (www.bestly.tech/api/cy-render) with the key
// from Vault, so "online" means a real authenticated round trip, not just that a
// setting exists. No PII. Anonymous (verify_jwt = false); the key never leaves
// the server.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const RENDER_URL = Deno.env.get("CY_RENDER_URL") ?? "https://www.bestly.tech/api/cy-render";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let online = false;
  let detail = "";
  const started = Date.now();
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: key, error } = await supabase.rpc("cy_render_key");
    if (error || !key) {
      detail = "render key missing from Vault";
    } else {
      const res = await fetch(RENDER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-render-key": String(key) },
        body: JSON.stringify({ action: "ping" }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json().catch(() => ({}));
      online = res.ok && body?.ok === true;
      detail = online ? "ok" : `engine answered ${res.status}`;
    }
  } catch (e) {
    detail = `engine unreachable: ${String(e).slice(0, 120)}`;
  }

  return new Response(
    JSON.stringify({
      configured: online, // kept for older admin builds
      online,
      engine: "vercel-chromium",
      status: online ? "online" : "offline",
      detail,
      latency_ms: Date.now() - started,
      checked_at: new Date().toISOString(),
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
