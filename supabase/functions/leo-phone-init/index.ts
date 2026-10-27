// ElevenLabs call-start webhook for Leo's phone line (310) 622-7052, plus an hourly self-heal watch.
// POST (no op): ElevenLabs asks for dynamic variables at call start. Returns trip_key etc. so calls don't fail.
//   trip_key is a SCOPED phone session minted by leo_phone_caller (matched guest = trip_status/notify_host/file_ticket/reminder_email only,
//   unknown caller = file_ticket + notify_host only, Jared's own cell = demo trip with every tool). trip-voice enforces the scope.
// POST ?op=watch: pg_cron checks ElevenLabs still points its call-start webhook here and that Leo has the
//   toggle on; repairs the webhook if it drifted, raises an alert (owner: Leo) if anything is off. Also keeps Leo's
//   default greeting (AI + calls are recorded) and 90-day recording retention in place.
// Auth: x-leo-init header must match Vault leo_phone_init_token (checked in SQL, never logged).
// verify_jwt = false (ElevenLabs and pg_cron call it with the header token, not a Supabase JWT).
import { createClient } from "npm:@supabase/supabase-js@2";
import { leoOpening } from "../_shared/leo-offer.ts";

const SB = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const SELF_URL = `${Deno.env.get("SUPABASE_URL")}/functions/v1/leo-phone-init`;
const LEO_AGENT = "agent_2501m4mb0gppf23943pftcjqem0a";

const DEFAULTS = {
  trip_key: "none",
  call_mode: "phone",
  caller_type: "unknown",
  guest_first_name: "",
  trip_stage: "none",
  pickup_place: "unknown",
  pickup_time_local: "",
  return_time_local: "",
  car_name: "Blue Steel",
  minutes_to_pickup: 9999,
  controls_state: "unknown",
  greeting_offer: "none",
  purpose: "none",
};
const LEO_NUMBER = "3106227052";
const LEO_RETENTION_DAYS = 90;
const LEO_DEFAULT_FIRST = "Hi, I'm Leo, the AI trip helper for your Tesla rental. Calls are recorded. What can I help with?";
const last10 = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
/** Opening line for Leo's own outbound early-return call (never the inbound "what can I help with?"). Same words trip-voice sends with the request. */
function earlyReturnOpener(first: unknown): string {
  const f = String(first ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  return `Hi${f ? " " + f : ""}, it's Leo, the AI trip helper. Calls are recorded. The car looks parked back at Kings Road. Are you finished with the car? Yes or no?`;
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function reply(vars: Record<string, unknown>, firstMessage?: string) {
  return json({
    type: "conversation_initiation_client_data",
    dynamic_variables: { ...DEFAULTS, ...vars },
    ...(firstMessage ? { conversation_config_override: { agent: { first_message: firstMessage } } } : {}),
  });
}

/** Stage-aware opening line for a caller we recognise (same words as the trip page's greeting). Unknown callers keep the agent's default. */
function greetFor(raw: Record<string, unknown>): { vars: Record<string, unknown>; text?: string } {
  const { starts_at, ends_at, ...vars } = raw;
  if (String(vars.caller_type ?? "unknown") === "unknown") return { vars };
  const mtp = Number(vars.minutes_to_pickup);
  const startsAt = typeof starts_at === "string" ? starts_at
    : Number.isFinite(mtp) && mtp !== 9999 ? new Date(Date.now() + mtp * 60000).toISOString() : null;
  const o = leoOpening({
    first: String(vars.guest_first_name ?? ""), startsAt, endsAt: typeof ends_at === "string" ? ends_at : null,
    ended: vars.trip_stage === "ended", controlsState: String(vars.controls_state ?? "unknown"), canAct: String(vars.caller_type) === "test_guest", // phone callers get a key now, but only Jared's demo test line can run the car
  });
  return { vars: { ...vars, greeting_offer: o.offer }, text: o.text };
}

async function raise(key: string, kind: "problem" | "resolved", title: string, body: string, healed = false) {
  try {
    await SB.rpc("bestly_raise", {
      p_key: key, p_kind: kind, p_severity: kind === "problem" ? "warning" : "info",
      p_title: title, p_body: body.slice(0, 300), p_area: "turo", p_needs_jared: null, p_healed: healed,
    });
  } catch { /* never block */ }
}

async function secret(name: string): Promise<string> {
  const { data, error } = await SB.rpc("leo_phone_secret", { p_name: name });
  if (error || !data) throw new Error(`secret ${name} unavailable`);
  return data as string;
}

async function el(path: string, init: RequestInit = {}) {
  const key = await secret("elevenlabs_api_key");
  const r = await fetch(`https://api.elevenlabs.io${path}`, {
    ...init,
    headers: { "xi-api-key": key, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ElevenLabs ${r.status} on ${path}`);
  return j as Record<string, any>;
}

async function watch() {
  const notes: string[] = [];
  const settings = await el("/v1/convai/settings");
  const hook = settings?.conversation_initiation_client_data_webhook;
  if (!hook || hook.url !== SELF_URL) {
    const token = await secret("leo_phone_init_token");
    await el("/v1/convai/settings", {
      method: "PATCH",
      body: JSON.stringify({
        conversation_initiation_client_data_webhook: { url: SELF_URL, request_headers: { "x-leo-init": token } },
      }),
    });
    notes.push(hook ? "repaired call-start webhook" : "registered call-start webhook");
  }
  const agent = await el(`/v1/convai/agents/${LEO_AGENT}`);
  // Legal disclosures (2026-10-26, Jared; CA Penal Code 632): Leo's default greeting says he is an AI and that calls are recorded, and recordings are kept
  // 90 days, not forever. Heals both if they drift. The per-call greeting comes from _shared/leo-offer.ts (LEO_INTRO) and this function's openers.
  try {
    const first = String(agent?.conversation_config?.agent?.first_message ?? "");
    if (!/\bAI\b/.test(first) || !/record/i.test(first)) {
      await el(`/v1/convai/agents/${LEO_AGENT}`, { method: "PATCH", body: JSON.stringify({ conversation_config: { agent: { first_message: LEO_DEFAULT_FIRST } } }) });
      notes.push("put Leo's greeting back (AI + calls are recorded)");
    }
    const priv = agent?.platform_settings?.privacy ?? {};
    if (priv.retention_days !== LEO_RETENTION_DAYS) {
      await el(`/v1/convai/agents/${LEO_AGENT}`, { method: "PATCH", body: JSON.stringify({ platform_settings: { privacy: { ...priv, retention_days: LEO_RETENTION_DAYS, apply_to_existing_conversations: false } } }) });
      notes.push(`set Leo's recordings to delete after ${LEO_RETENTION_DAYS} days`);
    }
  } catch (e) {
    await raise("leo.disclosures", "problem", "Leo: recording notice or retention drifted",
      "Leo's greeting must say he is an AI and calls are recorded, and recordings must delete after 90 days. Fixing it failed: " + String((e as Error)?.message ?? e));
  }
  const toggle = agent?.platform_settings?.overrides?.enable_conversation_initiation_client_data_from_webhook === true;
  if (!toggle) {
    await raise("leo.phone-init", "problem", "Leo: phone calls may fail",
      "Leo's call-start lookup toggle is off in ElevenLabs, so calls to (310) 622-7052 can drop. Needs turning back on.");
    return { ok: false, notes, toggle };
  }
  await raise("leo.phone-init", "resolved", "Leo: phone line healthy", notes.join("; ") || "checked", notes.length > 0);
  return { ok: true, notes, toggle };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("method", { status: 405 });
  let ok = false;
  try {
    const r = await SB.rpc("leo_phone_init_token_ok", { p_token: req.headers.get("x-leo-init") ?? "" });
    ok = r.data === true;
  } catch { ok = false; }
  if (!ok) return new Response("unauthorized", { status: 401 });

  const op = new URL(req.url).searchParams.get("op");
  if (op === "watch") {
    try { return json(await watch()); }
    catch (e) {
      const msg = String((e as Error)?.message ?? e);
      await raise("leo.phone-init", "problem", "Leo: phone line check failed", msg);
      return json({ ok: false, error: msg }, 500);
    }
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body */ }
  const caller = String(body.caller_id ?? body.from_number ?? "");
  // Leo's own outbound early-return call (2026-10-12): the guest's number is the callee (or, depending on the platform, the caller field). If a placed
  // call is waiting for it, answer with that call's variables (purpose early_return, call_mode outbound) and Leo's outbound opener, never the inbound greeting.
  try {
    const cands = [body.called_number, body.to_number, body.callee, body.caller_id, body.from_number].map(last10).filter((d) => d.length === 10 && d !== LEO_NUMBER);
    for (const d of [...new Set(cands)]) {
      const { data: pend } = await SB.rpc("leo_early_return_pending_call", { p_phone: d });
      if (pend && typeof pend === "object") {
        const v = pend as Record<string, unknown>;
        return reply(v, earlyReturnOpener(v.guest_first_name));
      }
    }
    // Our own number is the caller and nothing matched: this is an outbound call we placed. Never greet it as an inbound caller and never overwrite
    // the variables the outbound request already carries.
    if (last10(caller) === LEO_NUMBER && (last10(body.called_number ?? body.to_number) !== LEO_NUMBER)) {
      return json({ type: "conversation_initiation_client_data", dynamic_variables: {} });
    }
  } catch (e) {
    await raise("leo.phone-init", "problem", "Leo: outbound call lookup failed",
      "The early-return call lookup errored, so the call went ahead with the variables already on the request: " + String((e as Error)?.message ?? e));
  }
  try {
    const { data, error } = await SB.rpc("leo_phone_caller", { p_caller: caller });
    if (error) throw new Error(error.message);
    const g = greetFor((data ?? {}) as Record<string, unknown>);
    return reply(g.vars, g.text);
  } catch (e) {
    await raise("leo.phone-init", "problem", "Leo: caller lookup failed",
      "A call to (310) 622-7052 got safe defaults because the caller lookup errored: " + String((e as Error)?.message ?? e));
    return reply({});
  }
});
