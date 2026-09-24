// tesla-invoice — fetch Tesla's official Supercharger invoice PDFs, so a guest charge has real receipts
// (Turo does not accept Tesla app screenshots as evidence).
//
//   POST {"rid": 61304880}            (admin JWT or server key) -> every invoice of that trip's Supercharges
//   POST {"ids": ["<contentId>", ...]}                          -> those invoices
//   => { ok, files: [{ id, name, path, url }] }   url = signed link, valid 1 hour
//
// PDFs go to the private bucket "tesla-invoices" as <rid|misc>/<fileName>. Already stored = not re-fetched.
// Each Tesla call is metered through tesla_fleet_spend('data') like every other Fleet API call.
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SECRET_KEY, PUBLISHABLE_KEY, isServiceRequest } from "../_shared/keys.ts";

const FLEET = "https://fleet-api.prd.na.vn.cloud.tesla.com";
const TOKEN = "https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token";
const BUCKET = "tesla-invoices";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, SECRET_KEY, { auth: { persistSession: false } });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function isAdmin(req: Request) {
  if (await isServiceRequest(req)) return true;
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const c = createClient(Deno.env.get("SUPABASE_URL")!, PUBLISHABLE_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data, error } = await c.rpc("tesla_fleet_admin_state");
  return !error && !!data;
}

async function accessToken(): Promise<string> {
  const { data: s, error } = await sb.rpc("tesla_fleet_secrets");
  if (error || !s?.client_id) throw new Error("Tesla is not connected");
  const m = String(s.access_note ?? "").match(/expires (.+)$/);
  const exp = m ? Date.parse(m[1].trim().replace(" ", "T").replace(/\+00$/, "+00:00")) : 0;
  if (s.access_token && exp > Date.now() + 5 * 60_000) return s.access_token;
  const r = await fetch(TOKEN, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: s.client_id, refresh_token: s.refresh_token }).toString() });
  const tj = await r.json();
  if (!tj.access_token) throw new Error("Tesla token refresh failed");
  await sb.rpc("tesla_fleet_store_tokens", { p_refresh: tj.refresh_token ?? s.refresh_token, p_access: tj.access_token,
    p_expires_at: new Date(Date.now() + (tj.expires_in ?? 28800) * 1000).toISOString() });
  return tj.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!(await isAdmin(req))) return json({ ok: false, error: "admin only" }, 403);
  try {
    const body = await req.json().catch(() => ({}));
    let want: { id: string; name: string; folder: string }[] = [];
    if (body.rid) {
      const { data } = await sb.rpc("supercharge_audit_data");
      const trip = ((data as any)?.trips ?? []).find((t: any) => String(t.rid) === String(body.rid));
      if (!trip) return json({ ok: false, error: "no Supercharging found for that trip" }, 404);
      for (const s of trip.sessions ?? []) for (const i of s.invoices ?? []) want.push({ id: i.id, name: i.name, folder: String(body.rid) });
    } else if (Array.isArray(body.ids)) {
      want = body.ids.map((id: string) => ({ id: String(id), name: `${id}.pdf`, folder: "misc" }));
    }
    if (!want.length) return json({ ok: false, error: "no invoices to fetch" }, 400);

    await sb.storage.createBucket(BUCKET, { public: false }).catch(() => null);
    let token: string | null = null;
    const files = [];
    for (const w of want.slice(0, 10)) {
      const path = `${w.folder}/${w.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
      const { data: have } = await sb.storage.from(BUCKET).list(w.folder, { search: path.split("/")[1] });
      if (!have?.some((f) => `${w.folder}/${f.name}` === path)) {
        const { data: ok } = await sb.rpc("tesla_fleet_spend", { p_kind: "data", p_reservation: null, p_detail: { invoice: w.id }, p_admin: true });
        if (ok !== true) return json({ ok: false, error: "Tesla budget cap reached", files }, 429);
        token ??= await accessToken();
        const r = await fetch(`${FLEET}/api/1/dx/charging/invoice/${encodeURIComponent(w.id)}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) { files.push({ id: w.id, name: w.name, error: `Tesla ${r.status}: ${(await r.text()).slice(0, 160)}` }); continue; }
        const up = await sb.storage.from(BUCKET).upload(path, new Uint8Array(await r.arrayBuffer()), { contentType: "application/pdf", upsert: true });
        if (up.error) { files.push({ id: w.id, name: w.name, error: up.error.message }); continue; }
      }
      const { data: signed } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
      files.push({ id: w.id, name: w.name, path, url: signed?.signedUrl ?? null });
    }
    return json({ ok: files.every((f: any) => !f.error), files });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
