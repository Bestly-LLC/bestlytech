// bestly-admin-auth — real WebAuthn for the Bestly admins.
//
// The previous scheme encrypted the admin token with a passkey's PRF output and
// kept the ciphertext in localStorage. That is device-locked by construction:
// iCloud syncs the passkey, not the browser's local storage, so a passkey made
// on the iPhone was useless on the Mac. It also required the PRF extension,
// which Chrome's iCloud Keychain path does not reliably expose.
//
// This does it the ordinary way instead: credentials live in the database, the
// server verifies an assertion signature, and it issues a session. Any device
// holding the synced passkey can log in, in any browser that supports WebAuthn.
//
// MULTI-DOMAIN (added for bestly.tech)
// ------------------------------------
// A WebAuthn credential is bound to its Relying Party ID and cannot be moved.
// The passkeys registered for hoku-clean.com will never work on bestly.tech, no
// matter what the server does. So each domain keeps its own credentials and each
// row records the rp_id it belongs to. Both admins work at once; neither
// replaces the other.
//
// Registering a passkey requires already being an admin, which on a brand new
// domain nobody is. That closed loop is broken by an enrolment code: an admin
// already signed in on a working domain mints a one-time, ten-minute code and
// redeems it on the new domain to get a session, which then authorises
// registering a passkey there.
//
// WHICH ACTIONS NEED THE PROXY KEY
// --------------------------------
// hoku-clean.com calls this through a Vercel function that holds x-proxy-key
// server-side. bestly.tech has no such function, so the login endpoints must be
// callable from the browser. That is not a weakening: in every WebAuthn
// deployment the login endpoints are public, and their security comes from the
// challenge and the signature, not from a shared secret in front of them.
// Anything that CHANGES who can log in still requires the proxy key or a live
// session.
//
// Public:        status | auth-begin | auth-finish | enrol-redeem
// Privileged:    session-check | reg-begin | reg-finish | list-keys |
//                revoke-key | enrol-begin | sign-out
//
// KEY ROTATION
// ------------
// 2026-09-24: no key literal in this file any more. The proxy key is checked by
// fingerprint through edge_key_ok() (service-role only): Vault holds
// admin_proxy_key_sha256, plus admin_proxy_key_prev_sha256 while the
// hoku-clean.com proxy moves to the new key. Deleting the _prev secret ends
// the rollover with no deploy. The expired legacy key was removed outright.

import { createClient } from "jsr:@supabase/supabase-js@2";
// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-proxy-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// origin -> Relying Party ID. The RP ID must be a registrable suffix of the
// origin's host, which is why www and apex share one.
const ORIGIN_RP: Record<string, string> = {
  "https://hoku-clean.com": "hoku-clean.com",
  "https://www.hoku-clean.com": "hoku-clean.com",
  "https://bestly.tech": "bestly.tech",
  "https://www.bestly.tech": "bestly.tech",
};
const DEFAULT_RP = "hoku-clean.com";

const SESSION_DAYS = 30;

const PUBLIC_ACTIONS = new Set(["status", "auth-begin", "auth-finish", "enrol-redeem"]);
const ADMIN_ONLY = new Set([
  "reg-begin", "reg-finish", "list-keys", "revoke-key", "enrol-begin",
]);

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

// ---- base64url ------------------------------------------------------------
function b64uToBytes(s: string): Uint8Array {
  const t = s.replace(/-/g, "+").replace(/_/g, "/");
  const p = t + "=".repeat((4 - (t.length % 4)) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64u(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", b));
}
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// Accepts the current key, and the previous one only while its fingerprint is
// still in Vault. Only sha256 fingerprints are compared, in the database.
async function proxyKeyOk(pk: string | null): Promise<boolean> {
  if (!pk) return false;
  for (const n of ["admin_proxy_key_sha256", "admin_proxy_key_prev_sha256"]) {
    const { data } = await db.rpc("edge_key_ok", { p_name: n, p_key: pk });
    if (data === true) return true;
  }
  return false;
}

// WebCrypto wants r||s, but authenticators emit a DER SEQUENCE for ES256.
function derToRawEcdsa(der: Uint8Array): Uint8Array {
  let off = 0;
  if (der[off++] !== 0x30) throw new Error("signature: expected DER sequence");
  let len = der[off++];
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | der[off++];
  }
  const readInt = (): Uint8Array => {
    if (der[off++] !== 0x02) throw new Error("signature: expected DER integer");
    const l = der[off++];
    let v = der.slice(off, off + l);
    off += l;
    while (v.length > 32 && v[0] === 0) v = v.slice(1);
    if (v.length > 32) throw new Error("signature: integer too long");
    const out = new Uint8Array(32);
    out.set(v, 32 - v.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

async function newChallenge(purpose: "register" | "auth"): Promise<string> {
  const c = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
  await db.from("admin_challenges").insert({ challenge: c, purpose });
  return c;
}

// One-time use: consuming the row is what stops a replay.
async function consumeChallenge(c: string, purpose: string): Promise<boolean> {
  const { data } = await db.from("admin_challenges")
    .delete().eq("challenge", c).eq("purpose", purpose).select().maybeSingle();
  if (!data) return false;
  return Date.parse(data.expires_at) > Date.now();
}

type ClientData = { type: string; challenge: string; origin: string };

function parseClientData(b64u: string): ClientData {
  return JSON.parse(new TextDecoder().decode(b64uToBytes(b64u)));
}

// The RP for this ceremony comes from the ceremony's own clientData origin, not
// from anything the caller can assert separately.
function rpForOrigin(origin: string): string | null {
  return ORIGIN_RP[origin] ?? null;
}

async function checkAuthData(authData: Uint8Array, rpId: string, requireUV = true) {
  if (authData.length < 37) throw new Error("authenticatorData too short");
  const rpIdHash = authData.slice(0, 32);
  const expected = await sha256(new TextEncoder().encode(rpId));
  for (let i = 0; i < 32; i++) {
    if (rpIdHash[i] !== expected[i]) throw new Error("rpIdHash mismatch — wrong domain");
  }
  const flags = authData[32];
  if (!(flags & 0x01)) throw new Error("user presence flag not set");
  if (requireUV && !(flags & 0x04)) throw new Error("user verification flag not set");
  const signCount = (authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36];
  return { signCount: signCount >>> 0 };
}

async function issueSession(passkeyId: string | null): Promise<{ session: string; expiresAt: string }> {
  const raw = bytesToB64u(crypto.getRandomValues(new Uint8Array(32)));
  const hash = bytesToB64u(await sha256(new TextEncoder().encode(raw)));
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  await db.from("admin_sessions").insert({
    token_hash: hash, passkey_id: passkeyId, expires_at: expiresAt,
  });
  return { session: raw, expiresAt };
}

async function liveSession(token: unknown): Promise<boolean> {
  if (!token) return false;
  const h = bytesToB64u(await sha256(new TextEncoder().encode(String(token))));
  const { data } = await db.from("admin_sessions")
    .select("expires_at").eq("token_hash", h).maybeSingle();
  return !!data && Date.parse(data.expires_at) > Date.now();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const J = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? "");

    const viaProxy = await proxyKeyOk(req.headers.get("x-proxy-key"));

    // Login endpoints are reachable without the proxy key so a site with no
    // server-side secret store can host the admin. Everything that changes who
    // can log in still needs the proxy key or a live session.
    if (!viaProxy && !PUBLIC_ACTIONS.has(action)) {
      if (!(await liveSession(body.session))) return J({ error: "unauthorized" }, 401);
    }

    // Opportunistic housekeeping; cheap and keeps the tables small.
    if (Math.random() < 0.1) {
      await db.rpc("purge_expired_admin_auth");
      await db.rpc("purge_expired_enrol_codes");
    }

    // ---- status: does this admin have any passkeys for THIS domain? -------
    // Per-domain, because a device that has never seen bestly.tech should be
    // told there is nothing to sign in with there even though hoku has two.
    if (action === "status") {
      const rp = rpForOrigin(String(body.origin ?? req.headers.get("origin") ?? "")) ?? DEFAULT_RP;
      const { count } = await db.from("admin_passkeys")
        .select("id", { count: "exact", head: true }).eq("rp_id", rp);
      const { count: total } = await db.from("admin_passkeys")
        .select("id", { count: "exact", head: true });
      return J({ passkeys: count ?? 0, passkeysAnywhere: total ?? 0, rpId: rp });
    }

    // ---- auth-begin -------------------------------------------------------
    if (action === "auth-begin") {
      const rp = rpForOrigin(String(body.origin ?? req.headers.get("origin") ?? "")) ?? DEFAULT_RP;
      const challenge = await newChallenge("auth");
      return J({ challenge, rpId: rp });
    }

    // ---- auth-finish ------------------------------------------------------
    if (action === "auth-finish") {
      const { credentialId, clientDataJSON, authenticatorData, signature } = body;
      if (!credentialId || !clientDataJSON || !authenticatorData || !signature) {
        return J({ error: "credentialId, clientDataJSON, authenticatorData and signature are required" }, 400);
      }

      const cd = parseClientData(clientDataJSON);
      if (cd.type !== "webauthn.get") return J({ error: "wrong ceremony type" }, 400);
      const rp = rpForOrigin(cd.origin);
      if (!rp) return J({ error: "origin not allowed: " + cd.origin }, 400);
      if (!(await consumeChallenge(cd.challenge, "auth"))) {
        return J({ error: "challenge unknown, already used, or expired" }, 400);
      }

      const { data: cred } = await db.from("admin_passkeys")
        .select("*").eq("credential_id", credentialId).maybeSingle();
      if (!cred) return J({ error: "this passkey is not registered" }, 400);
      // A credential registered for another domain must not authenticate here,
      // even though the signature would verify.
      if ((cred.rp_id ?? DEFAULT_RP) !== rp) {
        return J({ error: "this passkey belongs to a different site" }, 400);
      }

      const authData = b64uToBytes(authenticatorData);
      const { signCount } = await checkAuthData(authData, rp);

      // Signed payload is authenticatorData || SHA-256(clientDataJSON).
      const cdHash = await sha256(b64uToBytes(clientDataJSON));
      const signed = new Uint8Array(authData.length + cdHash.length);
      signed.set(authData, 0);
      signed.set(cdHash, authData.length);

      const spki = b64uToBytes(cred.public_key_jwk.spki);
      let ok = false;
      if (cred.alg === -7) {
        const key = await crypto.subtle.importKey(
          "spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        ok = await crypto.subtle.verify(
          { name: "ECDSA", hash: "SHA-256" }, key, derToRawEcdsa(b64uToBytes(signature)), signed);
      } else if (cred.alg === -257) {
        const key = await crypto.subtle.importKey(
          "spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
        ok = await crypto.subtle.verify(
          "RSASSA-PKCS1-v1_5", key, b64uToBytes(signature), signed);
      } else {
        return J({ error: "unsupported key algorithm " + cred.alg }, 400);
      }
      if (!ok) return J({ error: "signature did not verify" }, 401);

      // A counter that goes backwards can mean a cloned authenticator. Synced
      // passkeys legitimately report 0 always, so only flag a real regression.
      if (signCount > 0 && cred.sign_count > 0 && signCount <= cred.sign_count) {
        return J({ error: "signature counter regressed — possible cloned key" }, 401);
      }

      await db.from("admin_passkeys").update({
        sign_count: signCount, last_used_at: new Date().toISOString(),
      }).eq("id", cred.id);

      const s = await issueSession(cred.id);
      return J({ ok: true, label: cred.label, rpId: rp, ...s });
    }

    // ---- enrol-redeem -----------------------------------------------------
    // Public by necessity: it is used on a domain where the caller cannot yet
    // authenticate. The code is the credential, so it is single-use, expires in
    // ten minutes, and is consumed by the same delete-and-return trick as a
    // WebAuthn challenge.
    if (action === "enrol-redeem") {
      const code = String(body.code ?? "").trim().toUpperCase();
      if (!code) return J({ error: "code required" }, 400);
      const { data } = await db.from("admin_enrol_codes")
        .delete().eq("code", code).is("used_at", null).select().maybeSingle();
      if (!data) return J({ error: "code not found or already used" }, 400);
      if (Date.parse(data.expires_at) < Date.now()) {
        return J({ error: "code expired — mint another" }, 400);
      }
      const s = await issueSession(null);
      return J({ ok: true, ...s });
    }

    // ---- session-check ----------------------------------------------------
    if (action === "session-check") {
      if (!body.session) return J({ valid: false });
      const hash = bytesToB64u(await sha256(new TextEncoder().encode(String(body.session))));
      const { data } = await db.from("admin_sessions")
        .select("*").eq("token_hash", hash).maybeSingle();
      if (!data) return J({ valid: false });
      if (Date.parse(data.expires_at) < Date.now()) {
        await db.from("admin_sessions").delete().eq("token_hash", hash);
        return J({ valid: false });
      }
      await db.from("admin_sessions")
        .update({ last_seen_at: new Date().toISOString() }).eq("token_hash", hash);
      return J({ valid: true, expiresAt: data.expires_at });
    }

    // ---- admin-only actions ----------------------------------------------
    // Registering a passkey is how someone becomes able to log in forever, so
    // it must never be reachable by an unauthenticated caller. The proxy checks
    // the admin token and sets adminVerified; a live session also qualifies.
    // Checking here too means a bug in the proxy cannot hand away the admin.
    if (ADMIN_ONLY.has(action)) {
      const allowed = body.adminVerified === true || await liveSession(body.session);
      if (!allowed) return J({ error: "admin authentication required" }, 401);
    }

    // ---- enrol-begin ------------------------------------------------------
    if (action === "enrol-begin") {
      // Human-readable, unambiguous alphabet: no O/0 or I/1 to mistype.
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const bytes = crypto.getRandomValues(new Uint8Array(10));
      let code = "";
      for (let i = 0; i < 10; i++) {
        if (i === 5) code += "-";
        code += alphabet[bytes[i] % alphabet.length];
      }
      const expiresAt = new Date(Date.now() + 10 * 60000).toISOString();
      await db.from("admin_enrol_codes").insert({
        code, expires_at: expiresAt, note: String(body.note ?? "").slice(0, 120),
      });
      return J({ ok: true, code, expiresAt });
    }

    if (action === "reg-begin") {
      const rp = rpForOrigin(String(body.origin ?? req.headers.get("origin") ?? "")) ?? DEFAULT_RP;
      const challenge = await newChallenge("register");
      return J({ challenge, rpId: rp });
    }

    if (action === "reg-finish") {
      const { credentialId, clientDataJSON, publicKeySpki, alg, label } = body;
      if (!credentialId || !clientDataJSON || !publicKeySpki || typeof alg !== "number") {
        return J({ error: "credentialId, clientDataJSON, publicKeySpki and alg are required" }, 400);
      }
      const cd = parseClientData(clientDataJSON);
      if (cd.type !== "webauthn.create") return J({ error: "wrong ceremony type" }, 400);
      const rp = rpForOrigin(cd.origin);
      if (!rp) return J({ error: "origin not allowed: " + cd.origin }, 400);
      if (!(await consumeChallenge(cd.challenge, "register"))) {
        return J({ error: "challenge unknown, already used, or expired" }, 400);
      }
      if (alg !== -7 && alg !== -257) return J({ error: "unsupported key algorithm " + alg }, 400);

      // Reject a key the runtime cannot actually import, rather than storing
      // something that only fails later at login.
      try {
        const spki = b64uToBytes(publicKeySpki);
        if (alg === -7) {
          await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
        } else {
          await crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
        }
      } catch (e) {
        return J({ error: "public key could not be imported: " + String(e) }, 400);
      }

      const { data, error } = await db.from("admin_passkeys").upsert({
        credential_id: credentialId,
        public_key_jwk: { spki: publicKeySpki },
        alg,
        rp_id: rp,
        label: (label || "Unnamed device").toString().slice(0, 60),
        sign_count: 0,
      }, { onConflict: "credential_id" }).select().single();
      if (error) return J({ error: error.message }, 500);

      return J({ ok: true, id: data.id, label: data.label, rpId: rp });
    }

    // ---- list / revoke ----------------------------------------------------
    if (action === "list-keys") {
      const { data } = await db.from("admin_passkeys")
        .select("id,label,rp_id,created_at,last_used_at").order("created_at");
      return J({ keys: data ?? [] });
    }

    if (action === "revoke-key") {
      if (!body.id) return J({ error: "id required" }, 400);
      const { data: target } = await db.from("admin_passkeys")
        .select("rp_id").eq("id", body.id).maybeSingle();
      if (!target) return J({ error: "no such key" }, 404);
      // Count within the same domain: removing the last hoku key locks hoku out
      // even if bestly.tech still has two of its own.
      const { count } = await db.from("admin_passkeys")
        .select("id", { count: "exact", head: true })
        .eq("rp_id", target.rp_id ?? DEFAULT_RP);
      if ((count ?? 0) <= 1) {
        return J({ error: "that is the only passkey for this site — add another before removing it" }, 409);
      }
      const { error } = await db.from("admin_passkeys").delete().eq("id", body.id);
      if (error) return J({ error: error.message }, 500);
      return J({ ok: true });
    }

    if (action === "sign-out") {
      if (body.session) {
        const hash = bytesToB64u(await sha256(new TextEncoder().encode(String(body.session))));
        await db.from("admin_sessions").delete().eq("token_hash", hash);
      }
      return J({ ok: true });
    }

    return J({ error: "unknown action" }, 400);
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});
