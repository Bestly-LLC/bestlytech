import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const rateLimitStore = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 5;
const RATE_LIMIT_WINDOW = 60 * 60 * 1000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(ip);
  if (!record || now > record.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
    return false;
  }
  if (record.count >= RATE_LIMIT) return true;
  record.count++;
  return false;
}

function sanitizeInput(input: string | null | undefined): string {
  if (!input) return "";
  return input.replace(/[<>]/g, "").trim().slice(0, 5000);
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
  honeypot?: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("cf-connecting-ip") || "unknown";
    if (isRateLimited(clientIP)) {
      console.log(`Rate limit exceeded for IP: ${clientIP}`);
      return new Response(JSON.stringify({ error: "Too many requests. Please try again later." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body: HireRequestBody = await req.json();
    if (body.honeypot) {
      return new Response(JSON.stringify({ success: true, message: "Request submitted successfully" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!body.name || !body.email || !body.projectType || !body.description) {
      return new Response(JSON.stringify({ error: "Missing required fields: name, email, projectType, and description are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!validateEmail(body.email)) {
      return new Response(JSON.stringify({ error: "Invalid email address" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = SB_SECRET;
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase configuration");
      throw new Error("Server configuration error");
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { data: insertedData, error: dbError } = await supabase.from("hire_requests").insert([sanitizedData]).select().single();
    if (dbError) {
      console.error("Database error:", dbError);
      throw new Error("Failed to save hire request");
    }
    console.log("Hire request saved to database:", insertedData.id);

    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const smtpPort = Deno.env.get("SMTP_PORT");
    if (!smtpHost || !smtpUser || !smtpPass || !smtpPort) {
      console.error("Missing SMTP configuration");
      return new Response(JSON.stringify({ success: true, message: "Request submitted successfully" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const timestamp = new Date().toLocaleString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" });
    const emailBody = `\nNEW HIRE REQUEST\n\nFrom: ${sanitizedData.name} <${sanitizedData.email}>\nCompany: ${sanitizedData.company || "N/A"}\n\nPROJECT DETAILS\nType: ${sanitizedData.project_type}\nBudget: ${sanitizedData.budget_range || "Not specified"}\nTimeline: ${sanitizedData.timeline || "Not specified"}\n\nDescription:\n${sanitizedData.description}\n\nReferral Source: ${sanitizedData.referral_source || "Not specified"}\n\nSubmitted: ${timestamp}\nRequest ID: ${insertedData.id}\n`.trim();

    try {
      const client = new SMTPClient({ connection: { hostname: smtpHost, port: parseInt(smtpPort, 10), tls: true, auth: { username: smtpUser, password: smtpPass } } });
      const emailTo = Deno.env.get("EMAIL_TO");
      if (!emailTo) {
        console.warn("submit-hire-request: EMAIL_TO env var not set; skipping email notification");
      } else {
        await client.send({
          from: smtpUser,
          to: emailTo,
          subject: `\u{1F195} Hire Request: ${sanitizedData.project_type} from ${sanitizedData.name}`,
          content: emailBody,
        });
      }
      await client.close();
      console.log("Email notification sent successfully");
    } catch (emailError) {
      console.error("Email sending failed:", emailError);
    }

    // SEC-07: SMS via Twilio. Numbers pulled from Supabase Vault via
    // the get_sms_config() SECURITY DEFINER RPC. Falls back to env vars
    // for backwards compatibility if vault isn't populated.
    try {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      const TWILIO_API_KEY = Deno.env.get("TWILIO_API_KEY");
      let smsTo: string | null = null;
      let smsFrom: string | null = null;
      try {
        const { data: smsConfig, error: smsError } = await supabase.rpc("get_sms_config");
        if (smsError) {
          console.warn("get_sms_config rpc failed, falling back to env vars:", smsError.message);
        } else if (smsConfig) {
          smsTo = (smsConfig as { to?: string }).to ?? null;
          smsFrom = (smsConfig as { from?: string }).from ?? null;
        }
      } catch (e) {
        console.warn("get_sms_config rpc threw:", e);
      }
      smsTo = smsTo || Deno.env.get("TWILIO_TO") || null;
      smsFrom = smsFrom || Deno.env.get("TWILIO_FROM") || null;

      if (LOVABLE_API_KEY && TWILIO_API_KEY && smsTo && smsFrom) {
        const smsBody = `New hire request from ${sanitizedData.name} — ${sanitizedData.project_type}, Budget: ${sanitizedData.budget_range || "N/A"}`;
        const smsRes = await fetch("https://connector-gateway.lovable.dev/twilio/Messages.json", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": TWILIO_API_KEY,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({ To: smsTo, From: smsFrom, Body: smsBody }),
        });
        if (smsRes.ok) console.log("SMS notification sent");
        else console.error("SMS failed:", await smsRes.text());
      } else {
        console.warn("submit-hire-request: SMS config incomplete; skipping SMS notification", { hasLovable: !!LOVABLE_API_KEY, hasTwilio: !!TWILIO_API_KEY, hasTo: !!smsTo, hasFrom: !!smsFrom });
      }
    } catch (smsError) {
      console.error("SMS sending failed:", smsError);
    }

    return new Response(JSON.stringify({ success: true, message: "Your request has been submitted successfully. We'll be in touch within 2-3 business days." }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error processing hire request:", error);
    return new Response(JSON.stringify({ error: "Failed to submit request. Please try again later." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
