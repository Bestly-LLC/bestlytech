/**
 * Passkeys, shared by the admin console and the partner portal.
 *
 * Face ID / Touch ID / Windows Hello instead of a password. The WebAuthn ceremony happens in the
 * browser; the two edge functions hold the challenge and the public key. Nothing secret is stored
 * here and nothing is typed by the person.
 */
import { supabase } from "@/integrations/supabase/client";

export const passkeysSupported = () =>
  typeof window !== "undefined" && !!window.PublicKeyCredential && !!navigator.credentials;

const toB64 = (b: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
const fromB64 = (s: string) => {
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b.length % 4 === 0 ? "" : "=".repeat(4 - (b.length % 4));
  return Uint8Array.from(atob(b + pad), (c) => c.charCodeAt(0)).buffer;
};
const why = (res: { error?: unknown; data?: unknown }, fallback: string) =>
  (res.data as { error?: string } | null)?.error ?? (res.error as { message?: string } | null)?.message ?? fallback;

/** Add a passkey to the signed-in account. Returns null on success, or a message to show. */
export async function addPasskey(): Promise<string | null> {
  if (!passkeysSupported()) return "This browser can't do passkeys.";
  const opt = await supabase.functions.invoke("webauthn-register", {
    body: { action: "options", origin: window.location.origin },
  });
  if (opt.error || (opt.data as any)?.error) return why(opt, "Couldn't start.");
  const o = opt.data as any;
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
        excludeCredentials: (o.excludeCredentials ?? []).map((c: any) => ({ id: fromB64(c.id), type: c.type })),
      },
    })) as PublicKeyCredential;
  } catch { return "cancelled"; }
  if (!credential) return "cancelled";
  const r = credential.response as AuthenticatorAttestationResponse;
  const ver = await supabase.functions.invoke("webauthn-register", {
    body: {
      action: "verify", origin: window.location.origin,
      credential: {
        id: credential.id, rawId: toB64(credential.rawId), type: credential.type,
        authenticatorAttachment: (credential as any).authenticatorAttachment,
        response: { clientDataJSON: toB64(r.clientDataJSON), attestationObject: toB64(r.attestationObject) },
      },
    },
  });
  if (ver.error || (ver.data as any)?.error) return why(ver, "Couldn't save the passkey.");
  return null;
}

/**
 * Sign in with a passkey. With no email the browser offers whichever passkey it has for this site.
 * Returns null on success (a session is set), or a message to show.
 */
export async function signInWithPasskey(email?: string): Promise<string | null> {
  if (!passkeysSupported()) return "This browser can't do passkeys.";
  const opt = await supabase.functions.invoke("webauthn-authenticate", {
    body: { action: "options", origin: window.location.origin, ...(email ? { email } : {}) },
  });
  if (opt.error || (opt.data as any)?.error) return why(opt, "Couldn't start.");
  const o = opt.data as any;
  let assertion: PublicKeyCredential | null;
  try {
    assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: fromB64(o.challenge),
        rpId: o.rpId,
        timeout: o.timeout,
        userVerification: o.userVerification as UserVerificationRequirement,
        allowCredentials: (o.allowCredentials ?? []).map((c: any) => ({ id: fromB64(c.id), type: c.type, transports: c.transports })),
      },
    })) as PublicKeyCredential;
  } catch { return "cancelled"; }
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
  if (ver.error || (ver.data as any)?.error) return why(ver, "That didn't work.");
  const { token_hash } = ver.data as { token_hash: string };
  const { error } = await supabase.auth.verifyOtp({ token_hash, type: "magiclink" });
  return error ? error.message : null;
}

/** How many passkeys this account has (for "you're all set" copy). */
export async function passkeyCount(userId: string) {
  const { count } = await supabase.from("passkey_credentials" as any)
    .select("id", { count: "exact", head: true }).eq("user_id", userId);
  return count ?? 0;
}
