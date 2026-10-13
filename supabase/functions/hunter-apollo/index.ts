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
  if (!(await isAdmin(req))) return J({ ok: false, error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  const owner = body.owner === "reese" ? "reese" : body.owner === "maya" ? "maya" : null;
  if (body.op !== "test" || !owner) return J({ ok: false, error: "expected {op:'test', owner}" }, 400);
  let r: { ok: boolean; note: string };
  try { r = await test(owner); } catch { r = { ok: false, note: "Couldn't reach Apollo. Try again in a minute." }; }
  await db.from("hunter_apollo_state").upsert({ owner, tested_at: new Date().toISOString(), test_ok: r.ok, test_note: r.note });
  return J(r);
});
