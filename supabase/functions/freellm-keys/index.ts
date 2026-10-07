import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

// Free AI keys (chief-of-staff plan, section 2). Admin-guarded wrapper over the freellm_key_* RPCs.
//   { action: "status" }                       -> per-provider key counts, the queue, when the Pi last synced (never a key value)
//   { action: "add", provider, key, label? }   -> parks the key in Vault; the Pi job (freellm_keys, every minute) adds it to FreeLLM
//   { action: "sync" }                         -> asks for a status refresh now (the Pi job picks it up within a minute)
// The key goes browser -> this function -> Vault and is never returned.

const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return J({ ok: false, error: "method not allowed" }, 405);
  const authz = req.headers.get("authorization") ?? "";
  if (!authz) return J({ ok: false, error: "authentication required" }, 401);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? req.headers.get("apikey") ?? "";
  // The caller's own JWT: team_is_admin() inside the RPCs checks auth.uid(), so a non-admin gets "admin only".
  const sb = createClient(url, anon, { global: { headers: { Authorization: authz } }, auth: { persistSession: false } });

  let body: any;
  try { body = await req.json(); } catch { return J({ ok: false, error: "invalid json" }, 400); }
  const action = String(body?.action ?? "status");

  if (action === "status" || action === "sync") {
    const { data, error } = await sb.rpc("freellm_keys_admin");
    if (error) return J({ ok: false, error: error.message }, error.message.includes("admin only") ? 403 : 500);
    return J({ ok: true, ...(data as object) });
  }
  if (action === "add") {
    const provider = String(body?.provider ?? "").trim();
    const key = String(body?.key ?? "").trim();
    if (!provider || !key) return J({ ok: false, error: "pick a provider and paste the key" }, 400);
    const { data, error } = await sb.rpc("freellm_key_add", { p_provider: provider, p_key: key, p_label: String(body?.label ?? "").slice(0, 60) });
    if (error) return J({ ok: false, error: error.message.replace(key, "[key]") }, error.message.includes("admin only") ? 403 : 400);
    return J({ ok: true, ...(data as object), note: "Saved. It is added to FreeLLM within a minute." });
  }
  return J({ ok: false, error: "unknown action" }, 400);
});
