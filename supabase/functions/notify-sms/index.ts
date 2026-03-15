import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/twilio";
const TO_NUMBER = "+18165007236";
const FROM_NUMBER = "+12139279363";
const ADMIN_EMAIL = "jaredbest@icloud.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { message } = await req.json();
    if (!message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "message required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { sms?: string; email?: string } = {};

    // ── SMS via Twilio ──────────────────────────────────────────────
    try {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
      if (LOVABLE_API_KEY && TWILIO_API_KEY) {
        const response = await fetch(`${GATEWAY_URL}/Messages.json`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": TWILIO_API_KEY,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: TO_NUMBER,
            From: FROM_NUMBER,
            Body: message.slice(0, 1600),
          }),
        });
        const data = await response.json();
        if (response.ok) {
          console.log("SMS sent:", data.sid);
          results.sms = "sent";
        } else {
          console.error("SMS API error:", JSON.stringify(data));
          results.sms = "failed";
        }
      } else {
        console.warn("Twilio keys not configured, skipping SMS");
        results.sms = "skipped";
      }
    } catch (smsErr) {
      console.error("SMS error:", smsErr);
      results.sms = "failed";
    }

    // ── Email via SMTP ──────────────────────────────────────────────
    try {
      const smtpHost = Deno.env.get("SMTP_HOST");
      const smtpUser = Deno.env.get("SMTP_USER");
      const smtpPass = Deno.env.get("SMTP_PASS");
      const smtpPort = Deno.env.get("SMTP_PORT");

      if (smtpHost && smtpUser && smtpPass && smtpPort) {
        const client = new SMTPClient({
          connection: {
            hostname: smtpHost,
            port: parseInt(smtpPort, 10),
            tls: true,
            auth: { username: smtpUser, password: smtpPass },
          },
        });

        await client.send({
          from: smtpUser,
          to: ADMIN_EMAIL,
          subject: `📋 New Intake Submission`,
          content: `${message}\n\n— Sent from Bestly notification system`,
        });

        await client.close();
        console.log("Email notification sent");
        results.email = "sent";
      } else {
        console.warn("SMTP not configured, skipping email");
        results.email = "skipped";
      }
    } catch (emailErr) {
      console.error("Email error:", emailErr);
      results.email = "failed";
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Notification error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
