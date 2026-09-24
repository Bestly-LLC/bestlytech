// review-auth — passkeys for the approval board.
//
// Two tiers, one ceremony. Elizabeth signs in as a client and sees her own
// board; Jared and Eli sign in as staff and see the studio. Neither tier can
// reach the other's data, and both go through the single verification path in
// ./webauthn.ts — a second copy of that code is how you end up hardening only
// one of them.
//
// The reviewer never makes an account. The emailed link is her enrolment
// ticket and her permanent recovery path. Staff have no such link, so first
// enrolment uses a code minted by hand — good for a handful of browsers until
// it expires, because one person signs in from more than one of them. Once
// somebody IS signed in, adding another passkey needs no code at all: the
// session is the proof.
//
// rpId comes from a server-side allowlist, never from the request body. A
// caller-supplied rpId lets an attacker verify an assertion against a domain
// they control.

import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  b64uToBuf, bufToB64u, randomB64u, sha256hex,
  publicKeyFromAttestation, verifyAssertion,
} from "./webauthn.ts";
// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const ORIGINS: Record<string, string> = {
  "https://studio.bestly.tech": "studio.bestly.tech",
  "https://review.bestly.tech": "review.bestly.tech",   // old host; redirects, kept during the switch
  "http://localhost:8080": "localhost",
};
const RP_NAME = "Bestly Studio";
const SESSION_DAYS = 30;
// Deliberately shorter than the client's: a staff session can promote content.
const STAFF_SESSION_DAYS = 14;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
};
const J = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  SB_SECRET,
  { auth: { persistSession: false } },
);

const PUBKEY_PARAMS = [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }];
const RESIDENT = { residentKey: "required", requireResidentKey: true, userVerification: "preferred" };

/* "not valid, or it has expired" covered five different situations and helped
   with none of them. Say which one it is. */
async function enrollWhy(db: any, slug: string, code: string): Promise<string> {
  let why = "";
  try { const { data } = await db.rpc("studio_enroll_code_why", { p_slug: slug, p_code: code }); why = String(data ?? ""); }
  catch { /* fall through to the old wording */ }
  switch (why) {
    case "no_such_staff": return `There is no staff account called "${slug}". Check the name in your setup email.`;
    case "inactive":      return "That account is switched off. Ask Jared to turn it back on.";
    case "no_code":       return "There is no setup code waiting for you. Ask for a new setup email.";
    case "wrong_code":    return "That code does not match. Copy it straight from the email — case does not matter but every character does.";
    case "expired":       return "That code has expired. Ask for a new setup email.";
    case "used_up":       return "That code has already set up as many browsers as it allows. Ask for a new setup email.";
    default:              return "That code is not valid, or it has expired.";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const body = await req.json().catch(() => ({}));
    const { action, token, credential } = body as Record<string, any>;

    const origin = req.headers.get("origin") ?? "";
    const rpId = ORIGINS[origin];
    if (!rpId) return J({ error: "origin not allowed" }, 403);

    const resolve = async (t: string) => {
      const { data } = await db.rpc("approval_resolve_client", { p_token: t });
      return data?.id ? data : null;
    };
    const staffFromSession = async (t: string) => {
      const { data } = await db.rpc("studio_resolve_staff", { p_token: String(t ?? "") });
      const s = Array.isArray(data) ? data[0] : data;
      return s?.id ? s : null;
    };
    // An insert that fails quietly here looks exactly like an expired
    // challenge three steps later, so this one is allowed to be loud.
    const putChallenge = async (row: Record<string, unknown>) => {
      const { error } = await db.from("client_webauthn_challenges").insert(row);
      if (error) throw new Error(`challenge insert failed: ${error.message}`);
    };
    const takeChallenge = async (kind: string, challenge: string, col?: string, val?: string) => {
      let q = db.from("client_webauthn_challenges").select("*")
        .eq("kind", kind).eq("challenge", challenge)
        .gt("expires_at", new Date().toISOString());
      if (col) q = q.eq(col, val!);
      const { data } = await q.maybeSingle();
      return data;
    };
    const clientDataOf = (c: any) =>
      JSON.parse(new TextDecoder().decode(b64uToBuf(c.response.clientDataJSON)));

    // ══ client ═════════════════════════════════════════════════════════════

    if (action === "enroll_options") {
      const client = await resolve(String(token ?? ""));
      if (!client) return J({ error: "unauthorized" }, 401);

      const challenge = randomB64u();
      await putChallenge({ challenge, kind: "enroll", client_slug: client.slug });

      return J({
        rp: { name: RP_NAME, id: rpId },
        user: {
          id: bufToB64u(new TextEncoder().encode(client.slug)),
          name: client.name,
          displayName: client.name,
        },
        challenge,
        pubKeyCredParams: PUBKEY_PARAMS,
        timeout: 60000,
        authenticatorSelection: RESIDENT,
        attestation: "none",
        // no exclusions here either: a second passkey somewhere else is the point
      });
    }

    if (action === "enroll_verify") {
      const client = await resolve(String(token ?? ""));
      if (!client) return J({ error: "unauthorized" }, 401);
      if (!credential?.response) return J({ error: "no credential" }, 400);

      const cd = clientDataOf(credential);
      if (cd.type !== "webauthn.create") return J({ error: "wrong ceremony" }, 400);
      if (cd.origin !== origin) return J({ error: "origin mismatch" }, 400);

      const ch = await takeChallenge("enroll", cd.challenge, "client_slug", client.slug);
      if (!ch) return J({ error: "challenge expired" }, 400);

      let pk;
      try { pk = publicKeyFromAttestation(credential.response.attestationObject); }
      catch (e) { return J({ error: `bad credential: ${(e as Error).message}` }, 400); }

      const { error } = await db.from("client_passkeys").insert({
        client_slug: client.slug,
        credential_id: credential.id,
        public_key: JSON.stringify(pk),
        counter: 0,
        device_name: String(body.deviceName ?? "This device").slice(0, 60),
        transports: credential.response.transports ?? ["internal"],
      });
      if (error) return J({ error: error.message }, 500);

      await db.from("client_webauthn_challenges").delete().eq("id", ch.id);
      const { count } = await db.from("client_passkeys")
        .select("id", { count: "exact", head: true }).eq("client_slug", client.slug);
      return J({ ok: true, passkeys: count ?? 1 });
    }

    if (action === "client_passkey_count") {
      const client = await resolve(String(token ?? ""));
      if (!client) return J({ error: "unauthorized" }, 401);
      const { data } = await db.from("client_passkeys")
        .select("id,device_name,transports,created_at,last_used_at").eq("client_slug", client.slug);
      return J({ ok: true, passkeys: data ?? [] });
    }

    if (action === "login_options") {
      const challenge = randomB64u();
      await putChallenge({ challenge, kind: "login" });
      return J({ rpId, challenge, timeout: 60000, userVerification: "preferred", allowCredentials: [] });
    }

    if (action === "login_verify") {
      if (!credential?.response) return J({ error: "no credential" }, 400);

      const { data: cred } = await db.from("client_passkeys")
        .select("*").eq("credential_id", credential.id).maybeSingle();
      if (!cred) {
        const { data: asStaff } = await db.from("staff_passkeys")
          .select("id").eq("credential_id", credential.id).maybeSingle();
        if (asStaff) return J({ error: "That is a Bestly staff passkey. Use the studio sign-in." }, 401);
        return J({ error: "unknown passkey" }, 401);
      }

      const cd = clientDataOf(credential);
      const ch = await takeChallenge("login", cd.challenge);
      if (!ch) return J({ error: "challenge expired" }, 400);

      const v = await verifyAssertion({
        rpId, origin, credential,
        storedPublicKey: cred.public_key, storedCounter: cred.counter,
      });
      if (!v.ok) return J({ error: v.error }, v.status);

      const session = randomB64u(32);
      const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
      const { error: sErr } = await db.from("client_sessions").insert({
        token_hash: await sha256hex(session),
        client_slug: cred.client_slug,
        passkey_id: cred.id,
        expires_at: expires,
      });
      if (sErr) return J({ error: sErr.message }, 500);

      await db.from("client_passkeys")
        .update({ counter: Math.max(v.counter, cred.counter), last_used_at: new Date().toISOString() })
        .eq("id", cred.id);
      await db.from("client_webauthn_challenges").delete().eq("id", ch.id);
      await db.from("client_sessions").delete().lt("expires_at", new Date().toISOString());

      return J({ ok: true, session, expires_at: expires, client: cred.client_slug });
    }

    // ══ staff ══════════════════════════════════════════════════════════════

    if (action === "staff_enroll_options") {
      const slug = String(body.staffSlug ?? "").trim().toLowerCase();
      const code = String(body.code ?? "").trim().toLowerCase();
      const { data: valid } = await db.rpc("studio_check_enroll_code", { p_slug: slug, p_code: code });
      if (!valid) return J({ error: await enrollWhy(db, slug, code) }, 401);

      const { data: staff } = await db.from("approval_staff")
        .select("id,slug,name").eq("slug", slug).maybeSingle();
      if (!staff) return J({ error: "unauthorized" }, 401);

      const challenge = randomB64u();
      await putChallenge({ challenge, kind: "staff_enroll", staff_slug: slug });

      return J({
        rp: { name: RP_NAME, id: rpId },
        user: {
          // namespaced so a staff credential can never collide with a client one
          id: bufToB64u(new TextEncoder().encode("staff:" + staff.slug)),
          name: `${staff.name} (Bestly staff)`,
          displayName: staff.name,
        },
        challenge,
        pubKeyCredParams: PUBKEY_PARAMS,
        timeout: 60000,
        authenticatorSelection: RESIDENT,
        attestation: "none",
        // Deliberately NOT excluding the credentials already on file. A passkey
        // saved in Chrome's own profile is invisible to Safari, and one saved
        // to iCloud Keychain is visible to both — excluding made the second
        // browser refuse with a browser-level error nobody could act on. An
        // extra row here is cheap; sign-in is discoverable and takes any of them.
      });
    }

    if (action === "staff_enroll_verify") {
      const slug = String(body.staffSlug ?? "").trim().toLowerCase();
      const code = String(body.code ?? "").trim().toLowerCase();
      if (!credential?.response) return J({ error: "no credential" }, 400);

      const cd = clientDataOf(credential);
      if (cd.type !== "webauthn.create") return J({ error: "wrong ceremony" }, 400);
      if (cd.origin !== origin) return J({ error: "origin mismatch" }, 400);

      const ch = await takeChallenge("staff_enroll", cd.challenge, "staff_slug", slug);
      if (!ch) return J({ error: "challenge expired" }, 400);

      let pk;
      try { pk = publicKeyFromAttestation(credential.response.attestationObject); }
      catch (e) { return J({ error: `bad credential: ${(e as Error).message}` }, 400); }

      // Consumed only now that a credential actually exists, so a cancelled
      // Face ID prompt does not burn the code.
      const { data: staff } = await db.rpc("studio_consume_enroll_code", { p_slug: slug, p_code: code });
      if (!staff?.id) return J({ error: await enrollWhy(db, slug, code) }, 401);

      const { error } = await db.from("staff_passkeys").insert({
        staff_id: staff.id,
        credential_id: credential.id,
        public_key: JSON.stringify(pk),
        counter: 0,
        device_name: String(body.deviceName ?? "This device").slice(0, 60),
        transports: credential.response.transports ?? ["internal"],
      });
      if (error) return J({ error: error.message }, 500);

      await db.from("client_webauthn_challenges").delete().eq("id", ch.id);
      return J({ ok: true, name: staff.name });
    }

    /* Add a passkey while already signed in. No code, no email — the session
       you are holding is the proof. This is how one person ends up with a
       passkey that works in Safari, in Chrome and on their phone: sign in
       once anywhere, then add one saved to iCloud Keychain. */
    if (action === "staff_add_options") {
      const staff = await staffFromSession(body.session);
      if (!staff) return J({ error: "Sign in first." }, 401);

      const challenge = randomB64u();
      await putChallenge({ challenge, kind: "staff_enroll", staff_slug: staff.slug });

      return J({
        rp: { name: RP_NAME, id: rpId },
        user: {
          id: bufToB64u(new TextEncoder().encode("staff:" + staff.slug)),
          name: `${staff.name} (Bestly staff)`,
          displayName: staff.name,
        },
        challenge,
        pubKeyCredParams: PUBKEY_PARAMS,
        timeout: 60000,
        authenticatorSelection: RESIDENT,
        attestation: "none",
        // no exclusions: the whole point is a second one, somewhere else
      });
    }

    if (action === "staff_add_verify") {
      const staff = await staffFromSession(body.session);
      if (!staff) return J({ error: "Sign in first." }, 401);
      if (!credential?.response) return J({ error: "no credential" }, 400);

      const cd = clientDataOf(credential);
      if (cd.type !== "webauthn.create") return J({ error: "wrong ceremony" }, 400);
      if (cd.origin !== origin) return J({ error: "origin mismatch" }, 400);

      const ch = await takeChallenge("staff_enroll", cd.challenge, "staff_slug", staff.slug);
      if (!ch) return J({ error: "challenge expired" }, 400);

      let pk;
      try { pk = publicKeyFromAttestation(credential.response.attestationObject); }
      catch (e) { return J({ error: `bad credential: ${(e as Error).message}` }, 400); }

      const { error } = await db.from("staff_passkeys").insert({
        staff_id: staff.id,
        credential_id: credential.id,
        public_key: JSON.stringify(pk),
        counter: 0,
        device_name: String(body.deviceName ?? "This device").slice(0, 60),
        transports: credential.response.transports ?? ["internal"],
      });
      if (error) return J({ error: error.message }, 500);

      await db.from("client_webauthn_challenges").delete().eq("id", ch.id);
      const { count } = await db.from("staff_passkeys")
        .select("id", { count: "exact", head: true }).eq("staff_id", staff.id);
      return J({ ok: true, name: staff.name, passkeys: count ?? 1 });
    }

    if (action === "staff_passkey_count") {
      const staff = await staffFromSession(body.session);
      if (!staff) return J({ error: "Sign in first." }, 401);
      const { data } = await db.from("staff_passkeys")
        .select("id,device_name,transports,created_at,last_used_at").eq("staff_id", staff.id);
      return J({ ok: true, passkeys: data ?? [] });
    }

    if (action === "staff_login_options") {
      const challenge = randomB64u();
      await putChallenge({ challenge, kind: "staff_login" });
      return J({ rpId, challenge, timeout: 60000, userVerification: "preferred", allowCredentials: [] });
    }

    if (action === "staff_login_verify") {
      if (!credential?.response) return J({ error: "no credential" }, 400);

      const { data: cred } = await db.from("staff_passkeys")
        .select("*, approval_staff!inner(id,name,slug,active)")
        .eq("credential_id", credential.id).maybeSingle();

      if (!cred) {
        // Offering the client passkey here is a likely mistake, not an attack.
        // Say what happened rather than returning "unknown passkey".
        const { data: asClient } = await db.from("client_passkeys")
          .select("client_slug").eq("credential_id", credential.id).maybeSingle();
        if (asClient) {
          return J({ error: "That is a client review passkey, not a Bestly staff one." }, 401);
        }
        return J({ error: "This device has no Bestly staff passkey yet." }, 401);
      }
      if (!cred.approval_staff?.active) return J({ error: "That staff account is inactive." }, 401);

      const cd = clientDataOf(credential);
      const ch = await takeChallenge("staff_login", cd.challenge);
      if (!ch) return J({ error: "challenge expired" }, 400);

      const v = await verifyAssertion({
        rpId, origin, credential,
        storedPublicKey: cred.public_key, storedCounter: cred.counter,
      });
      if (!v.ok) return J({ error: v.error }, v.status);

      const session = randomB64u(32);
      const { data: expires, error: sErr } = await db.rpc("studio_open_session", {
        p_staff: cred.staff_id,
        p_token_hash: await sha256hex(session),
        p_passkey: cred.id,
        p_days: STAFF_SESSION_DAYS,
      });
      if (sErr) return J({ error: sErr.message }, 500);

      await db.from("staff_passkeys")
        .update({ counter: Math.max(v.counter, cred.counter), last_used_at: new Date().toISOString() })
        .eq("id", cred.id);
      await db.from("client_webauthn_challenges").delete().eq("id", ch.id);

      return J({ ok: true, session, expires_at: expires, staff: cred.approval_staff.name });
    }

    return J({ error: "unknown action" }, 400);
  } catch (e) {
    console.error("review-auth", e);
    return J({ error: (e as Error).message }, 500);
  }
});
