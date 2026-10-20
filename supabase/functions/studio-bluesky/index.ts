// studio-bluesky — connects a brand's Bluesky account to Bestly Studio (2026-10-19).
// Bluesky has no OAuth for this: the account owner types their handle and an APP PASSWORD (a second password they can
// switch off any time) on /connect/bluesky.html. Short links bestly.tech/c/xxxxxxxx are minted by
// social_connect_mint(client, by, 'bluesky'); studio-social's `resolve` already sends them to /connect/bluesky.html.
//
//   POST {op:"bluesky_start",  k}                         -> the client's name (page shows the form)
//   POST {op:"bluesky_finish", k, handle, app_password}   -> signs in once to prove it works, stores the password in
//                                                            Supabase Vault (write-only), stores the DID + handle + session
//                                                            on social_accounts, marks the link used
//
// The account is keyed on its DID (stable if the handle later becomes @minutenewsdaily.com). The password and the
// session tokens are never returned, logged or echoed.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PDS = "https://bsky.social";
const ORIGINS = new Set(["https://www.bestly.tech", "https://bestly.tech", "https://studio.bestly.tech"]);
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const scrub = (s: string) => s.replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "jwt…")
  .replace(/\b[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}\b/gi, "app-password…");
async function link(k: string) {
  const short = /^[a-z2-9]{8}$/.test(k);
  if (!short && !/^[0-9a-f]{48}$/.test(k)) return null;
  const q = db.from("social_connect_links").select("id, client_id, expires_at, used_at, created_by, result, approval_clients(name, slug)");
  const { data } = await (short ? q.eq("short_code", k) : q.eq("token_hash", await sha(k))).maybeSingle();
  return data as any;
}
const linkProblem = (l: any) => !l ? "link_not_found" : l.used_at ? "link_used" : Date.parse(l.expires_at) < Date.now() ? "link_expired" : null;
const linkIsFor = (l: any, platform: string) => String(l?.created_by ?? "").endsWith("· " + platform);

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

  if (op === "bluesky_start") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!linkIsFor(l, "bluesky")) return J({ ok: false, error: "wrong_platform" }, 400);
    return J({ ok: true, client: l.approval_clients?.name ?? null });
  }

  if (op === "bluesky_finish") {
    const l = await link(String(b.k ?? ""));
    const bad = linkProblem(l);
    if (bad) return J({ ok: false, error: bad }, 410);
    if (!linkIsFor(l, "bluesky")) return J({ ok: false, error: "wrong_platform" }, 400);

    let handle = String(b.handle ?? "").trim().replace(/^@/, "").toLowerCase().replace(/\s+/g, "");
    const pw = String(b.app_password ?? "").trim();
    if (!handle) return J({ ok: false, error: "no_handle" }, 400);
    if (!handle.includes(".") && !handle.startsWith("did:")) handle += ".bsky.social";
    if (!/^[a-z0-9.-]+$/.test(handle) && !/^did:[a-z]+:[a-z0-9._:%-]+$/.test(handle)) return J({ ok: false, error: "bad_handle" }, 400);
    // an app password looks like xxxx-xxxx-xxxx-xxxx. Anything else is probably the main password: refuse it, never send it anywhere.
    if (!/^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/i.test(pw)) return J({ ok: false, error: "not_app_password" }, 400);

    try {
      const r = await fetch(`${PDS}/xrpc/com.atproto.server.createSession`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier: handle, password: pw }) });
      const s: any = await r.json().catch(() => ({}));
      if (!s?.accessJwt || !s?.did) {
        if (r.status === 429) return J({ ok: false, error: "rate_limited" }, 429);
        if (r.status === 401 || r.status === 400) return J({ ok: false, error: "login_refused" }, 401);
        return J({ ok: false, error: "bluesky_unreachable", detail: scrub(String(s?.error ?? r.status)).slice(0, 120) }, 502);
      }
      const { data: brand, error: be } = await db.rpc("client_social_brand", { p_client: l.client_id });
      if (be || !brand) return J({ ok: false, error: "store", detail: be?.message ?? "no brand" }, 500);

      const v = await db.rpc("studio_bluesky_cred_set", { p_brand: brand, p_handle: s.handle ?? handle, p_app_password: pw });
      if (v.error) return J({ ok: false, error: "store", detail: "vault: " + scrub(v.error.message) }, 500);

      const now = new Date().toISOString();
      const patch = {
        access_token: s.accessJwt, refresh_token: s.refreshJwt ?? null, remote_user_id: s.did, page_id: s.did, handle: "@" + (s.handle ?? handle),
        token_expires_at: null, refresh_expires_at: null, last_refreshed_at: now, active: true, publishing_paused: false,
        client_id: l.client_id, connected_via: "studio-bluesky", updated_at: now,
      };
      const { data: ex } = await db.from("social_accounts").select("id").eq("brand", brand).eq("platform", "bluesky").maybeSingle();
      let acctId: string | null = ex?.id ?? null;
      if (acctId) {
        const w = await db.from("social_accounts").update(patch).eq("id", acctId);
        if (w.error) return J({ ok: false, error: "store", detail: w.error.message }, 500);
      } else {
        const w = await db.from("social_accounts").insert({ ...patch, brand, platform: "bluesky", label: l.approval_clients?.name ?? null }).select("id").single();
        if (w.error) return J({ ok: false, error: "store", detail: w.error.message }, 500);
        acctId = (w.data as any)?.id ?? null;
      }
      await db.rpc("studio_bluesky_switch_on", { p_brand: brand, p_account: acctId });
      await db.from("social_connect_links").update({ used_at: now, result: { handle: s.handle ?? handle, did: s.did, platform: "bluesky" } }).eq("id", l.id);
      return J({ ok: true, client: l.approval_clients?.name ?? null, handle: s.handle ?? handle, email_confirmed: s.emailConfirmed ?? null, slug: l.approval_clients?.slug ?? null });
    } catch (e) {
      console.error("studio-bluesky finish", scrub(String(e)));
      return J({ ok: false, error: "unexpected", detail: scrub(String(e)).slice(0, 200) }, 502);
    }
  }

  return J({ ok: false, error: "unknown_op" }, 400);
});
