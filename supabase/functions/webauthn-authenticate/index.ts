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
        // Discoverable credential flow - allow any registered passkey
        const challenge = generateChallenge();

        await supabaseAdmin.from("webauthn_challenges").insert({
          challenge,
          type: "authentication",
        });

        const options = {
          rpId,
          challenge,
          timeout: 60000,
          userVerification: "preferred",
          allowCredentials: [], // empty = discoverable credentials
        };

        return new Response(JSON.stringify(options), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Email-based flow: look up user credentials
      // First find user by email
      const { data: userData, error: userError } = await supabaseAdmin.auth.admin.listUsers();
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

      const options = {
        rpId,
        challenge,
        timeout: 60000,
        userVerification: "preferred",
        allowCredentials: credentials.map((c) => ({
          id: c.credential_id,
          type: "public-key",
          transports: c.transports || ["internal"],
        })),
      };

      return new Response(JSON.stringify(options), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "verify") {
      const { credential } = body;
      const { id: credentialId, response: credResponse } = credential;

      // Look up credential
      const { data: storedCred } = await supabaseAdmin
        .from("passkey_credentials")
        .select("*")
        .eq("credential_id", credentialId)
        .single();

      if (!storedCred) {
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

      // Parse clientDataJSON to verify challenge
      const clientDataJSON = JSON.parse(
        new TextDecoder().decode(base64urlToBuffer(credResponse.clientDataJSON))
      );

      if (clientDataJSON.type !== "webauthn.get") {
        return new Response(JSON.stringify({ error: "Invalid ceremony type" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check challenge matches any valid challenge
      const matchingChallenge = challenges.find(
        (c) => c.challenge === clientDataJSON.challenge
      );

      if (!matchingChallenge) {
        return new Response(JSON.stringify({ error: "Challenge mismatch" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Verify the user has admin role
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
          counter: storedCred.counter + 1,
          last_used: new Date().toISOString(),
        })
        .eq("id", storedCred.id);

      // Clean up used challenge
      await supabaseAdmin
        .from("webauthn_challenges")
        .delete()
        .eq("id", matchingChallenge.id);

      // Generate a magic link for the user to create a session
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(
        storedCred.user_id
      );

      if (!userData?.user?.email) {
        return new Response(JSON.stringify({ error: "User not found" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Generate a magic link token
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

      // Extract the token hash from the action_link
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
