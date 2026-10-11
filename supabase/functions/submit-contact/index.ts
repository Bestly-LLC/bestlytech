import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Key switch (2026-09-24): new keys first, legacy as fallback.
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// SEC-05: Lock CORS to first-party origins. The contact form is only
// called from bestly.tech + www.bestly.tech — no reason to accept
// requests from anywhere else.
const ALLOWED_ORIGINS = new Set([
  "https://bestly.tech",
  "https://www.bestly.tech",
]);

function corsHeadersFor(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://bestly.tech";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

interface ContactRequest {
  name: string;
  email: string;
  category: string;
  subject: string;
  message: string;
  // Maya fills the form for the visitor (docs/maya-contact-form-opusplan.md): all optional.
  phone?: string;
  source?: string;
  conversation_id?: string;
}

const MAX_LENGTHS = { name: 100, email: 255, category: 50, subject: 200, message: 5000, phone: 40, conversation_id: 80 };

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + RATE_WINDOW_MS });
    return false;
  }
  if (record.count >= RATE_LIMIT) return true;
  record.count++;
  return false;
}

serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  const corsHeaders = corsHeadersFor(origin);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    console.warn("submit-contact: rejected origin", { origin });
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (isRateLimited(clientIp)) {
      return new Response(
        JSON.stringify({ error: "Too many submissions. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { name, email, category, subject, message, phone, source, conversation_id }: ContactRequest = await req.json();

    if (!name || !email || !subject || !message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = SB_SECRET;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const clean = {
      name: name.trim().slice(0, MAX_LENGTHS.name),
      email: email.toLowerCase().trim().slice(0, MAX_LENGTHS.email),
      category: (category || "general").slice(0, MAX_LENGTHS.category),
      subject: subject.trim().slice(0, MAX_LENGTHS.subject),
      message: message.trim().slice(0, MAX_LENGTHS.message),
      // Digits and the usual separators only, so a phone field cannot carry anything else.
      phone: (typeof phone === "string" ? phone.replace(/[^0-9+()\-.\s]/g, "").trim().slice(0, MAX_LENGTHS.phone) : "") || null,
      source: source === "maya" ? "maya" : "web",
      conversation_id:
        typeof conversation_id === "string" && /^conv_[A-Za-z0-9]+$/.test(conversation_id)
          ? conversation_id.slice(0, MAX_LENGTHS.conversation_id)
          : null,
    };

    const { error: insertError } = await supabase.from("contact_submissions").insert(clean);

    if (insertError) {
      console.error("Insert error:", insertError);
      throw new Error("Failed to save submission");
    }

    // A sales question is also one sales_lead ticket on Maya's desk (the Sales column and the hot-lead alert), made
    // the same way maya-ticket makes it. The website form is the only record Maya makes: she never files her own.
    // The submission is already saved, so a ticket failure never fails the visitor's send.
    if (clean.category === "sales") {
      try {
        const text = `${clean.subject} ${clean.message}`;
        const { data: t, error: tErr } = await supabase.rpc("maya_file_ticket", {
          p: {
            kind: "sales_lead",
            product: /agent/i.test(text) ? "Bestly Agent" : /cloud/i.test(text) ? "Bestly Cloud" : null,
            name: clean.name,
            email: clean.email,
            phone: clean.phone,
            issue: `Website form: ${clean.subject}. ${clean.message}`.slice(0, 1500),
            conversation_id: clean.conversation_id,
          },
        });
        if (tErr) throw tErr;
        if (t?.ticket) {
          await supabase.from("support_tickets").update({ source: "web-form" }).eq("code", t.ticket);
        }
      } catch (ticketError: any) {
        console.error("Sales ticket error:", ticketError);
        await supabase.rpc("bestly_raise", {
          p_key: "maya.ticket",
          p_kind: "problem",
          p_severity: "warning",
          p_title: "Maya: a website sales lead didn't reach her desk",
          p_body: `${clean.name} sent a sales question through the contact form; it is saved in contact_submissions but has no ticket. ${String(ticketError?.message ?? "").slice(0, 200)}`,
          p_area: "maya",
        });
      }
    }

    const smtpHost = Deno.env.get("SMTP_HOST");
    const emailTo = Deno.env.get("EMAIL_TO");
    if (smtpHost && emailTo) {
      console.log("SMTP configured, would send notification to:", emailTo);
    }

    return new Response(
      JSON.stringify({ success: true, message: "Contact form submitted successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Contact form error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
