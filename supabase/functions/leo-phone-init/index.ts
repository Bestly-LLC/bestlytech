// ElevenLabs call-start webhook for Leo's phone line (310) 622-7052, plus an hourly self-heal watch.
// POST (no op): ElevenLabs asks for dynamic variables at call start. Returns trip_key etc. so calls don't fail.
// POST ?op=watch: pg_cron checks ElevenLabs still points its call-start webhook here and that Leo has the
//   toggle on; repairs the webhook if it drifted, raises an alert (owner: Leo) if anything is off.
// Auth: x-leo-init header must match Vault leo_phone_init_token (checked in SQL, never logged).
// verify_jwt = false (ElevenLabs and pg_cron call it with the header token, not a Supabase JWT).
import { createClient } from "npm:@supabase/supabase-js@2";

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
};

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
function reply(vars: Record<string, unknown>) {
  return json({ type: "conversation_initiation_client_data", dynamic_variables: { ...DEFAULTS, ...vars } });
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
  try {
    const { data, error } = await SB.rpc("leo_phone_caller", { p_caller: caller });
    if (error) throw new Error(error.message);
    return reply((data ?? {}) as Record<string, unknown>);
  } catch (e) {
    await raise("leo.phone-init", "problem", "Leo: caller lookup failed",
      "A call to (310) 622-7052 got safe defaults because the caller lookup errored: " + String((e as Error)?.message ?? e));
    return reply({});
  }
});
