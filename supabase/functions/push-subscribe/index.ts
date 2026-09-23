// push-subscribe — the admin dashboard saves this browser's Web Push subscription.
// Signed-in admin only. Body:
//   { subscription: { endpoint, keys: { p256dh, auth } } }   upsert (by endpoint)
//   { action: "key" }                                          VAPID public key
//   { action: "remove", endpoint }                             forget this browser
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
  const { data: isAdmin } = await db.rpc("has_role", { _user_id: uid, _role: "admin" });
  if (isAdmin !== true) return J({ ok: false, error: "admin only" }, 403);

  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return J({ ok: false, error: "json body required" }, 400); }

  if (body.action === "key") {
    const { data, error } = await db.rpc("push_vapid_public");
    if (error || !data) return J({ ok: false, error: error?.message ?? "no VAPID key yet" }, 500);
    return J({ ok: true, public_key: data });
  }

  if (body.action === "remove") {
    const endpoint = String(body.endpoint ?? "");
    if (!endpoint) return J({ ok: false, error: "endpoint required" }, 400);
    await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
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
    .upsert({ endpoint, keys: { p256dh, auth: authKey } }, { onConflict: "endpoint" })
    .select("id").single();
  if (error) return J({ ok: false, error: error.message }, 500);
  return J({ ok: true, id: data.id, service: host });
});
