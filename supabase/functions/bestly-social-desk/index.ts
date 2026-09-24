// bestly-social-desk — read-only social calendar for the Bestly admin.
//
// This is what turns the desk from a snapshot into a live page. The artifact it
// replaces had the schedule pasted into it as a JSON literal, so it was correct
// only until the next post fired.
//
// WHY THIS EXISTS SEPARATELY FROM bestly-ig-poster
// ------------------------------------------------
// The poster requires an x-proxy-key or a service_role JWT. Neither can live in
// a browser: the proxy key would be readable by anyone who opened devtools, and
// the service key would hand over the whole database. hoku-clean.com solves that
// with a Vercel serverless function holding the key server-side, but bestly.tech
// has no api/ directory and no server-side secret store wired up.
//
// So this function is authorized by the ADMIN SESSION instead — the same session
// bestly-admin-auth issues after a passkey login. That means the page can call it
// directly from the browser with only the public anon key, and no new secret has
// to be created or stored anywhere.
//
// It is deliberately READ ONLY. Nothing here can publish, cancel, reschedule or
// change a token. Anything that writes stays behind the proxy-key path, because
// a session token sitting in a browser is a weaker credential than a server-side
// secret and should not be able to put something on a public feed.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

function bytesToB64u(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sessionValid(token: string): Promise<boolean> {
  if (!token) return false;
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
  );
  const hash = bytesToB64u(digest);
  const { data } = await db.from("admin_sessions")
    .select("expires_at").eq("token_hash", hash).maybeSingle();
  if (!data) return false;
  if (Date.parse(data.expires_at) < Date.now()) return false;
  await db.from("admin_sessions")
    .update({ last_seen_at: new Date().toISOString() }).eq("token_hash", hash);
  return true;
}

// Brand presentation lives here rather than in the page, so the accent colours
// and labels cannot drift away from what actually publishes.
const BRAND_META: Record<string, { name: string; accent: string; product: string }> = {
  cookieyeti: { name: "Cookie Yeti", accent: "#2FB8A0", product: "Browser privacy extension" },
  inventoryproof: { name: "InventoryProof", accent: "#D98324", product: "Home inventory documentation" },
  hoku: { name: "HOKU", accent: "#8CA86E", product: "Hypochlorous acid mist" },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), {
      status: s,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  try {
    const body = await req.json().catch(() => ({}));
    if (!(await sessionValid(String(body.session ?? "")))) {
      return J({ error: "admin session required" }, 401);
    }

    const { data: accounts } = await db.from("social_accounts")
      .select("brand,handle,active,access_token,token_expires_at,remote_user_id")
      .eq("platform", "instagram");

    const { data: posts } = await db.from("social_posts")
      .select("id,brand,status,media_type,media_url,media_urls,cover_url,caption," +
              "scheduled_at,posted_at,permalink,attempts,error")
      .eq("platform", "instagram")
      .order("scheduled_at", { ascending: true });

    const rows = posts ?? [];

    // Never ship the token itself — only what the desk needs to say about it.
    const brands = (accounts ?? []).map((a) => {
      const meta = BRAND_META[a.brand] ?? { name: a.brand, accent: "#888888", product: "" };
      const mine = rows.filter((p) => p.brand === a.brand);
      const fb = !!a.access_token && a.access_token.startsWith("EA");
      return {
        key: a.brand,
        ...meta,
        handle: a.handle,
        connected: !!(a.access_token && a.remote_user_id),
        active: a.active,
        api: fb ? "Facebook Login" : "Instagram Login",
        tokenExpiresAt: a.token_expires_at,
        neverExpires: !!a.access_token && !a.token_expires_at,
        queued: mine.filter((p) => p.status === "queued").length,
        posted: mine.filter((p) => p.status === "posted").length,
        held: mine.filter((p) => p.status === "held").length,
        failed: mine.filter((p) => p.status === "failed").length,
      };
    });

    const posts_out = rows.map((p) => ({
      id: p.id,
      brand: p.brand,
      status: p.status,
      type: p.media_type,
      slides: Array.isArray(p.media_urls) ? p.media_urls.length : 1,
      cover: p.cover_url || p.media_url,
      hook: (p.caption || "").split("\n")[0].slice(0, 120),
      scheduledAt: p.scheduled_at,
      postedAt: p.posted_at,
      permalink: p.permalink,
      attempts: p.attempts,
      // The error string can carry a full Graph API payload; the desk only needs
      // enough to see that something went wrong and roughly what.
      error: p.error ? String(p.error).slice(0, 180) : null,
    }));

    // Whether the drain is actually scheduled, and when it last ran. A queue that
    // looks healthy while nothing publishes is the failure this page exists to
    // catch: the drain job has been deleted once and silently timing out for far
    // longer, and on both occasions every queue view still looked normal.
    const { data: drain } = await db.rpc("social_drain_status");
    const drainRow = Array.isArray(drain) ? drain[0] ?? null : drain ?? null;

    return J({
      ok: true,
      generatedAt: new Date().toISOString(),
      brands,
      posts: posts_out,
      drain: drainRow,
    });
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});
