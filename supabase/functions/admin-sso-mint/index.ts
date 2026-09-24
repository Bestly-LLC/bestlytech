// admin-sso-mint — one click from bestly.tech/admin into hoku-clean.com/admin.
//
// The two admins authenticate differently: bestly.tech uses Supabase Auth plus
// the `admin` role; hoku-clean.com uses its own passkey sessions
// (bestly-admin-auth). Rather than teach either one the other's login, this
// mints the same single-use code that bestly-admin-auth's `enrol-redeem`
// already consumes. The HOKU admin page reads it from the URL fragment,
// strips it from the address bar, and redeems it for a normal session.
//
// Security:
// - Caller must present a live Supabase user JWT AND hold has_role(admin).
// - The code is single-use (redeem deletes the row) and lives 2 minutes.
// - It travels in the URL fragment, which browsers never send to a server
//   and which the HOKU page removes from history before redeeming.
// - Only bestly.tech origins may call this from a browser.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ALLOWED = new Set(["https://bestly.tech", "https://www.bestly.tech"]);
const HOKU_ADMIN = "https://hoku-clean.com/admin";
const TTL_MS = 2 * 60 * 1000;

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

function corsFor(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED.has(origin) ? origin : "https://bestly.tech",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const cors = corsFor(origin);
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    if (req.method !== "POST") return J({ error: "POST only" }, 405);
    if (origin && !ALLOWED.has(origin)) return J({ error: "origin not allowed" }, 403);

    const jwt = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!jwt) return J({ error: "sign in to the Bestly admin first" }, 401);

    const { data: u, error: ue } = await db.auth.getUser(jwt);
    if (ue || !u?.user) return J({ error: "session expired — sign in again" }, 401);

    const { data: isAdmin, error: re } = await db.rpc("has_role", { _user_id: u.user.id, _role: "admin" });
    if (re) return J({ error: "role check failed: " + re.message }, 500);
    if (!isAdmin) return J({ error: "admin role required" }, 403);

    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = crypto.getRandomValues(new Uint8Array(24));
    let code = "SSO-";
    for (const b of bytes) code += alphabet[b % alphabet.length];

    const expiresAt = new Date(Date.now() + TTL_MS).toISOString();
    const { error: ie } = await db.from("admin_enrol_codes").insert({
      code, expires_at: expiresAt, note: ("sso from bestly.tech: " + (u.user.email ?? u.user.id)).slice(0, 120),
    });
    if (ie) return J({ error: ie.message }, 500);

    return J({ ok: true, url: `${HOKU_ADMIN}#sso=${code}`, expiresAt });
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});
