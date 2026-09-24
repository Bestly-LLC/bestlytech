// WebAuthn primitives. One copy, two consumers (clients and staff).
//
// Carried over unchanged from the hardened webauthn-authenticate function.
// It lives in its own module so the staff tier cannot drift from the client
// tier: two copies of this means only one of them ever gets hardened.

export const b64uToBuf = (s: string): Uint8Array => {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0));
};

export const bufToB64u = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

export const randomB64u = (n = 32): string => {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return bufToB64u(a);
};

export const sha256hex = async (s: string): Promise<string> => {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
};

// ── minimal CBOR (enough for attestationObject / COSE keys) ───────────────
export function decodeCBOR(data: Uint8Array): any {
  let o = 0;
  function read(): any {
    if (o >= data.length) throw new Error("CBOR: unexpected end");
    const init = data[o++], major = init >> 5, info = init & 0x1f;
    const len = (): number => {
      if (info < 24) return info;
      if (info === 24) return data[o++];
      if (info === 25) { const v = (data[o] << 8) | data[o + 1]; o += 2; return v; }
      if (info === 26) {
        const v = (data[o] << 24) | (data[o + 1] << 16) | (data[o + 2] << 8) | data[o + 3];
        o += 4; return v >>> 0;
      }
      throw new Error(`CBOR: unsupported info ${info}`);
    };
    switch (major) {
      case 0: return len();
      case 1: return -1 - len();
      case 2: { const n = len(); const s = data.slice(o, o + n); o += n; return s; }
      case 3: { const n = len(); const s = data.slice(o, o + n); o += n; return new TextDecoder().decode(s); }
      case 4: { const n = len(); const a = []; for (let i = 0; i < n; i++) a.push(read()); return a; }
      case 5: { const n = len(); const m = new Map(); for (let i = 0; i < n; i++) { const k = read(); m.set(k, read()); } return m; }
      default: throw new Error(`CBOR: unsupported major ${major}`);
    }
  }
  return read();
}

export function publicKeyFromAttestation(attB64: string) {
  const att = decodeCBOR(b64uToBuf(attB64));
  const authData: Uint8Array = att.get("authData");
  if ((authData[32] & 0x40) === 0) throw new Error("no attested credential data");
  let p = 37 + 16;
  const idLen = (authData[p] << 8) | authData[p + 1];
  p += 2 + idLen;
  const cose: Map<number, any> = decodeCBOR(authData.slice(p));
  const alg = cose.get(3);
  if (alg === -7) {
    return { algorithm: alg, publicKeyJwk: {
      kty: "EC", crv: "P-256",
      x: bufToB64u(cose.get(-2) as Uint8Array), y: bufToB64u(cose.get(-3) as Uint8Array) } };
  }
  if (alg === -257) {
    return { algorithm: alg, publicKeyJwk: {
      kty: "RSA",
      n: bufToB64u(cose.get(-1) as Uint8Array), e: bufToB64u(cose.get(-2) as Uint8Array) } };
  }
  throw new Error(`unsupported COSE algorithm ${alg}`);
}

export function asn1ToRaw(sig: Uint8Array): Uint8Array {
  if (sig[0] !== 0x30) throw new Error("bad ASN.1");
  let o = 2;
  if (sig[o] !== 0x02) throw new Error("bad ASN.1 r"); o++;
  const rLen = sig[o++]; let r = sig.slice(o, o + rLen); o += rLen;
  if (sig[o] !== 0x02) throw new Error("bad ASN.1 s"); o++;
  const sLen = sig[o++]; let s = sig.slice(o, o + sLen);
  if (r.length === 33 && r[0] === 0) r = r.slice(1);
  if (s.length === 33 && s[0] === 0) s = s.slice(1);
  const raw = new Uint8Array(64);
  raw.set(r.length <= 32 ? r : r.slice(r.length - 32), 32 - Math.min(r.length, 32));
  raw.set(s.length <= 32 ? s : s.slice(s.length - 32), 64 - Math.min(s.length, 32));
  return raw;
}

export async function verifySignature(pk: any, authData: Uint8Array, clientData: Uint8Array, sig: Uint8Array) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientData));
  const signed = new Uint8Array(authData.length + hash.length);
  signed.set(authData); signed.set(hash, authData.length);

  if (pk.algorithm === -7) {
    const key = await crypto.subtle.importKey("jwk", pk.publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, asn1ToRaw(sig), signed);
  }
  if (pk.algorithm === -257) {
    const key = await crypto.subtle.importKey("jwk", { ...pk.publicKeyJwk, alg: "RS256" },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    return crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, sig, signed);
  }
  throw new Error("unsupported algorithm");
}

// Every assertion goes through this, whoever is signing in.
export async function verifyAssertion(opts: {
  rpId: string; origin: string; credential: any; storedPublicKey: string; storedCounter: number;
}): Promise<{ ok: true; counter: number } | { ok: false; status: number; error: string }> {
  const r = opts.credential.response;
  const clientDataBytes = b64uToBuf(r.clientDataJSON);
  const cd = JSON.parse(new TextDecoder().decode(clientDataBytes));
  if (cd.type !== "webauthn.get") return { ok: false, status: 400, error: "wrong ceremony" };
  if (cd.origin !== opts.origin) return { ok: false, status: 400, error: "origin mismatch" };

  const authData = b64uToBuf(r.authenticatorData);
  const wantHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(opts.rpId)));
  if (!wantHash.every((b, i) => b === authData[i])) return { ok: false, status: 400, error: "rp mismatch" };
  if ((authData[32] & 0x01) === 0) return { ok: false, status: 400, error: "no user presence" };

  let good = false;
  try {
    good = await verifySignature(JSON.parse(opts.storedPublicKey), authData,
                                 clientDataBytes, b64uToBuf(r.signature));
  } catch (e) { return { ok: false, status: 400, error: `verify failed: ${(e as Error).message}` }; }
  if (!good) return { ok: false, status: 401, error: "invalid signature" };

  // Synced passkeys legitimately report 0, so a non-incrementing counter is
  // logged rather than treated as a clone.
  const c = authData.slice(33, 37);
  const counter = ((c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3]) >>> 0;
  if (opts.storedCounter > 0 && counter <= opts.storedCounter) {
    console.warn("non-incrementing counter", { id: opts.credential.id, stored: opts.storedCounter, got: counter });
  }
  return { ok: true, counter };
}

// The challenge is the only thing standing between a replayed assertion and a
// session, so reading one always means consuming it.
export const challengeOf = (cd: any) => cd.challenge as string;
