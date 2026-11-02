// Family Cookbook: Face ID is the way in. The one-time link is only how a new phone proves who it is the first
// time; the moment it has, that phone keeps a passkey and never asks for anything again.
// Nothing secret lives on the phone or on our side: the passkey signs a challenge, we check the signature.

import { fn, getToken } from "./api";

const b64url = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s: string) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};

/** Face ID, Touch ID or the phone's own passcode. Every iPhone and iPad in this family has it; old browsers do not. */
export const canPasskey = () => typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined" && !!navigator.credentials;

const PK_SET = "fc_pk";
export const hasPasskeyHere = () => { try { return !!localStorage.getItem(PK_SET); } catch { return false; } };
const rememberPasskeyHere = () => { try { localStorage.setItem(PK_SET, "1"); } catch { /* private window: it will offer again */ } };

/** The person cancelled or the phone would not play along. Not an error worth shouting about. */
export class PasskeyOff extends Error {}

/** Add this phone. Needs a session already (a link, or a passkey on another phone). */
export async function addPasskey(): Promise<void> {
  const o = await fn<{ challenge: string; rpId: string; rpName: string; userId: string; userName: string; userDisplayName: string; exclude: string[]; label: string }>(
    "family-auth", { op: "passkey_new", token: getToken() });
  let cred: PublicKeyCredential | null;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        challenge: unb64url(o.challenge),
        rp: { id: o.rpId, name: o.rpName },
        user: { id: unb64url(o.userId), name: o.userName, displayName: o.userDisplayName },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        authenticatorSelection: { residentKey: "required", userVerification: "required" },
        excludeCredentials: (o.exclude || []).map((id) => ({ type: "public-key" as const, id: unb64url(id) })),
        attestation: "none",
        timeout: 120_000,
      },
    }) as PublicKeyCredential | null;
  } catch { throw new PasskeyOff(); }
  if (!cred) throw new PasskeyOff();
  const r = cred.response as AuthenticatorAttestationResponse;
  const pk = r.getPublicKey && r.getPublicKey();
  const alg = r.getPublicKeyAlgorithm && r.getPublicKeyAlgorithm();
  if (!pk || alg == null) throw new Error("This phone's passkey is in a shape we cannot read.");
  await fn("family-auth", { op: "passkey_save", token: getToken(), id: cred.id, publicKey: b64url(pk), alg, clientDataJSON: b64url(r.clientDataJSON), label: o.label });
  rememberPasskeyHere();
}

/** Sign in. The passkey says who it is, so there is nothing to type and nothing to pick. */
export async function signInWithPasskey(): Promise<{ token: string; me: unknown }> {
  const o = await fn<{ challenge: string; rpId: string }>("family-auth", { op: "passkey_start" });
  let cred: PublicKeyCredential | null;
  try {
    cred = await navigator.credentials.get({
      publicKey: { challenge: unb64url(o.challenge), rpId: o.rpId, userVerification: "required", timeout: 120_000 },
    }) as PublicKeyCredential | null;
  } catch { throw new PasskeyOff(); }
  if (!cred) throw new PasskeyOff();
  const r = cred.response as AuthenticatorAssertionResponse;
  const out = await fn<{ token: string; me: unknown }>("family-auth", {
    op: "passkey_finish", id: cred.id,
    authenticatorData: b64url(r.authenticatorData), clientDataJSON: b64url(r.clientDataJSON), signature: b64url(r.signature),
  });
  rememberPasskeyHere();
  return out;
}
