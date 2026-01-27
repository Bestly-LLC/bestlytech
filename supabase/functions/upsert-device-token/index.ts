import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // 1. Parse request body
    const { device_token, platform = "ios" } = await req.json();

    // 2. Validate device_token
    if (!device_token || typeof device_token !== "string" || device_token.trim().length === 0) {
      console.error("Invalid device_token: missing or empty");
      return new Response(
        JSON.stringify({ ok: false, error: "device_token is required and must be a non-empty string" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate token length (APNS tokens are typically 64 hex chars)
    if (device_token.length < 32 || device_token.length > 200) {
      console.error(`Invalid device_token length: ${device_token.length}`);
      return new Response(
        JSON.stringify({ ok: false, error: "device_token has invalid length" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Validate Authorization header and get user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      console.error("Missing or invalid Authorization header");
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create client with user's auth to validate JWT
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    // Validate the JWT using getClaims (faster than getUser)
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsError } = await supabaseAuth.auth.getUser(token);

    if (claimsError || !claimsData?.user) {
      console.error("JWT validation failed:", claimsError?.message);
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const userId = claimsData.user.id;
    console.log(`Upserting device token for user: ${userId}, platform: ${platform}`);

    // 4. Create service role client (bypasses RLS)
    const serviceClient = createClient(supabaseUrl, supabaseServiceRoleKey);

    // 5. Delete existing rows for this user OR this device token
    // This ensures: one token per user AND no duplicate tokens across users
    const { error: deleteError } = await serviceClient
      .from("device_tokens")
      .delete()
      .or(`user_id.eq.${userId},device_token.eq.${device_token}`);

    if (deleteError) {
      console.error("Error deleting existing tokens:", deleteError.message);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to clean up existing tokens" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Insert new row
    const { error: insertError } = await serviceClient
      .from("device_tokens")
      .insert({
        user_id: userId,
        device_token: device_token.trim(),
        platform: platform || "ios",
        updated_at: new Date().toISOString(),
      });

    if (insertError) {
      console.error("Error inserting device token:", insertError.message);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to save device token" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Successfully upserted device token for user: ${userId}`);

    // 7. Return success
    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
