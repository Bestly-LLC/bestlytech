// ava-assistant: Jared's personal AI assistant, separate from RoofGuard (Spark, 2026-10-04).
//
// Her line is (816) 429-9495. Anyone can call it: Ava answers, recognizes saved contacts (Mom) by caller ID, takes a
// message, and Jared gets it as a Scout push. From /admin/ava Jared can also have her call someone for a reason he types.
//
//   {action:"setup"}     admin: builds her own Telnyx pieces (outbound profile, outbound SIP credentials, an inbound
//                        connection pointed at ElevenLabs), her own ElevenLabs agent + post-call webhook + caller-lookup
//                        webhook, moves the number off RoofGuard, imports it for inbound + outbound. Safe to re-run.
//   {action:"call"}      admin (JWT): {phone, name, purpose, first_line} -> one outbound call.
//   {action:"live"}      admin (JWT): calls in progress right now (either direction) with the transcript so far.
//   {action:"audio"}     admin (JWT): {call_id} -> the recording.
//   ?hook=init           ElevenLabs, at the start of an inbound call: who is calling? -> greeting + contact details.
//                        Guarded by a shared header secret from Vault.
//   ?hook=post           ElevenLabs post-call webhook (HMAC-signed) -> ava_calls row + Scout push with the message.
//
// Nothing here touches rg_* except releasing the number from RoofGuard during setup.
// Secrets come from Vault through ava_secret() (service role only, allowlisted).

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const XI = "https://api.elevenlabs.io/v1";
const SELF = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ava-assistant`;
const LINE = "+18164299495";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

async function vault(name: string): Promise<string | null> {
  const { data, error } = await db.rpc("ava_secret", { p_name: name });
  return error || typeof data !== "string" || !data ? null : data;
}
const rnd = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
async function hmacHex(secret: string, msg: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
const serviceCall = (req: Request) => {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return [bearer, (req.headers.get("apikey") ?? "").trim()].some((t) => t && SERVICE_KEYS.has(t));
};
async function isAdmin(req: Request): Promise<boolean> {
  if (serviceCall(req)) return true;
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return false;
  const { data } = await db.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return data === true;
}
const toE164 = (v: string) => {
  const d = String(v ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? `+1${d}` : null;
};
const nowVars = () => {
  const tz = "America/Los_Angeles", now = new Date();
  return {
    today: new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now),
    local_time: new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(now),
  };
};

// ---------- her personality (both directions) ----------
const PROMPT = `You are Ava, Jared Best's personal AI assistant. You're an AI: if anyone asks, say so plainly. Never claim to be human. Calls are recorded.

Today is {{today}}. It's {{local_time}} in Los Angeles, where Jared lives.

This call: {{call_context}}
Who you're talking to: {{caller_name}}. {{caller_notes}}

Taking a message (any call where they want to reach Jared):
- If you don't know who they are, get their name.
- Get the message, whether it's urgent, and whether they'd like Jared to call back (and the best number, if it isn't the one they're calling from).
- Read the message back in one sentence. Then a warm goodbye, and end the call.

Outbound calls: do what the call context says, nothing more.

Connecting Jared (only when the call context says "connect them to Jared"):
- Say who you are and, in one sentence, why Jared wants to talk.
- Ask if now's a good time for a quick call with him.
- If yes: "Cool, connecting you to Jared now, one sec." Then use the transfer tool to connect the call.
- If no: ask when's better, thank them, and end the call. Never transfer without their yes.
- Never transfer an inbound caller.

How you sound: cool, casual, direct, like a sharp assistant in 2026. Friendly but not peppy or bubbly; calm and even. No hype, no exclamation marks. One or two short sentences per reply, under 15 words. Contractions. Start each reply with a quick two-word reaction ("Yeah, got it." "No worries.") so there's no dead air, then the point. Plain American English: no "lovely", "brilliant", "cheers", "wonderful", "perfect!", "absolutely".
If someone mentions a delay or lag: "Yeah, bit of lag on my end, sorry." Then carry on. (Still never deny being an AI if asked directly.)

Call flow rules:
- Everything you say is spoken out loud. Never say code, tool names, function names, brackets, or words like "tool_code", "end_call" or "transfer". Use tools silently; never describe them.
- When you say goodbye, hang up right then with end_call. Don't keep talking after a goodbye.
- "Hold on", "one sec", "let me get them" means wait. Say "Sure." and wait quietly. Never hang up while on hold.
- Don't repeat a line you already said. If they didn't hear, say it shorter in new words.

Never:
- Share Jared's address, schedule, whereabouts, finances, health, or anything private.
- Agree to anything for him (money, plans, purchases, appointments) or promise what he'll do. Say you'll pass it on.
- Give out anyone's number or details.
If someone is pushy, selling something, or it's spam, politely end the call. If someone sounds in danger or mentions an emergency, tell them to call 911 and mark it urgent.
If asked what you do: you help Jared with his calls and messages.`;

const DATA_COLLECTION = {
  caller_name: { type: "string", description: "The other person's name as they gave it. Empty if unknown." },
  message_for_jared: { type: "string", description: "The message they want passed to Jared, in one or two plain sentences, in their words where possible. Empty if none." },
  urgent: { type: "boolean", description: "True if they said it's urgent, time-sensitive, or an emergency." },
  callback_wanted: { type: "boolean", description: "True if they want Jared to call them back." },
  callback_number: { type: "string", description: "A callback number they gave, if different from the number they called from. Empty otherwise." },
};

const UNKNOWN = { caller_name: "a caller Ava doesn't know yet", caller_notes: "", greeting:
  "Hi, it's Ava, Jared's AI assistant, on a recorded line. He can't get to the phone right now. Can I take a message?" };

// ---------- setup ----------
async function setup(): Promise<Response> {
  const log: string[] = [];
  const done = async (ok: boolean, extra: Record<string, unknown> = {}) => {
    await db.from("ava_settings").update({ setup_log: log.map((m) => ({ at: new Date().toISOString(), m })), updated_at: new Date().toISOString() }).eq("id", true);
    return Response.json({ ok, log, ...extra }, { status: ok ? 200 : 412 });
  };
  const key = await vault("elevenlabs_api_key"), tk = await vault("telnyx_api_key");
  if (!key || !tk) { log.push("ElevenLabs or Telnyx key missing from Vault."); return done(false); }
  const { data: s } = await db.from("ava_settings").select("*").eq("id", true).single();
  const save = (p: Record<string, unknown>) => db.from("ava_settings").update(p).eq("id", true);
  const xi = (path: string, method: string, body?: unknown) => fetch(`${XI}${path}`, { method, headers: { "xi-api-key": key, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const tx = (path: string, method: string, body?: unknown) => fetch(`https://api.telnyx.com/v2${path}`, { method, headers: { authorization: `Bearer ${tk}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const first = async (path: string) => ((await (await tx(path, "GET")).json().catch(() => ({}))).data ?? [])[0]?.id ?? null;

  // 1. the number
  const nr = await tx(`/phone_numbers?filter[phone_number]=${encodeURIComponent(LINE)}`, "GET");
  const num = ((await nr.json().catch(() => ({}))).data ?? [])[0] as { id: string; phone_number: string } | undefined;
  if (!num) { log.push(`${LINE} isn't on the Telnyx account.`); return done(false); }
  log.push(`Her line: ${num.phone_number}`);

  // 2. Telnyx: her own outbound profile, outbound SIP credentials, and an inbound connection pointed at ElevenLabs
  let ovp = s?.telnyx_ovp_id ?? await first(`/outbound_voice_profiles?filter[name][contains]=${encodeURIComponent("Ava assistant")}`);
  if (!ovp) {
    const r = await tx("/outbound_voice_profiles", "POST", { name: "Ava assistant", traffic_type: "conversational", service_plan: "global",
      usage_payment_method: "rate-deck", whitelisted_destinations: ["US", "CA"], concurrent_call_limit: 2, daily_spend_limit: "5.00", daily_spend_limit_enabled: true });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { log.push(`Outbound profile failed (${r.status}): ${JSON.stringify(j).slice(0, 200)}`); return done(false); }
    ovp = j.data.id; log.push("Outbound profile created (US and Canada, $5/day cap).");
  }
  await save({ telnyx_ovp_id: ovp });

  let out = s?.telnyx_out_connection_id ?? null, sipUser = "", sipPass = await vault("ava_sip_password");
  if (!out && sipPass) out = await first(`/credential_connections?filter[connection_name][contains]=${encodeURIComponent("Ava assistant out")}`);
  if (!out || !sipPass) {
    sipUser = `avaasst${rnd(4)}`; sipPass = rnd(16);
    const r = await tx("/credential_connections", "POST", { connection_name: "Ava assistant out", user_name: sipUser, password: sipPass, outbound: { outbound_voice_profile_id: ovp } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { log.push(`Outbound SIP connection failed (${r.status}): ${JSON.stringify(j).slice(0, 200)}`); return done(false); }
    out = j.data.id; await db.rpc("ava_secret_put", { p_name: "ava_sip_password", p_value: sipPass });
    log.push("Outbound SIP connection created; password in Vault.");
  } else {
    sipUser = ((await (await tx(`/credential_connections/${out}`, "GET")).json().catch(() => ({}))).data?.user_name) ?? "";
  }
  await save({ telnyx_out_connection_id: out });

  let inc = s?.telnyx_in_connection_id ?? await first(`/fqdn_connections?filter[connection_name][contains]=${encodeURIComponent("Ava assistant in")}`);
  if (!inc) {
    const r = await tx("/fqdn_connections", "POST", { connection_name: "Ava assistant in", transport_protocol: "TCP",
      inbound: { ani_number_format: "+E.164", dnis_number_format: "+e164" } });   // inbound only (an outbound profile is refused until configured)
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { log.push(`Inbound connection failed (${r.status}): ${JSON.stringify(j).slice(0, 200)}`); return done(false); }
    inc = j.data.id;
    const f = await tx("/fqdns", "POST", { connection_id: inc, fqdn: "sip.rtc.elevenlabs.io", port: 5060, dns_record_type: "a" });
    if (!f.ok) log.push(`Note: could not point the inbound connection at ElevenLabs (${f.status}): ${(await f.text()).slice(0, 200)}`);
    else log.push("Inbound connection created, pointed at ElevenLabs.");
  }
  await save({ telnyx_in_connection_id: inc });
  const pa = await tx(`/phone_numbers/${num.id}`, "PATCH", { connection_id: inc });
  if (!pa.ok) log.push(`Note: could not route incoming calls (${pa.status}): ${(await pa.text()).slice(0, 200)}`);
  else log.push("Incoming calls to her line now go to Ava.");

  // 3. release the number from RoofGuard (its ElevenLabs import and its settings)
  const { data: rg } = await db.from("rg_settings").select("phone_number_id, from_number, callback_number").eq("id", true).maybeSingle();
  if (rg?.from_number === LINE && rg.phone_number_id) {
    const d = await xi(`/convai/phone-numbers/${rg.phone_number_id}`, "DELETE");
    log.push(d.ok || d.status === 404 ? "Released the number from RoofGuard's caller." : `Note: RoofGuard release returned ${d.status}.`);
  }
  if (rg && (rg.from_number === LINE || rg.callback_number === LINE)) {
    await db.from("rg_settings").update({
      ...(rg.from_number === LINE ? { phone_number_id: null, from_number: null } : {}),
      ...(rg.callback_number === LINE ? { callback_number: null } : {}),
      updated_at: new Date().toISOString(), updated_by: "ava-assistant setup" }).eq("id", true);
    log.push("RoofGuard no longer uses this number (it needs its own before calling again).");
  }

  // 4. webhooks: post-call (HMAC, secret in Vault) and caller lookup (header secret in Vault)
  let webhookId = s?.webhook_id ?? null;
  if (!webhookId && await vault("ava_webhook_secret")) {
    const list = ((await (await xi("/workspace/webhooks", "GET")).json().catch(() => ({}))).webhooks ?? []) as { webhook_id: string; name: string }[];
    webhookId = list.find((w) => w.name === "Ava assistant post-call")?.webhook_id ?? null;
  }
  if (!webhookId) {
    const r = await xi("/workspace/webhooks", "POST", { settings: { auth_type: "hmac", name: "Ava assistant post-call", webhook_url: `${SELF}?hook=post` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.webhook_id) { log.push(`Post-call webhook failed (${r.status}).`); return done(false); }
    webhookId = j.webhook_id;
    if (j.webhook_secret) await db.rpc("ava_secret_put", { p_name: "ava_webhook_secret", p_value: j.webhook_secret });
    log.push("Post-call webhook created; secret in Vault.");
  }
  await save({ webhook_id: webhookId });
  let initSecret = await vault("ava_init_secret");
  if (!initSecret) { initSecret = rnd(24); await db.rpc("ava_secret_put", { p_name: "ava_init_secret", p_value: initSecret }); }

  // 5. her agent
  const agentBody = {
    name: "Ava (Jared's assistant)",
    conversation_config: {
      agent: {
        first_message: "{{greeting}}", language: "en",
        dynamic_variables: { dynamic_variable_placeholders: { ...UNKNOWN, call_context: "Someone called Jared's line.", ...nowVars() } },
        prompt: { prompt: PROMPT, llm: s?.llm ?? "gpt-4.1-mini", temperature: 0.5,
          built_in_tools: {
            end_call: { name: "end_call", params: { system_tool_type: "end_call" } },
            // "Connect me": can only ever dial Jared's own cell
            transfer_to_number: { name: "transfer_to_number", params: { system_tool_type: "transfer_to_number", transfers: [{
              phone_number: s?.jared_cell ?? "+18165007236", transfer_type: "sip_refer",
              condition: "Only on an outbound call whose context says to connect them to Jared, after the person said yes to talking now." }] } },
          } },
      },
      // same speed settings as RoofGuard's Ava (keep the two in step)
      turn: { turn_eagerness: "eager", speculative_turn: true,
        soft_timeout_config: { timeout_seconds: 1.0, message: "Yeah...", randomize_fillers: true, max_soft_timeouts_per_generation: 1,
          additional_soft_timeout_messages: ["Mm, right...", "Yeah, so...", "Got it...", "Okay..."] } },
      tts: { voice_id: s?.voice_id ?? "pFZP5JQG7iQjIQuC4Bku", model_id: "eleven_flash_v2", stability: 0.55, similarity_boost: 0.8, optimize_streaming_latency: 4, speed: 1.05 },
    },
    platform_settings: {
      data_collection: DATA_COLLECTION,
      overrides: { enable_conversation_initiation_client_data_from_webhook: true },
      workspace_overrides: {
        webhooks: { post_call_webhook_id: webhookId, events: ["transcript"], send_audio: false },
        conversation_initiation_client_data_webhook: { url: `${SELF}?hook=init`, request_headers: { "x-ava-init": initSecret } },
      },
    },
  };
  let agentId = s?.agent_id ?? null;
  const ar = agentId ? await xi(`/convai/agents/${agentId}`, "PATCH", agentBody) : await xi("/convai/agents/create", "POST", agentBody);
  const aj = await ar.json().catch(() => ({}));
  if (!ar.ok) { log.push(`Agent ${agentId ? "update" : "create"} failed (${ar.status}): ${JSON.stringify(aj).slice(0, 300)}`); return done(false); }
  agentId = agentId ?? aj.agent_id;
  await save({ agent_id: agentId });
  log.push(`Agent ready: ${agentId}`);

  // 6. the number in ElevenLabs: inbound + outbound, pointed at her
  const trunk = { address: "sip.telnyx.com", transport: "tcp", credentials: { username: sipUser, password: sipPass } };
  let phoneId = s?.phone_number_id ?? null;
  if (!phoneId) {
    const list = ((await (await xi("/convai/phone-numbers", "GET")).json().catch(() => [])) ?? []) as { phone_number: string; phone_number_id: string }[];
    phoneId = (Array.isArray(list) ? list : []).find((p) => p.phone_number === LINE)?.phone_number_id ?? null;
  }
  if (!phoneId) {
    const pr = await xi("/convai/phone-numbers", "POST", { provider: "sip_trunk", phone_number: LINE, label: "Ava (Jared's assistant)", agent_id: agentId,
      supports_inbound: true, supports_outbound: true, outbound_trunk_config: trunk });
    const pj = await pr.json().catch(() => ({}));
    if (!pr.ok || !pj.phone_number_id) { log.push(`Number import failed (${pr.status}): ${JSON.stringify(pj).slice(0, 300)}`); return done(false); }
    phoneId = pj.phone_number_id;
  } else {
    const up = await xi(`/convai/phone-numbers/${phoneId}`, "PATCH", { agent_id: agentId, outbound_trunk_config: trunk });
    if (!up.ok) log.push(`Note: number update returned ${up.status}: ${(await up.text()).slice(0, 200)}`);
  }
  await save({ phone_number_id: phoneId, from_number: LINE });
  log.push("Ava answers (816) 429-9495 and can call out from it.");
  return done(true, { agent_id: agentId, phone_number_id: phoneId });
}

// ---------- outbound ----------
async function call(body: Record<string, unknown>): Promise<Response> {
  const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status, headers: CORS });
  const to = toE164(String(body.phone ?? ""));
  if (!to) return bad("Enter a 10-digit US or Canada number.");
  const { data: s } = await db.from("ava_settings").select("*").eq("id", true).single();
  const key = await vault("elevenlabs_api_key");
  if (!s?.agent_id || !s.phone_number_id || !key) return bad("Ava isn't set up yet. Run Setup on /admin/ava.", 412);
  const { data: contact } = await db.from("ava_contacts").select("id, name, relationship, notes").eq("phone", to).maybeSingle();
  const name = String(body.name ?? "").trim().slice(0, 40) || contact?.name || "";
  const purpose = String(body.purpose ?? "").trim().slice(0, 600) || "Jared asked you to call and say hello.";
  const connect = body.connect === true;
  const greeting = String(body.first_line ?? "").trim().slice(0, 300) ||
    `Hi${name ? ` ${name.split(" ")[0]}` : ""}, it's Ava, Jared's AI assistant, on a recorded line. ${body.connect === true ? "Jared would love a quick word with you." : "He asked me to give you a call."}`;
  const res = await fetch(`${XI}/convai/sip-trunk/outbound-call`, {
    method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ agent_id: s.agent_id, agent_phone_number_id: s.phone_number_id, to_number: to,
      conversation_initiation_client_data: { dynamic_variables: {
        greeting, call_context: connect
          ? `An outbound call to connect them to Jared. Why he wants to talk: ${purpose}. Check they're free, then connect them to Jared.`
          : `An outbound call Jared asked you to make. Why: ${purpose}`,
        caller_name: name || "them", caller_notes: contact ? `(${contact.relationship ?? "contact"}) ${contact.notes ?? ""}` : "", ...nowVars() } } }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.success === false) return bad(`The call didn't go out: ${JSON.stringify(j).slice(0, 200)}`, 502);
  const { data: row } = await db.from("ava_calls").insert({ direction: "outbound", phone: to, contact_id: contact?.id ?? null, caller_name: name || null,
    purpose, conversation_id: j.conversation_id ?? null, status: "queued", connect_to_jared: connect }).select("id").single();
  return Response.json({ ok: true, call_id: row?.id, calling: to }, { headers: CORS });
}

// ---------- live + audio ----------
type Turn = { role: string; message: string | null; time_in_call_secs?: number };
const slim = (t: Turn[] | undefined) => (t ?? []).filter((x) => x.message).map((x) => ({ role: x.role, text: x.message, t: x.time_in_call_secs ?? 0 }));

async function live(callId: string | null): Promise<Response> {
  const { data: s } = await db.from("ava_settings").select("agent_id").eq("id", true).single();
  const key = await vault("elevenlabs_api_key");
  if (!s?.agent_id || !key) return Response.json({ ok: true, calls: [] }, { headers: CORS });
  let active: { conversation_id: string; status: string }[];
  if (callId) {
    // one call (the dialer's in-call screen), followed through to the end
    const { data: r } = await db.from("ava_calls").select("conversation_id").eq("id", callId).maybeSingle();
    active = r?.conversation_id ? [{ conversation_id: r.conversation_id, status: "" }] : [];
  } else {
    const lr = await fetch(`${XI}/convai/conversations?agent_id=${s.agent_id}&page_size=10`, { headers: { "xi-api-key": key } });
    const list = ((await lr.json().catch(() => ({}))).conversations ?? []) as { conversation_id: string; status: string }[];
    active = list.filter((c) => ["initiated", "in-progress", "processing"].includes(c.status)).slice(0, 3);
  }
  const calls = await Promise.all(active.map(async (c) => {
    const d = await (await fetch(`${XI}/convai/conversations/${c.conversation_id}`, { headers: { "xi-api-key": key } })).json().catch(() => ({}));
    const pc = d.metadata?.phone_call ?? {};
    const phone = pc.external_number ?? null;
    const { data: row } = await db.from("ava_calls").select("id, caller_name, direction").eq("conversation_id", c.conversation_id).maybeSingle();
    const { data: contact } = phone ? await db.from("ava_contacts").select("name").eq("phone", phone).maybeSingle() : { data: null };
    return { conversation_id: c.conversation_id, call_id: row?.id ?? null, status: d.status ?? c.status,
      direction: row?.direction ?? pc.direction ?? "inbound", phone, who: contact?.name ?? row?.caller_name ?? null,
      elapsed: d.metadata?.start_time_unix_secs ? Math.round(Date.now() / 1000 - d.metadata.start_time_unix_secs) : 0,
      duration: d.metadata?.call_duration_secs ?? null, transcript: slim(d.transcript) };
  }));
  return Response.json({ ok: true, calls }, { headers: CORS });
}

async function audio(callId: string): Promise<Response> {
  const key = await vault("elevenlabs_api_key");
  const { data: c } = await db.from("ava_calls").select("conversation_id").eq("id", callId).maybeSingle();
  if (!key || !c?.conversation_id) return new Response("no recording for this call", { status: 404, headers: CORS });
  const res = await fetch(`${XI}/convai/conversations/${c.conversation_id}/audio`, { headers: { "xi-api-key": key } });
  if (!res.ok || !res.body) return new Response("recording not available yet", { status: res.status === 404 ? 404 : 502, headers: CORS });
  return new Response(res.body, { headers: { ...CORS, "content-type": res.headers.get("content-type") ?? "audio/mpeg", "cache-control": "private, max-age=3600" } });
}

// ---------- webhooks ----------
async function initHook(req: Request): Promise<Response> {
  const secret = await vault("ava_init_secret");
  if (!secret || req.headers.get("x-ava-init") !== secret) return new Response("unauthorized", { status: 401 });
  const b = await req.json().catch(() => ({}));
  const caller = toE164(String(b.caller_id ?? "")) ?? String(b.caller_id ?? "");
  const { data: c } = caller ? await db.from("ava_contacts").select("name, relationship, notes").eq("phone", caller).maybeSingle() : { data: null };
  const vars = c ? {
    caller_name: c.name, caller_notes: `They're Jared's ${c.relationship ?? "contact"}. ${c.notes ?? ""}`,
    greeting: `Hi ${c.name}! It's Ava, Jared's assistant, on a recorded line. He can't get to the phone, but I'd love to take a message for him.`,
  } : UNKNOWN;
  return Response.json({ type: "conversation_initiation_client_data",
    dynamic_variables: { ...vars, call_context: "Someone called Jared's line. Take a message.", ...nowVars() } });
}

async function postHook(req: Request): Promise<Response> {
  const secret = await vault("ava_webhook_secret");
  if (!secret) return new Response("webhook secret not configured", { status: 412 });
  const raw = await req.text();
  const sig = req.headers.get("elevenlabs-signature") ?? "";
  const t = sig.match(/t=(\d+)/)?.[1], v0 = sig.match(/v0=([0-9a-f]+)/)?.[1];
  if (!t || !v0 || Math.abs(Date.now() / 1000 - Number(t)) > 30 * 60) return new Response("bad signature", { status: 401 });
  if ((await hmacHex(secret, `${t}.${raw}`)) !== v0) return new Response("bad signature", { status: 401 });

  const evt = JSON.parse(raw);
  if (evt.type !== "post_call_transcription") return Response.json({ ok: true, ignored: evt.type });
  const d = evt.data ?? {};
  const dc = d.analysis?.data_collection_results ?? {};
  const val = (k: string) => { const v = dc[k]?.value; return v == null || v === "" ? null : String(v); };
  const pc = d.metadata?.phone_call ?? {};
  const phone = toE164(String(pc.external_number ?? "")) ?? pc.external_number ?? null;
  const { data: contact } = phone ? await db.from("ava_contacts").select("id, name").eq("phone", phone).maybeSingle() : { data: null };
  // deno-lint-ignore no-explicit-any
  const llm = (d.transcript ?? []).reduce((sum: number, turn: any) => sum + Object.values(turn?.llm_usage?.model_usage ?? {}).reduce((a: number, u: any) =>
    a + (u?.input?.price ?? 0) + (u?.output_total?.price ?? 0) + (u?.input_cache_read?.price ?? 0) + (u?.input_cache_write?.price ?? 0), 0), 0);
  const message = val("message_for_jared");
  const urgent = val("urgent") === "true";
  const callerName = val("caller_name") ?? contact?.name ?? null;
  const cbNum = val("callback_number");
  const row = {
    phone, contact_id: contact?.id ?? null, caller_name: callerName, status: "completed", summary: d.analysis?.transcript_summary ?? null,
    message: message ? (cbNum ? `${message} (call back: ${cbNum})` : message) : null, urgent, callback_wanted: val("callback_wanted") === "true",
    duration_sec: d.metadata?.call_duration_secs ?? null, transcript: d.transcript ?? null, llm_cost: Math.round(llm * 10000) / 10000,
    ended_at: new Date().toISOString(),
  };
  const { data: existing } = await db.from("ava_calls").select("id, direction").eq("conversation_id", d.conversation_id).maybeSingle();
  const direction = existing?.direction ?? (pc.direction === "outbound" ? "outbound" : "inbound");
  if (existing) await db.from("ava_calls").update(row).eq("id", existing.id);
  else await db.from("ava_calls").insert({ ...row, direction, conversation_id: d.conversation_id });

  const who = callerName ?? (phone ? phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : "Someone");
  if (message || direction === "inbound") {
    await db.rpc("scout_notify", { p_title: `${urgent ? "Urgent: " : ""}Message from ${who}`, p_body: message ?? row.summary ?? "Called Ava, no message left.",
      p_severity: urgent ? "warning" : "info", p_push: true, p_url: "/admin/ava", p_dedupe: `ava-msg-${d.conversation_id}` });
  } else {
    await db.rpc("scout_notify", { p_title: `Ava's call with ${who} finished`, p_body: row.summary ?? "", p_severity: "info", p_push: true,
      p_url: "/admin/ava", p_dedupe: `ava-out-${d.conversation_id}` });
  }
  return Response.json({ ok: true, direction, message: !!message });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  if (url.searchParams.get("hook") === "init") return initHook(req);
  if (url.searchParams.get("hook") === "post") return postHook(req);
  if (!(await isAdmin(req))) return new Response("unauthorized", { status: 401, headers: CORS });
  const body = await req.json().catch(() => ({}));
  if (body.action === "setup") return setup();
  if (body.action === "call") return call(body);
  if (body.action === "live") return live(body.call_id ? String(body.call_id) : null);
  if (body.action === "audio") return audio(String(body.call_id ?? ""));
  return Response.json({ ok: false, error: "unknown action" }, { status: 400, headers: CORS });
});
