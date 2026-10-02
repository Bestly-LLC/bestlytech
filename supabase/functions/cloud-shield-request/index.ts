import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";
import { pushNtfy } from "../_shared/ntfy.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = corsWith({
  headers: "authorization, x-client-info, apikey, content-type",
  methods: "GET, POST, OPTIONS"
});

function ok(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function bad(reason: string, status = 400) { return new Response(JSON.stringify({ ok: false, error: reason }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
function normalizeUrl(input: string): string | null {
  const trimmed = (input || "").trim();
  if (!trimmed) return null;
  let s = trimmed; if (!/^https?:\/\//i.test(s)) s = "http://" + s;
  try { const u = new URL(s); return u.hostname.toLowerCase().replace(/^www\./, "") + (u.pathname && u.pathname !== "/" ? u.pathname : ""); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET);

  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token");
    if (!token || token.length < 16) return bad("token required");
    const { data: deal, error } = await sb.from("cloud_deals").select("id, company_name").eq("shield_request_token", token).maybeSingle();
    if (error) return bad("could not load", 500);
    if (!deal) return bad("not found", 404);
    const { data: recent } = await sb.from("cloud_shield_requests").select("id, requested_url, status, created_at").eq("deal_id", deal.id).order("created_at", { ascending: false }).limit(10);
    return ok({ ok: true, deal: { company_name: deal.company_name }, recent: recent ?? [] });
  }

  if (req.method !== "POST") return bad("method not allowed", 405);

  let body: any; try { body = await req.json(); } catch { return bad("invalid json"); }
  const token = body?.token;
  if (!token || typeof token !== "string" || token.length < 16) return bad("token required");

  const url = normalizeUrl(String(body?.requested_url || ""));
  if (!url) return bad("a URL is required");
  if (url.length > 500) return bad("URL too long");

  const reason = String(body?.reason || "").slice(0, 1000) || null;
  const name = String(body?.requester_name || "").slice(0, 200) || null;
  const email = String(body?.requester_email || "").slice(0, 320) || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return bad("invalid email");

  const { data: deal, error: dErr } = await sb.from("cloud_deals").select("id, lead_id, company_name").eq("shield_request_token", token).maybeSingle();
  if (dErr) return bad("could not load deal", 500);
  if (!deal) return bad("not found", 404);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || null;
  const ua = req.headers.get("user-agent") ?? null;

  if (ip) {
    const since = new Date(Date.now() - 24*3600_000).toISOString();
    const { count } = await sb.from("cloud_shield_requests").select("id", { count: "exact", head: true }).eq("ip_address", ip).gte("created_at", since);
    if ((count ?? 0) >= 50) return bad("rate limit exceeded for this network", 429);
  }
  {
    const since = new Date(Date.now() - 24*3600_000).toISOString();
    const { count } = await sb.from("cloud_shield_requests").select("id", { count: "exact", head: true }).eq("deal_id", deal.id).gte("created_at", since);
    if ((count ?? 0) >= 200) return bad("rate limit exceeded for this org", 429);
  }

  const { data: inserted, error: insErr } = await sb.from("cloud_shield_requests").insert({
    deal_id: deal.id, requested_url: url, requester_name: name, requester_email: email, reason,
    ip_address: ip, user_agent: ua ? ua.slice(0, 500) : null,
  }).select("id").single();
  if (insErr || !inserted) { console.error("shield-request insert error", insErr); return bad("could not save", 500); }

  void pushNtfy({
    title: `Allowlist request: ${deal.company_name}`,
    body: `${url}${reason ? ` — ${reason.slice(0, 100)}` : ""}`,
    tags: "shield",
    priority: "3",
    click: `https://bestly.tech/admin/cloud/${deal.lead_id}`,
  });

  return ok({ ok: true, request_id: inserted.id });
});
