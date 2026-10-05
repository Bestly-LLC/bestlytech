// ava-call-quality: read-only look at how Ava SOUNDS, for both Avas. Admin / service key only. (Spark, 2026-10-05)
//
// Jared: "demo call from the partner portal was super choppy, voice not clear. Do we need a tool or employee to watch this?"
// The reply guard already catches what she SAYS (code leaks) and Line Check already catches a DEAD line. Nothing watched how a
// call SOUNDS. The watching itself is plain SQL (migration 20261005130000: ava_call_quality_scan + triggers), free, no AI.
// This function is only the microscope for a human or a session:
//   {action:"agent", source:"roofguard"|"ava"}        the live voice + turn + model + audio settings on the agent
//   {action:"call", conversation_id}                   ElevenLabs' own record of one call (phone leg, termination, errors)
// Read-only. (A "tune" action was tried on 2026-10-05 to cap the filler count at 1: ElevenLabs accepts the PATCH but keeps 5,
// so there is nothing to fix from our side and the action was removed.)

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const XI = "https://api.elevenlabs.io/v1";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

const err = (error: string, status = 400) => Response.json({ ok: false, error }, { status, headers: CORS });
const ok = (b: Record<string, unknown>) => Response.json({ ok: true, ...b }, { headers: CORS });

async function vault(name: string): Promise<string | null> {
  const { data, error } = await db.rpc("ava_secret", { p_name: name });
  return error || typeof data !== "string" || !data ? null : data;
}
async function isAdmin(req: Request): Promise<boolean> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (SERVICE_KEYS.has(token)) return true;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return data === true;
}

// deno-lint-ignore no-explicit-any
type Raw = Record<string, any>;

async function agent(key: string, source: string): Promise<Response> {
  const { data } = source === "roofguard"
    ? await db.from("rg_settings").select("agent_id, voice_id, llm, llm_fallbacks").eq("id", true).maybeSingle()
    : await db.from("ava_settings").select("agent_id, voice_id, llm, llm_fallbacks").limit(1).maybeSingle();
  if (!data?.agent_id) return err("That Ava has no agent yet.", 404);
  const r = await fetch(`${XI}/convai/agents/${data.agent_id}`, { headers: { "xi-api-key": key } }).catch(() => null);
  if (!r?.ok) { await r?.text().catch(() => ""); return err("Couldn't read the agent from ElevenLabs.", 502); }
  const a: Raw = await r.json();
  const cc: Raw = a.conversation_config ?? {};
  const prompt: Raw = cc.agent?.prompt ?? {};
  return ok({
    ours: { voice_id: data.voice_id, llm: data.llm, llm_fallbacks: data.llm_fallbacks },
    live: {
      tts: cc.tts, turn: cc.turn, asr: cc.asr,
      llm: prompt.llm, temperature: prompt.temperature, backup_llm_config: prompt.backup_llm_config ?? null,
      tools: Object.keys(prompt.built_in_tools ?? {}),
      conversation: cc.conversation,
    },
  });
}

async function call(key: string, cid: string): Promise<Response> {
  if (!/^conv_[A-Za-z0-9]{6,60}$/.test(cid)) return err("Pick a call.");
  const r = await fetch(`${XI}/convai/conversations/${cid}`, { headers: { "xi-api-key": key } }).catch(() => null);
  if (!r?.ok) { await r?.text().catch(() => ""); return err("Couldn't read that call from ElevenLabs.", 502); }
  const c: Raw = await r.json();
  const m: Raw = c.metadata ?? {};
  return ok({
    status: c.status, has_audio: c.has_audio, has_response_audio: c.has_response_audio,
    metadata: {
      call_duration_secs: m.call_duration_secs, termination_reason: m.termination_reason, error: m.error ?? null,
      phone_call: m.phone_call ?? null, features_usage: m.features_usage ?? null, main_language: m.main_language ?? null,
      charging: m.charging ? { call_charge: m.charging.call_charge, llm_price: m.charging.llm_price, tier: m.charging.tier } : null,
    },
    analysis: c.analysis ? { call_successful: c.analysis.call_successful } : null,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await isAdmin(req))) return new Response("unauthorized", { status: 401, headers: CORS });
  const b = await req.json().catch(() => ({}));
  const key = await vault("elevenlabs_api_key");
  if (!key) return err("The ElevenLabs key is missing from Vault.", 412);
  try {
    switch (b.action) {
      case "agent": return await agent(key, b.source === "ava" ? "ava" : "roofguard");
      case "call": return await call(key, String(b.conversation_id ?? ""));
      default: return err("unknown action");
    }
  } catch (e) {
    return err(`Something went wrong (${e instanceof Error ? e.message : "error"}).`, 500);
  }
});
