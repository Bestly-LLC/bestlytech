import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Token-bound brief CRUD for /brief/:token.
 *  GET    ?token=<>           → fetch brief + lead summary (no PII beyond company/name)
 *  PATCH  body { token, ...fields }  → partial save (auto-save on field blur)
 *  POST   body { token, submit: true } → mark submitted_at, fire ntfy push
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

const NTFY_BASE = "https://ntfy.sh";
const NTFY_TOPIC = "bestly-sysalert-7q2k9mx4";

const APP_SLUGS = [
  "drive",
  "video-chat",
  "mail",
  "docs",
  "calendar",
  "ai",
  "shield",
  "vpn",
  "backup",
  "projects",
  "forms",
  "passwords",
  "sign",
] as const;

const SPEND_BANDS = ["<25k", "25-75k", "75-150k", "150-300k", "300k+", "unsure"] as const;
const COMPLIANCE = ["hipaa", "soc2", "gdpr", "ccpa", "none", "unsure"] as const;
const YN_UNSURE = ["yes", "no", "unsure"] as const;

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function bad(reason: string, status = 400) {
  return new Response(JSON.stringify({ ok: false, error: reason }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asciiHeader(s: string) {
  return s
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, "");
}

function pickArray<T extends string>(input: unknown, allowed: readonly T[]): T[] | null {
  if (!Array.isArray(input)) return null;
  const set = new Set(allowed);
  const out: T[] = [];
  for (const v of input) {
    if (typeof v === "string" && set.has(v as T)) out.push(v as T);
  }
  return out;
}

const FIELDS_PATCHABLE = new Set([
  "current_apps",
  "annual_saas_spend_band",
  "compliance_frameworks",
  "office_city",
  "office_state",
  "office_country",
  "has_static_ip",
  "has_it_lead",
  "domain_owned",
  "preferred_subdomain",
  "biggest_unknown",
]);

function cap(s: unknown, n: number): string | null {
  if (s == null) return null;
  if (typeof s !== "string") return null;
  return s.slice(0, n);
}

function sanitizePatch(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if ("current_apps" in input) {
    const v = pickArray(input.current_apps, APP_SLUGS);
    if (v) out.current_apps = v;
  }
  if ("compliance_frameworks" in input) {
    const v = pickArray(input.compliance_frameworks, COMPLIANCE);
    if (v) out.compliance_frameworks = v;
  }
  if ("annual_saas_spend_band" in input) {
    const v = input.annual_saas_spend_band;
    if (v == null) out.annual_saas_spend_band = null;
    else if (typeof v === "string" && (SPEND_BANDS as readonly string[]).includes(v)) {
      out.annual_saas_spend_band = v;
    }
  }
  for (const k of ["has_static_ip", "has_it_lead", "domain_owned"]) {
    if (k in input) {
      const v = input[k];
      if (v == null) out[k] = null;
      else if (typeof v === "string" && (YN_UNSURE as readonly string[]).includes(v)) {
        out[k] = v;
      }
    }
  }
  if ("office_city" in input) out.office_city = cap(input.office_city, 100);
  if ("office_state" in input) out.office_state = cap(input.office_state, 100);
  if ("office_country" in input) out.office_country = cap(input.office_country, 64);
  if ("preferred_subdomain" in input) out.preferred_subdomain = cap(input.preferred_subdomain, 100);
  if ("biggest_unknown" in input) out.biggest_unknown = cap(input.biggest_unknown, 4000);

  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  // ──────────────────────────────────────────────────────────
  // GET — fetch brief by token
  // ──────────────────────────────────────────────────────────
  if (req.method === "GET") {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    if (!token || token.length < 16) return bad("token required");

    const { data: brief, error } = await sb
      .from("cloud_briefs")
      .select(
        "id, lead_id, submitted_at, current_apps, annual_saas_spend_band, compliance_frameworks, office_city, office_state, office_country, has_static_ip, has_it_lead, domain_owned, preferred_subdomain, biggest_unknown"
      )
      .eq("access_token", token)
      .maybeSingle();

    if (error) return bad("could not load brief", 500);
    if (!brief) return bad("not found", 404);

    const { data: lead } = await sb
      .from("cloud_leads")
      .select("contact_name, company_name, user_count_band")
      .eq("id", brief.lead_id)
      .single();

    return ok({ ok: true, brief, lead });
  }

  // ──────────────────────────────────────────────────────────
  // PATCH — partial save
  // ──────────────────────────────────────────────────────────
  if (req.method === "PATCH") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return bad("invalid json");
    }
    const token = body?.token;
    if (!token || typeof token !== "string" || token.length < 16) {
      return bad("token required");
    }

    const patch = sanitizePatch(body);
    if (Object.keys(patch).length === 0) return ok({ ok: true, saved: 0 });

    const { data: row, error: lookupErr } = await sb
      .from("cloud_briefs")
      .select("id, submitted_at")
      .eq("access_token", token)
      .maybeSingle();

    if (lookupErr) return bad("could not load brief", 500);
    if (!row) return bad("not found", 404);
    if (row.submitted_at) return bad("already submitted", 409);

    const { error: updErr } = await sb
      .from("cloud_briefs")
      .update(patch)
      .eq("id", row.id);

    if (updErr) {
      console.error("brief patch error", updErr);
      return bad("could not save", 500);
    }

    return ok({ ok: true, saved: Object.keys(patch).length });
  }

  // ──────────────────────────────────────────────────────────
  // POST — final submit
  // ──────────────────────────────────────────────────────────
  if (req.method === "POST") {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return bad("invalid json");
    }
    const token = body?.token;
    if (!token || typeof token !== "string" || token.length < 16) {
      return bad("token required");
    }

    // Allow last-second field updates with the submit payload
    const patch = sanitizePatch(body);

    const { data: row, error: lookupErr } = await sb
      .from("cloud_briefs")
      .select("id, lead_id, submitted_at")
      .eq("access_token", token)
      .maybeSingle();

    if (lookupErr) return bad("could not load brief", 500);
    if (!row) return bad("not found", 404);
    if (row.submitted_at) return ok({ ok: true, already: true });

    const update = { ...patch, submitted_at: new Date().toISOString() };
    const { error: updErr } = await sb.from("cloud_briefs").update(update).eq("id", row.id);
    if (updErr) {
      console.error("brief submit error", updErr);
      return bad("could not submit", 500);
    }

    // Pull lead for ntfy summary
    const { data: lead } = await sb
      .from("cloud_leads")
      .select("contact_name, company_name, user_count_band")
      .eq("id", row.lead_id)
      .single();

    const headers: Record<string, string> = {
      Title: asciiHeader(
        `Brief submitted: ${lead?.company_name ?? "(unknown)"} (${lead?.user_count_band ?? "?"} users)`
      ),
      Tags: "memo",
      Priority: "4",
      Click: `https://bestly.tech/admin/cloud/${row.lead_id}`,
    };
    const ntfyToken = Deno.env.get("NTFY_TOKEN");
    if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;

    fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, {
      method: "POST",
      headers,
      body: `${lead?.contact_name ?? "Client"} just finished the pre-call brief.`,
    }).catch((e) => console.error("ntfy push failed", e));

    // Customer-facing thank-you
    if (lead) {
      const { data: leadFull } = await sb
        .from("cloud_leads")
        .select("contact_email")
        .eq("id", row.lead_id)
        .single();
      if (leadFull?.contact_email) {
        sb.functions
          .invoke("send-transactional-email", {
            body: {
              templateName: "cloud-brief-submitted",
              recipientEmail: leadFull.contact_email,
              idempotencyKey: `cloud-brief-submitted-${row.id}`,
              templateData: {
                contact_name: lead.contact_name,
                company_name: lead.company_name,
              },
            },
          })
          .catch((e) => console.error("brief-submitted email failed", e));
      }
    }

    return ok({ ok: true });
  }

  return bad("method not allowed", 405);
});
