// tesla-fleet — connects Jared's Tesla (Fleet API) on a hard free-only budget.
//
//   POST {"op":"start"}   (admin JWT) → registers www.bestly.tech with Tesla (once), returns the Tesla sign-in URL
//   GET  /callback?code&state          → Tesla redirects here; tokens go to Vault, the car is looked up, back to admin
//   POST {"op":"status"}  (admin JWT) → connection + budget summary
//
// Every billable Tesla call goes through tesla_fleet_spend() first (monthly cap $8, Tesla gives $10 free).
// Secrets: Vault tesla_fleet_client_secret / _private_key / _refresh_token / _access_token via tesla_fleet_secrets().
import { createClient } from "npm:@supabase/supabase-js@2";
// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_PUBLISHABLE: string = __keys("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const FLEET = "https://fleet-api.prd.na.vn.cloud.tesla.com";
const AUTH = "https://auth.tesla.com/oauth2/v3/authorize";
const TOKEN = "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token";
const DOMAIN = "www.bestly.tech";
const REDIRECT = "https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/tesla-fleet/callback";
const ADMIN = "https://www.bestly.tech/admin/turo/lax-pass";
const SCOPES = "openid offline_access vehicle_device_data vehicle_cmds";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });
const back = (qs: string) => new Response(null, { status: 302, headers: { Location: `${ADMIN}?${qs}#tesla` } });

type Secrets = { client_id: string; client_secret: string; refresh_token?: string; access_token?: string; access_note?: string };
async function secrets(): Promise<Secrets> {
  const { data, error } = await sb.rpc("tesla_fleet_secrets");
  if (error || !data?.client_id || !data?.client_secret) throw new Error("Tesla client id/secret not set");
  return data as Secrets;
}
async function isAdmin(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const c = createClient(Deno.env.get("SUPABASE_URL")!, SB_PUBLISHABLE, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data, error } = await c.rpc("tesla_fleet_admin_state");
  return !error && !!data;
}
async function spend(kind: "data" | "command" | "wake" | "other", detail: unknown, admin = true) {
  const { data } = await sb.rpc("tesla_fleet_spend", { p_kind: kind, p_reservation: null, p_detail: detail, p_admin: admin });
  if (data !== true) throw new Error("Budget cap reached: Tesla call skipped");
}
async function setErr(msg: string | null) {
  await sb.from("tesla_fleet_settings").update({ last_error: msg }).eq("id", 1);
}
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

async function partnerRegister(s: Secrets) {
  const { data: st } = await sb.from("tesla_fleet_settings").select("partner_registered_at").eq("id", 1).single();
  if (st?.partner_registered_at) return;
  const t = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form({ grant_type: "client_credentials", client_id: s.client_id, client_secret: s.client_secret, scope: SCOPES, audience: FLEET }) });
  const tj = await t.json();
  if (!tj.access_token) throw new Error("partner token: " + JSON.stringify(tj).slice(0, 200));
  await spend("other", { call: "partner_accounts" });
  const r = await fetch(`${FLEET}/api/1/partner_accounts`, { method: "POST", headers: { Authorization: `Bearer ${tj.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ domain: DOMAIN }) });
  const body = await r.text();
  if (!r.ok && !/already/i.test(body)) throw new Error(`partner register ${r.status}: ${body.slice(0, 200)}`);
  await sb.from("tesla_fleet_settings").update({ partner_registered_at: new Date().toISOString() }).eq("id", 1);
}

async function listVehicles(access: string) {
  await spend("data", { call: "vehicles" });
  const r = await fetch(`${FLEET}/api/1/vehicles`, { headers: { Authorization: `Bearer ${access}` } });
  const j = await r.json();
  return (j.response ?? []) as { id: number; vin: string; display_name?: string; state?: string }[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/tesla-fleet/, "") || "/";
  try {
    if (path === "/callback" && req.method === "GET") {
      const code = url.searchParams.get("code"), state = url.searchParams.get("state");
      if (url.searchParams.get("error")) return back(`tesla=error&why=${encodeURIComponent(url.searchParams.get("error_description") ?? url.searchParams.get("error")!)}`);
      if (!code || !state) return back("tesla=error&why=missing+code");
      const { data: st } = await sb.from("tesla_fleet_oauth").delete().eq("state", state).gte("created_at", new Date(Date.now() - 20 * 60 * 1000).toISOString()).select("state");
      if (!st?.length) return back("tesla=error&why=link+expired,+try+again");
      const s = await secrets();
      const r = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ grant_type: "authorization_code", client_id: s.client_id, client_secret: s.client_secret, code, audience: FLEET, redirect_uri: REDIRECT }) });
      const tj = await r.json();
      if (!tj.refresh_token) { await setErr("token exchange: " + JSON.stringify(tj).slice(0, 200)); return back("tesla=error&why=Tesla+sign-in+failed"); }
      await sb.rpc("tesla_fleet_store_tokens", { p_refresh: tj.refresh_token, p_access: tj.access_token, p_expires_at: new Date(Date.now() + (tj.expires_in ?? 28800) * 1000).toISOString() });
      const cars = await listVehicles(tj.access_token).catch(() => []);
      const car = cars[0];
      await sb.from("tesla_fleet_settings").update({
        connected_at: new Date().toISOString(), last_error: null,
        ...(car ? { vin: car.vin, vehicle_id: String(car.id), vehicle_name: car.display_name ?? "Tesla" } : {}),
      }).eq("id", 1);
      return back(`tesla=connected${car ? `&car=${encodeURIComponent(car.display_name ?? "Tesla")}` : ""}`);
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (!(await isAdmin(req))) return json({ error: "admin only" }, 403);
      if (body.op === "start") {
        const s = await secrets();
        try { await partnerRegister(s); await setErr(null); }
        catch (e) { await setErr(String(e).slice(0, 300)); return json({ error: String(e).slice(0, 300) }, 502); }
        const state = crypto.randomUUID().replace(/-/g, "");
        await sb.from("tesla_fleet_oauth").insert({ state });
        const q = new URLSearchParams({ response_type: "code", client_id: s.client_id, redirect_uri: REDIRECT, scope: SCOPES, state,
          prompt_missing_scopes: "true", require_requested_scopes: "true", show_keypair_step: "true", locale: "en-US" });
        return json({ url: `${AUTH}?${q}` });
      }
      if (body.op === "status") {
        const { data } = await sb.rpc("tesla_fleet_month");
        return json({ ok: true, month: data });
      }
      return json({ error: "unknown op" }, 400);
    }
    return json({ error: "not found" }, 404);
  } catch (e) {
    console.error(e);
    await setErr(String(e).slice(0, 300)).catch(() => {});
    return json({ error: String(e).slice(0, 300) }, 500);
  }
});
