import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * cloud-deal-sign — programmatic e-sign envelope creation via Libresign on
 * cloud.bestly.tech. Replaces the manual "open Libresign UI / paste request
 * ID back into admin" flow.
 *
 * Auth: admin only (verify_jwt = true; we additionally check has_role 'admin').
 *
 * Body: {
 *   deal_id:       string                  required — the cloud_deals row
 *   template_kind: "sow" | "acceptance" | "nda"   which template to send
 * }
 *
 * Response: {
 *   ok: true,
 *   request_id:   string,                  Libresign request UUID
 *   sign_url:     string,                  signer's signing link
 *   document_url: string                   Nextcloud Files URL of the source PDF
 * }
 *
 * Side effects:
 *  - Stamps the deal with signing_provider = 'libresign', signing_request_id,
 *    signing_document_url, plus sow_sent_at when template_kind='sow'.
 *  - Inserts a cloud_deal_events row with event_type matching template_kind.
 *  - Fires ntfy push to operator.
 *
 * Configuration (Supabase env vars):
 *  LIBRESIGN_BASE      e.g. https://cloud.bestly.tech
 *  LIBRESIGN_USER      service account that holds the templates (e.g. "bestly-bot")
 *  LIBRESIGN_APP_TOKEN app password for the service account
 *  LIBRESIGN_TEMPLATES JSON string mapping template_kind → template path,
 *                       e.g. '{"sow":"/Bestly/Internal/Contracts/Templates/SOW.pdf",
 *                              "acceptance":"/Bestly/Internal/Contracts/Templates/Acceptance.pdf",
 *                              "nda":"/Bestly/Internal/Contracts/Templates/NDA.pdf"}'
 *
 * If any of those env vars are missing the function returns 503 — the
 * operator UI falls back to the legacy paste-flow (still wired in
 * CloudDealDetail.tsx).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

const ALLOWED_KINDS = ["sow", "acceptance", "nda"] as const;
type TemplateKind = (typeof ALLOWED_KINDS)[number];

const KIND_TO_EVENT: Record<TemplateKind, string> = {
  sow: "sow_sent",
  acceptance: "acceptance_sent",
  nda: "nda_sent",
};

const KIND_TO_DEAL_FIELD: Partial<Record<TemplateKind, string>> = {
  sow: "sow_sent_at",
};

function libresignBasicAuth(): string {
  const user = Deno.env.get("LIBRESIGN_USER")!;
  const token = Deno.env.get("LIBRESIGN_APP_TOKEN")!;
  return "Basic " + btoa(`${user}:${token}`);
}

function templatePathFor(kind: TemplateKind): string | null {
  const raw = Deno.env.get("LIBRESIGN_TEMPLATES");
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, string>;
    return map[kind] || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a Nextcloud Files path → fileId via the WebDAV PROPFIND endpoint.
 * Libresign requires a file_id (not a path) when creating a signing request.
 */
async function resolveFileId(base: string, user: string, path: string): Promise<number | null> {
  const url = `${base}/remote.php/dav/files/${user}${path.startsWith("/") ? path : "/" + path}`;
  const r = await fetch(url, {
    method: "PROPFIND",
    headers: {
      Authorization: libresignBasicAuth(),
      Depth: "0",
      "Content-Type": "application/xml",
    },
    body:
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns">` +
      `<d:prop><oc:fileid/></d:prop></d:propfind>`,
  });
  if (!r.ok) return null;
  const text = await r.text();
  const m = text.match(/<oc:fileid>(\d+)<\/oc:fileid>/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Create a Libresign signing request for a known templateFileId.
 *
 * Libresign API: POST /ocs/v2.php/apps/libresign/api/v1/request-signature
 *  body: { file: {nodeId}, signers: [{identifyMethods, displayName}], name, callback? }
 *  returns: { uuid, signers: [{sign_request_uuid, ...}], url }
 *
 * Verified against Libresign 13.2.4 on 2026-05-06.
 */
async function createSigningRequest(opts: {
  base: string;
  templateFileId: number;
  signer: { email: string; displayName: string };
  requestName: string;
  callbackUrl?: string;
}): Promise<{ uuid: string; sign_url: string } | { error: string }> {
  const r = await fetch(
    `${opts.base}/ocs/v2.php/apps/libresign/api/v1/request-signature?format=json`,
    {
      method: "POST",
      headers: {
        Authorization: libresignBasicAuth(),
        "Content-Type": "application/json",
        "OCS-APIRequest": "true",
      },
      body: JSON.stringify({
        file: { nodeId: opts.templateFileId },
        signers: [
          {
            identifyMethods: [
              { method: "email", value: opts.signer.email, mandatory: 1 },
            ],
            displayName: opts.signer.displayName,
            notify: 1,
          },
        ],
        name: opts.requestName,
        ...(opts.callbackUrl ? { callback: opts.callbackUrl } : {}),
      }),
    }
  );
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.ocs?.meta?.status !== "ok") {
    return { error: `Libresign ${r.status} ${j?.ocs?.meta?.statuscode ?? ""}: ${j?.ocs?.data?.message ?? JSON.stringify(j).slice(0, 300)}` };
  }
  const data = j?.ocs?.data;
  const uuid = data?.uuid;
  if (!uuid) return { error: "Libresign response missing uuid" };
  // For email-method signers, Libresign emails the recipient a tokenized link
  // when notify:1 is set. The generic public preview URL — useful for the
  // operator dashboard — uses the request UUID.
  const sign_url = `${opts.base}/apps/libresign/p/pdf/${uuid}`;
  return { uuid, sign_url };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return bad("method not allowed", 405);

  // Admin auth gate
  const authz = req.headers.get("authorization") || "";
  const callerToken = authz.replace(/^Bearer\s+/i, "");
  if (!callerToken) return bad("authentication required", 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sbAuth = createClient(supabaseUrl, serviceKey);
  const { data: userRes } = await sbAuth.auth.getUser(callerToken);
  const uid = userRes?.user?.id;
  if (!uid) return bad("invalid auth", 401);
  const sb = createClient(supabaseUrl, serviceKey);
  const { data: roleCheck } = await sb.rpc("has_role", { _user_id: uid, _role: "admin" });
  if (!roleCheck) return bad("admin only", 403);

  // Validate body
  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("invalid json");
  }
  const dealId = body?.deal_id;
  const kind = body?.template_kind as TemplateKind;
  if (!dealId || typeof dealId !== "string") return bad("deal_id required");
  if (!ALLOWED_KINDS.includes(kind)) return bad("template_kind must be sow|acceptance|nda");

  // Configuration check — fail soft if Libresign isn't wired up yet
  const base = Deno.env.get("LIBRESIGN_BASE");
  const lUser = Deno.env.get("LIBRESIGN_USER");
  const lToken = Deno.env.get("LIBRESIGN_APP_TOKEN");
  if (!base || !lUser || !lToken) {
    return bad(
      "Libresign not configured on this Supabase project — set LIBRESIGN_BASE, LIBRESIGN_USER, LIBRESIGN_APP_TOKEN, and LIBRESIGN_TEMPLATES env vars. The operator paste-flow remains available as fallback.",
      503
    );
  }
  const templatePath = templatePathFor(kind);
  if (!templatePath) {
    return bad(
      `LIBRESIGN_TEMPLATES env var has no mapping for '${kind}' — add it before sending.`,
      503
    );
  }

  // Look up deal
  const { data: deal, error: dErr } = await sb
    .from("cloud_deals")
    .select("id, lead_id, company_name, primary_contact_name, primary_contact_email")
    .eq("id", dealId)
    .maybeSingle();
  if (dErr || !deal) return bad("deal not found", 404);

  // Resolve template file_id via WebDAV PROPFIND
  const fileId = await resolveFileId(base, lUser, templatePath);
  if (!fileId) return bad(`template not found at ${templatePath}`, 500);

  // Build the callback URL (Phase 4 webhook) — pointing at our companion edge
  // function. Libresign per-envelope callbacks don't support custom headers,
  // so we encode the shared secret as a query param. The webhook handler
  // accepts either ?secret= or the X-Bestly-Sign-Secret header.
  const webhookSecret = Deno.env.get("LIBRESIGN_WEBHOOK_SECRET");
  const callbackUrl = webhookSecret
    ? `${supabaseUrl}/functions/v1/cloud-deal-sign-webhook?secret=${encodeURIComponent(webhookSecret)}`
    : `${supabaseUrl}/functions/v1/cloud-deal-sign-webhook`;

  // Create the signing request
  const requestName =
    kind === "sow"
      ? `Bestly Cloud SOW — ${deal.company_name}`
      : kind === "acceptance"
      ? `Bestly Cloud Acceptance — ${deal.company_name}`
      : `Bestly Cloud NDA — ${deal.company_name}`;

  const result = await createSigningRequest({
    base,
    templateFileId: fileId,
    signer: {
      email: deal.primary_contact_email,
      displayName: deal.primary_contact_name,
    },
    requestName,
    callbackUrl,
  });

  if ("error" in result) {
    console.error("libresign create error", result.error);
    return bad(result.error, 502);
  }

  // Build the public document URL (path is canonical; UUID identifies request)
  const documentUrl = `${base}${templatePath}`;

  // Stamp the deal
  const update: Record<string, any> = {
    signing_provider: "libresign",
    signing_request_id: result.uuid,
    signing_document_url: documentUrl,
  };
  const dealField = KIND_TO_DEAL_FIELD[kind];
  if (dealField) update[dealField] = new Date().toISOString();

  const { error: uErr } = await sb.from("cloud_deals").update(update).eq("id", deal.id);
  if (uErr) {
    console.error("deal update error", uErr);
    return bad("could not stamp deal", 500);
  }

  // Audit event
  await sb.from("cloud_deal_events").insert({
    deal_id: deal.id,
    lead_id: deal.lead_id,
    event_type: KIND_TO_EVENT[kind],
    event_payload: {
      signing_provider: "libresign",
      signing_request_id: result.uuid,
      template_kind: kind,
      template_path: templatePath,
      sign_url: result.sign_url,
    },
    triggered_by: "admin",
  });

  // Operator ntfy push
  try {
    const headers: Record<string, string> = {
      Title: asciiHeader(
        `${kind.toUpperCase()} sent to ${deal.primary_contact_name}: ${deal.company_name}`
      ),
      Tags: "envelope_with_arrow",
      Priority: "4",
      Click: `https://bestly.tech/admin/cloud/${deal.lead_id}`,
    };
    const ntfyToken = Deno.env.get("NTFY_TOKEN");
    if (ntfyToken) headers["Authorization"] = `Bearer ${ntfyToken}`;
    await fetch(`${NTFY_BASE}/${NTFY_TOPIC}`, {
      method: "POST",
      headers,
      body: result.sign_url,
    });
  } catch (e) {
    console.error("ntfy push failed (sign create)", e);
  }

  return ok({
    ok: true,
    request_id: result.uuid,
    sign_url: result.sign_url,
    document_url: documentUrl,
  });
});
