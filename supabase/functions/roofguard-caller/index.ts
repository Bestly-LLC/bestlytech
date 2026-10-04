// roofguard-caller: the RoofGuard dialer + post-call webhook (Spark, 2026-10-04). BUILT, NOT YET DEPLOYED.
//
// Two jobs:
//   POST {action:"tick"}     (pg_cron, every 5 min once switched on) -> asks rg_next_call_batch() who may be
//                            dialed now, submits them to ElevenLabs batch calling, logs a queued rg_calls row each.
//   POST ?hook=elevenlabs    ElevenLabs post-call webhook -> verifies the HMAC signature, maps the agent's
//                            data-collection fields to an outcome, writes through rg_record_call().
//
// Safety, in order:
//   1. rg_settings.calling_enabled must be true (defaults to false).
//   2. Vault must hold elevenlabs_api_key (and elevenlabs_webhook_secret for the hook) - absent = refuse.
//   3. Every dial rule (line type, DNC, window, attempts, gap, caps, holidays) lives in rg_next_call_batch(),
//      so this function cannot dial anyone the database would not allow.
//   4. Numbers are re-checked against rg_dnc right before submit.
//
// Secrets: read per call from Vault through rg_secret() (service role only, an allowlist of 4 names), never env or code.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const XI = "https://api.elevenlabs.io/v1";

type Next = { lead_id: string; company: string; phone: string; timezone: string; contact_name: string | null;
  contact_title: string | null; pitch_angle: string; category: string; state: string; attempt: number };

async function vault(name: string): Promise<string | null> {
  const { data, error } = await db.rpc("rg_secret", { p_name: name });
  return error || typeof data !== "string" || !data ? null : data;
}

async function authorized(req: Request): Promise<boolean> {
  const k = req.headers.get("x-proxy-key");
  if (k) {
    for (const n of ["edge_proxy_key_sha256", "edge_proxy_key_prev_sha256"]) {
      const { data } = await db.rpc("edge_key_ok", { p_name: n, p_key: k });
      if (data === true) return true;
    }
  }
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (req.headers.get("apikey") ?? "").trim();
  return [bearer, apikey].some((t) => t && SERVICE_KEYS.has(t));
}

// ---------- dialer ----------
async function tick(): Promise<Response> {
  const { data: s } = await db.from("rg_settings").select("*").eq("id", true).single();
  if (!s?.calling_enabled) return Response.json({ ok: true, skipped: "calling is off" });
  if (!s.agent_id || !s.phone_number_id) return Response.json({ ok: false, skipped: "agent_id / phone_number_id not set" }, { status: 412 });
  const key = await vault("elevenlabs_api_key");
  if (!key) return Response.json({ ok: false, skipped: "elevenlabs_api_key missing from Vault" }, { status: 412 });

  const { data: next, error } = await db.rpc("rg_next_call_batch", { p_limit: 10 });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const leads = (next ?? []) as Next[];
  if (!leads.length) return Response.json({ ok: true, dialed: 0 });

  // last-second DNC re-check
  const { data: dnc } = await db.from("rg_dnc").select("phone").in("phone", leads.map((l) => l.phone));
  const blocked = new Set((dnc ?? []).map((d: { phone: string }) => d.phone));
  const go = leads.filter((l) => !blocked.has(l.phone));
  if (!go.length) return Response.json({ ok: true, dialed: 0 });

  const res = await fetch(`${XI}/convai/batch-calling/submit`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      call_name: `roofguard-${new Date().toISOString().slice(0, 16)}`,
      agent_id: s.agent_id,
      agent_phone_number_id: s.phone_number_id,
      recipients: go.map((l) => ({
        phone_number: l.phone,
        conversation_initiation_client_data: {
          dynamic_variables: {
            lead_id: l.lead_id, company: l.company, contact_name: l.contact_name ?? "the facilities director",
            contact_title: l.contact_title ?? "", pitch_angle: l.pitch_angle, category: l.category, state: l.state,
            callback_number: s.callback_number ?? "",
          },
        },
      })),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return Response.json({ ok: false, status: res.status, error: body }, { status: 502 });

  await db.from("rg_calls").insert(go.map((l) => ({ lead_id: l.lead_id, attempt: l.attempt, to_number: l.phone, batch_id: body.id ?? null, status: "queued" })));
  await db.from("rg_leads").update({ call_status: "in_progress" }).in("id", go.map((l) => l.lead_id));
  return Response.json({ ok: true, dialed: go.length, batch_id: body.id ?? null });
}

// ---------- post-call webhook ----------
async function hmacHex(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const OUTCOMES = new Set(["booked", "callback_set", "dm_identified", "voicemail_left", "gatekeeper_blocked",
  "not_interested", "wrong_number", "do_not_call", "no_answer", "other"]);

async function hook(req: Request): Promise<Response> {
  const secret = await vault("elevenlabs_webhook_secret");
  if (!secret) return new Response("webhook secret not configured", { status: 412 });
  const raw = await req.text();
  // ElevenLabs-Signature: t=<unix>,v0=<hex hmac of "t.body">
  const sigHeader = req.headers.get("elevenlabs-signature") ?? "";
  const t = sigHeader.match(/t=(\d+)/)?.[1];
  const v0 = sigHeader.match(/v0=([0-9a-f]+)/)?.[1];
  if (!t || !v0 || Math.abs(Date.now() / 1000 - Number(t)) > 30 * 60) return new Response("bad signature", { status: 401 });
  if ((await hmacHex(secret, `${t}.${raw}`)) !== v0) return new Response("bad signature", { status: 401 });

  const evt = JSON.parse(raw);
  if (evt.type !== "post_call_transcription") return Response.json({ ok: true, ignored: evt.type });
  const d = evt.data ?? {};
  const vars = d.conversation_initiation_client_data?.dynamic_variables ?? {};
  const dc = d.analysis?.data_collection_results ?? {};
  const val = (k: string) => (dc[k]?.value ?? null) as string | null;
  let outcome = String(val("outcome") ?? "other").toLowerCase().replace(/\s+/g, "_");
  if (!OUTCOMES.has(outcome)) outcome = "other";
  if (String(val("dnc_requested") ?? "").toLowerCase() === "true") outcome = "do_not_call";
  const callbackAt = val("callback_at");

  const { data, error } = await db.rpc("rg_record_call", {
    p_conversation_id: d.conversation_id, p_lead_id: vars.lead_id, p_to_number: vars.system__called_number ?? d.metadata?.phone_call?.external_number ?? "",
    p_status: "completed", p_outcome: outcome, p_summary: d.analysis?.transcript_summary ?? null,
    p_duration_sec: d.metadata?.call_duration_secs ?? null, p_meeting_times: val("meeting_times"), p_meeting_email: val("meeting_email"),
    p_callback_at: callbackAt && !isNaN(Date.parse(callbackAt)) ? new Date(callbackAt).toISOString() : null,
    p_dm_name: val("dm_name"), p_dm_title: val("dm_title"), p_notes: val("notes"),
    p_transcript: d.transcript ?? null, p_recording_url: null,
  });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json(data);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("hook") === "elevenlabs") return hook(req);
  if (!(await authorized(req))) return new Response("unauthorized", { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.action === "tick") return tick();
  return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
});
