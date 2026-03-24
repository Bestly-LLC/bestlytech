import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Helper: always return 200 with JSON so supabase.functions.invoke() can read the body
function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function errorResponse(error: string) {
  return jsonResponse({ error });
}

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

function asn1ToRaw(sig: Uint8Array): Uint8Array {
  if (sig[0] !== 0x30) throw new Error("Invalid ASN.1 signature");
  let offset = 2;
  if (sig[offset] !== 0x02) throw new Error("Invalid ASN.1 r");
  offset++;
  const rLen = sig[offset++];
  let r = sig.slice(offset, offset + rLen);
  offset += rLen;
  if (sig[offset] !== 0x02) throw new Error("Invalid ASN.1 s");
  offset++;
  const sLen = sig[offset++];
  let s = sig.slice(offset, offset + sLen);
  if (r.length === 33 && r[0] === 0) r = r.slice(1);
  if (s.length === 33 && s[0] === 0) s = s.slice(1);
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
  const clientDataHash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", clientDataJSON)
  );
  const signedData = new Uint8Array(authenticatorData.length + clientDataHash.length);
  signedData.set(authenticatorData);
  signedData.set(clientDataHash, authenticatorData.length);

  if (publicKeyData.algorithm === -7) {
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing env vars:", { hasUrl: !!supabaseUrl, hasKey: !!serviceRoleKey });
      return errorResponse("Server configuration error");
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { action, origin: clientOrigin, email, ...body } = await req.json();
    const rpId = getRpId(clientOrigin || req.headers.get("origin") || "https://localhost");
    console.log("WebAuthn request:", { action, rpId, clientOrigin, email: email ? "provided" : "none" });

    if (action === "options") {
      if (!email) {
        const challenge = generateChallenge();
        await supabaseAdmin.from("webauthn_challenges").insert({
          challenge,
          type: "authentication",
        });
        return jsonResponse({
          rpId,
          challenge,
          timeout: 60000,
          userVerification: "preferred",
          allowCredentials: [],
        });
      }

      const { data: userData } = await supabaseAdmin.auth.admin.listUsers();
      const targetUser = userData?.users?.find(
        (u) => u.email?.toLowerCase() === email.toLowerCase()
      );

      if (!targetUser) {
        return errorResponse("No passkey found for this account");
      }

      const { data: credentials } = await supabaseAdmin
        .from("passkey_credentials")
        .select("credential_id, transports")
        .eq("user_id", targetUser.id);

      if (!credentials || credentials.length === 0) {
        return errorResponse("No passkey registered for this account");
      }

      const challenge = generateChallenge();
      await supabaseAdmin.from("webauthn_challenges").insert({
        user_id: targetUser.id,
        challenge,
        type: "authentication",
        email: email.toLowerCase(),
      });

      return jsonResponse({
        rpId,
        challenge,
        timeout: 60000,
        userVerification: "preferred",
        allowCredentials: credentials.map((c) => ({
          id: c.credential_id,
          type: "public-key",
          transports: c.transports || ["internal"],
        })),
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
        return errorResponse("Credential not found. You may need to re-register your passkey.");
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
        console.error("No valid challenges found");
        return errorResponse("Challenge expired. Please try again.");
      }

      // Parse clientDataJSON
      const clientDataJSONBytes = base64urlToBuffer(credResponse.clientDataJSON);
      const clientDataJSON = JSON.parse(new TextDecoder().decode(clientDataJSONBytes));

      if (clientDataJSON.type !== "webauthn.get") {
        return errorResponse("Invalid ceremony type");
      }

      // Verify challenge
      const matchingChallenge = challenges.find(
        (c) => c.challenge === clientDataJSON.challenge
      );
      if (!matchingChallenge) {
        console.error("Challenge mismatch", { 
          received: clientDataJSON.challenge?.slice(0, 10), 
          available: challenges.map(c => c.challenge?.slice(0, 10)) 
        });
        return errorResponse("Challenge mismatch. Please try again.");
      }

      // Verify origin matches rpId
      try {
        const originUrl = new URL(clientDataJSON.origin);
        if (originUrl.hostname !== rpId) {
          console.error("Origin mismatch", { originHostname: originUrl.hostname, rpId });
          return errorResponse(`Origin mismatch: browser says ${originUrl.hostname}, server expects ${rpId}`);
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
        console.error("rpIdHash mismatch", { rpId });
        return errorResponse("Passkey domain mismatch — this passkey was registered on a different domain. Please re-register.");
      }

      // Verify flags: UP (bit 0) must be set
      const flags = authDataBytes[32];
      if ((flags & 0x01) === 0) {
        return errorResponse("User presence flag not set");
      }

      // Verify counter (prevent replay)
      const counterBytes = authDataBytes.slice(33, 37);
      const counter = (counterBytes[0] << 24) | (counterBytes[1] << 16) | (counterBytes[2] << 8) | counterBytes[3];
      if (storedCred.counter > 0 && counter <= storedCred.counter) {
        return errorResponse("Security error: counter replay detected. Please re-register your passkey.");
      }

      // *** CRYPTOGRAPHIC SIGNATURE VERIFICATION ***
      let publicKeyData: { publicKeyJwk: JsonWebKey; algorithm: number };
      try {
        publicKeyData = JSON.parse(storedCred.public_key);
      } catch {
        return errorResponse("Passkey needs re-registration. Please delete and re-register your passkey in Security settings.");
      }

      if (!publicKeyData.publicKeyJwk || !publicKeyData.algorithm) {
        return errorResponse("Invalid stored key format. Please re-register your passkey.");
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
        return errorResponse("Signature verification failed: " + (err instanceof Error ? err.message : String(err)));
      }

      if (!verified) {
        console.error("Signature invalid for credential:", credentialId);
        return errorResponse("Invalid signature. Your passkey may need to be re-registered.");
      }

      // Verify admin role
      const { data: hasAdmin } = await supabaseAdmin.rpc("has_role", {
        _user_id: storedCred.user_id,
        _role: "admin",
      });

      if (!hasAdmin) {
        return errorResponse("Not an admin");
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
        return errorResponse("User not found");
      }

      const { data: linkData, error: linkError } =
        await supabaseAdmin.auth.admin.generateLink({
          type: "magiclink",
          email: userData.user.email,
        });

      if (linkError || !linkData) {
        console.error("Link generation error:", linkError);
        return errorResponse("Session creation failed");
      }

      const actionLink = linkData.properties?.action_link || "";
      const tokenHash = new URL(actionLink).searchParams.get("token") ||
        linkData.properties?.hashed_token || "";

      console.log("Passkey auth successful for:", userData.user.email);
      return jsonResponse({
        success: true,
        token_hash: tokenHash,
        email: userData.user.email,
      });
    }

    return errorResponse("Invalid action");
  } catch (err) {
    console.error("WebAuthn auth error:", err);
    return errorResponse(err instanceof Error ? err.message : "Unknown error");
  }
});
