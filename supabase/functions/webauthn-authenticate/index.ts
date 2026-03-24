import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

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

function getRpId(origin: string): string {
  try {
    const url = new URL(origin);
    return url.hostname;
  } catch {
    return "localhost";
  }
}

// Convert ASN.1 DER ECDSA signature to raw r||s format for SubtleCrypto
function asn1ToRaw(sig: Uint8Array): Uint8Array {
  // ASN.1: 0x30 <len> 0x02 <rLen> <r> 0x02 <sLen> <s>
  if (sig[0] !== 0x30) throw new Error("Invalid ASN.1 signature");
  let offset = 2;
  // r
  if (sig[offset] !== 0x02) throw new Error("Invalid ASN.1 r");
  offset++;
  const rLen = sig[offset++];
  let r = sig.slice(offset, offset + rLen);
  offset += rLen;
  // s
  if (sig[offset] !== 0x02) throw new Error("Invalid ASN.1 s");
  offset++;
  const sLen = sig[offset++];
  let s = sig.slice(offset, offset + sLen);

  // Remove leading zero padding
  if (r.length === 33 && r[0] === 0) r = r.slice(1);
  if (s.length === 33 && s[0] === 0) s = s.slice(1);

  // Pad to 32 bytes
  const raw = new Uint8Array(64);
  raw.set(r.length <= 32 ? r : r.slice(r.length - 32), 32 - Math.min(r.length, 32));
  raw.set(s.length <= 32 ? s : s.slice(s.length - 32), 64 - Math.min(s.length, 32));
  return raw;
}

async function verifySignature(
  publicKeyData: { publicKeyJwk: JsonWebKey; algorithm: number },
  authenticatorData: Uint8Array,
  clientDataJSON: Uint8Array,
  signature: Uint8Array
): Promise<boolean> {
  // signedData = authenticatorData || SHA-256(clientDataJSON)
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", clientDataJSON)
  );
  const signedData = new Uint8Array(authenticatorData.length + clientDataHash.length);
  signedData.set(authenticatorData);
  signedData.set(clientDataHash, authenticatorData.length);

  if (publicKeyData.algorithm === -7) {
    // ES256
    const key = await crypto.subtle.importKey(
      "jwk",
      publicKeyData.publicKeyJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"]
    );
    const rawSig = asn1ToRaw(signature);
    return crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      rawSig,
      signedData
    );
  } else if (publicKeyData.algorithm === -257) {
    // RS256
    const key = await crypto.subtle.importKey(
      "jwk",
      { ...publicKeyData.publicKeyJwk, alg: "RS256" },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
    return crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      signature,
      signedData
    );
  }

  throw new Error(`Unsupported algorithm: ${publicKeyData.algorithm}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { action, origin: clientOrigin, email, ...body } = await req.json();
    const rpId = getRpId(clientOrigin || req.headers.get("origin") || "https://localhost");

    if (action === "options") {
      if (!email) {
        // Discoverable credential flow
        const challenge = generateChallenge();

        await supabaseAdmin.from("webauthn_challenges").insert({
          challenge,
          type: "authentication",
        });

        return new Response(JSON.stringify({
          rpId,
          challenge,
          timeout: 60000,
          userVerification: "preferred",
          allowCredentials: [],
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Email-based flow
      const { data: userData } = await supabaseAdmin.auth.admin.listUsers();
      const targetUser = userData?.users?.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase()
      );

      if (!targetUser) {
        return new Response(JSON.stringify({ error: "No passkey found for this account" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: credentials } = await supabaseAdmin
        .from("passkey_credentials")
        .select("credential_id, transports")
        .eq("user_id", targetUser.id);

      if (!credentials || credentials.length === 0) {
        return new Response(JSON.stringify({ error: "No passkey registered for this account" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const challenge = generateChallenge();

      await supabaseAdmin.from("webauthn_challenges").insert({
        user_id: targetUser.id,
        challenge,
        type: "authentication",
        email: email.toLowerCase(),
      });

      return new Response(JSON.stringify({
        rpId,
        challenge,
        timeout: 60000,
        userVerification: "preferred",
        allowCredentials: credentials.map((c) => ({
          id: c.credential_id,
          type: "public-key",
          transports: c.transports || ["internal"],
        })),
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify") {
      const { credential } = body;
      const { id: credentialId, response: credResponse } = credential;
      console.log("Verify attempt:", { credentialId, rpId, clientOrigin });

      // Look up credential
      const { data: storedCred } = await supabaseAdmin
        .from("passkey_credentials")
        .select("*")
        .eq("credential_id", credentialId)
        .single();

      if (!storedCred) {
        console.error("Credential not found in DB:", credentialId);
        return new Response(JSON.stringify({ error: "Credential not found" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Get the challenge
      const { data: challenges } = await supabaseAdmin
        .from("webauthn_challenges")
        .select("*")
        .eq("type", "authentication")
        .gte("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(5);

      if (!challenges || challenges.length === 0) {
        return new Response(JSON.stringify({ error: "Challenge expired" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Parse clientDataJSON
      const clientDataJSONBytes = base64urlToBuffer(credResponse.clientDataJSON);
      const clientDataJSON = JSON.parse(new TextDecoder().decode(clientDataJSONBytes));

      if (clientDataJSON.type !== "webauthn.get") {
        return new Response(JSON.stringify({ error: "Invalid ceremony type" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify challenge
      const matchingChallenge = challenges.find(
        (c) => c.challenge === clientDataJSON.challenge
      );
      if (!matchingChallenge) {
        return new Response(JSON.stringify({ error: "Challenge mismatch" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify origin matches rpId
      try {
        const originUrl = new URL(clientDataJSON.origin);
        if (originUrl.hostname !== rpId) {
          return new Response(JSON.stringify({ error: "Origin mismatch" }), {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch {
        // Allow if origin can't be parsed (localhost dev)
      }

      // Parse authenticatorData
      const authDataBytes = base64urlToBuffer(credResponse.authenticatorData);

      // Verify rpIdHash (first 32 bytes of authenticatorData)
      const rpIdHashExpected = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rpId))
      );
      const rpIdHashActual = authDataBytes.slice(0, 32);
      if (!rpIdHashExpected.every((b, i) => b === rpIdHashActual[i])) {
        console.error("rpIdHash mismatch", { rpId, expectedHash: Array.from(rpIdHashExpected).slice(0,4), actualHash: Array.from(rpIdHashActual).slice(0,4) });
        return new Response(JSON.stringify({ error: "rpIdHash mismatch — passkey was registered on a different domain" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify flags: UP (bit 0) must be set
      const flags = authDataBytes[32];
      if ((flags & 0x01) === 0) {
        return new Response(JSON.stringify({ error: "User presence flag not set" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify counter (prevent replay)
      const counterBytes = authDataBytes.slice(33, 37);
      const counter = (counterBytes[0] << 24) | (counterBytes[1] << 16) | (counterBytes[2] << 8) | counterBytes[3];
      if (storedCred.counter > 0 && counter <= storedCred.counter) {
        return new Response(JSON.stringify({ error: "Counter replay detected" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // *** CRYPTOGRAPHIC SIGNATURE VERIFICATION ***
      let publicKeyData: { publicKeyJwk: JsonWebKey; algorithm: number };
      try {
        publicKeyData = JSON.parse(storedCred.public_key);
      } catch {
        // Legacy credential stored as raw attestationObject — reject
        return new Response(JSON.stringify({ 
          error: "Passkey needs re-registration. Please delete and re-register your passkey." 
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!publicKeyData.publicKeyJwk || !publicKeyData.algorithm) {
        return new Response(JSON.stringify({ 
          error: "Invalid stored key format. Please re-register your passkey." 
        }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const signatureBytes = base64urlToBuffer(credResponse.signature);
      let verified = false;
      try {
        verified = await verifySignature(
          publicKeyData,
          authDataBytes,
          clientDataJSONBytes,
          signatureBytes
        );
      } catch (err) {
        console.error("Signature verification error:", err);
        return new Response(JSON.stringify({ error: "Signature verification failed" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (!verified) {
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify admin role
      const { data: hasAdmin } = await supabaseAdmin.rpc("has_role", {
        _user_id: storedCred.user_id,
        _role: "admin",
      });

      if (!hasAdmin) {
        return new Response(JSON.stringify({ error: "Not an admin" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Update counter and last_used
      await supabaseAdmin
        .from("passkey_credentials")
        .update({
          counter,
          last_used: new Date().toISOString(),
        })
        .eq("id", storedCred.id);

      // Clean up used challenge
      await supabaseAdmin
        .from("webauthn_challenges")
        .delete()
        .eq("id", matchingChallenge.id);

      // Generate magic link
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(
        storedCred.user_id
      );

      if (!userData?.user?.email) {
        return new Response(JSON.stringify({ error: "User not found" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: linkData, error: linkError } =
        await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email: userData.user.email,
        });

      if (linkError || !linkData) {
        console.error("Link generation error:", linkError);
        return new Response(JSON.stringify({ error: "Session creation failed" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const actionLink = linkData.properties?.action_link || "";
      const tokenHash = new URL(actionLink).searchParams.get("token") ||
        linkData.properties?.hashed_token || "";

      return new Response(
        JSON.stringify({
          success: true,
          token_hash: tokenHash,
          email: userData.user.email,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("WebAuthn auth error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
