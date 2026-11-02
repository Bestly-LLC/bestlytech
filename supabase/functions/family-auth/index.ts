// family-auth — the way in to the Family Cookbook (bestly.tech/cookbook). Owner: Basil.
// Two doors, both ending in the cookbook's OWN session (family_sessions, token random, only its sha-256 stored):
//   POST { op: "start" }                 -> { url }  Bestly Cloud (OIDC), PKCE + state kept server-side
//   POST { op: "exchange", code, state } -> { token, me }
//   POST { op: "invite", token, role }   -> { url }  a reviewer mints a one-time link for someone
//   POST { op: "link", t }               -> { token, me }  that link, spent on use: no account, no password
// Bestly Cloud (cloud.bestly.tech) is the identity provider for the OIDC door; the code exchange happens here so the
// client secret never reaches a phone. We never see or store a Bestly Cloud password or passkey.
// A phone that returns from Bestly Cloud inside the home-screen app may not share Safari's storage, so nothing the sign-in
// needs lives in the browser: state and the PKCE verifier are rows in family_oauth_states.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB, { auth: { persistSession: false } });

const IDP = "https://cloud.bestly.tech";
const SITE = "https://www.bestly.tech";
const REDIRECT = `${SITE}/cookbook/callback`;
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

/* ===== passkeys ===== */
// The passkey is the way in. The page hands us what the browser already decoded (credential id, SPKI public key,
// algorithm), so there is no CBOR and no attestation to unpick: we are not vetting which authenticator Mom owns,
// only that the thing signing now is the thing that registered. RP id is the apex so www and bestly.tech both work.
const RP_ID = "bestly.tech";
const RP_NAME = "Family Cookbook";
const WEB_ORIGINS = new Set(["https://www.bestly.tech", "https://bestly.tech"]);

const unb64url = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const sha256 = async (b: Uint8Array) => new Uint8Array(await crypto.subtle.digest("SHA-256", b));
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** WebAuthn hands ECDSA signatures over as DER; Web Crypto wants the raw r||s pair. */
function derToRaw(sig: Uint8Array): Uint8Array {
  if (sig[0] !== 0x30) return sig; // already raw
  let i = 2;
  if (sig[1] & 0x80) i = 2 + (sig[1] & 0x7f);
  const read = () => {
    if (sig[i++] !== 0x02) throw new Error("bad signature");
    let len = sig[i++];
    let v = sig.slice(i, i + len);
    i += len;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);      // strip the sign byte
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);                                 // left-pad to 32
    return out;
  };
  const r = read(), s = read();
  return new Uint8Array([...r, ...s]);
}

/** The signed thing is always authenticatorData || sha256(clientDataJSON). */
async function verifyAssertion(alg: number, spki: Uint8Array, authData: Uint8Array, clientDataJSON: Uint8Array, sig: Uint8Array) {
  const signed = new Uint8Array([...authData, ...(await sha256(clientDataJSON))]);
  if (alg === -7) {
    const key = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(sig), signed);
  }
  if (alg === -257) {
    const key = await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "RSASSA-PKCS1-v1_5" }, key, sig, signed);
  }
  return false;
}

/** type, challenge and origin all have to be the ones we asked for. The challenge row is single-use. */
async function checkClientData(raw: string, want: "webauthn.create" | "webauthn.get", kind: "register" | "login") {
  let cd: { type?: string; challenge?: string; origin?: string };
  try { cd = JSON.parse(new TextDecoder().decode(unb64url(raw))); } catch { return null; }
  if (cd.type !== want || !cd.challenge || !WEB_ORIGINS.has(cd.origin ?? "")) return null;
  const { data: ch } = await db.from("family_webauthn_challenges").delete()
    .eq("challenge", cd.challenge).eq("kind", kind).gt("expires_at", new Date().toISOString())
    .select("member_id").maybeSingle();
  return ch ? { memberId: ch.member_id as string | null } : null;
}

/** The authenticator really is ours, the person really was there, and Face ID (or a PIN) really happened. */
async function checkAuthData(authData: Uint8Array) {
  if (authData.length < 37) return false;
  if (!sameBytes(authData.slice(0, 32), await sha256(new TextEncoder().encode(RP_ID)))) return false;
  const flags = authData[32];
  return (flags & 0x01) === 0x01 && (flags & 0x04) === 0x04; // user present + user verified
}

/** The uuid as the 16 raw bytes WebAuthn wants for user.id. */
const uuidBytes = (u: string) => Uint8Array.from((u.replace(/-/g, "").match(/../g) ?? []).map((h) => parseInt(h, 16)));

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
  // A reviewer makes a one-time link for someone, so that person never needs a Bestly Cloud account or a password.
  if (body.op === "invite") {
    const caller = String(body.token ?? ""), role = String(body.role ?? "");
    if (!["mom", "jared", "mariah"].includes(role)) return J(req, { ok: false, error: "unknown person" }, 400);
    const { data: me } = await db.rpc("family_me", { p_token: caller });
    if (!me || !(me as { reviewer?: boolean }).reviewer) return J(req, { ok: false, error: "Only Jared or Mariah can make a sign-in link." }, 403);
    const { data: mine } = await db.from("family_members").select("id").eq("role", (me as { id?: string }).id ?? "").maybeSingle();
    const { data: m } = await db.from("family_members").select("id, name, status").eq("role", role).maybeSingle();
    if (!m || m.status === "paused") return J(req, { ok: false, error: "That person is not on the family list." }, 404);
    const t = rand(32);
    const { error } = await db.from("family_invites").insert({ token_hash: await sha256hex(t), member_id: m.id, created_by: mine?.id ?? null });
    if (error) { await log(false, "invite", error.message, m.id); return J(req, { ok: false, error: "Could not make that link. Try again." }, 500); }
    await db.from("family_invites").delete().lt("expires_at", new Date().toISOString());
    if (m.status === "pending") await db.from("family_members").update({ status: "invited", invited_at: new Date().toISOString() }).eq("id", m.id);
    await log(true, "invite", `link for ${role}`, m.id);
    return J(req, { ok: true, url: `${SITE}/cookbook/join?t=${t}`, name: m.name, days: 7 });
  }

  // Tapping that link: one use, then it is spent.
  if (body.op === "link") {
    const t = String(body.t ?? "");
    if (!/^[0-9a-f]{64}$/.test(t)) return J(req, { ok: false, error: "That link is not valid. Ask Jared for a new one." }, 400);
    const { count } = await db.from("family_auth_log").select("id", { count: "exact", head: true }).eq("ok", false).gte("at", new Date(Date.now() - 600_000).toISOString());
    if ((count ?? 0) >= 30) return J(req, { ok: false, error: "Too many tries. Wait a few minutes." }, 429);
    // claiming the invite and checking it is unused happen in one update, so a link can never be spent twice
    const { data: inv } = await db.from("family_invites").update({ used_at: new Date().toISOString() })
      .eq("token_hash", await sha256hex(t)).is("used_at", null).gt("expires_at", new Date().toISOString())
      .select("member_id").maybeSingle();
    if (!inv) { await log(false, "link", "unknown, used or expired link"); return J(req, { ok: false, error: "That link was already used or has expired. Ask Jared for a new one." }, 400); }
    const { data: m } = await db.from("family_members").select("id, status, first_sign_in_at").eq("id", inv.member_id).maybeSingle();
    if (!m || m.status === "paused") { await log(false, "link", "no seat", inv.member_id); return J(req, { ok: false, error: "That person is not on the family list." }, 403); }
    const token = rand(32);
    const { error } = await db.from("family_sessions").insert({ token_hash: await sha256hex(token), member_id: m.id, via: "link" });
    if (error) { await log(false, "session", error.message, m.id); return J(req, { ok: false, error: "Could not finish signing in. Try again." }, 500); }
    const now = new Date().toISOString();
    await db.from("family_members").update({ status: "active", last_sign_in_at: now, ...(m.first_sign_in_at ? {} : { first_sign_in_at: now }) }).eq("id", m.id);
    await db.from("family_sessions").delete().eq("member_id", m.id).lt("expires_at", now);
    await log(true, "session", "signed in with a link", m.id);
    const { data: me } = await db.rpc("family_me", { p_token: token });
    return J(req, { ok: true, token, me });
  }

  /* ===== passkeys: the way in ===== */

  // Setting one up. You have to already be signed in (a link, or a passkey you already have) to add one.
  if (body.op === "passkey_new") {
    const { data: me } = await db.rpc("family_me", { p_token: String(body.token ?? "") });
    if (!me) return J(req, { ok: false, error: "not_signed_in" }, 401);
    const role = (me as { id?: string }).id ?? "", label = (me as { name?: string }).name ?? "";
    const { data: m } = await db.from("family_members").select("id, name, last_name").eq("role", role).maybeSingle();
    if (!m) return J(req, { ok: false, error: "That person is not on the family list." }, 403);
    await db.from("family_webauthn_challenges").delete().lt("expires_at", new Date().toISOString());
    const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const { error } = await db.from("family_webauthn_challenges").insert({ challenge, member_id: m.id, kind: "register" });
    if (error) return J(req, { ok: false, error: "Could not start that. Try again." }, 500);
    const { data: have } = await db.from("family_passkeys").select("credential_id").eq("member_id", m.id);
    return J(req, {
      ok: true, challenge, rpId: RP_ID, rpName: RP_NAME,
      userId: b64url(uuidBytes(m.id)), userName: `${m.name} ${m.last_name}`.trim(), userDisplayName: m.name,
      exclude: (have ?? []).map((p) => p.credential_id), label,
    });
  }

  // Keeping it. Only the public key lands here, so there is no secret in this table.
  if (body.op === "passkey_save") {
    const { data: me } = await db.rpc("family_me", { p_token: String(body.token ?? "") });
    if (!me) return J(req, { ok: false, error: "not_signed_in" }, 401);
    const { data: m } = await db.from("family_members").select("id").eq("role", (me as { id?: string }).id ?? "").maybeSingle();
    if (!m) return J(req, { ok: false, error: "That person is not on the family list." }, 403);
    const id = String(body.id ?? ""), pk = String(body.publicKey ?? ""), alg = Number(body.alg ?? 0);
    if (!id || !pk || ![-7, -257].includes(alg)) return J(req, { ok: false, error: "That phone offered a passkey we cannot read." }, 400);
    const ch = await checkClientData(String(body.clientDataJSON ?? ""), "webauthn.create", "register");
    if (!ch || ch.memberId !== m.id) { await log(false, "passkey", "register challenge did not match", m.id); return J(req, { ok: false, error: "That took too long. Try again." }, 400); }
    try { await crypto.subtle.importKey("spki", unb64url(pk), alg === -7 ? { name: "ECDSA", namedCurve: "P-256" } : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]); }
    catch { return J(req, { ok: false, error: "That phone offered a passkey we cannot read." }, 400); }
    const { error } = await db.from("family_passkeys").upsert({ credential_id: id, member_id: m.id, public_key: pk, alg, label: String(body.label ?? "").slice(0, 60) || null });
    if (error) { await log(false, "passkey", error.message, m.id); return J(req, { ok: false, error: "Could not save that passkey. Try again." }, 500); }
    await log(true, "passkey", "passkey added", m.id);
    return J(req, { ok: true });
  }

  // Signing in with one. No name to type: the passkey says who it is.
  if (body.op === "passkey_start") {
    await db.from("family_webauthn_challenges").delete().lt("expires_at", new Date().toISOString());
    const challenge = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const { error } = await db.from("family_webauthn_challenges").insert({ challenge, kind: "login" });
    if (error) return J(req, { ok: false, error: "Sign-in is not available right now. Please try again in a few minutes." }, 503);
    return J(req, { ok: true, challenge, rpId: RP_ID });
  }

  if (body.op === "passkey_finish") {
    const { count } = await db.from("family_auth_log").select("id", { count: "exact", head: true }).eq("ok", false).gte("at", new Date(Date.now() - 600_000).toISOString());
    if ((count ?? 0) >= 30) return J(req, { ok: false, error: "Too many tries. Wait a few minutes." }, 429);
    const id = String(body.id ?? "");
    const { data: pk } = await db.from("family_passkeys").select("member_id, public_key, alg").eq("credential_id", id).maybeSingle();
    if (!pk) { await log(false, "passkey", "unknown credential"); return J(req, { ok: false, error: "That passkey is not set up here. Ask Jared for a link." }, 403); }
    const ch = await checkClientData(String(body.clientDataJSON ?? ""), "webauthn.get", "login");
    if (!ch) { await log(false, "passkey", "login challenge did not match", pk.member_id); return J(req, { ok: false, error: "That took too long. Try again." }, 400); }
    let ok = false;
    try {
      const authData = unb64url(String(body.authenticatorData ?? ""));
      ok = await checkAuthData(authData) && await verifyAssertion(pk.alg, unb64url(pk.public_key), authData, unb64url(String(body.clientDataJSON ?? "")), unb64url(String(body.signature ?? "")));
    } catch { ok = false; }
    if (!ok) { await log(false, "passkey", "signature did not check out", pk.member_id); return J(req, { ok: false, error: "That did not check out. Try again." }, 403); }
    const { data: m } = await db.from("family_members").select("id, status, first_sign_in_at").eq("id", pk.member_id).maybeSingle();
    if (!m || m.status === "paused") { await log(false, "passkey", "no seat", pk.member_id); return J(req, { ok: false, error: "That person is not on the family list." }, 403); }
    const token = rand(32);
    const { error } = await db.from("family_sessions").insert({ token_hash: await sha256hex(token), member_id: m.id, via: "passkey" });
    if (error) { await log(false, "session", error.message, m.id); return J(req, { ok: false, error: "Could not finish signing in. Try again." }, 500); }
    const now = new Date().toISOString();
    await db.from("family_passkeys").update({ last_used_at: now }).eq("credential_id", id);
    await db.from("family_members").update({ status: "active", last_sign_in_at: now, ...(m.first_sign_in_at ? {} : { first_sign_in_at: now }) }).eq("id", m.id);
    await db.from("family_sessions").delete().eq("member_id", m.id).lt("expires_at", now);
    await log(true, "session", "signed in with a passkey", m.id);
    const { data: who } = await db.rpc("family_me", { p_token: token });
    return J(req, { ok: true, token, me: who });
  }

  return J(req, { ok: false, error: "unknown op" }, 400);
});
