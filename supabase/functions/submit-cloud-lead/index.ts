import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Bestly In-House Cloud — Stage 1 lead capture.
 *
 * Public form on /get-started POSTs here.
 *  - Inserts into cloud_leads (server-side, bypasses RLS via service role).
 *  - The trigger auto-creates the cloud_briefs shell with an access_token.
 *  - We fire ntfy push to the operator (Jared) with lead summary + click-through to /admin.
 *  - Return { brief_token } so frontend can redirect to /brief/[token].
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const NTFY_BASE = "https://ntfy.sh";
const NTFY_TOPIC = "bestly-sysalert-7q2k9mx4";
const ADMIN_CLICK_URL = "https://bestly.tech/admin";

const USER_BAND = ["5", "25", "50", "100", "200+"] as const;
const PAIN = ["cost", "sovereignty", "brand", "ai-privacy", "lock-in", "other"] as const;
const URGENCY = ["renewal-30", "renewal-90", "renewal-180", "exploring"] as const;

type LeadInput = {
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  company_name: string;
  company_website?: string;
  user_count_band: typeof USER_BAND[number];
  primary_pain?: typeof PAIN[number];
  primary_pain_detail?: string;
  urgency?: typeof URGENCY[number];
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  referrer?: string;
};

function bad(reason: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: reason }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function asciiHeader(s: string) {
  // ntfy headers must be ASCII — strip em-dash, smart quotes, etc.
  return s
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    // drop anything that isn't printable ASCII
    .replace(/[^\x20-\x7E]/g, "");
}

async function pushNtfy(lead: LeadInput, leadId: string) {
  const title = asciiHeader(
    `New cloud lead: ${lead.company_name} (${lead.user_count_band} users)`
  );
  const tags = ["bell", "office"];
  const lines: string[] = [
    `${lead.contact_name} <${lead.contact_email}>`,
    lead.company_website ? lead.company_website : "",
    lead.urgency ? `Urgency: ${lead.urgency.replace("renewal-", "renewal in ")}d` : "",
    lead.primary_pain ? `Pain: ${lead.primary_pain}` : "",
    lead.primary_pain_detail ? `Note: ${lead.primary_pain_detail.slice(0, 200)}` : "",
  ].filter(Boolean);
  const body = lines.join("\n");

  const headers: Record<string, string> = {
    Title: title,
    Tags: tags.join(","),
    Priority: "5",
    Click: `${ADMIN_CLICK_URL}/cloud/${leadId}`,
  };
  const ntfyToken = Deno.env.get("NTFY_TOKEN");
  if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;

  try {
    await fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, {
      method: "POST",
      headers,
      body,
    });
  } catch (err) {
    console.error("ntfy push failed", err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return bad("method not allowed", 405);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return bad("invalid json");
  }

  const lead = raw as Partial<LeadInput>;

  // Validate required fields
  if (!lead.contact_name || !lead.contact_name.trim()) return bad("contact_name required");
  if (!lead.contact_email || !isEmail(lead.contact_email)) return bad("valid contact_email required");
  if (!lead.company_name || !lead.company_name.trim()) return bad("company_name required");
  if (!lead.user_count_band || !USER_BAND.includes(lead.user_count_band)) {
    return bad("user_count_band required (5/25/50/100/200+)");
  }
  if (lead.primary_pain && !PAIN.includes(lead.primary_pain)) return bad("invalid primary_pain");
  if (lead.urgency && !URGENCY.includes(lead.urgency)) return bad("invalid urgency");

  // Length caps to prevent abuse
  const cap = (s: string | undefined, n: number) => (s ? s.slice(0, n) : undefined);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  // Capture forwarded IP/UA (best-effort)
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null;
  const ua = req.headers.get("user-agent") ?? null;

  const insert = {
    contact_name: cap(lead.contact_name, 200),
    contact_email: cap(lead.contact_email.toLowerCase(), 320),
    contact_phone: cap(lead.contact_phone, 64),
    company_name: cap(lead.company_name, 200),
    company_website: cap(lead.company_website, 500),
    user_count_band: lead.user_count_band,
    primary_pain: lead.primary_pain ?? null,
    primary_pain_detail: cap(lead.primary_pain_detail, 2000),
    urgency: lead.urgency ?? null,
    utm_source: cap(lead.utm_source, 200),
    utm_medium: cap(lead.utm_medium, 200),
    utm_campaign: cap(lead.utm_campaign, 200),
    referrer: cap(lead.referrer, 500),
    ip_address: ip,
    user_agent: cap(ua ?? undefined, 500),
  };

  const { data: leadRow, error: leadErr } = await sb
    .from("cloud_leads")
    .insert(insert)
    .select("id")
    .single();

  if (leadErr || !leadRow) {
    console.error("insert lead error", leadErr);
    return bad("could not save lead", 500);
  }

  // Read back the brief shell that the trigger created
  const { data: brief, error: briefErr } = await sb
    .from("cloud_briefs")
    .select("access_token")
    .eq("lead_id", leadRow.id)
    .single();

  if (briefErr || !brief) {
    console.error("brief lookup error", briefErr);
    // Lead is saved — fail soft, return without brief token
    await pushNtfy(lead as LeadInput, leadRow.id);
    return new Response(
      JSON.stringify({ ok: true, lead_id: leadRow.id, brief_token: null }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Fire-and-forget push to operator
  pushNtfy(lead as LeadInput, leadRow.id).catch(() => {});

  // Fire-and-forget customer-facing email
  sb.functions
    .invoke("send-transactional-email", {
      body: {
        templateName: "cloud-lead-received",
        recipientEmail: insert.contact_email,
        idempotencyKey: `cloud-lead-received-${leadRow.id}`,
        templateData: {
          contact_name: insert.contact_name,
          company_name: insert.company_name,
          brief_url: `https://bestly.tech/brief/${brief.access_token}`,
          cal_url: "https://cloud.bestly.tech/apps/calendar/appointment/BtktQYtGFocY",
        },
      },
    })
    .catch((e) => console.error("lead-received email failed", e));

  return new Response(
    JSON.stringify({
      ok: true,
      lead_id: leadRow.id,
      brief_token: brief.access_token,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
