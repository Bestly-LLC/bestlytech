import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { activationCodeEmail } from "../_shared/email-template.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Valid platforms per DB constraint
const VALID_PLATFORMS = ["chrome", "safari", "firefox", "ios", "macos", "unknown"];

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { email, platform } = await req.json();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return new Response(JSON.stringify({ success: false, error: "invalid_email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Normalize platform - map any variant to valid value
    let safePlatform = (platform || "unknown").toLowerCase().replace(/_extension$/, "");
    if (!VALID_PLATFORMS.includes(safePlatform)) {
      safePlatform = "unknown";
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = SB_SECRET;
    const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Rate limit: max 5 codes per email per hour
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from("activation_codes")
      .select("*", { count: "exact", head: true })
      .eq("email", email.toLowerCase())
      .gte("created_at", oneHourAgo);

    if ((count ?? 0) >= 5) {
      return new Response(JSON.stringify({ success: false, error: "Too many requests" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cleanup expired/pending codes
    await supabase
      .from("activation_codes")
      .delete()
      .eq("email", email.toLowerCase())
      .eq("active", false);

    // Generate 6-digit code
    const code = String(Math.floor(100000 + Math.random() * 900000));

    // Insert activation code (expires in 15 minutes)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const { error: insertError } = await supabase.from("activation_codes").insert({
      email: email.toLowerCase(),
      code,
      platform: safePlatform,
      active: false,
      expires_at: expiresAt,
    });

    if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

    // Render the branded HTML email
    const html = activationCodeEmail(code);
    const textContent = `Your Cookie Yeti activation code is: ${code}\n\nThis code expires in 15 minutes.\nEnter this code in the Cookie Yeti extension to activate Pro.\n\nIf you didn't request this code, you can safely ignore this email.`;

    // --- SEND IMMEDIATELY via Resend API (no queue delay) ---
    const resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: "Cookie Yeti <noreply@bestly.tech>",
        to: [email.toLowerCase()],
        subject: "Your Cookie Yeti activation code",
        html,
        text: textContent,
      }),
    });

    const resendData = await resendResponse.json();

    if (!resendResponse.ok) {
      console.error("Resend API error:", resendData);
      // Fall back to queue if direct send fails
      const messageId = crypto.randomUUID();
      await supabase.rpc("enqueue_email", {
        queue_name: "transactional_emails",
        payload: {
          message_id: messageId,
          idempotency_key: messageId,
          to: email,
          from: "Cookie Yeti <noreply@bestly.tech>",
          subject: "Your Cookie Yeti activation code",
          html,
          text: textContent,
          purpose: "transactional",
          label: "activation_code",
          queued_at: new Date().toISOString(),
        },
      });
      // Still return success - email will be sent by cron
      return new Response(JSON.stringify({ success: true, delivery: "queued" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log successful send
    await supabase.from("email_send_log").insert({
      queue_name: "transactional_emails",
      queue_message_id: 0,
      to_email: email.toLowerCase(),
      subject: "Your Cookie Yeti activation code",
      status: "sent",
      provider: "resend",
      provider_message_id: resendData.id,
      sent_at: new Date().toISOString(),
    });

    console.log(`✓ Activation code sent instantly to ${email} via Resend (ID: ${resendData.id})`);

    return new Response(JSON.stringify({ success: true, delivery: "instant" }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("send-activation-code error:", error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
