// hunter-apollo — checks an Apollo key Hunter holds in the Vault. Admin only. Never returns or logs the key.
//   POST { op: "test", owner: "maya" | "reese" }
//   -> { ok, note }   ok = key works; note says whether this plan can search people/companies over the API.
// Writes the result to hunter_apollo_state so the page (and the watchdog) see it.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsWith } from "../_shared/cors.ts";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const CORS = corsWith({ headers: "authorization, content-type, apikey, x-client-info", methods: "POST, OPTIONS" });
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });
const API = "https://api.apollo.io/api/v1";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const isService = (req: Request) => {
  const b = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim(), a = (req.headers.get("apikey") ?? "").trim();
  return [b, a].some((t) => t && SERVICE_KEYS.has(t));
};
const host = (u: string | null) => { try { return u ? new URL(u.startsWith("http") ? u : `https://${u}`).hostname.replace(/^www\./, "") : null; } catch { return null; } };

async function raise(key: string, problem: boolean, title: string, body?: string) {
  await db.rpc("bestly_raise", { p_key: key, p_kind: problem ? "problem" : "resolved", p_severity: problem ? "warning" : "info",
    p_title: title, p_body: body ?? null, p_area: "hunter", p_healed: false });
}

type Out = { tried: number; found: number; errors: string[] };
async function save(owner: string, lead_id: string, status: string, found: unknown) {
  await db.from("hunter_apollo_enrich").upsert({ owner, lead_id, status, found, tried_at: new Date().toISOString() });
}

// Free plans 403 on people/match, so Reese gets the company lookup too: size, industry, main phone if missing.
async function enrichReese(key: string, cap: number, o: Out) {
  const { data: tried } = await db.from("hunter_apollo_enrich").select("lead_id").eq("owner", "reese");
  const skip = new Set((tried ?? []).map((r: { lead_id: string }) => r.lead_id));
  const { data: scores } = await db.from("hunter_lead_scores").select("lead_id, priority").eq("owner", "reese").order("priority", { ascending: false }).limit(400);
  const ids = (scores ?? []).map((s: { lead_id: string }) => s.lead_id).filter((id: string) => !skip.has(id)).slice(0, 200);
  if (!ids.length) return;
  const { data: leads } = await db.from("rg_leads").select("id, website, phone, dnc").in("id", ids);
  const byId = new Map((leads ?? []).map((l: any) => [l.id, l]));
  for (const id of ids) {
    if (o.tried >= cap) break;
    const l: any = byId.get(id), domain = host(l?.website);
    if (!l || l.dnc || !domain) continue;
    o.tried++;
    const r = await call(key, `/organizations/enrich?domain=${encodeURIComponent(domain)}`);
    if (r.status === 401 || r.status === 403 || r.status === 402 || r.status === 429) { o.errors.push(`Reese: Apollo answered ${r.status}`); await save("reese", id, "error", { status: r.status }); break; }
    const org: any = r.body?.organization;
    if (!org) { await save("reese", id, "none", null); continue; }
    const kept = { employees: org.estimated_num_employees ?? null, industry: org.industry ?? null, phone: org.primary_phone?.sanitized_number ?? null, founded: org.founded_year ?? null };
    await save("reese", id, "found", kept); o.found++;
    if (!l.phone && kept.phone) await db.from("rg_leads").update({ phone: kept.phone, phone_source: "apollo" }).eq("id", id);
  }
}

async function enrichMaya(key: string, cap: number, o: Out) {
  const { data: tried } = await db.from("hunter_apollo_enrich").select("lead_id").eq("owner", "maya");
  const skip = new Set((tried ?? []).map((r: { lead_id: string }) => r.lead_id));
  const { data: leads } = await db.from("maya_leads").select("id, website, phone, fit_score").in("status", ["checked", "queued"])
    .not("website", "is", null).order("fit_score", { ascending: false, nullsFirst: false }).limit(300);
  for (const l of (leads ?? []) as any[]) {
    if (o.tried >= cap) break;
    const domain = host(l.website);
    if (skip.has(l.id) || !domain) continue;
    o.tried++;
    const r = await call(key, `/organizations/enrich?domain=${encodeURIComponent(domain)}`);
    if (r.status === 401 || r.status === 403 || r.status === 402 || r.status === 429) { o.errors.push(`Maya: Apollo answered ${r.status}`); await save("maya", l.id, "error", { status: r.status }); break; }
    const org: any = r.body?.organization;
    if (!org) { await save("maya", l.id, "none", null); continue; }
    const kept = { employees: org.estimated_num_employees ?? null, industry: org.industry ?? null, phone: org.primary_phone?.sanitized_number ?? null, founded: org.founded_year ?? null };
    await save("maya", l.id, "found", kept); o.found++;
    if (!l.phone && kept.phone) await db.from("maya_leads").update({ phone: kept.phone, phone_source: "apollo" }).eq("id", l.id);
  }
}

async function enrich() {
  const { data: st } = await db.from("hunter_settings").select("enabled, apollo_cap_maya, apollo_cap_reese").eq("id", true).maybeSingle();
  if (!st?.enabled) return { ok: true, paused: true };
  const res: Record<string, Out> = {};
  for (const owner of ["reese", "maya"] as const) {
    const o: Out = { tried: 0, found: 0, errors: [] }; res[owner] = o;
    const { data: key } = await db.rpc("hunter_secret", { p_name: `apollo_api_key_${owner}` });
    if (!key) continue;
    const cap = owner === "maya" ? st.apollo_cap_maya : st.apollo_cap_reese;
    try { owner === "maya" ? await enrichMaya(key, cap, o) : await enrichReese(key, cap, o); }
    catch (e) { o.errors.push(`${owner}: ${String(e).slice(0, 80)}`); }
  }
  const errors = [...res.maya.errors, ...res.reese.errors];
  const { data: src } = await db.from("hunter_sources").select("fail_streak").eq("slug", "apollo").maybeSingle();
  const streak = errors.length ? (src?.fail_streak ?? 0) + 1 : 0;
  const now = new Date().toISOString();
  await db.from("hunter_sources").update({ fail_streak: streak, last_error: errors.join("; ") || null, last_run_at: now, ...(errors.length ? {} : { last_ok_at: now }) }).eq("slug", "apollo");
  if (streak >= 2) await raise("hunter.apollo", true, "Hunter: Apollo enrichment keeps failing",
    `${errors.join("; ")}. A 401/403 means a key needs replacing on the Apollo card; 402/429 means the free credits ran out for the month.`);
  else if (!errors.length) await raise("hunter.apollo", false, "Hunter: Apollo enrichment OK", `Reese ${res.reese.found} of ${res.reese.tried}, Maya ${res.maya.found} of ${res.maya.tried}.`);
  return { ok: !errors.length, ...res };
}

async function isAdmin(req: Request) {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data: u } = await db.auth.getUser(jwt);
  if (!u?.user) return false;
  const { data } = await db.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
  return !!data;
}

async function call(key: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`${API}${path}`, {
    ...init,
    headers: { "x-api-key": key, "Content-Type": "application/json", "Cache-Control": "no-cache", ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(15000),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, unknown> };
}

async function test(owner: "maya" | "reese") {
  const { data: key } = await db.rpc("hunter_secret", { p_name: `apollo_api_key_${owner}` });
  if (!key) return { ok: false, note: "No key saved yet." };
  const h = await call(key, "/auth/health");
  if (h.status === 401 || h.status === 403 || h.body?.is_logged_in === false)
    return { ok: false, note: "Apollo rejected this key. Make a new one in Apollo and paste it again." };
  if (h.status >= 400) return { ok: false, note: `Apollo answered ${h.status}. Try again in a few minutes.` };
  // Free plans often can't search over the API. One tiny search tells us, and costs no credits.
  const s = await call(key, "/mixed_companies/search", { method: "POST", body: JSON.stringify({ per_page: 1, page: 1, q_organization_keyword_tags: ["roofing"] }) });
  if (s.status === 200) return { ok: true, note: "Connected. This plan can search companies, so Hunter can pull leads." };
  if (s.status === 403 || s.status === 422)
    return { ok: true, note: "Key works, but this free plan can't search over the API. Hunter can only enrich leads it already found." };
  return { ok: true, note: `Key works. Search answered ${s.status}, so Hunter will keep to free sources for now.` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const svc = isService(req);
  if (!svc && !(await isAdmin(req))) return J({ ok: false, error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  if (body.op === "enrich") return J(await enrich());
  const owner = body.owner === "reese" ? "reese" : body.owner === "maya" ? "maya" : null;
  if (body.op !== "test" || !owner) return J({ ok: false, error: "expected {op:'test', owner}" }, 400);
  let r: { ok: boolean; note: string };
  try { r = await test(owner); } catch { r = { ok: false, note: "Couldn't reach Apollo. Try again in a minute." }; }
  await db.from("hunter_apollo_state").upsert({ owner, tested_at: new Date().toISOString(), test_ok: r.ok, test_note: r.note });
  return J(r);
});
