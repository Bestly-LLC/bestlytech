import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Rate limiting store (in-memory, resets on function restart)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 5;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000; // 1 hour in milliseconds

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return false;
  }

  if (record.count >= RATE_LIMIT) {
    return true;
  }

  record.count++;
  return false;
}

function sanitizeInput(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(/[<>]/g, "") // Remove potential HTML tags
    .trim()
    .slice(0, 5000); // Limit length
}

function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 255;
}

interface HireRequestBody {
  name: string;
  email: string;
  company?: string;
  projectType: string;
  budgetRange?: string;
  timeline?: string;
  description: string;
  referralSource?: string;
  honeypot?: string; // Hidden field for bot detection
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Get client IP for rate limiting
    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                     req.headers.get("cf-connecting-ip") || 
                     "unknown";

    // Check rate limit
    if (isRateLimited(clientIP)) {
      console.log(`Rate limit exceeded for IP: ${clientIP}`);
      return new Response(
        JSON.stringify({ error: "Too many requests. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body: HireRequestBody = await req.json();

    // Honeypot check - if filled, it's likely a bot
    if (body.honeypot) {
      console.log("Honeypot triggered, likely bot submission");
      // Return success to not alert the bot
      return new Response(
        JSON.stringify({ success: true, message: "Request submitted successfully" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate required fields
    if (!body.name || !body.email || !body.projectType || !body.description) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: name, email, projectType, and description are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate email format
    if (!validateEmail(body.email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email address" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Sanitize inputs
    const sanitizedData = {
      name: sanitizeInput(body.name).slice(0, 100),
      email: sanitizeInput(body.email).slice(0, 255),
      company: sanitizeInput(body.company).slice(0, 200) || null,
      project_type: sanitizeInput(body.projectType).slice(0, 100),
      budget_range: sanitizeInput(body.budgetRange).slice(0, 50) || null,
      timeline: sanitizeInput(body.timeline).slice(0, 50) || null,
      description: sanitizeInput(body.description).slice(0, 5000),
      referral_source: sanitizeInput(body.referralSource).slice(0, 200) || null,
    };

    // Initialize Supabase client with service role for database insert
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase configuration");
      throw new Error("Server configuration error");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Store in database
    const { data: insertedData, error: dbError } = await supabase
      .from("hire_requests")
      .insert([sanitizedData])
      .select()
      .single();

    if (dbError) {
      console.error("Database error:", dbError);
      throw new Error("Failed to save hire request");
    }

    console.log("Hire request saved to database:", insertedData.id);

    // Send email notification
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const smtpPort = Deno.env.get("SMTP_PORT");

    if (!smtpHost || !smtpUser || !smtpPass || !smtpPort) {
      console.error("Missing SMTP configuration");
      // Still return success since the data was saved to database
      return new Response(
        JSON.stringify({ success: true, message: "Request submitted successfully" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const timestamp = new Date().toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });

    const emailBody = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEW HIRE REQUEST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

From: ${sanitizedData.name} <${sanitizedData.email}>
Company: ${sanitizedData.company || "N/A"}

PROJECT DETAILS
───────────────
Type: ${sanitizedData.project_type}
Budget: ${sanitizedData.budget_range || "Not specified"}
Timeline: ${sanitizedData.timeline || "Not specified"}

Description:
${sanitizedData.description}

Referral Source: ${sanitizedData.referral_source || "Not specified"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Submitted: ${timestamp}
Request ID: ${insertedData.id}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`.trim();

    try {
      const client = new SMTPClient({
        connection: {
          hostname: smtpHost,
          port: parseInt(smtpPort, 10),
          tls: true,
          auth: {
            username: smtpUser,
            password: smtpPass,
          },
        },
      });

      await client.send({
        from: smtpUser, // support@bestly.tech
        to: "jaredbest@icloud.com",
        subject: `🆕 Hire Request: ${sanitizedData.project_type} from ${sanitizedData.name}`,
        content: emailBody,
      });

      await client.close();
      console.log("Email notification sent successfully");
    } catch (emailError) {
      console.error("Email sending failed:", emailError);
      // Don't fail the request since database save was successful
    }

    // Send SMS notification via Twilio
    try {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
      if (LOVABLE_API_KEY && TWILIO_API_KEY) {
        const smsBody = `New hire request from ${sanitizedData.name} — ${sanitizedData.project_type}, Budget: ${sanitizedData.budget_range || "N/A"}`;
        const smsRes = await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": TWILIO_API_KEY,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: "+18165007236",
            From: "+12139279363",
            Body: smsBody,
          }),
        });
        if (smsRes.ok) {
          console.log("SMS notification sent");
        } else {
          console.error("SMS failed:", await smsRes.text());
        }
      }
    } catch (smsError) {
      console.error("SMS sending failed:", smsError);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Your request has been submitted successfully. We'll be in touch within 2-3 business days." }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing hire request:", error);
    return new Response(
      JSON.stringify({ error: "Failed to submit request. Please try again later." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
