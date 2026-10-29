// family-auth — "Sign in with Bestly Cloud" for the Family Cookbook (bestly.tech/cookbook). Owner: Basil.
// Bestly Cloud (cloud.bestly.tech) is the identity provider. This function does the OpenID Connect code exchange on the
// server (the client secret never reaches a phone), asks Bestly Cloud who signed in, matches that account to a
// family_members row, and mints the cookbook's OWN session. We never see or store a Bestly Cloud password or passkey.
//   POST { op: "start" }                 -> { url }  where to send the phone (PKCE + state are kept server-side)
//   POST { op: "exchange", code, state } -> { token, me }  token is random, only its sha-256 is stored (family_sessions)
// A phone that returns from Bestly Cloud inside the home-screen app may not share Safari's storage, so nothing the sign-in
// needs lives in the browser: state and the PKCE verifier are rows in family_oauth_states.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB, { auth: { persistSession: false } });

const IDP = "https://cloud.bestly.tech";
const REDIRECT = "https://www.bestly.tech/cookbook/callback";
const ORIGINS = new Set(["https://www.bestly.tech", "https://bestly.tech", "http://localhost:4173", "http://localhost:5173", "http://127.0.0.1:4173"]);
const cors = (req: Request) => ({
  "Access-Control-Allow-Origin": ORIGINS.has(req.headers.get("origin") ?? "") ? req.headers.get("origin")! : "https://www.bestly.tech",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", Vary: "Origin",
});
const J = (req: Request, o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...cors(req) } });

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const rand = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)));
const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const sha256hex = async (s: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));

async function log(ok: boolean, stage: string, detail: string, memberId?: string) {
  try { await db.from("family_auth_log").insert({ ok, stage, detail: detail.slice(0, 300), member_id: memberId ?? null }); } catch { /* best effort */ }
}

let disco: { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string; at: number } | null = null;
async function discovery() {
  if (disco && Date.now() - disco.at < 3_600_000) return disco;
  let last = "";
  for (const path of ["/.well-known/openid-configuration", "/index.php/apps/oidc/openid-configuration"]) {
    try {
      const r = await fetch(IDP + path, { signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
      if (!r.ok) { last = `${path} ${r.status}`; continue; }
      const j = await r.json();
      if (j.authorization_endpoint && j.token_endpoint && j.userinfo_endpoint) {
        disco = { authorization_endpoint: j.authorization_endpoint, token_endpoint: j.token_endpoint, userinfo_endpoint: j.userinfo_endpoint, at: Date.now() };
        return disco;
      }
      last = `${path} missing endpoints`;
    } catch (e) { last = `${path} ${(e as Error).message}`; }
  }
  throw new Error("discovery: " + last);
}

async function client(): Promise<{ id: string; secret: string }> {
  const { data } = await db.rpc("family_oauth_client");
  const id = String((data as any)?.id ?? ""), secret = String((data as any)?.secret ?? "");
  if (!id || !secret) throw new Error("the sign-in app is not set up");
  return { id, secret };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method !== "POST") return J(req, { ok: false, error: "POST only" }, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty */ }

  if (body.op === "start") {
    try {
      const [d, c] = await Promise.all([discovery(), client()]);
      await db.from("family_oauth_states").delete().lt("expires_at", new Date().toISOString());
      const state = rand(24), verifier = rand(32);
      const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
      const { error } = await db.from("family_oauth_states").insert({ state, verifier });
      if (error) throw new Error(error.message);
      const u = new URL(d.authorization_endpoint);
      u.search = new URLSearchParams({ response_type: "code", client_id: c.id, redirect_uri: REDIRECT, scope: "openid profile", state, code_challenge: challenge, code_challenge_method: "S256" }).toString();
      return J(req, { ok: true, url: u.toString() });
    } catch (e) {
      await log(false, "discovery", (e as Error).message);
      return J(req, { ok: false, error: "Sign-in is not available right now. Please try again in a few minutes." }, 503);
    }
  }

  if (body.op === "exchange") {
    const code = String(body.code ?? ""), state = String(body.state ?? "");
    if (!/^[A-Za-z0-9._~\-]{8,2048}$/.test(code) || !/^[0-9a-f]{48}$/.test(state)) return J(req, { ok: false, error: "That sign-in link is not valid. Start again." }, 400);
    const { count } = await db.from("family_auth_log").select("id", { count: "exact", head: true }).eq("ok", false).gte("at", new Date(Date.now() - 600_000).toISOString());
    if ((count ?? 0) >= 30) return J(req, { ok: false, error: "Too many tries. Wait a few minutes." }, 429);
    // the state row is single-use
    const { data: st } = await db.from("family_oauth_states").delete().eq("state", state).select("verifier, expires_at").maybeSingle();
    if (!st || new Date(st.expires_at).getTime() < Date.now()) { await log(false, "state", "unknown or expired state"); return J(req, { ok: false, error: "That sign-in took too long. Start again." }, 400); }
    let uid = "";
    try {
      const [d, c] = await Promise.all([discovery(), client()]);
      const tr = await fetch(d.token_endpoint, {
        method: "POST", signal: AbortSignal.timeout(12_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + btoa(`${c.id}:${c.secret}`), Accept: "application/json" },
        body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, code_verifier: st.verifier }),
      });
      const tj = await tr.json().catch(() => ({}));
      if (!tr.ok || !tj.access_token) { await log(false, "token", `token endpoint ${tr.status} ${String(tj.error ?? "")}`); return J(req, { ok: false, error: "Bestly Cloud did not accept that sign-in. Try again." }, 502); }
      const ur = await fetch(d.userinfo_endpoint, { signal: AbortSignal.timeout(10_000), headers: { Authorization: `Bearer ${tj.access_token}`, Accept: "application/json" } });
      const uj = await ur.json().catch(() => ({}));
      if (!ur.ok) { await log(false, "userinfo", `userinfo ${ur.status}`); return J(req, { ok: false, error: "Bestly Cloud did not say who you are. Try again." }, 502); }
      uid = String(uj.preferred_username ?? uj.sub ?? "").trim();
      if (!uid) { await log(false, "userinfo", "no username in the reply"); return J(req, { ok: false, error: "Bestly Cloud did not say who you are. Try again." }, 502); }
    } catch (e) {
      await log(false, "token", (e as Error).message);
      return J(req, { ok: false, error: "Sign-in is not available right now. Please try again in a few minutes." }, 503);
    }
    const { data: m } = await db.from("family_members").select("id, role, name, last_name, status, first_sign_in_at").ilike("nc_uid", uid.replace(/[%_]/g, "\\$&")).maybeSingle();
    if (!m || !["invited", "active"].includes(m.status)) {
      await log(false, "member", `no seat for ${uid.slice(0, 40)}`);
      return J(req, { ok: false, error: "This Bestly Cloud account is not on the family list. Ask Jared to invite you." }, 403);
    }
    const token = rand(32);
    const { error } = await db.from("family_sessions").insert({ token_hash: await sha256hex(token), member_id: m.id, via: "oidc" });
    if (error) { await log(false, "session", error.message, m.id); return J(req, { ok: false, error: "Could not finish signing in. Try again." }, 500); }
    const now = new Date().toISOString();
    await db.from("family_members").update({ status: "active", last_sign_in_at: now, ...(m.first_sign_in_at ? {} : { first_sign_in_at: now }) }).eq("id", m.id);
    await db.from("family_sessions").delete().eq("member_id", m.id).lt("expires_at", now);
    await log(true, "session", "signed in", m.id);
    const { data: me } = await db.rpc("family_me", { p_token: token });
    return J(req, { ok: true, token, me });
  }
  return J(req, { ok: false, error: "unknown op" }, 400);
});
