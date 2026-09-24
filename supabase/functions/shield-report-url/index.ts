import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const NTFY_BASE = "https://ntfy.sh";
const NTFY_TOPIC = "bestly-sysalert-7q2k9mx4";

function ok(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function bad(reason: string, status = 400) { return new Response(JSON.stringify({ ok: false, error: reason }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function asciiHeader(s: string) { return s.replace(/[–—]/g,"-").replace(/[‘’]/g,"'").replace(/[“”]/g,'"').replace(/[^\x20-\x7E]/g,""); }
function looksLikeUrl(s: string) { if (!s || s.length > 2000) return false; if (/^(javascript|data|file|mailto):/i.test(s)) return false; if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) return true; try { const u = new URL(s); return ["http:","https:"].includes(u.protocol); } catch { return false; } }
function isEmail(s: string) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return bad("method not allowed", 405);

  let body: any; try { body = await req.json(); } catch { return bad("invalid json"); }

  if (typeof body?.honeypot === "string" && body.honeypot.trim().length > 0) return ok({ ok: true, id: null });

  const url = String(body?.url || "").trim();
  if (!url) return bad("url required");
  if (!looksLikeUrl(url)) return bad("invalid url");

  const reason = body?.reason ? String(body.reason).slice(0, 1000) : null;
  const reporterEmail = body?.reporter_email ? String(body.reporter_email).slice(0, 320).toLowerCase() : null;
  if (reporterEmail && !isEmail(reporterEmail)) return bad("invalid email");
  const reporterOrg = body?.reporter_org ? String(body.reporter_org).slice(0, 200) : null;
  const dealToken = body?.deal_token ? String(body.deal_token) : null;

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET);

  let dealId: string | null = null;
  let resolvedOrg = reporterOrg;
  if (dealToken && dealToken.length >= 16) {
    const { data: deal } = await sb.from("cloud_deals").select("id, company_name").eq("intake_token", dealToken).maybeSingle();
    if (deal) { dealId = deal.id; if (!resolvedOrg) resolvedOrg = deal.company_name; }
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const ua = req.headers.get("user-agent") ?? null;

  if (ip) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await sb.from("shield_url_reports").select("id", { count: "exact", head: true }).gte("created_at", since).eq("ip_address", ip);
    if ((count ?? 0) >= 10) return bad("rate limit", 429);
  }

  const { data: row, error } = await sb.from("shield_url_reports").insert({
    reported_url: url, reason, reporter_email: reporterEmail, reporter_org: resolvedOrg,
    deal_id: dealId, ip_address: ip, user_agent: ua ? ua.slice(0, 500) : null,
  }).select("id, reported_domain").single();

  if (error || !row) { console.error("shield-report insert error", error); return bad("could not save", 500); }

  const headers: Record<string,string> = {
    Title: asciiHeader(`Shield review: ${row.reported_domain ?? "(unknown)"}${resolvedOrg ? ` (${resolvedOrg})` : ""}`),
    Tags: "shield", Priority: "3",
    Click: `https://bestly.tech/admin/shield-reports`,
  };
  const ntfyToken = Deno.env.get("NTFY_TOKEN"); if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;
  fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, { method: "POST", headers, body: `${url}${reason ? `\n— ${reason.slice(0, 200)}` : ""}` }).catch(e => console.error("ntfy push failed", e));

  return ok({ ok: true, id: row.id });
});
