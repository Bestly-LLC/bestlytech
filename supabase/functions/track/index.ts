// Cookie Yeti — anonymous product-analytics ingestion.
//
// POST /functions/v1/track  (anon key in `apikey` header; verify_jwt = false)
// Body: { anon_id, platform, event, props?, app_version?, ts? }
//
// Privacy-first by construction:
//   - Only allowlisted event names + platforms are accepted.
//   - props are aggressively PII-scrubbed: any key that looks like email/url/
//     domain/ip/name is dropped, and any value that looks like an email/URL/IP
//     is dropped. Values are length-capped and only scalars are kept.
//   - We NEVER log request bodies or prop values.
// Returns 204 on success (best-effort ingest; never blocks the client UX).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// Keys that must never be persisted (PII / re-identifying / free-form).
const PII_KEY = /(email|e-mail|mail|url|uri|link|href|domain|host|hostname|ip|ipaddr|address|name|user|first|last|full_?name|phone|tel|zip|postal|lat|lon|geo|token|secret|password|cookie|query|search|referrer|referer|path)/i;
// Value shapes that are PII even under an innocuous key.
const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/i;
const IP_RE = /\b\d{1,3}(?:\.\d{1,3}){3}\b/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function scrubProps(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  let kept = 0;
  for (const [rawKey, rawVal] of Object.entries(input as Record<string, unknown>)) {
    if (kept >= 20) break;                       // cap breadth
    const key = String(rawKey).slice(0, 40);
    if (PII_KEY.test(key)) continue;             // drop PII-ish keys outright
    // Only keep small scalars: string (enum-ish), number, boolean.
    if (typeof rawVal === "number" && Number.isFinite(rawVal)) {
      out[key] = rawVal; kept++; continue;
    }
    if (typeof rawVal === "boolean") { out[key] = rawVal; kept++; continue; }
    if (typeof rawVal === "string") {
      const v = rawVal.trim().slice(0, 64);      // cap length
      if (!v) continue;
      if (EMAIL_RE.test(v) || URL_RE.test(v) || IP_RE.test(v)) continue; // drop PII values
      out[key] = v; kept++; continue;
    }
    // objects/arrays/null are dropped (keep props flat + tiny).
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

    // Strict validation against the allowlists.
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

    // Optional client timestamp; only accept a sane ISO value, else server now().
    let created_at: string | undefined;
    const ts = (body as any).ts;
    if (typeof ts === "string") {
      const t = Date.parse(ts);
      if (Number.isFinite(t)) {
        // clamp to a plausible window (no far-future / ancient backfill abuse)
        const now = Date.now();
        if (t <= now + 5 * 60_000 && t >= now - 30 * 86400_000) {
          created_at = new Date(t).toISOString();
        }
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const row: Record<string, unknown> = { anon_id, platform, event, props, app_version };
    if (created_at) row.created_at = created_at;

    const { error } = await supabase.from("product_events").insert(row);
    if (error) {
      // Never log the body/props. Log only a coarse marker.
      console.error("[track] insert failed:", error.code ?? "unknown");
      return new Response(JSON.stringify({ error: "insert_failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(null, { status: 204, headers: corsHeaders });
  } catch (_err) {
    // Do not surface or log internals (may contain body fragments).
    return new Response(JSON.stringify({ error: "server_error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
