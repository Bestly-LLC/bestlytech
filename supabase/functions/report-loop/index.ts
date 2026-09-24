// CY-LOOP-01: Reported when Cookie Yeti detects an endless reload loop on a
// page. Deactivates any active patterns for that domain (a bad pattern is the
// most common server-side cause of a click->reload loop) and records the
// report so the domain can be reviewed / suppressed. Idempotent.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(b, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
}

function normDomain(d) {
  return String(d || "").trim().toLowerCase().replace(/^www\./, "").replace(/[^a-z0-9.\-]/g, "").slice(0, 253);
}

// CY-PRIV (server defense-in-depth): reduce any URL to its origin so no path,
// query string, or fragment is ever persisted.
function originOnly(v) {
  if (!v) return "";
  const s = String(v).trim();
  if (!s) return "";
  try { return new URL(s).origin; } catch {
    return /:\/\//.test(s)
      ? s.replace(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/?#]+).*$/, "$1")
      : s.replace(/^([^/?#]+).*$/, "$1");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let body = {};
  try { body = await req.json(); } catch { /* empty */ }
  const domain = normDomain(body.domain);
  const pageUrl = originOnly(body.pageUrl).slice(0, 500);
  if (!domain || !domain.includes(".")) return json({ ok: false, error: "invalid_domain" }, 400);

  const db = createClient(Deno.env.get("SUPABASE_URL"), SB_SECRET, { auth: { persistSession: false } });
  try {
    // Deactivate active patterns whose domain matches (exact or subdomain).
    const { data: deactivated } = await db
      .from("cookie_patterns")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .or(`domain.eq.${domain},domain.ilike.%.${domain}`)
      .eq("is_active", true)
      .select("id,selector");

    // Log it as a resolved missed-banner row tagged as a reload loop so it is
    // visible in the dashboard and excluded from AI generation.
    await db.from("missed_banner_reports").insert({
      domain,
      page_url: pageUrl || `https://${domain}`,
      banner_html: "[reload-loop] Cookie Yeti detected an endless reload loop and backed off.",
      cmp_fingerprint: "reload_loop",
      resolved: true,
      has_working_pattern: false,
    });

    return json({ ok: true, deactivated: (deactivated || []).length });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 200);
  }
});
