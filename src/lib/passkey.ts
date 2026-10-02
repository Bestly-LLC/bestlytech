/**
 * Passkeys, shared by the admin console and the partner portal.
 *
 * Face ID / Touch ID / Windows Hello instead of a password. The WebAuthn ceremony happens in the
 * browser; the two edge functions hold the challenge and the public key. Nothing secret is stored
 * here and nothing is typed by the person.
 *
 * Contract for the two ceremonies below: they resolve to `null` on success or a message to show
 * the person — except the literal `"cancelled"`, which means the person dismissed the browser
 * prompt and callers should stay quiet. Neither of them throws; every failure comes back as a
 * string.
 */
import { supabase } from "@/integrations/supabase/client";

/** Which authenticator the browser should prefer: the built-in one or a security key. */
export type PasskeyKind = "platform" | "cross-platform";

/** Business errors ride along in the response body, even on a 200. */
type ErrorBody = { error?: string };

/** What the register edge function answers before the browser prompt fires. */
type RegisterStart = {
  challenge: string;
  rp: { name: string; id?: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: PublicKeyCredentialParameters[];
  timeout?: number;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: AttestationConveyancePreference;
  excludeCredentials?: { id: string; type: "public-key" }[];
};

/** What the authenticate edge function answers before the browser prompt fires. */
type AuthStart = {
  challenge: string;
  rpId: string;
  timeout?: number;
  userVerification?: UserVerificationRequirement;
  allowCredentials?: { id: string; type: "public-key"; transports?: string[] }[];
};

export const passkeysSupported = () =>
  typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

const toB64 = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
const fromB64 = (s: string) => {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b.length % 4 === 0 ? "" : "=".repeat(4 - (b.length % 4));
  return Uint8Array.from(atob(b + pad), (c) => c.charCodeAt(0)).buffer;
};

/**
 * The server's message out of an invoke result. Business errors arrive as `data.error` on a 200,
 * but webauthn-register answers 400/401 and supabase-js parks those bodies on `error.context`.
 */
async function why(res: { error?: unknown; data?: unknown }, fallback: string): Promise<string> {
  const data = res.data as { error?: string } | null | undefined;
  if (data?.error) return String(data.error);
  const err = res.error as { message?: string; context?: Response } | null | undefined;
  if (err) {
    const ctx = err.context;
    if (ctx && typeof ctx.clone === "function") {
      try {
        const body = (await ctx.clone().json()) as { error?: string };
        if (body?.error) {
          console.error("passkey:", body.error);
          return String(body.error);
        }
      } catch { /* body wasn't JSON */ }
    }
    console.error("passkey:", err.message);
    return err.message || fallback;
  }
  return fallback;
}

/** A thrown credential-prompt error, flattened onto the string contract above. */
function promptProblem(err: unknown, fallback: string): string {
  if (err instanceof DOMException) {
    if (err.name === "NotAllowedError" || err.name === "AbortError") return "cancelled";
    if (err.name === "InvalidStateError") return "This device is already registered.";
    return err.message || fallback;
  }
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Add a passkey to the signed-in account. `keyType` is echoed to the edge function on both the
 * options and verify calls so a security key gets the right authenticatorSelection.
 */
export async function addPasskey(opts?: { keyType?: PasskeyKind }): Promise<string | null> {
  if (!passkeysSupported()) return "This browser can't do passkeys.";
  const keyType = opts?.keyType ? { keyType: opts.keyType } : {};
  try {
    const opt = await supabase.functions.invoke("webauthn-register", {
      body: { action: "options", origin: window.location.origin, ...keyType },
    });
    if (opt.error || (opt.data as ErrorBody | null)?.error) {
      return `Couldn't start registration: ${await why(opt, "no response from the server")}`;
    }
    const o = opt.data as RegisterStart;
    let credential: PublicKeyCredential | null;
    try {
      credential = (await navigator.credentials.create({
        publicKey: {
          rp: o.rp,
          user: { id: fromB64(o.user.id), name: o.user.name, displayName: o.user.displayName },
          challenge: fromB64(o.challenge),
          pubKeyCredParams: o.pubKeyCredParams,
          timeout: o.timeout,
          authenticatorSelection: o.authenticatorSelection,
          attestation: o.attestation,
          excludeCredentials: (o.excludeCredentials ?? []).map((c) => ({ id: fromB64(c.id), type: c.type })),
        },
      })) as PublicKeyCredential;
    } catch (err) {
      return promptProblem(err, "Couldn't register the passkey.");
    }
    if (!credential) return "cancelled";
    const r = credential.response as AuthenticatorAttestationResponse;
    const ver = await supabase.functions.invoke("webauthn-register", {
      body: {
        action: "verify", origin: window.location.origin, ...keyType,
        credential: {
          id: credential.id, rawId: toB64(credential.rawId), type: credential.type,
          credentialAuthenticatorAttachment: credential.authenticatorAttachment,
          response: { clientDataJSON: toB64(r.clientDataJSON), attestationObject: toB64(r.attestationObject) },
        },
      },
    });
    if (ver.error || (ver.data as ErrorBody | null)?.error) {
      return `Registration failed: ${await why(ver, "the server rejected the credential")}`;
    }
    return null;
  } catch (err) {
    return promptProblem(err, "Couldn't register the passkey.");
  }
}

/**
 * Sign in with a passkey. With no email the browser offers whichever passkey it has for this site.
 * Server messages come back untouched on purpose: the partner portal matches on their prefix.
 */
export async function signInWithPasskey(email?: string): Promise<string | null> {
  if (!passkeysSupported()) return "This browser can't do passkeys.";
  try {
    const opt = await supabase.functions.invoke("webauthn-authenticate", {
      body: { action: "options", origin: window.location.origin, ...(email ? { email } : {}) },
    });
    if (opt.error || (opt.data as ErrorBody | null)?.error) return await why(opt, "Couldn't start.");
    const o = opt.data as AuthStart;
    let assertion: PublicKeyCredential | null;
    try {
      assertion = (await navigator.credentials.get({
        publicKey: {
          challenge: fromB64(o.challenge),
          rpId: o.rpId,
          timeout: o.timeout,
          userVerification: o.userVerification,
          allowCredentials: (o.allowCredentials ?? []).map((c) => ({
            id: fromB64(c.id),
            type: c.type,
            transports: c.transports as AuthenticatorTransport[] | undefined,
          })),
        },
      })) as PublicKeyCredential;
    } catch (err) {
      return promptProblem(err, "That didn't work.");
    }
    if (!assertion) return "cancelled";
    const r = assertion.response as AuthenticatorAssertionResponse;
    const ver = await supabase.functions.invoke("webauthn-authenticate", {
      body: {
        action: "verify", origin: window.location.origin,
        credential: {
          id: assertion.id, rawId: toB64(assertion.rawId), type: assertion.type,
          response: {
            clientDataJSON: toB64(r.clientDataJSON),
            authenticatorData: toB64(r.authenticatorData),
            signature: toB64(r.signature),
            userHandle: r.userHandle ? toB64(r.userHandle) : null,
          },
        },
      },
    });
    if (ver.error || (ver.data as ErrorBody | null)?.error) return await why(ver, "That didn't work.");
    const { token_hash } = ver.data as { token_hash: string };
    const { error } = await supabase.auth.verifyOtp({ token_hash, type: "magiclink" });
    return error ? error.message : null;
  } catch (err) {
    return promptProblem(err, "That didn't work.");
  }
}

/** How many passkeys this account has (for "you're all set" copy). */
export async function passkeyCount(userId: string) {
  const { count } = await supabase.from("passkey_credentials")
    .select("id", { count: "exact", head: true }).eq("user_id", userId);
  return count ?? 0;
}
