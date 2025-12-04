import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Simple in-memory rate limiting (basic protection)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW_MS });
    return false;
  }
  
  if (record.count >= RATE_LIMIT) {
    return true;
  }
  
  record.count++;
  return false;
}

function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    // Only allow http and https protocols
    if (!["http:", "https:"].includes(url.protocol)) {
      return false;
    }
    // Reject javascript: and data: schemes that might be embedded
    if (urlString.toLowerCase().includes("javascript:") || urlString.toLowerCase().includes("data:")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function sanitizeString(str: string, maxLength: number = 2000): string {
  if (!str) return "";
  return str
    .slice(0, maxLength)
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;")
    .trim();
}

function extractDomain(urlString: string): string {
  try {
    const url = new URL(urlString);
    return url.hostname;
  } catch {
    return "unknown";
  }
}

interface ReportRequest {
  websiteUrl: string;
  notes?: string;
  browser?: string;
  version?: string;
  userAgent?: string;
  timestamp?: string;
  honeypot?: string;
}

const handler = async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Get client IP for rate limiting
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || 
                     req.headers.get("cf-connecting-ip") || 
                     "unknown";
    
    // Check rate limit
    if (isRateLimited(clientIp)) {
      console.log(`Rate limit exceeded for IP: ${clientIp}`);
      return new Response(JSON.stringify({ error: "Too many submissions. Please try again later." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body: ReportRequest = await req.json();
    console.log("Received report submission:", { 
      websiteUrl: body.websiteUrl, 
      hasNotes: !!body.notes,
      browser: body.browser,
      version: body.version
    });

    // Honeypot check - reject if filled
    if (body.honeypot && body.honeypot.trim() !== "") {
      console.log("Honeypot triggered, rejecting submission");
      return new Response(JSON.stringify({ error: "Invalid submission" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate website URL
    if (!body.websiteUrl || !isValidUrl(body.websiteUrl)) {
      return new Response(JSON.stringify({ error: "Please enter a valid website URL (e.g., https://example.com)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Sanitize inputs
    const websiteUrl = sanitizeString(body.websiteUrl, 500);
    const notes = sanitizeString(body.notes || "", 2000);
    const browser = sanitizeString(body.browser || "Not provided", 100);
    const version = sanitizeString(body.version || "Not provided", 50);
    const userAgent = sanitizeString(body.userAgent || req.headers.get("user-agent") || "Not provided", 500);
    const submissionTimestamp = body.timestamp || new Date().toISOString();
    const domain = extractDomain(websiteUrl);

    // Compose email
    const emailSubject = `[Cookie Yeti] Site Report – ${domain} – ${submissionTimestamp}`;
    const emailBody = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
COOKIE YETI - SITE REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Website URL: ${websiteUrl}

Additional Notes:
${notes || "(No additional notes provided)"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
METADATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Browser: ${browser}
Cookie Yeti Version: ${version}
User Agent: ${userAgent}
Submission Time: ${submissionTimestamp}
Client IP: ${clientIp}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    // Get SMTP configuration from environment
    const smtpHost = Deno.env.get("SMTP_HOST");
    const smtpPort = parseInt(Deno.env.get("SMTP_PORT") || "465", 10);
    const smtpUser = Deno.env.get("SMTP_USER");
    const smtpPass = Deno.env.get("SMTP_PASS");
    const emailTo = Deno.env.get("EMAIL_TO");

    if (!smtpHost || !smtpUser || !smtpPass || !emailTo) {
      console.error("Missing SMTP configuration");
      return new Response(JSON.stringify({ error: "Server configuration error. Please try again later." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Attempting to send email via ${smtpHost}:${smtpPort}`);

    // Create SMTP client and send email
    const client = new SMTPClient({
      connection: {
        hostname: smtpHost,
        port: smtpPort,
        tls: true,
        auth: {
          username: smtpUser,
          password: smtpPass,
        },
      },
    });

    try {
      await client.send({
        from: smtpUser,
        to: emailTo,
        subject: emailSubject,
        content: emailBody,
      });

      await client.close();
      console.log("Email sent successfully to", emailTo);

      return new Response(JSON.stringify({ 
        success: true, 
        message: "Thank you for your report! We'll investigate this website." 
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (smtpError) {
      console.error("SMTP error:", smtpError);
      await client.close();
      return new Response(JSON.stringify({ 
        error: "Failed to send report. Please try again or email support@bestly.tech directly." 
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  } catch (error) {
    console.error("Error processing report:", error);
    return new Response(JSON.stringify({ error: "An error occurred. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

serve(handler);
