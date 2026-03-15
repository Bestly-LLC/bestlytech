import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { activationCodeEmail } from "../_shared/email-template.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const smtpUser = Deno.env.get("PRIVATEMAIL_EMAIL");
    const smtpPass = Deno.env.get("PRIVATEMAIL_PASSWORD");

    if (!smtpUser || !smtpPass) {
      throw new Error("PRIVATEMAIL_EMAIL or PRIVATEMAIL_PASSWORD is not configured");
    }

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
      platform: platform || "unknown",
      active: false,
      expires_at: expiresAt,
    });

    if (insertError) throw new Error(`Insert failed: ${insertError.message}`);

    // Send branded HTML email via PrivateMail SMTP (port 465, TLS)
    const html = activationCodeEmail(code);

    const client = new SMTPClient({
      connection: {
        hostname: "mail.privateemail.com",
        port: 465,
        tls: true,
        auth: {
          username: smtpUser,
          password: smtpPass,
        },
      },
    });

    await client.send({
      from: smtpUser,
      to: email,
      subject: "Your Cookie Yeti activation code",
      content: "auto",
      html,
    });

    await client.close();

    return new Response(JSON.stringify({ success: true }), {
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
