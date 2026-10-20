// studio-threads — connects a brand's Threads profile to Bestly Studio (2026-10-19).
// Same job and link scheme as studio-social's Instagram / TikTok / Facebook ops, kept in its own function so
// the live Instagram, TikTok and Facebook connect flows are not touched. Short links bestly.tech/c/xxxxxxxx are
// minted by social_connect_mint(client, by, 'threads'); studio-social's `resolve` already sends them to
// /connect/threads.html, which talks to this function.
//
//   POST {op:"threads_start",  k}          -> the client's name and the Threads authorize URL
//   POST {op:"threads_finish", k, code}    Threads' code -> short-lived token -> 60-day token on the brand's
//                                          social_accounts row (bestly-threads-poster refreshes it before it expires)
//   POST {op:"threads_setup",  s, app_id, app_secret}   one-time: the Threads app id + secret (Vault studio_threads_*)
//
// Tokens are never returned, logged or echoed.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const REDIRECT = "https://www.bestly.tech/connect/threads.html";
const SCOPES = "threads_basic,threads_content_publish";
const GRAPH = "https://graph.threads.net";
const ORIGINS = new Set(["https://www.bestly.tech", "https://bestly.tech", "https://studio.bestly.tech"]);
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const scrub = (s: string) => s.replace(/THAA[A-Za-z0-9_-]{20,}/g, "THAA…").replace(/access_token=[^&\s"]+/g, "access_token=…")
  .replace(/(client_secret|refresh_token|code)=[^&\s"]+/g, "$1=…");

async function creds(): Promise<{ id: string; secret: string } | null> {
  const { data } = await db.rpc("studio_threads_app_get");
  const id = (data as any)?.app_id, secret = (data as any)?.app_secret;
  return id && secret ? { id: String(id), secret: String(secret) } : null;
}
async function setupOk(s: string): Promise<boolean> {
  if (!s) return false;
  const { data } = await db.rpc("studio_setup_link_ok", { p_sha: await sha(s) });
  return data === true;
}
async function link(k: string) {
  const short = /^[a-z2-9]{8}$/.test(k);
  if (!short && !/^[0-9a-f]{48}$/.test(k)) return null;
  const q = db.from("social_connect_links").select("id, client_id, expires_at, used_at, created_by, result, approval_clients(name, slug)");
  const { data } = await (short ? q.eq("short_code", k) : q.eq("token_hash", await sha(k))).maybeSingle();
  return data as any;
}
const linkProblem = (l: any) => !l ? "link_not_found" : l.used_at ? "link_used" : Date.parse(l.expires_at) < Date.now() ? "link_expired" : null;
const linkIsFor = (l: any, platform: string) => String(l?.created_by ?? "").endsWith("· " + platform);

async function gj(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}

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

  if (op === "threads_setup") {
    if (!(await setupOk(String(b.s ?? "")))) return J({ ok: false, error: "setup_link_expired" }, 404);
    const { error } = await db.rpc("studio_threads_app_set", { p_app_id: String(b.app_id ?? ""), p_app_secret: String(b.app_secret ?? "") });
    if (error) return J({ ok: false, error: "not_saved", detail: error.message }, 400);
    return J({ ok: true, redirect_uri: REDIRECT, scopes: SCOPES });
  }

  if (op === "threads_start") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!linkIsFor(l, "threads")) return J({ ok: false, error: "wrong_platform" }, 400);
    const app = await creds();
    if (!app) return J({ ok: false, error: "not_set_up", client: l.approval_clients?.name ?? null }, 503);
    const go = new URL("https://threads.net/oauth/authorize");
    go.searchParams.set("client_id", app.id);
    go.searchParams.set("redirect_uri", REDIRECT);
    go.searchParams.set("scope", SCOPES);
    go.searchParams.set("response_type", "code");
    go.searchParams.set("state", String(b.k));
    return J({ ok: true, client: l.approval_clients?.name ?? null, authorize_url: go.toString() });
  }

  if (op === "threads_finish") {
    const k = String(b.k ?? "");
    const code = String(b.code ?? "").replace(/#_$/, "");
    const l = await link(k);
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!linkIsFor(l, "threads")) return J({ ok: false, error: "wrong_platform" }, 400);
    if (!code) return J({ ok: false, error: "no_code" }, 400);
    const app = await creds();
    if (!app) return J({ ok: false, error: "not_set_up" }, 503);
    try {
      const sr = await gj(`${GRAPH}/oauth/access_token`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: app.id, client_secret: app.secret, grant_type: "authorization_code", redirect_uri: REDIRECT, code }),
      });
      const short = sr.json?.access_token;
      if (!short) return J({ ok: false, error: "code_exchange", detail: scrub(JSON.stringify(sr.json?.error_message ?? sr.json?.error ?? sr.json)).slice(0, 300) }, 502);

      const lr = await gj(`${GRAPH}/access_token?grant_type=th_exchange_token&client_secret=${encodeURIComponent(app.secret)}&access_token=${encodeURIComponent(short)}`);
      if (!lr.json?.access_token) return J({ ok: false, error: "long_exchange", detail: scrub(JSON.stringify(lr.json?.error ?? lr.json)).slice(0, 300) }, 502);
      const longTok = String(lr.json.access_token);
      const expiresAt = new Date(Date.now() + (Number(lr.json.expires_in) || 5184000) * 1000).toISOString();

      const me = await gj(`${GRAPH}/v1.0/me?fields=id,username,name&access_token=${encodeURIComponent(longTok)}`);
      const uid = String(me.json?.id ?? sr.json?.user_id ?? "");
      if (!uid) return J({ ok: false, error: "profile", detail: scrub(JSON.stringify(me.json?.error ?? me.json)).slice(0, 300) }, 502);
      const handle = me.json?.username ? "@" + me.json.username : null;

      const { data: brand, error: be } = await db.rpc("client_social_brand", { p_client: l.client_id });
      if (be || !brand) return J({ ok: false, error: "store", detail: be?.message ?? "no brand" }, 500);
      const now = new Date().toISOString();
      const patch = {
        access_token: longTok, remote_user_id: uid, page_id: uid, handle, token_expires_at: expiresAt, last_refreshed_at: now,
        active: true, publishing_paused: false, client_id: l.client_id, connected_via: "studio-threads", updated_at: now,
      };
      const { data: ex } = await db.from("social_accounts").select("id").eq("brand", brand).eq("platform", "threads").maybeSingle();
      let acctId: string | null = ex?.id ?? null;
      if (acctId) {
        const w = await db.from("social_accounts").update(patch).eq("id", acctId);
        if (w.error) return J({ ok: false, error: "store", detail: w.error.message }, 500);
      } else {
        const w = await db.from("social_accounts").insert({ ...patch, brand, platform: "threads", label: l.approval_clients?.name ?? null }).select("id").single();
        if (w.error) return J({ ok: false, error: "store", detail: w.error.message }, 500);
        acctId = (w.data as any)?.id ?? null;
      }
      await db.rpc("studio_threads_switch_on", { p_brand: brand, p_account: acctId });
      await db.from("social_connect_links").update({ used_at: now, result: { handle, threads_id: uid, platform: "threads" } }).eq("id", l.id);
      return J({ ok: true, client: l.approval_clients?.name ?? null, handle: me.json?.username ?? null, slug: l.approval_clients?.slug ?? null });
    } catch (e) {
      console.error("studio-threads finish", scrub(String(e)));
      return J({ ok: false, error: "unexpected", detail: scrub(String(e)).slice(0, 300) }, 502);
    }
  }

  return J({ ok: false, error: "unknown_op" }, 400);
});
