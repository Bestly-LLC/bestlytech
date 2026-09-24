// studio-social — lets any Studio client connect their own Instagram account.
//
// The pages live on www.bestly.tech/connect/ (Supabase will not serve HTML from an
// edge function), and talk to this function as a small JSON API:
//
//   POST {op:"start",  k}              a one-use link minted by Studio (staff or client)
//                                      -> the client's name and the Instagram authorize URL
//   POST {op:"finish", k, code}        Instagram's code -> 60-day token on the client's
//                                      social_accounts row (bestly-ig-poster refreshes it)
//   POST {op:"setup",  s, app_id, app_secret}
//                                      one-time: Jared stores the Instagram app id + secret
//
// Uses "Instagram API with Instagram Login": the client needs a Business or Creator
// account, but no Facebook Page. Publishing is bestly-ig-poster's drain, unchanged.
// Tokens are never returned, logged or echoed.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const REDIRECT = "https://www.bestly.tech/connect/instagram.html";
const SCOPES = "instagram_business_basic,instagram_business_content_publish";
const SETUP_SHA = "0bfb581373272cc33e87d928742ba29ff70974824e163d8f3c9495c5481d9330";
const SETUP_UNTIL = Date.parse("2026-09-24T18:14:25Z");
const ORIGINS = new Set(["https://www.bestly.tech", "https://bestly.tech", "https://studio.bestly.tech"]);

const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const scrub = (s: string) => s.replace(/access_token=[^&\s"]+/g, "access_token=…").replace(/IGAA[\w-]+/g, "IGAA…");

async function appCreds(): Promise<{ id: string; secret: string } | null> {
  const { data } = await db.rpc("studio_ig_app_get");
  const id = (data as any)?.app_id, secret = (data as any)?.app_secret;
  return id && secret ? { id: String(id), secret: String(secret) } : null;
}

async function link(k: string) {
  if (!/^[0-9a-f]{48}$/.test(k)) return null;
  const { data } = await db.from("social_connect_links")
    .select("id, client_id, expires_at, used_at, approval_clients(name, slug)")
    .eq("token_hash", await sha(k)).maybeSingle();
  return data as any;
}
const linkProblem = (l: any) =>
  !l ? "link_not_found" : l.used_at ? "link_used" : Date.parse(l.expires_at) < Date.now() ? "link_expired" : null;

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://www.bestly.tech",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method !== "POST") return J({ ok: false, error: "post_only" }, 405);

  let b: Record<string, any> = {};
  try { b = await req.json(); } catch { return J({ ok: false, error: "bad_json" }, 400); }
  const op = String(b.op ?? "");

  if (op === "setup") {
    if (Date.now() > SETUP_UNTIL || (await sha(String(b.s ?? ""))) !== SETUP_SHA) return J({ ok: false, error: "setup_link_expired" }, 404);
    const { error } = await db.rpc("studio_ig_app_set", { p_app_id: String(b.app_id ?? ""), p_app_secret: String(b.app_secret ?? "") });
    if (error) return J({ ok: false, error: "not_saved", detail: error.message }, 400);
    return J({ ok: true, redirect_uri: REDIRECT });
  }

  if (op === "start") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    const app = await appCreds();
    if (!app) return J({ ok: false, error: "not_set_up", client: l.approval_clients?.name ?? null }, 503);
    const go = new URL("https://www.instagram.com/oauth/authorize");
    go.searchParams.set("enable_fb_login", "0");
    go.searchParams.set("force_authentication", "1");
    go.searchParams.set("client_id", app.id);
    go.searchParams.set("redirect_uri", REDIRECT);
    go.searchParams.set("response_type", "code");
    go.searchParams.set("scope", SCOPES);
    go.searchParams.set("state", String(b.k));
    return J({ ok: true, client: l.approval_clients?.name ?? null, authorize_url: go.toString() });
  }

  if (op === "finish") {
    const k = String(b.k ?? "");
    const code = String(b.code ?? "").replace(/#_$/, "");
    const l = await link(k);
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!code) return J({ ok: false, error: "no_code" }, 400);
    const app = await appCreds();
    if (!app) return J({ ok: false, error: "not_set_up" }, 503);
    try {
      const sr = await fetch("https://api.instagram.com/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: app.id, client_secret: app.secret, grant_type: "authorization_code", redirect_uri: REDIRECT, code }),
      });
      const sj: any = await sr.json();
      const short = sj.access_token ?? sj.data?.[0]?.access_token;
      const perms = String(sj.permissions ?? sj.data?.[0]?.permissions ?? "");
      if (!short) return J({ ok: false, error: "code_exchange", detail: scrub(JSON.stringify(sj.error_message ?? sj.error ?? sj)).slice(0, 300) }, 502);
      if (perms && !perms.includes("instagram_business_content_publish")) return J({ ok: false, error: "publish_permission_missing" }, 400);

      const lr = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(app.secret)}&access_token=${encodeURIComponent(short)}`);
      const lj: any = await lr.json();
      if (!lj.access_token) return J({ ok: false, error: "long_exchange", detail: scrub(JSON.stringify(lj.error ?? lj)).slice(0, 300) }, 502);
      const expiresAt = new Date(Date.now() + (Number(lj.expires_in) || 5184000) * 1000).toISOString();

      const mr = await fetch(`https://graph.instagram.com/v23.0/me?fields=user_id,username,account_type&access_token=${encodeURIComponent(lj.access_token)}`);
      const me: any = await mr.json();
      const igId = String(me.user_id ?? me.id ?? "");
      if (!igId) return J({ ok: false, error: "profile", detail: scrub(JSON.stringify(me.error ?? me)).slice(0, 300) }, 502);
      if (me.account_type && !/BUSINESS|CREATOR/i.test(String(me.account_type))) return J({ ok: false, error: "personal_account" }, 400);

      const { data: brand, error: be } = await db.rpc("client_social_brand", { p_client: l.client_id });
      if (be || !brand) return J({ ok: false, error: "store", detail: be?.message ?? "no brand" }, 500);
      const { error: ue } = await db.from("social_accounts").update({
        access_token: lj.access_token,
        remote_user_id: igId,
        handle: me.username ? "@" + me.username : null,
        token_expires_at: expiresAt,
        last_refreshed_at: new Date().toISOString(),
        active: true,
        client_id: l.client_id,
        connected_via: "studio-social",
        updated_at: new Date().toISOString(),
      }).eq("brand", brand).eq("platform", "instagram");
      if (ue) return J({ ok: false, error: "store", detail: ue.message }, 500);
      await db.from("social_connect_links").update({ used_at: new Date().toISOString(), result: { handle: me.username ?? null, ig_id: igId } }).eq("id", l.id);
      return J({ ok: true, client: l.approval_clients?.name ?? null, handle: me.username ?? null });
    } catch (e) {
      console.error("studio-social finish", scrub(String(e)));
      return J({ ok: false, error: "unexpected", detail: scrub(String(e)).slice(0, 300) }, 502);
    }
  }

  return J({ ok: false, error: "unknown_op" }, 400);
});
