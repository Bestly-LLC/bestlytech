// Cookie Yeti — render-engine health probe (admin-facing).
//
// GET /functions/v1/cy-render-health
// Pings the self-hosted render engine (www.bestly.tech/api/cy-render) with the key
// from Vault, so "online" means a real authenticated round trip, not just that a
// setting exists. No PII. Anonymous (verify_jwt = false); the key never leaves
// the server.
//
// Watchdog (2026-10-29): POST {"watch":true} with the service key (pg_cron job cy-render-watch, every
// 15 min, owned by Cookie Yeti Pipeline) does a real round trip, ping PLUS a "selftest" that launches
// Chromium and renders an inline page, because a ping alone stays green while the browser is broken.
// Two failures in one run raise 'cy:render-engine' through bestly_raise (signed by Cookie Yeti Pipeline,
// resolves itself when the browser is back). A "busy" answer is not a failure.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = corsWith({
  headers: "authorization, x-client-info, apikey, content-type",
  methods: "GET, POST, OPTIONS"
});

const RENDER_URL = Deno.env.get("CY_RENDER_URL") ?? "https://www.bestly.tech/api/cy-render";

const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

async function selftest(key: string): Promise<{ ok: boolean; busy: boolean; detail: string }> {
  try {
    const res = await fetch(RENDER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-render-key": key },
      body: JSON.stringify({ action: "selftest" }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body?.ok === true) return { ok: true, busy: false, detail: "ok" };
    if (body?.busy === true) return { ok: false, busy: true, detail: "busy" };
    return { ok: false, busy: false, detail: `browser test answered ${res.status}${body?.error ? `: ${String(body.error).slice(0, 100)}` : ""}` };
  } catch (e) {
    return { ok: false, busy: false, detail: `browser test did not answer: ${String(e).slice(0, 100)}` };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let watch = false;
  if (req.method === "POST" && isSvc(req)) {
    try { watch = (await req.json())?.watch === true; } catch { /* no body */ }
  }

  let online = false;
  let detail = "";
  const started = Date.now();
  const raiseDown = async (sb: any, why: string) => {
    await sb.rpc("bestly_raise", { p_key: "cy:render-engine", p_kind: "problem", p_severity: "warning",
      p_title: "Cookie Yeti's robot browser is down",
      p_body: `${why}. Banner fixes and pattern checks pause until it is back; they retry on their own every 15 minutes.`,
      p_area: "cookie-yeti" });
  };
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET);
    const { data: key, error } = await supabase.rpc("cy_render_key");
    if (error || !key) {
      detail = "render key missing from Vault";
      if (watch) await raiseDown(supabase, detail);
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

      if (watch) {
        // Real browser check, one retry. Busy means "working on other pages", which is healthy.
        let t = online ? await selftest(String(key)) : { ok: false, busy: false, detail };
        if (!t.ok && !t.busy) { await new Promise((r) => setTimeout(r, 5_000)); t = online ? await selftest(String(key)) : t; }
        const healthy = t.ok || t.busy;
        if (healthy) {
          await supabase.rpc("bestly_raise", { p_key: "cy:render-engine", p_kind: "resolved", p_severity: "info",
            p_title: "Cookie Yeti's robot browser is back", p_body: "Test page rendered fine.", p_area: "cookie-yeti" });
        } else {
          detail = t.detail;
          await raiseDown(supabase, t.detail);
        }
        online = healthy;
      }
    }
  } catch (e) {
    detail = `engine unreachable: ${String(e).slice(0, 120)}`;
    if (watch) {
      try { await raiseDown(createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET), detail); } catch { /* nothing more to do */ }
    }
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
