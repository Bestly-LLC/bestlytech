// Cookie Yeti — anonymous product-analytics ingestion.
//
// POST /functions/v1/track  (anon key in `apikey` header; verify_jwt = false)
// Body: { anon_id, platform, event, props?, app_version?, ts? }
//
// Privacy-first by construction:
//   - Only allowlisted event names + platforms are accepted.
//   - props are aggressively PII-scrubbed.
//   - We NEVER log request bodies or prop values.
// Returns 204 on success (best-effort ingest; never blocks the client UX).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ALLOWED_EVENTS = new Set([
  "install", "onboarding_complete", "extension_enabled", "first_dismiss",
  "banner_handled_daily", "daily_limit_hit", "report_submitted",
  "paywall_viewed", "upgrade_started", "upgrade_completed",
  "notif_opt_in", "notif_clicked", "heartbeat",
]);

const ALLOWED_PLATFORMS = new Set(["ios", "macos", "chrome", "safari"]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Max-Age": "86400",
};

const PII_KEY = /(email|e-mail|mail|url|uri|link|href|domain|host|hostname|ip|ipaddr|address|name|user|first|last|full_?name|phone|tel|zip|postal|lat|lon|geo|token|secret|password|cookie|query|search|referrer|referer|path)/i;
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/i;
const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function scrubProps(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  let kept = 0;
  for (const [rawKey, rawVal] of Object.entries(input as Record<string, unknown>)) {
    if (kept >= 20) break;
    const key = String(rawKey).slice(0, 40);
    if (PII_KEY.test(key)) continue;
    if (typeof rawVal === "number" && Number.isFinite(rawVal)) { out[key] = rawVal; kept++; continue; }
    if (typeof rawVal === "boolean") { out[key] = rawVal; kept++; continue; }
    if (typeof rawVal === "string") {
      const v = rawVal.trim().slice(0, 64);
      if (!v) continue;
      if (EMAIL_RE.test(v) || URL_RE.test(v) || IP_RE.test(v)) continue;
      out[key] = v; kept++; continue;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return new Response(JSON.stringify({ error: "bad_body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const anon_id = String((body as any).anon_id ?? "").trim();
    const platform = String((body as any).platform ?? "").trim().toLowerCase();
    const event = String((body as any).event ?? "").trim();
    const app_version_raw = (body as any).app_version;
    const app_version = app_version_raw == null ? null : String(app_version_raw).slice(0, 32);

    if (!UUID_RE.test(anon_id)) {
      return new Response(JSON.stringify({ error: "invalid_anon_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!ALLOWED_PLATFORMS.has(platform)) {
      return new Response(JSON.stringify({ error: "invalid_platform" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!ALLOWED_EVENTS.has(event)) {
      return new Response(JSON.stringify({ error: "invalid_event" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const props = scrubProps((body as any).props);

    let created_at: string | undefined;
    const ts = (body as any).ts;
    if (typeof ts === "string") {
      const t = Date.parse(ts);
      if (Number.isFinite(t)) {
        const now = Date.now();
        if (t <= now + 5 * 60000 && t >= now - 30 * 86400000) {
          created_at = new Date(t).toISOString();
        }
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      SB_SECRET,
    );

    const row: Record<string, unknown> = { anon_id, platform, event, props, app_version };
    if (created_at) row.created_at = created_at;

    const { error } = await supabase.from("product_events").insert(row);
    if (error) {
      console.error("[track] insert failed:", error.code ?? "unknown");
      return new Response(JSON.stringify({ error: "insert_failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(null, { status: 204, headers: corsHeaders });
  } catch (_err) {
    return new Response(JSON.stringify({ error: "server_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
