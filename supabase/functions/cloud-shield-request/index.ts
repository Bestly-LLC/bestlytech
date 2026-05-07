import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * End-user submits a request to allowlist a blocked URL.
 *
 *  POST  body { token, requested_url, requester_name?, requester_email?, reason? }
 *    → { ok, request_id }
 *  GET   ?token=<>
 *    → { ok, deal: { company_name }, recent: [...] }
 *      (lookup endpoint so the form page can confirm the token resolves
 *       and show the user a list of their org's recent requests)
 *
 * Token-bound — must match cloud_deals.shield_request_token.
 * Anti-abuse: per-IP per-day cap of 50 submissions, per-token per-day cap of 200.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const NTFY_BASE = "https://ntfy.sh";
const NTFY_TOPIC = "bestly-sysalert-7q2k9mx4";

function ok(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function bad(reason: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: reason }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asciiHeader(s: string) {
  return s
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, "");
}

function normalizeUrl(input: string): string | null {
  const trimmed = (input || "").trim();
  if (!trimmed) return null;
  // Accept either bare domain (example.com) or full URL.
  let s = trimmed;
  if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try {
    const u = new URL(s);
    return u.hostname.toLowerCase().replace(/^www\./, "") + (u.pathname && u.pathname !== "/" ? u.pathname : "");
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ─── GET — token lookup + recent submissions ───────────
  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token");
    if (!token || token.length < 16) return bad("token required");
    const { data: deal, error } = await sb
      .from("cloud_deals")
      .select("id, company_name")
      .eq("shield_request_token", token)
      .maybeSingle();
    if (error) return bad("could not load", 500);
    if (!deal) return bad("not found", 404);
    const { data: recent } = await sb
      .from("cloud_shield_requests")
      .select("id, requested_url, status, created_at")
      .eq("deal_id", deal.id)
      .order("created_at", { ascending: false })
      .limit(10);
    return ok({ ok: true, deal: { company_name: deal.company_name }, recent: recent ?? [] });
  }

  // ─── POST — submit ─────────────────────────────────────
  if (req.method !== "POST") return bad("method not allowed", 405);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("invalid json");
  }
  const token = body?.token;
  if (!token || typeof token !== "string" || token.length < 16) return bad("token required");

  const url = normalizeUrl(String(body?.requested_url || ""));
  if (!url) return bad("a URL is required");
  if (url.length > 500) return bad("URL too long");

  const reason = String(body?.reason || "").slice(0, 1000) || null;
  const name = String(body?.requester_name || "").slice(0, 200) || null;
  const email = String(body?.requester_email || "").slice(0, 320) || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return bad("invalid email");
  }

  const { data: deal, error: dErr } = await sb
    .from("cloud_deals")
    .select("id, lead_id, company_name")
    .eq("shield_request_token", token)
    .maybeSingle();
  if (dErr) return bad("could not load deal", 500);
  if (!deal) return bad("not found", 404);

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const ua = req.headers.get("user-agent") ?? null;

  // Anti-abuse: per-IP rate limit (50/day)
  if (ip) {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count } = await sb
      .from("cloud_shield_requests")
      .select("id", { count: "exact", head: true })
      .eq("ip_address", ip)
      .gte("created_at", since);
    if ((count ?? 0) >= 50) return bad("rate limit exceeded for this network", 429);
  }
  // Per-deal cap (200/day)
  {
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count } = await sb
      .from("cloud_shield_requests")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", deal.id)
      .gte("created_at", since);
    if ((count ?? 0) >= 200) return bad("rate limit exceeded for this org", 429);
  }

  const { data: inserted, error: insErr } = await sb
    .from("cloud_shield_requests")
    .insert({
      deal_id: deal.id,
      requested_url: url,
      requester_name: name,
      requester_email: email,
      reason,
      ip_address: ip,
      user_agent: ua ? ua.slice(0, 500) : null,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    console.error("shield-request insert error", insErr);
    return bad("could not save", 500);
  }

  // Operator notification
  const headers: Record<string, string> = {
    Title: asciiHeader(`Allowlist request: ${deal.company_name}`),
    Tags: "shield",
    Priority: "3",
    Click: `https://bestly.tech/admin/cloud/${deal.lead_id}`,
  };
  const ntfyToken = Deno.env.get("NTFY_TOKEN");
  if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;
  fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, {
    method: "POST",
    headers,
    body: `${url}${reason ? ` — ${reason.slice(0, 100)}` : ""}`,
  }).catch((e) => console.error("ntfy push failed", e));

  return ok({ ok: true, request_id: inserted.id });
});
