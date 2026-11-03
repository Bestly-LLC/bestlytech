// studio-li-page — connect a client's LinkedIn PAGE (company Page) to Bestly Studio. Sibling of studio-social/studio-threads.
// App "Bestly Studio Pages" (264206540, client 86tq996vscr93a, Community Management API). Gated: every op except lip_setup
// answers {error:"not_available"} while studio_flags.li_pages_approved is false.
//
//   POST {op:"lip_setup", s, client_secret, client_id?}  one-time: the Pages app secret (+ id) into Vault. Works before the flag flips.
//   POST {op:"lip_start",  k}        -> the LinkedIn authorize URL (scopes openid profile w_organization_social r_organization_social rw_organization_admin)
//   POST {op:"lip_finish", k, code}  -> the Pages she administers (organizationAcls ADMINISTRATOR + APPROVED).
//                                       One = connected. Several = {pick:[{id,name}]}; tokens wait server-side, never sent to the browser.
//   POST {op:"lip_pick",   k, org_id} the Page she chose -> connected
// Connecting parks the person's profile connection in social_li_profile_saved (never deleted) and makes the client's
// social_accounts linkedin row the Page (page_id urn:li:organization:<id>, connected_via studio-li-page). bestly-li-poster posts as that URN.
// Tokens are never returned, logged or echoed.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { LIP_REDIRECT, LIP_SCOPES, adminOrgIds, grantedAllowsPosting, orgUrn, pageName, pickerList } from "./lib.ts";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const ORIGINS = new Set(["https://www.bestly.tech", "https://bestly.tech", "https://studio.bestly.tech"]);
const LI_REST = "https://api.linkedin.com/rest";
const LI_VERSIONS = ["202606", "202604", "202601", "202511", "202509"];   // YYYYMM; walk down if one is refused (426)

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const scrub = (s: string) => s.replace(/AQ[A-Za-z0-9_-]{40,}/g, "AQ…").replace(/access_token=[^&\s"]+/g, "access_token=…").replace(/(client_secret|refresh_token|code)=[^&\s"]+/g, "$1=…");

async function creds(): Promise<{ id: string; secret: string } | null> {
  const { data } = await db.rpc("studio_li_pages_app_get");
  const id = (data as any)?.client_id, secret = (data as any)?.client_secret;
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

let liVersion = LI_VERSIONS[0];
async function liApi(path: string, token: string) {
  for (let i = Math.max(0, LI_VERSIONS.indexOf(liVersion)); i < LI_VERSIONS.length; i++) {
    const r = await fetch(LI_REST + path, { headers: { Authorization: "Bearer " + token, "Linkedin-Version": LI_VERSIONS[i], "X-Restli-Protocol-Version": "2.0.0" } });
    if (r.status === 426) continue;
    liVersion = LI_VERSIONS[i];
    return { status: r.status, json: await r.json().catch(() => ({})) as any };
  }
  return { status: 426, json: {} as any };
}

type Org = { id: string; name: string; access_token: string; refresh_token: string | null; token_expires_at: string; refresh_expires_at: string | null };

async function store(l: any, org: Org) {
  const { data: brand, error: be } = await db.rpc("client_social_brand", { p_client: l.client_id });
  if (be || !brand) return { ok: false, error: "store", detail: be?.message ?? "no brand" };
  const { data, error } = await db.rpc("studio_li_page_connect", {
    p_brand: brand, p_client: l.client_id, p_org_id: org.id, p_name: org.name, p_access: org.access_token, p_refresh: org.refresh_token,
    p_expires: org.token_expires_at, p_refresh_expires: org.refresh_expires_at, p_label: l.approval_clients?.name ?? null,
  });
  if (error || (data as any)?.ok !== true) return { ok: false, error: "store", detail: error?.message ?? (data as any)?.error };
  await db.from("social_connect_links").update({ used_at: new Date().toISOString(), result: { handle: org.name, org_id: org.id, urn: orgUrn(org.id), platform: "linkedin_page" } }).eq("id", l.id);
  return { ok: true, client: l.approval_clients?.name ?? null, handle: org.name, slug: l.approval_clients?.slug ?? null };
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const cors: Record<string, string> = {
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://www.bestly.tech",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
  if (req.method !== "POST") return J({ ok: false, error: "post_only" }, 405);
  let b: Record<string, any> = {};
  try { b = await req.json(); } catch { return J({ ok: false, error: "bad_json" }, 400); }
  const op = String(b.op ?? "");

  if (op === "lip_setup") {
    if (!(await setupOk(String(b.s ?? "")))) return J({ ok: false, error: "setup_link_expired" }, 404);
    const { data: cur } = await db.rpc("studio_li_pages_app_get");
    const id = String(b.client_id ?? "").trim() || String((cur as any)?.client_id ?? "");
    const { error } = await db.rpc("studio_li_pages_app_set", { p_client_id: id, p_client_secret: String(b.client_secret ?? "") });
    if (error) return J({ ok: false, error: "not_saved", detail: error.message }, 400);
    return J({ ok: true, redirect_uri: LIP_REDIRECT, scopes: LIP_SCOPES });
  }

  if (!op.startsWith("lip_")) return J({ ok: false, error: "unknown_op" }, 400);
  // the gate: nothing below is reachable until LinkedIn has approved the Community Management API and the flag is flipped
  const { data: on } = await db.rpc("studio_li_pages_approved");
  if (on !== true) return J({ ok: false, error: "not_available" }, 404);

  const k = String(b.k ?? "");
  const l = await link(k);
  const bad = linkProblem(l);
  if (bad) return J({ ok: false, error: bad }, 410);
  if (!linkIsFor(l, "linkedin_page")) return J({ ok: false, error: "wrong_platform" }, 400);

  if (op === "lip_start") {
    const app = await creds();
    if (!app) return J({ ok: false, error: "not_set_up", client: l.approval_clients?.name ?? null }, 503);
    const go = new URL("https://www.linkedin.com/oauth/v2/authorization");
    go.searchParams.set("response_type", "code");
    go.searchParams.set("client_id", app.id);
    go.searchParams.set("redirect_uri", LIP_REDIRECT);
    go.searchParams.set("state", k);
    go.searchParams.set("scope", LIP_SCOPES);
    return J({ ok: true, client: l.approval_clients?.name ?? null, authorize_url: go.toString() });
  }

  if (op === "lip_finish") {
    const code = String(b.code ?? "");
    if (!code) return J({ ok: false, error: "no_code" }, 400);
    const app = await creds();
    if (!app) return J({ ok: false, error: "not_set_up" }, 503);
    try {
      const tr = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: app.id, client_secret: app.secret, redirect_uri: LIP_REDIRECT }),
      });
      const tj: any = await tr.json().catch(() => ({}));
      if (!tj.access_token) return J({ ok: false, error: "code_exchange", detail: scrub(JSON.stringify(tj.error_description ?? tj.error ?? tj)).slice(0, 300) }, 502);
      if (!grantedAllowsPosting(tj.scope, LIP_SCOPES)) return J({ ok: false, error: "post_permission_missing" }, 400);
      const tokenExpires = new Date(Date.now() + (Number(tj.expires_in) || 5184000) * 1000).toISOString();
      const refreshExpires = tj.refresh_token ? new Date(Date.now() + (Number(tj.refresh_token_expires_in) || 31536000) * 1000).toISOString() : null;
      const ac = await liApi("/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50", tj.access_token);
      if (ac.status !== 200) return J({ ok: false, error: "pages", detail: scrub(JSON.stringify(ac.json?.message ?? ac.json?.code ?? ac.status)).slice(0, 300) }, 502);
      const ids = adminOrgIds(ac.json);
      if (ids.length === 0) return J({ ok: false, error: "no_company_page" }, 400);
      const orgs: Org[] = [];
      for (const id of ids) {
        const o = await liApi("/organizations/" + id, tj.access_token);
        orgs.push({ id, name: pageName(o.status === 200 ? o.json : null, id), access_token: String(tj.access_token), refresh_token: tj.refresh_token ? String(tj.refresh_token) : null, token_expires_at: tokenExpires, refresh_expires_at: refreshExpires });
      }
      if (orgs.length === 1) return J(await store(l, orgs[0]));
      await db.from("social_connect_links").update({ result: { pending: orgs } }).eq("id", l.id);
      return J({ ok: true, pick: pickerList(orgs), client: l.approval_clients?.name ?? null });
    } catch (e) {
      console.error("studio-li-page lip_finish", scrub(String(e)));
      return J({ ok: false, error: "unexpected", detail: scrub(String(e)).slice(0, 300) }, 502);
    }
  }

  if (op === "lip_pick") {
    const org = ((l.result?.pending ?? []) as Org[]).find((o) => o.id === String(b.org_id ?? ""));
    if (!org) return J({ ok: false, error: "page_not_found" }, 400);
    return J(await store(l, org));
  }
  return J({ ok: false, error: "unknown_op" }, 400);
});
