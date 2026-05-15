import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * cloud-deal-sign-webhook — Libresign callback handler.
 *
 * Libresign POSTs here when a signing event happens. We look up the deal by
 * signing_request_id, stamp the appropriate timestamp, write a deal_event,
 * fire ntfy + customer email, and (for SOW) optionally auto-advance stage.
 *
 * Auth: verify_jwt = false (Libresign won't carry our JWT). We instead require
 * a shared secret in the X-Bestly-Sign-Secret header (LIBRESIGN_WEBHOOK_SECRET
 * env var). Libresign supports custom headers on its callbacks.
 *
 * Body shape varies across Libresign versions. We handle a few common shapes:
 *   { event: "signed", uuid: <request-uuid>, signer: {email}, signed_at: <iso> }
 *   { event: "signed", request: {uuid: ...}, ... }
 *   { type: "sign", file: {uuid: ...}, ... }
 *
 * If the body shape doesn't match any known pattern, we log + 200 (so
 * Libresign doesn't keep retrying) and let the operator notice via the
 * unchanged status on the deal page.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-bestly-sign-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const NTFY_BASE = "https://ntfy.sh";
const NTFY_TOPIC = "bestly-sysalert-7q2k9mx4";

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

function pickRequestUuid(body: any): string | null {
  if (typeof body?.uuid === "string") return body.uuid;
  if (typeof body?.request?.uuid === "string") return body.request.uuid;
  if (typeof body?.file?.uuid === "string") return body.file.uuid;
  if (typeof body?.signature?.request_uuid === "string") return body.signature.request_uuid;
  return null;
}

function pickEventType(body: any): "signed" | "declined" | "viewed" | "other" {
  const t = (body?.event || body?.type || "").toString().toLowerCase();
  if (t.includes("sign")) return "signed";
  if (t.includes("decline") || t.includes("reject")) return "declined";
  if (t.includes("view") || t.includes("open")) return "viewed";
  return "other";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return bad("method not allowed", 405);

  // Shared-secret check. We accept the secret either as the X-Bestly-Sign-Secret
  // header (Workflow Engine path — supports custom headers) OR as a `?secret=`
  // query param (per-envelope callback path — Libresign's per-request callback
  // is a plain URL with no custom-header support).
  const expected = Deno.env.get("LIBRESIGN_WEBHOOK_SECRET");
  if (expected) {
    const url = new URL(req.url);
    const fromHeader = req.headers.get("x-bestly-sign-secret");
    const fromQuery = url.searchParams.get("secret");
    if (fromHeader !== expected && fromQuery !== expected) {
      console.warn("sign-webhook secret mismatch");
      return bad("unauthorized", 401);
    }
  }

  // Libresign 13 posts the callback as multipart/form-data with three fields:
  //   uuid    — request UUID (matches cloud_deals.signing_request_id)
  //   status  — file status code (fires only when the whole envelope is signed)
  //   file    — the signed PDF binary (we don't store; Nextcloud has it)
  // We also tolerate a JSON shape for forward-compat / Workflow Engine path.
  let reqUuid: string | null = null;
  let body: any = null;
  let eventType: "signed" | "declined" | "viewed" | "other" = "other";
  const ct = (req.headers.get("content-type") || "").toLowerCase();

  if (ct.startsWith("multipart/form-data")) {
    try {
      const form = await req.formData();
      const u = form.get("uuid");
      const s = form.get("status");
      reqUuid = typeof u === "string" ? u : null;
      body = { uuid: reqUuid, status: typeof s === "string" ? s : null, source: "multipart" };
      // notifyCallback only fires on full-sign completion in Libresign 13
      eventType = "signed";
    } catch (e) {
      console.error("multipart parse failed", e);
      return bad("invalid multipart");
    }
  } else {
    try {
      body = await req.json();
    } catch {
      return bad("invalid json");
    }
    reqUuid = pickRequestUuid(body);
    eventType = pickEventType(body);
  }

  if (!reqUuid) {
    console.warn("webhook with no request uuid", JSON.stringify(body).slice(0, 400));
    return ok({ ok: true, ignored: true });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  // Look up the deal
  const { data: deal } = await sb
    .from("cloud_deals")
    .select(
      "id, lead_id, current_stage, company_name, primary_contact_name, primary_contact_email, sow_signed_at, install_data"
    )
    .eq("signing_request_id", reqUuid)
    .maybeSingle();

  if (!deal) {
    console.warn("webhook for unknown signing_request_id", reqUuid);
    return ok({ ok: true, unmatched: true });
  }

  // Process by event type
  if (eventType === "viewed") {
    await sb.from("cloud_deal_events").insert({
      deal_id: deal.id,
      lead_id: deal.lead_id,
      event_type: "sign_viewed",
      event_payload: { signing_request_id: reqUuid, raw: body },
      triggered_by: "libresign-webhook",
    });
    return ok({ ok: true, recorded: "viewed" });
  }

  if (eventType === "declined") {
    await sb.from("cloud_deal_events").insert({
      deal_id: deal.id,
      lead_id: deal.lead_id,
      event_type: "sign_declined",
      event_payload: { signing_request_id: reqUuid, raw: body },
      triggered_by: "libresign-webhook",
    });
    // ntfy with priority 5 — operator should see this immediately
    try {
      const headers: Record<string, string> = {
        Title: asciiHeader(`Signing declined: ${deal.company_name}`),
        Tags: "no_entry",
        Priority: "5",
        Click: `https://bestly.tech/admin/cloud/${deal.lead_id}`,
      };
      const ntfyToken = Deno.env.get("NTFY_TOKEN");
      if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;
      await fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, {
        method: "POST",
        headers,
        body: `${deal.primary_contact_name ?? "Client"} declined the signing request.`,
      });
    } catch (e) {
      console.error("ntfy decline failed", e);
    }
    return ok({ ok: true, recorded: "declined" });
  }

  if (eventType !== "signed") {
    return ok({ ok: true, ignored: eventType });
  }

  // ── Signed ──
  const signedAt =
    body?.signed_at || body?.timestamp || new Date().toISOString();
  const isAcceptance =
    deal.current_stage === 7 ||
    !!(deal.install_data as any)?.acceptance?.envelope_id ||
    body?.kind === "acceptance";

  const updates: Record<string, any> = {};
  if (isAcceptance) {
    // Stamp acceptance.signed_at inside install_data
    const install = (deal.install_data as any) || {};
    install.acceptance = {
      ...(install.acceptance || {}),
      envelope_id: install.acceptance?.envelope_id ?? reqUuid,
      signed_at: signedAt,
    };
    updates.install_data = install;
  } else {
    if (!deal.sow_signed_at) updates.sow_signed_at = signedAt;
  }

  if (Object.keys(updates).length > 0) {
    await sb.from("cloud_deals").update(updates).eq("id", deal.id);
  }

  await sb.from("cloud_deal_events").insert({
    deal_id: deal.id,
    lead_id: deal.lead_id,
    event_type: isAcceptance ? "acceptance_signed" : "sow_signed",
    event_payload: { signing_request_id: reqUuid, signed_at: signedAt, raw: body },
    triggered_by: "libresign-webhook",
  });

  // ntfy push
  try {
    const headers: Record<string, string> = {
      Title: asciiHeader(
        `${isAcceptance ? "Acceptance" : "SOW"} signed: ${deal.company_name}`
      ),
      Tags: "white_check_mark",
      Priority: "5",
      Click: `https://bestly.tech/admin/cloud/${deal.lead_id}`,
    };
    const ntfyToken = Deno.env.get("NTFY_TOKEN");
    if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;
    await fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, {
      method: "POST",
      headers,
      body: `${deal.primary_contact_name ?? "Client"} just signed.${
        isAcceptance ? " Stage 7 complete — Mark live unlocked." : ""
      }`,
    });
  } catch (e) {
    console.error("ntfy sign-complete failed", e);
  }

  return ok({ ok: true, recorded: isAcceptance ? "acceptance_signed" : "sow_signed" });
});
