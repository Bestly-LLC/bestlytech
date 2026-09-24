import { createClient } from "jsr:@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SB_PUBLISHABLE: string = __keys("SUPABASE_PUBLISHABLE_KEYS") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function generateChallenge(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64urlToBuffer(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = base64.length % 4 === 0 ? "" : "=".repeat(4 - (base64.length % 4));
  const binary = atob(base64 + pad);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function bufferToBase64url(buffer: Uint8Array): string {
  return btoa(String.fromCharCode(...buffer))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

const RP_NAME = "Bestly Admin";

function getRpId(origin: string): string {
  try {
    const url = new URL(origin);
    return url.hostname;
  } catch {
    return "localhost";
  }
}

// ---- Minimal CBOR decoder (enough for attestationObject) ----
function decodeCBOR(data: Uint8Array): any {
  let offset = 0;

  function read(): any {
    if (offset >= data.length) throw new Error("CBOR: unexpected end");
    const initial = data[offset++];
    const majorType = initial >> 5;
    const additionalInfo = initial & 0x1f;

    function readLength(): number {
      if (additionalInfo < 24) return additionalInfo;
      if (additionalInfo === 24) return data[offset++];
      if (additionalInfo === 25) {
        const v = (data[offset] << 8) | data[offset + 1];
        offset += 2;
        return v;
      }
      if (additionalInfo === 26) {
        const v = (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
        offset += 4;
        return v >>> 0;
      }
      throw new Error(`CBOR: unsupported additional info ${additionalInfo}`);
    }

    switch (majorType) {
      case 0: return readLength(); // unsigned int
      case 1: return -1 - readLength(); // negative int
      case 2: { // byte string
        const len = readLength();
        const slice = data.slice(offset, offset + len);
        offset += len;
        return slice;
      }
      case 3: { // text string
        const len = readLength();
        const slice = data.slice(offset, offset + len);
        offset += len;
        return new TextDecoder().decode(slice);
      }
      case 4: { // array
        const len = readLength();
        const arr = [];
        for (let i = 0; i < len; i++) arr.push(read());
        return arr;
      }
      case 5: { // map
        const len = readLength();
        const map = new Map();
        for (let i = 0; i < len; i++) {
          const key = read();
          const value = read();
          map.set(key, value);
        }
        return map;
      }
      default:
        throw new Error(`CBOR: unsupported major type ${majorType}`);
    }
  }

  return read();
}

// Extract the raw COSE public key bytes from attestationObject
// Returns the JWK-importable {x, y} for ES256 or the raw spki for RS256
function extractPublicKeyFromAttestation(attestationObjectB64: string): {
  publicKeyJwk: JsonWebKey;
  algorithm: number;
} {
  const attObj = decodeCBOR(base64urlToBuffer(attestationObjectB64));
  const authData: Uint8Array = attObj.get("authData");
  const flags = authData[32];
  const hasAttestedCredentialData = (flags & 0x40) !== 0;
  if (!hasAttestedCredentialData) {
    throw new Error("No attested credential data in authData");
  }

  let pos = 37;
  pos += 16;
  const credIdLen = (authData[pos] << 8) | authData[pos + 1];
  pos += 2;
  pos += credIdLen;
  const coseKeyBytes = authData.slice(pos);
  const coseKey: Map<number, any> = decodeCBOR(coseKeyBytes);

  const alg = coseKey.get(3);

  if (alg === -7) {
    const x = coseKey.get(-2) as Uint8Array;
    const y = coseKey.get(-3) as Uint8Array;
    return {
      algorithm: alg,
      publicKeyJwk: {
        kty: "EC",
        crv: "P-256",
        x: bufferToBase64url(x),
        y: bufferToBase64url(y),
      },
    };
  } else if (alg === -257) {
    const n = coseKey.get(-1) as Uint8Array;
    const e = coseKey.get(-2) as Uint8Array;
    return {
      algorithm: alg,
      publicKeyJwk: {
        kty: "RSA",
        n: bufferToBase64url(n),
        e: bufferToBase64url(e),
      },
    };
  }

  throw new Error(`Unsupported COSE algorithm: ${alg}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      SB_SECRET
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      SB_PUBLISHABLE,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: claimsData, error: claimsError } = await supabaseUser.auth.getUser();
    if (claimsError || !claimsData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const user = claimsData.user;
    const { action, origin: clientOrigin, keyType, ...body } = await req.json();
    const rpId = getRpId(clientOrigin || req.headers.get("origin") || "https://localhost");

    if (action === "options") {
      const challenge = generateChallenge();

      await supabaseAdmin.from("webauthn_challenges").insert({
        user_id: user.id,
        challenge,
        type: "registration",
        email: user.email,
      });

      const { data: existingCreds } = await supabaseAdmin
        .from("passkey_credentials")
        .select("credential_id")
        .eq("user_id", user.id);

      const isCrossPlatform = keyType === "cross-platform";

      const options = {
        rp: { name: RP_NAME, id: rpId },
        user: {
          id: bufferToBase64url(new TextEncoder().encode(user.id)),
          name: user.email,
          displayName: user.email?.split("@")[0] || "Admin",
        },
        challenge,
        pubKeyCredParams: [
          { alg: -7, type: "public-key" },
          { alg: -257, type: "public-key" },
        ],
        timeout: 60000,
        authenticatorSelection: {
          ...(isCrossPlatform ? {} : { authenticatorAttachment: "platform" }),
          residentKey: "preferred",
          userVerification: "preferred",
        },
        attestation: "none",
        excludeCredentials: (existingCreds || []).map((c) => ({
          id: c.credential_id,
          type: "public-key",
        })),
      };

      return new Response(JSON.stringify(options), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify") {
      const { credential } = body;

      const { data: challenges } = await supabaseAdmin
        .from("webauthn_challenges")
        .select("*")
        .eq("user_id", user.id)
        .eq("type", "registration")
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1);

      if (!challenges || challenges.length === 0) {
        return new Response(JSON.stringify({ error: "Challenge expired or not found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { id: credentialId, response: credResponse, type: credType } = credential;

      if (credType !== "public-key") {
        return new Response(JSON.stringify({ error: "Invalid credential type" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const clientDataJSON = JSON.parse(
        new TextDecoder().decode(base64urlToBuffer(credResponse.clientDataJSON))
      );

      if (clientDataJSON.type !== "webauthn.create") {
        return new Response(JSON.stringify({ error: "Invalid ceremony type" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (clientDataJSON.challenge !== challenges[0].challenge) {
        return new Response(JSON.stringify({ error: "Challenge mismatch" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // SEC-03: Verify origin. Previously a mismatch only logged a warning,
      // which let an attacker register a passkey from a malicious origin
      // and authenticate from the legitimate one. Now a mismatch hard-rejects.
      const expectedOrigin = clientOrigin || req.headers.get("origin");
      if (expectedOrigin && clientDataJSON.origin !== expectedOrigin) {
        console.warn(`Origin mismatch: expected ${expectedOrigin}, got ${clientDataJSON.origin}`);
        return new Response(JSON.stringify({ error: "Origin mismatch" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let publicKeyData: { publicKeyJwk: JsonWebKey; algorithm: number };
      try {
        publicKeyData = extractPublicKeyFromAttestation(credResponse.attestationObject);
      } catch (err) {
        console.error("Failed to extract public key:", err);
        return new Response(JSON.stringify({ error: "Failed to parse credential public key" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const detectedType = credential.authenticatorAttachment || (keyType === "cross-platform" ? "cross-platform" : "platform");
      const deviceName = detectedType === "cross-platform" ? "Security Key" : "Platform Passkey";

      const { error: insertError } = await supabaseAdmin
        .from("passkey_credentials")
        .insert({
          user_id: user.id,
          credential_id: credentialId,
          public_key: JSON.stringify(publicKeyData),
          counter: 0,
          device_type: detectedType,
          device_name: deviceName,
          transports: credResponse.getTransports?.() || ["internal"],
        });

      if (insertError) {
        console.error("Insert error:", insertError);
        return new Response(JSON.stringify({ error: "Failed to store credential" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await supabaseAdmin
        .from("webauthn_challenges")
        .delete()
        .eq("user_id", user.id)
        .eq("type", "registration");

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("WebAuthn register error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
