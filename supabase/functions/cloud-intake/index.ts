import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Token-bound technical-intake portal for /intake/:token.
 *  GET    ?token=<>                             → fetch intake_data + deal summary
 *  PATCH  body { token, stage, data }           → merge stage data (auto-save)
 *  POST   body { token }                        → mark submitted, fire ntfy push
 *
 * Stages: network | branding | users | migration | policy.
 * Each stage is a free-form jsonb subdoc — server validates only that the
 * stage key is one of the allowed values; client owns shape correctness for
 * v1. Locked once intake_submitted_at is set.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

const NTFY_BASE = "https://ntfy.sh";
const NTFY_TOPIC = "bestly-sysalert-7q2k9mx4";

const ALLOWED_STAGES = ["network", "branding", "users", "migration", "policy"] as const;
type StageKey = typeof ALLOWED_STAGES[number];

function ok(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), {
    status: s,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ─── GET ─────────────────────────────────────────────────
  if (req.method === "GET") {
    const token = new URL(req.url).searchParams.get("token");
    if (!token || token.length < 16) return bad("token required");

    const { data: deal, error } = await sb
      .from("cloud_deals")
      .select(
        "id, lead_id, current_stage, company_name, primary_contact_name, primary_contact_email, target_user_count, intake_data, intake_submitted_at, provisioning_data, install_data, live_data, go_live_at"
      )
      .eq("intake_token", token)
      .maybeSingle();

    if (error) return bad("could not load", 500);
    if (!deal) return bad("not found", 404);

    return ok({ ok: true, deal });
  }

  // ─── PATCH ───────────────────────────────────────────────
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
    const stage = body?.stage as StageKey | undefined;
    if (!stage || !ALLOWED_STAGES.includes(stage)) {
      return bad("stage required (network|branding|users|migration|policy)");
    }
    const data = body?.data;
    if (data == null || typeof data !== "object" || Array.isArray(data)) {
      return bad("data must be an object");
    }

    const { data: row, error: lookupErr } = await sb
      .from("cloud_deals")
      .select("id, intake_data, intake_submitted_at")
      .eq("intake_token", token)
      .maybeSingle();

    if (lookupErr) return bad("could not load", 500);
    if (!row) return bad("not found", 404);
    if (row.intake_submitted_at) return bad("already submitted", 409);

    // Merge — replace the entire stage subdoc with what the client sent.
    // Client sends the full stage object on each save (idempotent).
    const merged = { ...(row.intake_data || {}), [stage]: data };

    const { error: updErr } = await sb
      .from("cloud_deals")
      .update({ intake_data: merged })
      .eq("id", row.id);

    if (updErr) {
      console.error("intake patch error", updErr);
      return bad("could not save", 500);
    }

    return ok({ ok: true, stage, saved: Object.keys(data).length });
  }

  // ─── POST (submit) ───────────────────────────────────────
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

    const { data: row, error: lookupErr } = await sb
      .from("cloud_deals")
      .select("id, lead_id, company_name, primary_contact_name, intake_submitted_at")
      .eq("intake_token", token)
      .maybeSingle();

    if (lookupErr) return bad("could not load", 500);
    if (!row) return bad("not found", 404);
    if (row.intake_submitted_at) return ok({ ok: true, already: true });

    const { error: updErr } = await sb
      .from("cloud_deals")
      .update({ intake_submitted_at: new Date().toISOString() })
      .eq("id", row.id);

    if (updErr) {
      console.error("intake submit error", updErr);
      return bad("could not submit", 500);
    }

    await sb.from("cloud_deal_events").insert({
      deal_id: row.id,
      lead_id: row.lead_id,
      event_type: "intake_submitted",
      event_payload: {},
      triggered_by: "client",
    });

    const headers: Record<string, string> = {
      Title: asciiHeader(`Intake submitted: ${row.company_name}`),
      Tags: "package",
      Priority: "5",
      Click: `https://bestly.tech/admin/cloud/${row.lead_id}`,
    };
    const ntfyToken = Deno.env.get("NTFY_TOKEN");
    if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;

    fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, {
      method: "POST",
      headers,
      body: `${row.primary_contact_name ?? "Client"} just finished the technical intake.`,
    }).catch((e) => console.error("ntfy push failed", e));

    // Customer-facing thank-you
    const { data: dealFull } = await sb
      .from("cloud_deals")
      .select("primary_contact_email, primary_contact_name, company_name")
      .eq("id", row.id)
      .single();
    if (dealFull?.primary_contact_email) {
      sb.functions
        .invoke("send-transactional-email", {
          body: {
            templateName: "cloud-intake-received",
            recipientEmail: dealFull.primary_contact_email,
            idempotencyKey: `cloud-intake-received-${row.id}`,
            templateData: {
              contact_name: dealFull.primary_contact_name,
              company_name: dealFull.company_name,
            },
          },
        })
        .catch((e) => console.error("intake-received email failed", e));
    }

    return ok({ ok: true });
  }

  return bad("method not allowed", 405);
});
