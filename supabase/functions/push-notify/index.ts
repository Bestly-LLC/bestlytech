// push-notify — send a real OS notification (Web Push) to every browser subscribed
// in bestly.tech/admin. Body: { title, body?, severity?: info|warning|critical, url?, tag?, audience?, user_id? }
// audience "admin" (default) = the admin's browsers. audience "partner" needs a user_id and reaches
// only that partner's own browsers (partner_chat_push trigger); partner sends are service-role only.
// Returns { sent: n, failed, removed }.
//
// Auth: the service role key (scout_notify via pg_net, other functions) or a signed-in admin.
// VAPID keys live only in Vault (vapid_public_key / vapid_private_key / vapid_mailto), read
// through push_vapid_get() which only the service role can call. If they are missing the first
// call generates them here and writes them straight to Vault — the private key is never shown.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const __svc = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", ...Object.values((() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}"); } catch { return {}; } })()) as string[]].filter(Boolean));
const isSvc = (req: Request) => { const b = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim(); const a = (req.headers.get("apikey") ?? "").trim(); return __svc.has(b) || __svc.has(a); };

const SERVICE = SB_SECRET;
const db = createClient(Deno.env.get("SUPABASE_URL")!, SERVICE, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

/** "service" (server-side callers), "admin" (a signed-in admin), or null. */
async function caller(req: Request): Promise<"service" | "admin" | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (isSvc(req)) return "service";
  if (!jwt) return null;
  const { data: vaultKey } = await db.rpc("push_service_key_ok", { p_key: jwt });
  if (vaultKey === true) return "service";
  const { data: who } = await db.auth.getUser(jwt);
  const uid = who?.user?.id;
  if (!uid) return null;
  const { data: isAdmin } = await db.rpc("has_role", { _user_id: uid, _role: "admin" });
  return isAdmin === true ? "admin" : null;
}

async function vapid() {
  let { data } = await db.rpc("push_vapid_get");
  let k = (data ?? {}) as { public?: string; private?: string; mailto?: string };
  if (!k.public || !k.private) {
    const gen = webpush.generateVAPIDKeys();
    const { error } = await db.rpc("push_vapid_init", {
      p_public: gen.publicKey, p_private: gen.privateKey, p_mailto: "mailto:admin@bestly.tech",
    });
    if (error) throw new Error("could not store VAPID keys: " + error.message);
    ({ data } = await db.rpc("push_vapid_get"));
    k = (data ?? {}) as typeof k;
  }
  let subject = (k.mailto ?? "admin@bestly.tech").trim();
  if (!/^(mailto:|https:)/.test(subject)) subject = "mailto:" + subject;
  return { publicKey: k.public!, privateKey: k.private!, subject };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return J({ ok: false, error: "POST only" }, 405);
  const who = await caller(req);
  if (!who) return J({ ok: false, error: "unauthorized" }, 401);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine for action:init */ }

  let keys;
  try { keys = await vapid(); } catch (e) { return J({ ok: false, error: String(e) }, 500); }
  if (body.action === "init") return J({ ok: true, public_key: keys.publicKey });

  const audience = body.audience === "partner" ? "partner" : "admin";
  const userId = body.user_id ? String(body.user_id) : "";
  if (audience === "partner" && (who !== "service" || !userId)) return J({ ok: false, error: "partner pushes are server-side and need a user_id" }, 403);

  const title = String(body.title ?? "").trim().slice(0, 200);
  if (!title) return J({ ok: false, error: "title required" }, 400);
  const severity = ["info", "warning", "critical"].includes(String(body.severity)) ? String(body.severity) : "info";
  const payload = JSON.stringify({
    title,
    body: body.body ? String(body.body).slice(0, 500) : "",
    severity,
    url: body.url ? String(body.url) : "/admin",
    tag: body.tag ? String(body.tag) : undefined,
    // A partner already looking at the portal doesn't need an OS popup on top.
    quiet_if_focused: audience === "partner",
  });

  webpush.setVapidDetails(keys.subject, keys.publicKey, keys.privateKey);
  let q = db.from("push_subscriptions").select("id, endpoint, keys").eq("audience", audience);
  if (userId) q = q.eq("user_id", userId);
  const { data: subs, error } = await q;
  if (error) return J({ ok: false, error: error.message }, 500);

  let sent = 0, failed = 0;
  const removed: string[] = [];
  const errors: { host: string; status?: number; error: string }[] = [];
  await Promise.all((subs ?? []).map(async (s: { id: string; endpoint: string; keys: { p256dh: string; auth: string } }) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, {
        TTL: severity === "critical" ? 86400 : 3600,
        urgency: severity === "critical" ? "high" : "normal",
      });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.from("push_subscriptions").delete().eq("id", s.id);
        removed.push(s.id);
      } else {
        failed++;
        errors.push({ host: new URL(s.endpoint).host, status, error: String((e as Error).message ?? e).slice(0, 200) });
      }
    }
  }));

  return J({ sent, failed, removed: removed.length, ...(errors.length ? { errors } : {}) });
});
