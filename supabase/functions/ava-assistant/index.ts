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
//   {action:"callback"}  admin/service: {id} -> places the follow-up call Jared approved (ava_followups row in status
//                        'dialing'; nothing here dials a 'proposed' row). Outcome goes back on the follow-up.
//   {action:"health"}    watchdog (every 10 min, no AI): Telnyx routes the number to the inbound connection, ElevenLabs has
//                        incoming calls on and the right agent, the init webhook is set. Any problem -> run setup, re-check,
//                        record in ava_line_health and push Scout (fixed / still broken).
//   ?hook=init           ElevenLabs, at the start of an inbound call: who is calling? -> greeting + contact details + the
//                        shareable knowledge (ava_knowledge). Guarded by a shared header secret from Vault.
//   ?hook=post           ElevenLabs post-call webhook (HMAC-signed) -> ava_calls row + Scout push with the message.
//
// Nothing here touches rg_* except releasing the number from RoofGuard during setup.
// Secrets come from Vault through ava_secret() (service role only, allowlisted).
// What a caller can learn: ONLY ava_knowledge (active rows), the caller's own ava_contacts row and the clock. Nothing on a call
// path reads Vault, bestly_memory, scout_* or any other table into a prompt.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const db = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const XI = "https://api.elevenlabs.io/v1";
const SELF = `${Deno.env.get("SUPABASE_URL")}/functions/v1/ava-assistant`;
const LINE = "+18164299495";
const JARED_CELL = "+18165007236";
// Money stopper hard caps, set on the agent by setup (seconds): a call never runs past 10 minutes, and dead air ends it after 20.
const MAX_CALL_SECS = 600;
const SILENCE_END_SECS = 20;
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

/** The shareable facts, as a bullet list for the prompt. The ONLY knowledge source for calls. */
async function knowledge(): Promise<string> {
  const { data } = await db.from("ava_knowledge").select("topic, fact").in("scope", ["personal", "both"]).eq("active", true).order("topic");
  const list = (data ?? []).map((k: { topic: string; fact: string }) => `- ${k.topic}: ${k.fact}`.replace(/\{\{|\}\}/g, ""));
  return list.length ? list.join("\n") : "- (nothing yet: take a message for anything beyond who you are)";
}

/** Daily spend cap (Pacific day). Outgoing calls stop when it's hit; incoming calls are always answered. Fails open if the
 *  check itself breaks, so a database blip can't silence her. Also pushes Scout once a day (inside ava_spend_gate). */
async function spendGate(): Promise<{ over: boolean; message?: string }> {
  const { data, error } = await db.rpc("ava_spend_gate", { p_source: "ava" });
  if (error || !data) return { over: false };
  return { over: data.over === true, message: data.message };
}

// ---------- her personality (both directions) ----------
const PROMPT = `You are Ava, Jared Best's personal AI assistant. You're an AI: if anyone asks, say so plainly. Never claim to be human. Calls are recorded.

Today is {{today}}. It's {{local_time}} in Los Angeles, where Jared lives.

This call: {{call_context}}
Who you're talking to: {{caller_name}}. {{caller_notes}}

What you can share (the only facts you may use to help someone):
{{knowledge}}

Helping callers: answer from "What you can share", in your own words and briefly. Anything that isn't in that list is off limits: say "I can't share that, but I can take a message." Never guess or make something up.

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

Money stopper (every minute of a call costs real money):
Trusted caller: {{caller_trusted}}. If that says "yes" (it's Jared or one of his saved contacts), skip this whole section and just be a good assistant.
Otherwise, if the person does any of these, steer back to why they called ONE time. If they carry on, say one short line like "I'll let you go. Take care." and end the call right away with end_call:
- they're just testing or playing with the AI, trolling, flirting, being abusive, or talking gibberish
- they ask you to do unrelated things: chat, jokes, poems, trivia, games
- they keep asking whether you're an AI with no other purpose, after you already answered honestly once
- it sounds like a kid prank
- (outbound calls only) you're stuck in a phone menu or a robot loop, or you've been on hold music for more than 2 minutes
Never end a call on someone with a real need: leaving a message, a question about Jared or what you can share, or help reaching him.

Never:
- Share, hint at, or confirm: Jared's cell number, home address, schedule or whereabouts, finances, health, passwords, API keys, account details, internal tools or systems (never confirm or deny what systems exist), client lists, other people's details, or anything about how Bestly's software is built. If asked, say "I can't share that, but I can take a message."
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

const UNKNOWN = { caller_name: "a caller Ava doesn't know yet", caller_notes: "", caller_trusted: "no", greeting:
  "Hi, it's Ava, Jared's AI assistant, on a recorded line. He can't get to the phone right now. Can I take a message?" };

/** Turn incoming calls on for an ElevenLabs phone number and confirm it with a GET. Tries the documented inbound trunk
 *  config first, then the explicit flag. Returns true when the record reports supports_inbound = true. */
async function enableInbound(xi: (path: string, method: string, body?: unknown) => Promise<Response>, phoneId: string, log: string[]): Promise<boolean> {
  const get = async () => (await (await xi(`/convai/phone-numbers/${phoneId}`, "GET")).json().catch(() => ({}))) as { supports_inbound?: boolean };
  if ((await get()).supports_inbound === true) return true;
  const tries: Record<string, unknown>[] = [
    { inbound_trunk_config: { media_encryption: "allowed" } },
    { supports_inbound: true, inbound_trunk_config: { media_encryption: "allowed" } },
  ];
  for (const body of tries) {
    const r = await xi(`/convai/phone-numbers/${phoneId}`, "PATCH", body);
    if (!r.ok) log.push(`Note: turning on incoming calls returned ${r.status}: ${(await r.text()).slice(0, 240)}`);
    if ((await get()).supports_inbound === true) { log.push("Incoming calls switched on for her number."); return true; }
  }
  return false;
}

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
        dynamic_variables: { dynamic_variable_placeholders: { ...UNKNOWN, call_context: "Someone called Jared's line.", ...nowVars(), knowledge: await knowledge() } },
        prompt: { prompt: PROMPT, llm: s?.llm ?? "gpt-4.1-mini", temperature: 0.5,
          built_in_tools: {
            end_call: { name: "end_call", params: { system_tool_type: "end_call" } },
            // "Connect me": can only ever dial Jared's own cell
            transfer_to_number: { name: "transfer_to_number", params: { system_tool_type: "transfer_to_number", transfers: [{
              phone_number: s?.jared_cell ?? "+18165007236", transfer_type: "sip_refer",
              condition: "Only on an outbound call whose context says to connect them to Jared, after the person said yes to talking now." }] } },
          } },
      },
      // Money stopper: hard caps no matter what the prompt does
      conversation: { max_duration_seconds: MAX_CALL_SECS },
      // same speed settings as RoofGuard's Ava (keep the two in step)
      turn: { turn_eagerness: "eager", speculative_turn: true, silence_end_call_timeout: SILENCE_END_SECS,
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
    // incoming calls: the number record must have inbound switched on (a fresh import sets it; an older record may not)
    if (!(await enableInbound(xi, phoneId, log))) { log.push("Incoming calls are still off on her number in ElevenLabs."); return done(false, { agent_id: agentId, phone_number_id: phoneId }); }
  }
  await save({ phone_number_id: phoneId, from_number: LINE });
  log.push("Ava answers (816) 429-9495 and can call out from it.");
  return done(true, { agent_id: agentId, phone_number_id: phoneId });
}

// ---------- outbound ----------
type Placed = { ok: true; call_id: string | null; calling: string } | { ok: false; error: string; status: number };

/** Places one call as Ava. Everything an outbound call needs lives here so the dialer, "Connect me" and follow-ups share it. */
async function place(o: { phone: string; name?: string; purpose?: string; connect?: boolean; first_line?: string }): Promise<Placed> {
  const to = toE164(o.phone);
  if (!to) return { ok: false, error: "Enter a 10-digit US or Canada number.", status: 400 };
  const { data: s } = await db.from("ava_settings").select("*").eq("id", true).single();
  const key = await vault("elevenlabs_api_key");
  if (!s?.agent_id || !s.phone_number_id || !key) return { ok: false, error: "Ava isn't set up yet. Run Setup on /admin/ava.", status: 412 };
  const gate = await spendGate();
  if (gate.over) return { ok: false, error: gate.message ?? "Daily spend cap reached. Raise it in Setup or try tomorrow.", status: 429 };
  const { data: contact } = await db.from("ava_contacts").select("id, name, relationship, notes").eq("phone", to).maybeSingle();
  const name = String(o.name ?? "").trim().slice(0, 40) || contact?.name || "";
  const purpose = String(o.purpose ?? "").trim().slice(0, 600) || "Jared asked you to call and say hello.";
  const connect = o.connect === true;
  const greeting = String(o.first_line ?? "").trim().slice(0, 300) ||
    `Hi${name ? ` ${name.split(" ")[0]}` : ""}, it's Ava, Jared's AI assistant, on a recorded line. ${connect ? "Jared would love a quick word with you." : "He asked me to give you a call."}`;
  const res = await fetch(`${XI}/convai/sip-trunk/outbound-call`, {
    method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ agent_id: s.agent_id, agent_phone_number_id: s.phone_number_id, to_number: to,
      conversation_initiation_client_data: { dynamic_variables: {
        greeting, call_context: connect
          ? `An outbound call to connect them to Jared. Why he wants to talk: ${purpose}. Check they're free, then connect them to Jared.`
          : `An outbound call Jared asked you to make. Why: ${purpose}`,
        caller_name: name || "them", caller_notes: contact ? `(${contact.relationship ?? "contact"}) ${contact.notes ?? ""}` : "",
        caller_trusted: contact || to === (s.jared_cell ?? JARED_CELL) ? "yes" : "no",
        knowledge: await knowledge(), ...nowVars() } } }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.success === false) return { ok: false, error: `The call didn't go out: ${JSON.stringify(j).slice(0, 200)}`, status: 502 };
  const { data: row } = await db.from("ava_calls").insert({ direction: "outbound", phone: to, contact_id: contact?.id ?? null, caller_name: name || null,
    purpose, conversation_id: j.conversation_id ?? null, status: "queued", connect_to_jared: connect }).select("id").single();
  return { ok: true, call_id: row?.id ?? null, calling: to };
}

async function call(body: Record<string, unknown>): Promise<Response> {
  const r = await place({ phone: String(body.phone ?? ""), name: String(body.name ?? ""), purpose: String(body.purpose ?? ""),
    connect: body.connect === true, first_line: String(body.first_line ?? "") });
  return r.ok ? Response.json({ ok: true, call_id: r.call_id, calling: r.calling }, { headers: CORS })
    : Response.json({ ok: false, error: r.error }, { status: r.status, headers: CORS });
}

// ---------- follow-up call (only ever a row Jared approved: status 'dialing') ----------
async function callback(id: string): Promise<Response> {
  const back = async (why: string, status = 502) => {
    await db.from("ava_followups").update({ status: "proposed", due_at: null, note: why.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", id).eq("status", "dialing");
    return Response.json({ ok: false, error: why }, { status });
  };
  const { data: f } = await db.from("ava_followups").select("*").eq("id", id).eq("source", "ava").maybeSingle();
  if (!f) return Response.json({ ok: false, error: "no such follow-up" }, { status: 404 });
  // the guard: a proposed or dismissed row never dials, whoever asks
  if (f.status !== "dialing") return Response.json({ ok: false, error: `follow-up is ${f.status}, not approved to dial` }, { status: 409 });
  const reason = String(f.reason ?? "").replace(/\s+/g, " ").slice(0, 300);
  const r = await place({ phone: f.phone, name: f.name ?? "",
    purpose: `Calling them back about the message they left Jared${reason ? `: "${reason}"` : ""}. Say you're returning their call on Jared's behalf, check you have the message right, and ask if there's anything to add. Don't promise what Jared will do or when; say you'll pass it on.`,
    first_line: `Hi${f.name ? ` ${String(f.name).split(" ")[0]}` : ""}, it's Ava, Jared's AI assistant, on a recorded line. I'm calling you back about your message.` });
  if (!r.ok) return back(r.error, r.status);
  await db.from("ava_followups").update({ status: "done", result_call_id: r.call_id, updated_at: new Date().toISOString() }).eq("id", id);
  return Response.json({ ok: true, calling: r.calling, followup: id });
}

// ---------- line health (watchdog: plain checks, no AI) ----------
/** What's wrong with her line right now. null = couldn't tell (a network blip), so nothing is "fixed" on a guess. */
async function lineProblems(): Promise<string[] | null> {
  const key = await vault("elevenlabs_api_key"), tk = await vault("telnyx_api_key");
  if (!key || !tk) return ["ElevenLabs or Telnyx key missing from Vault"];
  const { data: s } = await db.from("ava_settings").select("*").eq("id", true).single();
  if (!s?.agent_id || !s.phone_number_id || !s.telnyx_in_connection_id) return ["Not set up (agent, number or inbound connection missing)"];
  const problems: string[] = [];
  try {
    const nr = await fetch(`https://api.telnyx.com/v2/phone_numbers?filter[phone_number]=${encodeURIComponent(LINE)}`, { headers: { authorization: `Bearer ${tk}` } });
    if (nr.status >= 500) return null;
    const num = ((await nr.json().catch(() => ({}))).data ?? [])[0] as { connection_id?: string } | undefined;
    if (!num) problems.push("Her number isn't on the Telnyx account");
    else if (num.connection_id !== s.telnyx_in_connection_id) problems.push("Telnyx isn't routing her number to the inbound connection");

    const pr = await fetch(`${XI}/convai/phone-numbers/${s.phone_number_id}`, { headers: { "xi-api-key": key } });
    if (pr.status >= 500) return null;
    if (!pr.ok) problems.push(`ElevenLabs can't find her number (${pr.status})`);
    else {
      const p = await pr.json().catch(() => ({})) as { supports_inbound?: boolean; assigned_agent?: { agent_id?: string } };
      if (p.supports_inbound !== true) problems.push("Incoming calls are off for her number in ElevenLabs");
      if (p.assigned_agent?.agent_id !== s.agent_id) problems.push("Her number points at the wrong agent");
    }

    const ar = await fetch(`${XI}/convai/agents/${s.agent_id}`, { headers: { "xi-api-key": key } });
    if (ar.status >= 500) return null;
    if (!ar.ok) problems.push(`ElevenLabs can't find her agent (${ar.status})`);
    else {
      const a = await ar.json().catch(() => ({})) as { platform_settings?: { overrides?: { enable_conversation_initiation_client_data_from_webhook?: boolean };
        workspace_overrides?: { conversation_initiation_client_data_webhook?: { url?: string } } } };
      const hook = a.platform_settings?.workspace_overrides?.conversation_initiation_client_data_webhook?.url ?? "";
      if (!hook.includes("hook=init") || a.platform_settings?.overrides?.enable_conversation_initiation_client_data_from_webhook !== true) problems.push("Her caller lookup (init webhook) isn't set");
    }
  } catch { return null; }
  return problems;
}

async function health(): Promise<Response> {
  const first = await lineProblems();
  if (first === null) return Response.json({ ok: null, skipped: "couldn't reach the voice platform" });
  let problems = first, healed = false;
  if (first.length) {
    try { await setup(); } catch { /* the re-check below says what's still wrong */ }
    problems = (await lineProblems()) ?? first;
    healed = problems.length === 0;
  }
  const ok = problems.length === 0, now = new Date().toISOString();
  const { data: prev } = await db.from("ava_line_health").select("last_ok_at").eq("source", "ava").maybeSingle();
  await db.from("ava_line_health").upsert({ source: "ava", ok, problems, healed, checked_at: now, last_ok_at: ok ? now : prev?.last_ok_at ?? null }, { onConflict: "source" });
  const url = "https://bestly.tech/admin/ava";
  if (first.length && healed) {
    await db.rpc("scout_notify", { p_title: "Ava's line wasn't answering, fixed", p_body: `${first.join("; ")}. Setup re-ran and the line checks out now.`,
      p_severity: "info", p_push: true, p_url: url, p_dedupe: `ava-line-fixed-ava-${now.slice(0, 13)}` });
  } else if (!ok) {
    await db.rpc("scout_notify", { p_title: "Ava's line is still broken", p_body: `${problems.join("; ")}. Setup couldn't fix it.`,
      p_severity: "warning", p_push: true, p_url: url, p_dedupe: `ava-line-broken-ava-${now.slice(0, 10)}-${Math.floor(new Date(now).getUTCHours() / 6)}` });
  }
  return Response.json({ ok, healed, problems });
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
  const { data: st } = await db.from("ava_settings").select("jared_cell").eq("id", true).maybeSingle();
  const trusted = !!c || (!!caller && caller === (st?.jared_cell ?? JARED_CELL)) ? "yes" : "no";
  const vars = c ? {
    caller_trusted: trusted, caller_name: c.name, caller_notes: `They're Jared's ${c.relationship ?? "contact"}. ${c.notes ?? ""}`,
    greeting: `Hi ${c.name}! It's Ava, Jared's assistant, on a recorded line. He can't get to the phone, but I'd love to take a message for him.`,
  } : { ...UNKNOWN, caller_trusted: trusted };
  return Response.json({ type: "conversation_initiation_client_data",
    dynamic_variables: { ...vars, call_context: "Someone called Jared's line. Take a message.", knowledge: await knowledge(), ...nowVars() } });
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
    callback_number: cbNum ? toE164(cbNum) : null,
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
  if (body.action === "callback") return callback(String(body.id ?? ""));
  if (body.action === "health") return health();
  if (body.action === "live") return live(body.call_id ? String(body.call_id) : null);
  if (body.action === "audio") return audio(String(body.call_id ?? ""));
  return Response.json({ ok: false, error: "unknown action" }, { status: 400, headers: CORS });
});
