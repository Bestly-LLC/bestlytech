// push-subscribe — save this browser's Web Push subscription.
// audience "admin" (default): signed-in admin only; gets the admin's alerts.
// audience "partner": a signed-in partner (or admin previewing the portal); gets only their own
// Scout answers, keyed to their user id. Body:
//   { subscription: { endpoint, keys: { p256dh, auth } }, audience? }   upsert (by endpoint+audience)
//   { action: "key" }                                                     VAPID public key
//   { action: "remove", endpoint, audience? }                             forget this browser
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const { data: who } = jwt ? await db.auth.getUser(jwt) : { data: null };
  const uid = who?.user?.id;
  if (!uid) return J({ ok: false, error: "unauthorized" }, 401);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }
  const audience = body.audience === "partner" ? "partner" : "admin";

  const { data: isAdmin } = await db.rpc("has_role", { _user_id: uid, _role: "admin" });
  let allowed = isAdmin === true;
  if (!allowed && audience === "partner") {
    const { data: p } = await db.from("partners").select("id").eq("user_id", uid).maybeSingle();
    allowed = !!p;
  }
  if (!allowed) return J({ ok: false, error: audience === "partner" ? "partners only" : "admin only" }, 403);

  if (body.action === "key") {
    const { data, error } = await db.rpc("push_vapid_public");
    if (error || !data) return J({ ok: false, error: error?.message ?? "no VAPID key yet" }, 500);
    return J({ ok: true, public_key: data });
  }

  if (body.action === "remove") {
    const endpoint = String(body.endpoint ?? "");
    if (!endpoint) return J({ ok: false, error: "endpoint required" }, 400);
    await db.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("audience", audience);
    return J({ ok: true, removed: true });
  }

  const sub = body.subscription ?? {};
  const endpoint = String(sub.endpoint ?? "");
  const p256dh = String(sub.keys?.p256dh ?? "");
  const authKey = String(sub.keys?.auth ?? "");
  let host = "";
  try { host = new URL(endpoint).protocol === "https:" ? new URL(endpoint).host : ""; } catch { /* */ }
  if (!host || !p256dh || !authKey) return J({ ok: false, error: "subscription with endpoint and keys required" }, 400);

  const { data, error } = await db.from("push_subscriptions")
    .upsert({ endpoint, keys: { p256dh, auth: authKey }, audience, user_id: uid }, { onConflict: "endpoint,audience" })
    .select("id").single();
  if (error) return J({ ok: false, error: error.message }, 500);
  return J({ ok: true, id: data.id, service: host });
});
