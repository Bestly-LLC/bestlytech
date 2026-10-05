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
//   {action:"voices"}    admin: current voice + "In your library" + "Discover" (shared library), filters from the picker.
//   {action:"voice_say"} admin: {voice_id, text} -> mp3 of her saying it (40 a Pacific day).
//   {action:"voice_test_call"}  admin: {voice_id} -> ONE call to Jared's own cell in that voice (per-call override).
//   {action:"voice_use"} admin: {voice_id, public_owner_id?, name} -> add to the account if needed, save, re-run setup.
//   {action:"voice_clone" | "voice_preview" | "voice_delete" | "voice_resume"}  Jared's own voice (docs/ava-voice-clone-opusplan.md).
//   {action:"spam_complaint" | "spam_letter"}  admin: {company_id} -> pre-filled Do Not Call complaint text / demand-letter TEMPLATE
//                        (fixed text, no AI; nothing is ever sent). The letter sets the company's status to 'letter_drafted'.
//   {action:"evidence"}  admin/service: {call_id?} -> copies a spam call's recording into the private ava-evidence bucket
//                        (no call_id: retries every spam call that still has no copy). The health action also retries.
//   {action:"cal_status" | "cal_secret_put" | "cal_disconnect" | "cal_test" | "free_slots" | "book_call"}  admin: Ava's calendars (iCloud + Nextcloud over
//                        CalDAV; passwords only in Vault, never returned). free_slots = next free times; book_call = ONE outbound call that
//                        offers a chosen slot (Jared's tap is the yes). The health action also checks the calendar connections once an hour.
//   ?hook=init           ElevenLabs, at the start of an inbound call: who is calling? -> greeting + contact details + the
//                        shareable knowledge (ava_knowledge). Detects a forwarded call from Jared's cell (answers as his assistant,
//                        in his voice when he wants). Logs the payload shape to ava_init_debug. Guarded by a shared header secret.
//   ?hook=post           ElevenLabs post-call webhook (HMAC-signed) -> ava_calls row (forwarded, spam intel) + Scout push.
//
// Nothing here touches rg_* except releasing the number from RoofGuard during setup.
// Secrets come from Vault through ava_secret() (service role only, allowlisted).
// What a caller can learn: ONLY ava_knowledge (active rows), the caller's own ava_contacts row and the clock. Nothing on a call
// path reads Vault, bestly_memory, scout_* or any other table into a prompt.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { busyFrom, DEFAULT_HOURS, discover, eventsIn, ptParts, zonedToUtc, durationFor, freeSlots, parseConstraints, putEvent, spoken, turoWindows, TURO_WINDOW_MIN, type Busy, type Cal, type Creds, type Hours, type Provider, type Slot } from "./calendar.ts";

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

// A call the line provider still lists as live but that can't be: a ring that never connected stays "initiated" forever
// (call #69, Mom, 2026-10-05: a second ring sat there and the page said "on a call, 35 minutes"), and nothing outlives
// the max call length. Those are ghosts, so the live view skips them.
function isLiveConv(c: { status: string; start_time_unix_secs?: number }): boolean {
  if (!["initiated", "in-progress", "processing"].includes(c.status)) return false;
  const age = c.start_time_unix_secs ? Date.now() / 1000 - c.start_time_unix_secs : 0;
  if (c.status === "initiated" && age > 90) return false;
  return age <= MAX_CALL_SECS + 120;
}
const SILENCE_END_SECS = 20;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Expose-Headers": "x-says-left" };
const DEFAULT_VOICE = "pFZP5JQG7iQjIQuC4Bku";   // Lily
const SAY_CAP = 40;                              // "Hear her say..." plays per Pacific day
/** The agent's voice settings. English agents must use flash/turbo v2 (v2_5 is rejected); flash is the fastest. */
const ttsConfig = (voice_id: string) => ({ voice_id, model_id: "eleven_flash_v2", stability: 0.55, similarity_boost: 0.8, optimize_streaming_latency: 4, speed: 1.05 });

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

/** The coach's learned playbook (rules Jared approved on the Scorecard). Never fails a call. */
async function coachNotes(): Promise<string> {
  const { data, error } = await db.rpc("ava_coach_notes");
  const t = error ? "" : String(data ?? "").replace(/\{\{|\}\}/g, "").trim();
  return t || "(none yet)";
}

/** The shareable facts, as a bullet list for the prompt. The ONLY knowledge source for calls. */
async function knowledge(): Promise<string> {
  const { data } = await db.from("ava_knowledge").select("topic, fact").in("scope", ["personal", "both"]).eq("active", true).eq("status", "live").order("topic");
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
const PROMPT = `You are Ava, Jared Best's personal AI assistant. You're an AI: if anyone sincerely asks, say so plainly. Never claim to be human.

Today is {{today}}. It's {{local_time}} in Los Angeles, where Jared lives.

This call: {{call_context}}
Who you're talking to: {{caller_name}}. {{caller_notes}}
{{voice_rules}}
{{forward_rules}}

What you can share (the only facts you may use to help someone):
{{knowledge}}

Incoming and forwarded calls (not outbound ones, whose opener already says it):
- Your first line is already spoken: "Hey, Jared's phone. What's up?" You answer his phone as his assistant. If they ask who you are: "I'm Jared's assistant." (Ava, if they want a name.)
- Recording notice: California needs it early, so on your NEXT turn, right after the caller's first reply, work in one short recording notice, casual and brief, then carry on, for example "Heads up, calls here get recorded. What can I do for you?" Never say "on a recorded line". Never put it in your first line, never repeat it.

Helping callers: answer from "What you can share", in your own words and briefly. Anything that isn't in that list is off limits: say "I can't share that, but I can take a message." Never guess or make something up.

Taking a message (any call where they want to reach Jared):
- If you don't know who they are, get their name.
- Get the message, whether it's urgent, and whether they'd like Jared to call back.
- If they want a call back, you must end the call holding digits he can dial. Never settle for "my office number" or "the number I'm calling from" as the answer:
  - If they name a different line (office, mobile, home), ask for that number and read it back digit by digit to confirm.
  - Otherwise ask "is the number you're calling from the best one?" If they say yes, ask them to say it anyway so you have it right, and read it back. Some numbers arrive withheld on our end, and then there is nothing to call.
- Read the message back in one sentence. Then a warm goodbye, and end the call.

Outbound calls: do what the call context says, nothing more.

Booking calls (only when the call context says to offer specific times): offer the first time. If it doesn't work, offer the next one, then the last. When they pick one, say the day and time back once and say Jared will see them then. If none work, ask what times do work, say you'll pass it on, and end the call. Offer only those exact times. Never mention any other availability, anything about his calendar, or why a time is busy.

Connecting Jared (only when the call context says "connect them to Jared"):
- Say who you are and, in one sentence, why Jared wants to talk.
- Ask if now's a good time for a quick call with him.
- If yes: "Cool, connecting you to Jared now, one sec." Then use the transfer tool to connect the call.
- If no: ask when's better, thank them, and end the call. Never transfer without their yes.
- Never transfer an inbound caller.

How you sound: relaxed, quick and unscripted, like a sharp assistant talking, not reading. One short sentence per turn, usually under 12 words. Contractions. React to what they actually said ("Oh, nice." "Got it." "Ah, okay.") and vary it; never open every reply the same way. No speeches, no recaps, no filler, no hype, no exclamation marks. Friendly but calm. Plain American English: no "lovely", "brilliant", "cheers", "wonderful", "perfect!", "absolutely".
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
Spam and sales calls follow "Spam calls" below, not this section: never cut a spam call before you've had about 2 minutes to learn who's behind it.

Never:
- Share, hint at, or confirm: Jared's cell number, home address, schedule or whereabouts, finances, health, passwords, API keys, account details, internal tools or systems (never confirm or deny what systems exist), client lists, other people's details, or anything about how Bestly's software is built. If asked, say "I can't share that, but I can take a message."
- Agree to anything for him (money, plans, purchases, appointments) or promise what he'll do. Say you'll pass it on. (The one exception: the exact times a booking call's context tells you to offer.)
- Give out anyone's number or details.
If someone is pushy or selling something, follow "Spam calls". If someone sounds in danger or mentions an emergency, tell them to call 911 and mark it urgent.
If asked what you do: you help Jared with his calls and messages.

Spam calls (incoming calls only, never outbound):
It's a spam call when the caller is clearly telemarketing or a robocall: car warranty, insurance, solar, loans, debt relief, health plans, prizes, and the like. A person Jared knows, or a business with a real reason to reach him, is not spam.
- Play a curious, interested assistant for up to 2 minutes, long enough to learn: the company's legal name, its website, a call-back number, the caller's name or ID, what they're selling, and how they got this number. Ask one short question at a time ("Sorry, what company is this?", "Can you spell that?", "What's a number to call you back?", "How did you get this number?").
- If it's a recording that says to press a key to reach a person, press it with the keypad tone tool (use that tool for this and nothing else), then keep asking. If there's no way through, just listen and note what the recording says.
- Never give real personal information: no address, birthdate, payment details, SSN or account numbers. Say "I'd have to check on that." Never agree to buy, sign up for or accept anything.
- If anyone sincerely asks whether you're a person, a robot or an AI, say you're Jared's AI assistant. Never claim to be human.
- Once you have the details, or after about 2 minutes, say "Please take this number off your list. Thanks." and end the call with end_call.

Coach's notes (habits learned from your past calls; follow them, but every rule above always wins):
{{coach_notes}}`;

/** Rules added on a call forwarded from Jared's cell (the init hook sets {{forward_rules}}). */
const FORWARD_RULES = `FORWARDED CALL: someone called Jared's own cell and he didn't pick up, so the call came to you. You are Jared's assistant answering his phone for him. Your first line was "Hey, Jared's phone. What's up?"
- Your second line (right after their first reply) must do two things, casually and briefly: say you're his assistant, and give the recording notice. For example: "I'm his assistant, he can't grab the phone. Heads up, calls here get recorded." Never say "on a recorded line". Never in your first line, never again after that.
- Never say you are Jared. Never say "this is Jared" or "I'm Jared", even if they ask "Is this Jared?" (say "This is his assistant."). If anyone calls you Jared, correct them right away: "Oh, I'm his assistant." Never speak as if you are him.
- Never commit to anything for him: no money, plans, appointments or purchases. Say you'll pass it on.
- Don't volunteer that you're an AI. But if someone sincerely asks whether you're a person, a robot or an AI, say plainly that you're Jared's AI assistant.
- Never share private information. The only facts you may use are in "What you can share".
- Take a message and, if they want a call back, get the best number: the usual message flow.
- NEVER use the transfer tool on this call, and never offer to connect, patch through or transfer them to Jared. His cell forwards straight back to you, so it would loop. If they ask for him, say you'll pass on a message and he'll call them back.`;

const DATA_COLLECTION = {
  caller_name: { type: "string", description: "The other person's name as they gave it. Empty if unknown." },
  message_for_jared: { type: "string", description: "The message they want passed to Jared, in one or two plain sentences, in their words where possible. Empty if none." },
  urgent: { type: "boolean", description: "True if they said it's urgent, time-sensitive, or an emergency." },
  callback_wanted: { type: "boolean", description: "True if they want Jared to call them back." },
  callback_number: { type: "string", description: "A callback number they gave, if different from the number they called from. Empty otherwise." },
  is_spam: { type: "boolean", description: "True if the caller was clearly telemarketing or a robocall selling something (car warranty, insurance, solar, loans, debt relief, health plans, prizes). False for a real person or a business with a real reason to call." },
  robocall: { type: "boolean", description: "True if the caller was a prerecorded or automated message, not a live person." },
  spam_company: { type: "string", description: "The legal name of the company behind a spam call, as stated. Empty if none was given." },
  spam_website: { type: "string", description: "The website the spam caller gave. Empty if none." },
  spam_callback_number: { type: "string", description: "The call-back number the spam caller gave. Empty if none." },
  spam_caller_name: { type: "string", description: "The name or ID the spam caller gave for themselves. Empty if none." },
  spam_offer: { type: "string", description: "What the spam caller was selling or offering, in a few words. Empty if none." },
  // next-action buttons (read from the transcript by the voice platform's own analysis: no extra AI spend)
  intent: { type: "string", enum: ["appointment", "callback", "question", "info_only", "spam", "other"],
    description: "Why the other person called or what they need from Jared. Exactly one of: appointment (they want to schedule or set a time to meet or talk), callback (they want Jared to call them back), question (they asked something they want answered), info_only (they only passed on information), spam (telemarketing or a robocall), other." },
  counterpart_business: { type: "string", description: "The business or organization the other person is calling from, as they said it. Empty if none or a private person." },
  counterpart_phone: { type: "string", description: "A phone number the other person gave to reach them, including a call-back number. Empty if they gave none." },
  appointment_purpose: { type: "string", description: "If they want an appointment or meeting: what it is for, in a few words. Empty otherwise." },
  preferred_times: { type: "string", description: "Days or times they said work for them, in their own words. Empty if none." },
  next_actions: { type: "string", description: "Up to three short suggested next steps for Jared, separated by semicolons (for example: Call back about the invoice; Find a time Thursday). Empty if nothing is needed." },
  appt_duration_min: { type: "integer", description: "If they want an appointment or meeting: how long it should run, in minutes, if they said. Use 60 if they did not say. Leave empty for every other call." },
  appt_constraints: { type: "string", description: "If they want an appointment or meeting: anything they said that limits when it can happen, in their words (for example: Tuesday afternoon only, after 2, not before the 15th, next week). Empty if none." },
  booked_slot: { type: "string", description: "Only when Ava offered specific meeting times on an outbound call: the start of the time the other person agreed to, as an ISO 8601 date-time with the Pacific UTC offset (use the call date to resolve days like Thursday). Empty if they did not agree to one of the offered times." },
};

const UNKNOWN = { caller_name: "a caller Ava doesn't know yet", caller_notes: "", caller_trusted: "no", voice_rules: "", forward_rules: "", call_voice: "ava", forwarded: "no", forwarded_from: "", greeting:
  "Hey, Jared's phone. What's up?" };

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
        dynamic_variables: { dynamic_variable_placeholders: { ...UNKNOWN, call_context: "Someone called Jared's line.", ...nowVars(), knowledge: await knowledge(), coach_notes: await coachNotes() } },
        prompt: { prompt: PROMPT, llm: s?.llm ?? "gpt-4.1-mini", temperature: 0.5,
          built_in_tools: {
            end_call: { name: "end_call", params: { system_tool_type: "end_call" } },
            // keypad tones: only for a spam robocall that says "press 1 to speak to someone" (the prompt limits it to that)
            play_keypad_touch_tone: { name: "play_keypad_touch_tone", params: { system_tool_type: "play_keypad_touch_tone" } },
            // "Connect me": can only ever dial Jared's own cell
            transfer_to_number: { name: "transfer_to_number", params: { system_tool_type: "transfer_to_number", transfers: [{
              phone_number: s?.jared_cell ?? "+18165007236", transfer_type: "sip_refer",
              condition: "Only on an outbound call whose context says to connect them to Jared, after the person said yes to talking now. NEVER on an incoming or forwarded call: Jared's cell forwards back to this line, so it would loop." }] } },
          } },
      },
      // Money stopper: hard caps no matter what the prompt does
      conversation: { max_duration_seconds: MAX_CALL_SECS },
      // same speed settings as RoofGuard's Ava (keep the two in step)
      turn: { turn_eagerness: "eager", speculative_turn: true, silence_end_call_timeout: SILENCE_END_SECS,
        soft_timeout_config: { timeout_seconds: 1.0, message: "Yeah...", randomize_fillers: true, max_soft_timeouts_per_generation: 1,
          additional_soft_timeout_messages: ["Mm, right...", "Yeah, so...", "Got it...", "Okay..."] } },
      tts: ttsConfig(s?.voice_id ?? DEFAULT_VOICE),
    },
    platform_settings: {
      data_collection: DATA_COLLECTION,
      // a single call may swap the voice (voice test, "Use my voice", forwarded calls) and the first line (forwarded calls); nothing else is overridable
      overrides: { conversation_config_override: { agent: { first_message: true }, tts: { voice_id: true } }, enable_conversation_initiation_client_data_from_webhook: true },
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

/** Prompt rules for a call in Jared's cloned voice (docs/ava-voice-clone-opusplan.md). The opener already discloses. */
const VOICE_RULES = "VOICE MODE: you are speaking in Jared's own voice, so you must be clear you are his AI assistant and not him. Your first line already says so; never skip or contradict it. If anyone asks, say you're an AI. Never say \"this is Jared\" or \"I'm Jared\", and never speak as if you are him. Never commit to anything for him: no money, plans, appointments or promises. Say you'll pass it on.";

/** Places one call as Ava. Everything an outbound call needs lives here so the dialer, "Connect me" and follow-ups share it. */
async function place(o: { phone: string; name?: string; purpose?: string; connect?: boolean; first_line?: string; voice_id?: string; voice_mode?: "ava" | "jared"; booking?: Record<string, unknown> }): Promise<Placed> {
  const to = toE164(o.phone);
  if (!to) return { ok: false, error: "Enter a 10-digit US or Canada number.", status: 400 };
  const { data: s } = await db.from("ava_settings").select("*").eq("id", true).single();
  const key = await vault("elevenlabs_api_key");
  if (!s?.agent_id || !s.phone_number_id || !key) return { ok: false, error: "Ava isn't set up yet. Run Setup on /admin/ava.", status: 412 };
  const gate = await spendGate();
  if (gate.over) return { ok: false, error: gate.message ?? "Daily spend cap reached. Raise it in Setup or try tomorrow.", status: 429 };
  const { data: contact } = await db.from("ava_contacts").select("id, name, relationship, notes").eq("phone", to).maybeSingle();
  const name = String(o.name ?? "").trim().slice(0, 40) || contact?.name || "";
  const purpose = String(o.purpose ?? "").trim().slice(0, o.booking ? 900 : 600) || "Jared asked you to call and say hello.";
  const connect = o.connect === true;
  // her voice for this call: the agent's own, a one-call override (the voice test), or Jared's clone ("Use my voice")
  let voiceOverride: string | null = o.voice_id ?? null, voiceTag: "ava" | "jared" = "ava", voiceRules = "";
  if (o.voice_mode === "jared") {
    if (!s.jared_voice_id) return { ok: false, error: "Record your voice first. It's in Ava's voice, further down this page.", status: 412 };
    if (s.jared_voice_paused_at) return { ok: false, error: "Voice mode is off after a guard alert. Turn it back on in Ava's voice section.", status: 409 };
    voiceOverride = s.jared_voice_id; voiceTag = "jared"; voiceRules = VOICE_RULES;
  }
  const first = name ? ` ${name.split(" ")[0]}` : "";
  const greeting = voiceTag === "jared"
    ? `Hey${first}, it's Jared's AI assistant, using his voice.`   // disclosure first, always
    : String(o.first_line ?? "").trim().slice(0, 300) ||
      `Hi${first}, it's Ava, Jared's AI assistant, on a recorded line. ${connect ? "Jared would love a quick word with you." : "He asked me to give you a call."}`;
  const res = await fetch(`${XI}/convai/sip-trunk/outbound-call`, {
    method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ agent_id: s.agent_id, agent_phone_number_id: s.phone_number_id, to_number: to,
      conversation_initiation_client_data: { ...(voiceOverride ? { conversation_config_override: { tts: { voice_id: voiceOverride } } } : {}), dynamic_variables: {
        greeting, voice_rules: voiceRules, call_context: connect
          ? `An outbound call to connect them to Jared. Why he wants to talk: ${purpose}. Check they're free, then connect them to Jared.`
          : `An outbound call Jared asked you to make. Why: ${purpose}`,
        caller_name: name || "them", caller_notes: contact ? `(${contact.relationship ?? "contact"}) ${contact.notes ?? ""}` : "",
        caller_trusted: contact || to === (s.jared_cell ?? JARED_CELL) ? "yes" : "no",
        knowledge: await knowledge(), coach_notes: await coachNotes(), ...nowVars() } } }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.success === false) return { ok: false, error: `The call didn't go out: ${JSON.stringify(j).slice(0, 200)}`, status: 502 };
  const { data: row } = await db.from("ava_calls").insert({ direction: "outbound", phone: to, contact_id: contact?.id ?? null, caller_name: name || null,
    purpose, conversation_id: j.conversation_id ?? null, status: "queued", connect_to_jared: connect, voice: voiceTag, ...(o.booking ? { booking: o.booking } : {}) }).select("id").single();
  return { ok: true, call_id: row?.id ?? null, calling: to };
}

async function call(body: Record<string, unknown>): Promise<Response> {
  const r = await place({ phone: String(body.phone ?? ""), name: String(body.name ?? ""), purpose: String(body.purpose ?? ""),
    connect: body.connect === true, first_line: String(body.first_line ?? ""), voice_mode: body.voice === "jared" ? "jared" : "ava" });
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
  // Ring the number they asked to be reached on (an office line, a mobile), falling back to the
  // number they rang from. 'anonymous' means the caller ID was withheld, so there is nothing to fall
  // back to and Jared has to supply one in the card.
  const r = await place({ phone: f.callback_phone || f.phone, name: f.name ?? "",
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
  try { await evidenceRetry(); } catch { /* the line check below still runs */ }
  const voiceNotes = await voiceHealth();   // her voice still exists (falls back to the default and re-runs setup if not)
  const calNotes = await calendarHealth();  // iCloud / Nextcloud connections, hourly
  try { await db.rpc("ava_brief_watch"); } catch { /* the brief watchdog must never break the line check */ }
  const first = await lineProblems();
  if (first === null) return Response.json({ ok: null, skipped: "couldn't reach the voice platform", calendars: calNotes });
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
  return Response.json({ ok, healed, problems, voice: voiceNotes, calendars: calNotes });
}

// ---------- live + audio ----------
type Turn = { role: string; message: string | null; time_in_call_secs?: number };
const slim = (t: Turn[] | undefined) => (t ?? []).filter((x) => x.message).map((x) => ({ role: x.role, text: x.message, t: x.time_in_call_secs ?? 0 }));

async function live(callId: string | null, conversationId: string | null = null): Promise<Response> {
  const { data: s } = await db.from("ava_settings").select("agent_id").eq("id", true).single();
  const key = await vault("elevenlabs_api_key");
  if (!s?.agent_id || !key) return Response.json({ ok: true, calls: [] }, { headers: CORS });
  let active: { conversation_id: string; status: string }[];
  if (conversationId) {
    // one call by its conversation id (the live pill: a call that has no row yet, such as an incoming one)
    active = [{ conversation_id: conversationId, status: "" }];
  } else if (callId) {
    // one call (the dialer's in-call screen), followed through to the end
    const { data: r } = await db.from("ava_calls").select("conversation_id").eq("id", callId).maybeSingle();
    active = r?.conversation_id ? [{ conversation_id: r.conversation_id, status: "" }] : [];
  } else {
    const lr = await fetch(`${XI}/convai/conversations?agent_id=${s.agent_id}&page_size=10`, { headers: { "xi-api-key": key } });
    const list = ((await lr.json().catch(() => ({}))).conversations ?? []) as { conversation_id: string; status: string; start_time_unix_secs?: number }[];
    active = list.filter(isLiveConv).slice(0, 3);
  }
  const calls = await Promise.all(active.map(async (c) => {
    const d = await (await fetch(`${XI}/convai/conversations/${c.conversation_id}`, { headers: { "xi-api-key": key } })).json().catch(() => ({}));
    const pc = d.metadata?.phone_call ?? {};
    const phone = pc.external_number ?? null;
    const { data: row } = await db.from("ava_calls").select("id, caller_name, direction, voice, forwarded").eq("conversation_id", c.conversation_id).maybeSingle();
    const dyn = (d.conversation_initiation_client_data?.dynamic_variables ?? {}) as Record<string, unknown>;   // set by the init hook before the row exists
    const { data: contact } = phone ? await db.from("ava_contacts").select("name").eq("phone", phone).maybeSingle() : { data: null };
    return { conversation_id: c.conversation_id, call_id: row?.id ?? null, status: d.status ?? c.status,
      direction: row?.direction ?? pc.direction ?? "inbound", voice: row?.voice ?? (dyn.call_voice === "jared" ? "jared" : "ava"),
      forwarded: row?.forwarded === true || dyn.forwarded === "yes", phone, who: contact?.name ?? row?.caller_name ?? null,
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

// ---------- voices: the picker (Ava's own voice) and Jared's clone ----------
const SAMPLE_JARED = "Hey, it's Jared's AI assistant, using his voice. He's tied up right now, can I take a message?";
const VOICE_ID = /^[A-Za-z0-9]{10,40}$/;
const jerr = (error: string, status = 400, extra: Record<string, unknown> = {}) => Response.json({ ok: false, error, ...extra }, { status, headers: CORS });
const xiKey = () => vault("elevenlabs_api_key");
const xiHeaders = (key: string, json = true): Record<string, string> => json ? { "xi-api-key": key, "content-type": "application/json" } : { "xi-api-key": key };
// deno-lint-ignore no-explicit-any
type RawVoice = Record<string, any>;
const trimTo = (v: unknown, n: number) => { const t = String(v ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

function slimVoice(v: RawVoice) {
  const l = (v.labels ?? {}) as Record<string, string>;
  const full = String(v.name ?? "");
  const [head, ...rest] = full.split(/\s+[-–—]\s+/);
  return {
    voice_id: String(v.voice_id ?? ""), public_owner_id: v.public_owner_id ? String(v.public_owner_id) : undefined,
    name: (head ?? "").trim() || full, accent: String(v.accent ?? l.accent ?? ""), age: String(v.age ?? l.age ?? ""), gender: String(v.gender ?? l.gender ?? ""),
    description: trimTo(v.description || rest.join(" - ") || v.descriptive || l.descriptive, 120),
    preview_url: (v.preview_url as string | undefined) ?? null, in_library: v.is_added_by_user === true,
  };
}

/** One voice in this account. missing = the platform says it doesn't exist; status 0 = couldn't reach it. */
async function voiceInfo(id: string): Promise<{ status: number; missing: boolean; v?: RawVoice }> {
  try {
    const key = await xiKey();
    if (!key) return { status: 0, missing: false };
    const r = await fetch(`${XI}/voices/${id}`, { headers: xiHeaders(key, false) });
    if (r.ok) return { status: 200, missing: false, v: await r.json() };
    const t = await r.text().catch(() => "");
    return { status: r.status, missing: r.status === 404 || /voice_not_found|voice.{0,20}not found/i.test(t) };
  } catch { return { status: 0, missing: false }; }
}

async function saysLeft(): Promise<number> {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
  const { data } = await db.from("ava_voice_usage").select("says").eq("source", "ava").eq("day", day).maybeSingle();
  return Math.max(0, SAY_CAP - (data?.says ?? 0));
}

/** null = couldn't tell (treated as "try it"). */
async function canClone(key: string): Promise<boolean | null> {
  try {
    const r = await fetch(`${XI}/user/subscription`, { headers: xiHeaders(key, false) });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    return typeof j.can_use_instant_voice_cloning === "boolean" ? j.can_use_instant_voice_cloning : null;
  } catch { return null; }
}

async function voices(b: Record<string, unknown>): Promise<Response> {
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const { data: s } = await db.from("ava_settings").select("voice_id, jared_voice_id, jared_voice_paused_at, jared_voice_paused_why").eq("id", true).single();
  const scope = ["library", "discover", "clone", "all"].includes(String(b.scope)) ? String(b.scope) : "all";
  const gender = ["female", "male", "any"].includes(String(b.gender)) ? String(b.gender) : "female";
  const accent = ["any", "british", "australian", "american"].includes(String(b.accent)) ? String(b.accent) : "any";
  const age = ["any", "young", "middle_aged"].includes(String(b.age)) ? String(b.age) : "any";
  const page = Math.max(0, Math.min(50, Math.floor(Number(b.page) || 0)));
  const keep = (v: ReturnType<typeof slimVoice>) => (gender === "any" || !v.gender || v.gender === gender) && (accent === "any" || v.accent === accent) && (age === "any" || v.age === age);

  const current = async () => {
    const id = s?.voice_id ?? DEFAULT_VOICE, i = await voiceInfo(id);
    return i.v ? { ...slimVoice(i.v), voice_id: id, missing: false } : { voice_id: id, name: i.missing ? "Missing" : "Unknown", accent: "", age: "", description: "", preview_url: null, missing: i.missing };
  };
  const library = async () => {
    const out: ReturnType<typeof slimVoice>[] = [];
    let token = "";
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`${XI.replace("/v1", "/v2")}/voices?page_size=100${token ? `&next_page_token=${encodeURIComponent(token)}` : ""}`, { headers: xiHeaders(key, false) });
      if (!r.ok) throw new Error(`library ${r.status}`);
      const j = await r.json();
      for (const v of (j.voices ?? []) as RawVoice[]) {
        // a cloned voice is never an agent's default (it has no disclosure opener); it lives in the "Your voice" card
        if (v.category === "cloned" || v.voice_id === s?.jared_voice_id) continue;
        out.push(slimVoice(v));
      }
      if (!j.has_more || !j.next_page_token) break;
      token = j.next_page_token;
    }
    return out.filter(keep);
  };
  const discover = async () => {
    const q = new URLSearchParams({ page_size: "24", use_cases: "conversational", language: "en", page: String(page) });
    if (gender !== "any") q.set("gender", gender);
    if (accent !== "any") q.set("accent", accent);
    if (age !== "any") q.set("age", age);
    const r = await fetch(`${XI}/shared-voices?${q}`, { headers: xiHeaders(key, false) });
    if (!r.ok) throw new Error(`discover ${r.status}`);
    const j = await r.json();
    return { items: ((j.voices ?? []) as RawVoice[]).map(slimVoice), has_more: j.has_more === true };
  };
  const clone = async () => ({ can_clone: await canClone(key), voice_id: s?.jared_voice_id ?? null, paused_at: s?.jared_voice_paused_at ?? null, paused_why: s?.jared_voice_paused_why ?? null });

  try {
    const [cur, lib, dis, cl, left] = await Promise.all([
      current(), scope === "library" || scope === "all" ? library() : null, scope === "discover" || scope === "all" ? discover() : null,
      scope === "clone" || scope === "all" ? clone() : null, saysLeft()]);
    return Response.json({ ok: true, current: cur, library: lib, discover: dis?.items ?? null, has_more: dis?.has_more ?? false, says_left: left, say_cap: SAY_CAP, clone: cl }, { headers: CORS });
  } catch (e) {
    return jerr(`Couldn't load voices right now (${e instanceof Error ? e.message : "error"}). Try again.`, 502);
  }
}

/** One sample play: counts against the daily cap, streams an mp3 back (Flash v2, the same model the agent speaks with). */
async function say(voice: string, text: string): Promise<Response> {
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const t = await db.rpc("ava_voice_say_take", { p_source: "ava", p_cap: SAY_CAP });
  if (t.error || !t.data) return jerr("Couldn't check today's sample limit. Try again.", 500);
  if (t.data.ok !== true) return jerr(`That's all ${SAY_CAP} samples for today. They reset at midnight Pacific.`, 429, { says_left: 0 });
  const res = await fetch(`${XI}/text-to-speech/${voice}?output_format=mp3_44100_64`, { method: "POST", headers: xiHeaders(key), body: JSON.stringify({ text, model_id: "eleven_flash_v2" }) });
  if (!res.ok || !res.body) {
    // a failed sample doesn't count
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
    await db.from("ava_voice_usage").update({ says: Math.max(0, (t.data.says ?? 1) - 1) }).eq("source", "ava").eq("day", day);
    await res.text().catch(() => "");
    return jerr(res.status === 404 || res.status === 400 ? "That voice isn't in your account anymore. Reload the list." : "The voice platform couldn't make that sample. Try again.", res.status === 404 ? 404 : 502);
  }
  return new Response(res.body, { headers: { ...CORS, "content-type": "audio/mpeg", "cache-control": "no-store", "x-says-left": String(Math.max(0, SAY_CAP - (t.data.says ?? SAY_CAP))) } });
}

function voiceSay(b: Record<string, unknown>): Promise<Response> | Response {
  const voice = String(b.voice_id ?? ""), text = String(b.text ?? "").replace(/\s+/g, " ").trim();
  if (!VOICE_ID.test(voice)) return jerr("Pick a voice first.");
  if (!text) return jerr("Type something for her to say.");
  if (text.length > 200) return jerr("Keep it to 200 characters.");
  return say(voice, text);
}

/** ONE test call to Jared's own cell with a per-call voice. Same spend cap and gate as every other outgoing call. */
async function voiceTestCall(b: Record<string, unknown>): Promise<Response> {
  const voice = String(b.voice_id ?? "");
  if (!VOICE_ID.test(voice)) return jerr("Pick a voice first.");
  const info = await voiceInfo(voice);
  if (info.status !== 200) return jerr(info.missing ? "That voice isn't in your account yet. Use it first, or pick one from your library." : "Couldn't check that voice. Try again.", info.missing ? 404 : 502);
  if (info.v?.category === "cloned") return jerr("That's a cloned voice. Test it with the Use my voice switch in the dialer.", 409);
  const { data: s } = await db.from("ava_settings").select("jared_cell").eq("id", true).single();
  const since = new Date(Date.now() - 90_000).toISOString();
  const { count } = await db.from("ava_calls").select("id", { count: "exact", head: true }).like("purpose", "Voice test%").gte("created_at", since);
  if ((count ?? 0) > 0) return jerr("A test call just went out. Give it a minute.", 429);
  const r = await place({ phone: s?.jared_cell ?? JARED_CELL, name: "Jared", voice_id: voice,
    first_line: "Hey Jared, it's Ava, your AI assistant, on a recorded line. I'm testing a new voice. How do I sound?",
    purpose: "Voice test. This is a test call to Jared himself with a new voice. Say your first line, ask how the voice sounds, listen to his answer, thank him, say goodbye and end the call. Keep it under a minute." });
  return r.ok ? Response.json({ ok: true, call_id: r.call_id, calling: r.calling }, { headers: CORS }) : jerr(r.error, r.status);
}

/** "Use for Ava": add a shared voice to the account if needed, point the agent at it, save, re-run setup. */
async function voiceUse(b: Record<string, unknown>): Promise<Response> {
  const vid = String(b.voice_id ?? ""), owner = String(b.public_owner_id ?? ""), name = trimTo(b.name, 60) || "Voice";
  if (!VOICE_ID.test(vid) || (owner && !VOICE_ID.test(owner))) return jerr("Pick a voice first.");
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const { data: s } = await db.from("ava_settings").select("voice_id, agent_id").eq("id", true).single();

  let useId = vid;
  if (owner && b.in_library !== true) {
    const r = await fetch(`${XI}/voices/add/${owner}/${vid}`, { method: "POST", headers: xiHeaders(key), body: JSON.stringify({ new_name: `Ava – ${name}` }) });
    const t = await r.text().catch(() => "");
    if (r.ok) { try { useId = JSON.parse(t).voice_id ?? vid; } catch { /* keep vid */ } }
    else if (!(r.status === 400 && /already/i.test(t))) {
      if (/voice_limit|limit.{0,30}(reached|exceeded)|maximum.{0,20}voices/i.test(t)) return jerr("Your voice library is full. Remove a voice you don't use in ElevenLabs, then try again.", 409);
      if (r.status === 401 || r.status === 402 || r.status === 403) return jerr("Your ElevenLabs plan won't let this voice be added.", 402);
      return jerr("Couldn't add that voice to your library. Try again, or pick another.", 502);
    }
  }
  const check = await voiceInfo(useId);
  if (check.status !== 200) return jerr("That voice isn't in your account. Reload the list and try again.", 404);
  if (check.v?.category === "cloned") return jerr("A cloned voice can't be her default voice. Use the Use my voice switch in the dialer.", 409);

  // point the agent at it first (fast fail), then save, then re-run setup so everything matches
  if (s?.agent_id) {
    const pr = await fetch(`${XI}/convai/agents/${s.agent_id}`, { method: "PATCH", headers: xiHeaders(key), body: JSON.stringify({ conversation_config: { tts: ttsConfig(useId) } }) });
    if (!pr.ok) { await pr.text().catch(() => ""); return jerr("The voice platform wouldn't switch her voice. Try again.", 502); }
  }
  await db.from("ava_settings").update({ voice_id: useId, updated_at: new Date().toISOString() }).eq("id", true);
  let setupOk = false;
  try { setupOk = (await setup()).ok; } catch { /* the watchdog re-runs setup if something is off */ }
  return Response.json({ ok: true, voice_id: useId, name, setup_ok: setupOk }, { headers: CORS });
}

// ---------- Jared's own voice ----------
const MIME: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", webm: "audio/webm", ogg: "audio/ogg" };
const CLONE_PATH = /^clone\/[A-Za-z0-9._-]{1,120}\.(wav|mp3|m4a|mp4|webm|ogg)$/i;

async function purgeRaw(olderThanMs = 0): Promise<void> {
  try {
    const { data } = await db.storage.from("ava-voice").list("clone", { limit: 100 });
    const old = (data ?? []).filter((o) => o.name && (olderThanMs === 0 || Date.now() - Date.parse(o.created_at ?? "") > olderThanMs));
    if (old.length) await db.storage.from("ava-voice").remove(old.map((o) => `clone/${o.name}`));
  } catch { /* best effort */ }
}

async function voiceClone(b: Record<string, unknown>): Promise<Response> {
  const path = String(b.path ?? "");
  if (!CLONE_PATH.test(path)) return jerr("Record or upload your voice first.");
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  if ((await canClone(key)) === false) return jerr("Your voice plan doesn't include cloning yet.", 402, { code: "no_plan" });
  const dl = await db.storage.from("ava-voice").download(path);
  if (dl.error || !dl.data) return jerr("Couldn't read the recording. Upload it again.", 404);
  if (dl.data.size > 25 * 1024 * 1024) { await db.storage.from("ava-voice").remove([path]); return jerr("That file is over 25 MB. Record a shorter one.", 413); }
  if (dl.data.size < 20_000) return jerr("That recording is too short. Read the script for about 3 minutes.", 422);

  const ext = path.split(".").pop()!.toLowerCase();
  const form = new FormData();
  form.append("name", "Jared (Ava assistant)");
  form.append("description", "Jared's own voice for his AI assistant. Always disclosed as AI.");
  form.append("remove_background_noise", "true");
  form.append("files", new File([dl.data], `jared.${ext}`, { type: MIME[ext] ?? dl.data.type ?? "audio/mpeg" }));
  const r = await fetch(`${XI}/voices/add`, { method: "POST", headers: xiHeaders(key, false), body: form });
  const t = await r.text().catch(() => "");
  let j: RawVoice = {}; try { j = JSON.parse(t); } catch { /* not json */ }
  if (!r.ok || !j.voice_id) {
    if (r.status === 402 || /can_not_use_instant_voice_cloning|subscription/i.test(t)) return jerr("Your voice plan doesn't include cloning yet.", 402, { code: "no_plan" });
    if (/voice_limit|limit.{0,30}(reached|exceeded)/i.test(t)) return jerr("Your voice library is full. Remove a voice you don't use in ElevenLabs, then try again.", 409);
    if (/too short|not enough|minimum/i.test(t)) return jerr("That recording is too short. Read the script for about 3 minutes.", 422);
    return jerr("The voice platform couldn't make a clone from that recording. Try a quieter room.", 502);
  }
  const { data: prev } = await db.from("ava_settings").select("jared_voice_id, jared_pvc_voice_id, jared_ivc_voice_id, pvc_state").eq("id", true).single();
  // The Pro clone (ava-voicebank, trained from his meetings) is never replaced or deleted by a quick re-record:
  // while it's live, a new quick clone becomes the backup; otherwise it becomes the voice, as before.
  const proLive = !!prev?.jared_pvc_voice_id && prev.jared_voice_id === prev.jared_pvc_voice_id;
  const old = proLive ? prev?.jared_ivc_voice_id : prev?.jared_voice_id;
  await db.from("ava_settings").update({
    ...(proLive ? { jared_ivc_voice_id: j.voice_id } : { jared_voice_id: j.voice_id, jared_ivc_voice_id: null }),
    ...(prev?.pvc_state === "paused" ? { pvc_state: "collecting" } : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", true);
  // the raw recording is gone the moment the clone exists
  await db.storage.from("ava-voice").remove([path]);
  await purgeRaw();
  if (old && old !== j.voice_id && old !== prev?.jared_pvc_voice_id) await fetch(`${XI}/voices/${old}`, { method: "DELETE", headers: xiHeaders(key, false) }).then((x) => x.text()).catch(() => {});
  return Response.json({ ok: true, voice_id: j.voice_id }, { headers: CORS });
}

async function voicePreview(b: Record<string, unknown>): Promise<Response> {
  const { data: s } = await db.from("ava_settings").select("jared_voice_id").eq("id", true).single();
  if (!s?.jared_voice_id) return jerr("Record your voice first.", 412);
  const text = String(b.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200) || SAMPLE_JARED;
  return say(s.jared_voice_id, text);
}

async function voiceDelete(): Promise<Response> {
  const key = await xiKey();
  if (!key) return jerr("The ElevenLabs key is missing from Vault.", 412);
  const { data: s } = await db.from("ava_settings").select("jared_voice_id, jared_pvc_voice_id, jared_ivc_voice_id").eq("id", true).single();
  // "Delete my voice" removes every copy: the voice in use, the Pro clone and the quick-clone backup
  for (const id of new Set([s?.jared_voice_id, s?.jared_pvc_voice_id, s?.jared_ivc_voice_id].filter(Boolean) as string[])) {
    const r = await fetch(`${XI}/voices/${id}`, { method: "DELETE", headers: xiHeaders(key, false) });
    await r.text().catch(() => "");
    if (!r.ok && r.status !== 404) return jerr("Couldn't remove it from the voice platform. Try again.", 502);
  }
  await db.from("ava_voice_bank").delete().neq("meeting", "");
  // paused: the Mac stops banking his meetings until he records a voice again
  await db.from("ava_settings").update({ jared_voice_id: null, jared_pvc_voice_id: null, jared_ivc_voice_id: null, pvc_state: "paused", pvc_trained_seconds: 0,
    pvc_last_train_at: null, pvc_live_at: null, pvc_note: "Deleted. Record your voice again to restart.",
    jared_voice_for_contacts: false, jared_voice_paused_at: null, jared_voice_paused_why: null, updated_at: new Date().toISOString() }).eq("id", true);
  await purgeRaw();
  return Response.json({ ok: true }, { headers: CORS });
}

async function voiceResume(): Promise<Response> {
  await db.from("ava_settings").update({ jared_voice_paused_at: null, jared_voice_paused_why: null, updated_at: new Date().toISOString() }).eq("id", true);
  return Response.json({ ok: true }, { headers: CORS });
}

/** Watchdog part: her voice (and Jared's clone) must still exist. Missing voice = back to the default (Lily), setup re-run, Scout told. */
async function voiceHealth(): Promise<string[]> {
  const notes: string[] = [];
  try {
    if (!(await xiKey())) return notes;
    const { data: s } = await db.from("ava_settings").select("voice_id, jared_voice_id, jared_ivc_voice_id").eq("id", true).single();
    // tells ava-voicebank this build protects the Pro clone (re-record keeps it, delete removes it), so it may switch over
    await db.from("ava_settings").update({ pvc_guard_at: new Date().toISOString() }).eq("id", true);
    if (!s) return notes;
    const now = new Date().toISOString(), url = "https://bestly.tech/admin/ava", hour = now.slice(0, 13);
    const cur = await voiceInfo(s.voice_id ?? DEFAULT_VOICE);
    if (cur.missing) {
      if (s.voice_id && s.voice_id !== DEFAULT_VOICE) {
        await db.from("ava_settings").update({ voice_id: DEFAULT_VOICE, updated_at: now }).eq("id", true);
        let ok = false; try { ok = (await setup()).ok; } catch { /* below */ }
        notes.push("Her voice was missing; back on the default voice");
        await db.rpc("scout_notify", { p_title: "Ava (assistant): her voice went missing, switched back to Lily",
          p_body: `The voice she was using no longer exists in the account. She's on Lily again and setup ${ok ? "re-ran fine" : "couldn't finish (the line check will retry)"}. Pick a new one at /admin/ava.`,
          p_severity: "warning", p_push: true, p_url: url, p_dedupe: `ava-voice-missing-ava-${hour}` });
      } else {
        notes.push("The default voice is missing from the account");
        await db.rpc("scout_notify", { p_title: "Ava (assistant): her default voice is missing", p_body: "Lily isn't in the account, so she has no working voice. Pick one at /admin/ava.",
          p_severity: "high", p_push: true, p_url: url, p_dedupe: `ava-voice-missing-ava-${hour}` });
      }
    }
    if (s.jared_voice_id) {
      const j = await voiceInfo(s.jared_voice_id);
      // the Pro clone went missing but the quick clone is kept as backup: fall back to it
      const backup = j.missing && s.jared_ivc_voice_id && s.jared_ivc_voice_id !== s.jared_voice_id && !(await voiceInfo(s.jared_ivc_voice_id)).missing;
      if (backup) {
        await db.from("ava_settings").update({ jared_voice_id: s.jared_ivc_voice_id, updated_at: now }).eq("id", true);
        notes.push("Jared's Pro voice was missing; back on his quick clone");
      } else if (j.missing) {
        await db.from("ava_settings").update({ jared_voice_id: null, jared_voice_for_contacts: false, updated_at: now }).eq("id", true);
        notes.push("Jared's cloned voice was missing; voice mode is off");
        await db.rpc("scout_notify", { p_title: "Ava (assistant): your cloned voice is gone", p_body: "It no longer exists in the voice account, so Use my voice is off. Record it again at /admin/ava.",
          p_severity: "warning", p_push: true, p_url: url, p_dedupe: `ava-jaredvoice-missing-${hour}` });
      }
    }
    await purgeRaw(24 * 3600_000);   // a recording that never got cloned doesn't sit around
  } catch { /* the line check still runs */ }
  return notes;
}

// ---------- forwarded-call detection ----------
// Jared dials *71 8164299495 on Verizon; calls he doesn't answer on his cell forward to her line. Whether the diversion
// reaches us (a Diversion / History-Info header, or a called number that isn't her line) is only knowable from a real forwarded
// call: ElevenLabs documents caller_id, called_number and call id for the init webhook, and exposes custom X- headers as
// sip_* variables, but says nothing about Diversion. So every init and post-call payload shape is logged to ava_init_debug
// (keys and non-secret values, last 50) and the rule below reads whatever is there. No match = a normal inbound call.
const CELL10 = JARED_CELL.slice(-10), LINE10 = LINE.slice(-10);
const SECRETISH = /secret|token|passw|api[_-]?key|authori[sz]|signature|cookie|credential|bearer/i;

function flatten(o: unknown, prefix = "", out: Record<string, string> = {}, depth = 0): Record<string, string> {
  if (o == null || depth > 5 || Object.keys(out).length >= 150) return out;
  if (Array.isArray(o)) { o.slice(0, 10).forEach((v, i) => flatten(v, `${prefix}[${i}]`, out, depth + 1)); return out; }
  if (typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (!SECRETISH.test(k)) flatten(v, prefix ? `${prefix}.${k}` : k, out, depth + 1);
    return out;
  }
  out[prefix] = String(o).replace(/\s+/g, " ").slice(0, 160);
  return out;
}
/** The 10-digit number inside a value like "+18165007236", "(816) 500-7236" or "<sip:+18165007236@host>;reason=no-answer". */
const last10 = (v: string) => { const m = v.match(/\+?\d[\d\s().-]{8,}\d/); const d = (m?.[0] ?? v).replace(/\D/g, ""); return d.length >= 10 ? d.slice(-10) : ""; };

type Fwd = { forwarded: boolean; from: string | null; why: string | null };
/** A field that names Jared's cell AND looks like a diversion (by its name or its value), or a called number that isn't her line. */
function detectForward(fields: Record<string, string>): Fwd {
  const DIV_PATH = /divers|history[_ .-]?info|redirect|forward|rdnis|orig(inal)?[_ .-]?(called|dest|number|to|cld)|p[_-]?called|referred|retarget/i;
  const DIV_VALUE = /reason\s*=\s*(unconditional|no-?answer|busy|unavailable|deflection|follow-?me|out-of-service|time-of-day|do-not-disturb|unknown|cfnr|cfb|cfu)|;\s*counter\s*=|cause\s*=\s*(486|480|408|404|302)/i;
  const CALLED_PATH = /(^|[._\[])(system__called_number|called_number|called|to_number|to|dnis|agent_number)$/i;
  let calledDiff: Fwd | null = null;
  for (const [path, v] of Object.entries(fields)) {
    if ((DIV_PATH.test(path) || DIV_VALUE.test(v)) && v.replace(/\D/g, "").includes(CELL10)) return { forwarded: true, from: JARED_CELL, why: `${path} names the cell` };
    if (!calledDiff && CALLED_PATH.test(path)) {
      const n = last10(v);
      if (n && n !== LINE10) calledDiff = { forwarded: true, from: n === CELL10 ? JARED_CELL : `+1${n}`, why: `${path} is not her line` };
    }
  }
  return calledDiff ?? { forwarded: false, from: null, why: null };
}

async function logDebug(row: { kind: "init" | "post"; keys: unknown; fields: Record<string, string>; fwd: Fwd; note?: string }) {
  try {
    await db.from("ava_init_debug").insert({ kind: row.kind, keys: row.keys, fields: row.fields, forwarded: row.fwd.forwarded, forwarded_from: row.fwd.from,
      note: [row.fwd.why, row.note].filter(Boolean).join(" | ") || null });
  } catch { /* debugging must never touch a call */ }
}

/** The first line on every incoming and forwarded call. Short on purpose; the recording notice comes after the caller's first reply (see PROMPT). */
const IN_GREETING = (first: string | null) => `Hey${first ? ` ${first}` : ""}, Jared's phone. What's up?`;
const FWD_GREETING = IN_GREETING;
/** Voice-mode rules on a forwarded call: she is the assistant, never him. */
const VOICE_RULES_FWD = "VOICE MODE: you are speaking in Jared's own voice, answering his phone as his assistant. Never say \"this is Jared\" or \"I'm Jared\", and never speak as if you are him, even if asked \"Is this Jared?\" (say \"This is his assistant.\"). If anyone sincerely asks whether you are a person, a robot or an AI, say plainly that you're Jared's AI assistant. Never commit to anything for him: no money, plans, appointments or promises. Say you'll pass it on. Your second line must say you are his assistant and give the recording notice (\"I'm his assistant, he can't grab the phone. Heads up, calls here get recorded.\"). If anyone calls you Jared, correct them right away.";

// ---------- webhooks ----------
async function initHook(req: Request): Promise<Response> {
  const secret = await vault("ava_init_secret");
  if (!secret || req.headers.get("x-ava-init") !== secret) return new Response("unauthorized", { status: 401 });
  const b = await req.json().catch(() => ({}));
  const caller = toE164(String(b.caller_id ?? "")) ?? String(b.caller_id ?? "");
  const { data: c } = caller ? await db.from("ava_contacts").select("name, relationship, notes").eq("phone", caller).maybeSingle() : { data: null };
  const { data: st } = await db.from("ava_settings").select("jared_cell, forward_enabled, forward_voice, jared_voice_id, jared_voice_paused_at").eq("id", true).maybeSingle();
  const trusted = !!c || (!!caller && caller === (st?.jared_cell ?? JARED_CELL)) ? "yes" : "no";

  const fields = flatten(b);
  const fwd = caller === (st?.jared_cell ?? JARED_CELL) ? { forwarded: false, from: null, why: null } : detectForward(fields);
  await logDebug({ kind: "init", keys: { body: Object.keys(b), headers: [...req.headers.keys()] }, fields, fwd });

  const base = { knowledge: await knowledge(), coach_notes: await coachNotes(), ...nowVars() };
  if (fwd.forwarded) {
    // a call to Jared's cell he didn't answer. Her voice is his clone only when he turned that on and the clone is healthy.
    const useJared = st?.forward_enabled === true && st.forward_voice === "jared" && !!st.jared_voice_id && !st.jared_voice_paused_at;
    const first = c?.name ? String(c.name).replace(/\{\{|\}\}/g, "").trim().split(/\s+/)[0] || null : null;
    const greeting = FWD_GREETING(first);
    return Response.json({ type: "conversation_initiation_client_data",
      conversation_config_override: { agent: { first_message: greeting }, ...(useJared ? { tts: { voice_id: st!.jared_voice_id } } : {}) },
      dynamic_variables: { ...UNKNOWN, ...(c ? { caller_name: c.name, caller_notes: `They're Jared's ${c.relationship ?? "contact"}. ${c.notes ?? ""}` } : {}),
        caller_trusted: trusted, greeting, forward_rules: FORWARD_RULES, voice_rules: useJared ? VOICE_RULES_FWD : "",
        call_voice: useJared ? "jared" : "ava", forwarded: "yes", forwarded_from: fwd.from ?? JARED_CELL,
        call_context: "A call to Jared's own cell that he didn't answer, forwarded to you. You are his assistant taking the call. Take a message.", ...base } });
  }
  const vars = c ? {
    caller_trusted: trusted, caller_name: c.name, caller_notes: `They're Jared's ${c.relationship ?? "contact"}. ${c.notes ?? ""}`,
    greeting: IN_GREETING(String(c.name).replace(/\{\{|\}\}/g, "").trim().split(/\s+/)[0] || null),
  } : { ...UNKNOWN, caller_trusted: trusted };
  return Response.json({ type: "conversation_initiation_client_data",
    dynamic_variables: { ...UNKNOWN, ...vars, call_context: "Someone called Jared's line. Take a message.", ...base } });
}

// ---------- evidence: the private, permanent copy of a spam call's recording ----------
const EVIDENCE_TRIES = 36;   // the watchdog (every 10 minutes) keeps trying for about 6 hours
async function saveEvidence(callId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: c } = await db.from("ava_calls").select("id, call_no, conversation_id, evidence_path, evidence_tries").eq("id", callId).maybeSingle();
  if (!c?.conversation_id) return { ok: false, error: "no recording for this call" };
  if (c.evidence_path) return { ok: true };
  const fail = async (why: string) => {
    const tries = (c.evidence_tries ?? 0) + 1;
    await db.from("ava_calls").update({ evidence_tries: tries, evidence_error: why.slice(0, 200) }).eq("id", c.id);
    if (tries === EVIDENCE_TRIES) {
      await db.rpc("scout_notify", { p_title: `Ava (assistant): couldn't save the recording of call #${c.call_no ?? "?"}`,
        p_body: `The spam call's recording never copied into your evidence folder (${why}). Download it from ElevenLabs before it expires.`,
        p_severity: "warning", p_push: true, p_url: "https://bestly.tech/admin/ava", p_dedupe: `ava-evidence-fail-${c.id}` });
    }
    return { ok: false, error: why };
  };
  const key = await vault("elevenlabs_api_key");
  if (!key) return fail("ElevenLabs key missing");
  try {
    const res = await fetch(`${XI}/convai/conversations/${c.conversation_id}/audio`, { headers: { "xi-api-key": key } });
    if (!res.ok) { await res.text().catch(() => ""); return fail(`recording not ready (${res.status})`); }
    const type = res.headers.get("content-type") ?? "audio/mpeg";
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength < 2000) return fail("recording was empty");
    const path = `${new Date().getUTCFullYear()}/${c.conversation_id}.${/wav/i.test(type) ? "wav" : /ogg/i.test(type) ? "ogg" : "mp3"}`;
    const up = await db.storage.from("ava-evidence").upload(path, buf, { contentType: type, upsert: true });
    if (up.error) return fail(`storage: ${up.error.message}`);
    await db.from("ava_calls").update({ evidence_path: path, evidence_at: new Date().toISOString(), evidence_error: null }).eq("id", c.id);
    return { ok: true };
  } catch (e) { return fail(e instanceof Error ? e.message : "error"); }
}

/** Every spam call that still has no copy (watchdog, every 10 minutes, no AI). */
async function evidenceRetry(): Promise<number> {
  const { data } = await db.from("ava_calls").select("id").eq("is_spam", true).is("evidence_path", null).not("conversation_id", "is", null)
    .lt("evidence_tries", EVIDENCE_TRIES).gt("created_at", new Date(Date.now() - 14 * 86400_000).toISOString()).order("created_at", { ascending: true }).limit(5);
  let n = 0;
  for (const r of data ?? []) if ((await saveEvidence(r.id)).ok) n++;
  return n;
}

async function evidence(b: Record<string, unknown>): Promise<Response> {
  const id = String(b.call_id ?? "");
  if (!id) return Response.json({ ok: true, saved: await evidenceRetry() }, { headers: CORS });
  const r = await saveEvidence(id);
  return Response.json(r, { status: r.ok ? 200 : 502, headers: CORS });
}

// ---------- Do Not Call: the complaint text and the demand-letter template (fixed text, no AI, never sent) ----------
const DNC_FORM = "https://www.donotcall.gov/report.html";
const ptFull = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
  .format(new Date(iso)).replace(/,? at /, " at ").replace(/\u202f/g, " ");
const ptDate = (d = new Date()) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", year: "numeric", month: "long", day: "numeric" }).format(d);
const prettyPhone = (v: string | null | undefined) => { const d = (v ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, ""); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (v ?? ""); };
const uniq = (a: (string | null | undefined)[]) => [...new Set(a.map((x) => (x ?? "").trim()).filter(Boolean))];
const dollars = (n: number) => `$${n.toLocaleString("en-US")}`;

type SpamCall = { id: string; call_no: number | null; created_at: string; phone: string | null; forwarded: boolean; robocall: boolean; spam_offer: string | null;
  spam_caller_name: string | null; spam_callback_number: string | null; spam_website: string | null };
type SpamCo = { id: string; name: string | null; website: string | null; callback_numbers: string[]; caller_ids: string[]; calls_12mo: number; status: string };

async function spamCompany(id: string): Promise<{ co: SpamCo; calls: SpamCall[] } | null> {
  const { data: co } = await db.from("ava_spam_companies").select("id, name, website, callback_numbers, caller_ids, calls_12mo, status").eq("id", id).maybeSingle();
  if (!co) return null;
  const { data: calls } = await db.from("ava_calls").select("id, call_no, created_at, phone, forwarded, robocall, spam_offer, spam_caller_name, spam_callback_number, spam_website")
    .eq("spam_company_id", id).eq("is_spam", true).order("created_at", { ascending: true });
  return { co: co as SpamCo, calls: (calls ?? []) as SpamCall[] };
}

/** Only calls that came through Jared's cell are on the registered number. */
const NO_CELL_CALLS = "None of this company's calls are marked Forwarded, so none are on your registered number. Open each call and tap \"Came through my cell\" for the ones that did.";

function callLine(c: SpamCall, i: number) {
  return `${i + 1}. ${ptFull(c.created_at)}. Caller ID: ${prettyPhone(c.phone) || "unknown"}. Prerecorded message: ${c.robocall ? "yes" : "no"}.${c.spam_offer ? ` Offered: ${c.spam_offer}.` : ""}`;
}

async function spamComplaint(b: Record<string, unknown>): Promise<Response> {
  const d = await spamCompany(String(b.company_id ?? ""));
  if (!d) return jerr("That company isn't there anymore.", 404);
  const calls = d.calls.filter((c) => c.forwarded);
  if (!calls.length) return jerr(NO_CELL_CALLS, 409);
  const name = d.co.name ?? "(company name not given)";
  const text = [
    "DO NOT CALL COMPLAINT. Draft to paste into donotcall.gov/report.html. Jared submits it himself.",
    "",
    `Number that was called: ${prettyPhone(JARED_CELL)} (registered on the National Do Not Call Registry)`,
    `Company that called: ${name}`,
    d.co.website ? `Website: ${d.co.website}` : null,
    uniq([...d.co.callback_numbers.map(prettyPhone), ...calls.map((c) => prettyPhone(c.spam_callback_number))]).length
      ? `Call-back number(s) they gave: ${uniq([...d.co.callback_numbers.map(prettyPhone), ...calls.map((c) => prettyPhone(c.spam_callback_number))]).join(", ")}` : null,
    uniq(calls.map((c) => c.phone ? prettyPhone(c.phone) : null)).length ? `Caller ID(s) shown: ${uniq(calls.map((c) => prettyPhone(c.phone))).join(", ")}` : null,
    uniq(calls.map((c) => c.spam_caller_name)).length ? `Caller name(s) they gave: ${uniq(calls.map((c) => c.spam_caller_name)).join(", ")}` : null,
    uniq(calls.map((c) => c.spam_offer)).length ? `What they were selling: ${uniq(calls.map((c) => c.spam_offer)).join("; ")}` : null,
    "",
    `Calls (${calls.length}), times in Pacific:`,
    ...calls.map(callLine),
    "",
    "Before you file: confirm you have no business relationship with this company and never gave them permission to call.",
  ].filter((x) => x !== null).join("\n");
  return Response.json({ ok: true, text, form_url: DNC_FORM, calls: calls.length }, { headers: CORS });
}

async function spamLetter(b: Record<string, unknown>): Promise<Response> {
  const d = await spamCompany(String(b.company_id ?? ""));
  if (!d) return jerr("That company isn't there anymore.", 404);
  const calls = d.calls.filter((c) => c.forwarded);
  if (!calls.length) return jerr(NO_CELL_CALLS, 409);
  const name = d.co.name ?? "(company name not given)";
  const n = calls.length;
  const nums = uniq([...d.co.callback_numbers.map(prettyPhone), ...calls.map((c) => prettyPhone(c.spam_callback_number))]);
  const text = [
    "Draft. Not legal advice. Review before sending.",
    "",
    "[Your name]",
    "[Your mailing address]",
    ptDate(),
    "",
    `To: ${name}, Legal / Compliance Department`,
    d.co.website ? `Website: ${d.co.website}` : null,
    nums.length ? `Call-back number(s) they gave: ${nums.join(", ")}` : null,
    "",
    `Re: Telemarketing calls to ${prettyPhone(JARED_CELL)}, a number on the National Do Not Call Registry`,
    "",
    "To whom it may concern:",
    "",
    `My telephone number, ${prettyPhone(JARED_CELL)}, is on the National Do Not Call Registry [registered since: DATE, from donotcall.gov > Verify a Registration]. Your company, or someone calling on your behalf, called that number ${n === 1 ? "once" : `${n} times`}:`,
    "",
    ...calls.map(callLine),
    "",
    "I have no business relationship with your company and I did not give it permission to call me.",
    "",
    `Under the Telephone Consumer Protection Act, 47 U.S.C. § 227(c)(5), a person who receives more than one telephone call in a 12-month period from or on behalf of the same entity in violation of the Do Not Call rules (47 C.F.R. § 64.1200(c)(2)) may recover up to $500 for each violation, and a court may increase that to up to three times as much ($1,500 per call) if the violation was willful or knowing. For the ${n === 1 ? "call" : `${n} calls`} above, that is up to ${dollars(500 * n)}, or up to ${dollars(1500 * n)} if willful.`,
    "",
    "I request that you:",
    `1. Stop calling this number and add it to your internal do-not-call list now (47 C.F.R. § 64.1200(d)(3)).`,
    "2. Send me a copy of your written Do Not Call policy, which you must provide on request (47 C.F.R. § 64.1200(d)(1)).",
    "3. Tell me, in writing, where you got my number and when.",
    `4. Resolve this with me directly. I am willing to settle for ${dollars(500 * n)} if I hear from you within 14 days.`,
    "",
    "If I do not hear from you, I reserve all of my rights, including complaints to the FTC and FCC and the claims described above.",
    "",
    "Sincerely,",
    "[Your name]",
    "[Your email or mailing address]",
  ].filter((x) => x !== null).join("\n");
  await db.from("ava_spam_companies").update({ status: "letter_drafted", updated_at: new Date().toISOString() }).eq("id", d.co.id).in("status", ["tracking", "threshold"]);
  return Response.json({ ok: true, text, calls: n }, { headers: CORS });
}


// ---------- calendars (iCloud + Nextcloud, read-only free/busy; writes only to the Nextcloud calendar Jared marks "Ava books here") ----------
const INTENTS = new Set(["appointment", "callback", "question", "info_only", "spam", "other"]);
// Calendar logins live only in Vault. The Calendars card writes ava_caldav_* through an admin RPC (never through this function, never echoed back).
// Nextcloud falls back to the login Bestly already keeps in Vault for cloud.bestly.tech (nextcloud_base_url / nextcloud_user / nextcloud_app_password).
// iCloud has no fallback: Jared pastes an Apple app-specific password. The wall_icloud_* secrets are deliberately NOT used.
const CAL_SECRETS = ["ava_caldav_nextcloud_user", "ava_caldav_nextcloud_pass", "ava_caldav_icloud_user", "ava_caldav_icloud_pass"];
const PROVIDER_NAME: Record<Provider, string> = { nextcloud: "Nextcloud", icloud: "iCloud" };
type CalFound = { id: string; href: string; name: string; writable: boolean; provider?: Provider };
type CalCheck = { at: string; ok: boolean; last_ok_at?: string | null; error?: string };
type CalCfg = { selected?: string[]; book_to?: string | null; hours?: Hours; turo_window_min?: number; found?: Partial<Record<Provider, CalFound[]>>; checked?: Partial<Record<Provider, CalCheck>> };
type Booking = { action_id: string; source_call_id: string; source: string; slot: string; offered: string[]; purpose: string; duration_min?: number; business: string | null; who: string; phone: string };

async function calSettings(): Promise<CalCfg> {
  const { data } = await db.from("ava_settings").select("calendars").eq("id", true).maybeSingle();
  return (data?.calendars ?? {}) as CalCfg;
}
/** Merge a patch into ava_settings.calendars (re-reads first so a choice Jared just saved isn't overwritten). */
async function saveCal(patch: Partial<CalCfg>): Promise<CalCfg> {
  const next = { ...(await calSettings()), ...patch };
  await db.from("ava_settings").update({ calendars: next, updated_at: new Date().toISOString() }).eq("id", true);
  return next;
}
async function calCreds(): Promise<Partial<Record<Provider, Creds>>> {
  const [nu, np, iu, ip, su, sp, sb] = await Promise.all([...CAL_SECRETS, "nextcloud_user", "nextcloud_app_password", "nextcloud_base_url"].map((n) => vault(n)));
  const base = sb && /^https:\/\//i.test(sb) ? sb : undefined;
  const nextcloud = nu && np ? { user: nu, pass: np, base } : su && sp ? { user: su, pass: sp, base } : null;
  return { ...(nextcloud ? { nextcloud } : {}), ...(iu && ip ? { icloud: { user: iu, pass: ip } } : {}) };
}
/** Is the shared Bestly Nextcloud login being used (no override pasted)? Booleans only. */
async function nextcloudShared(): Promise<boolean> {
  const [nu, np] = await Promise.all([vault("ava_caldav_nextcloud_user"), vault("ava_caldav_nextcloud_pass")]);
  return !(nu && np);
}
const errText = (e: unknown) => (e instanceof Error ? e.message : "error").replace(/[\r\n]+/g, " ").slice(0, 160);

/** Can "Find times" run? Not when no calendar is ticked, or when a connected calendar's last check failed (the reason is shown on the button). */
function findTimesState(cfg: CalCfg, creds: Partial<Record<Provider, Creds>>): { ok: boolean; reason: string | null } {
  for (const p of ["nextcloud", "icloud"] as Provider[]) {
    if (creds[p] && cfg.checked?.[p] && cfg.checked[p]!.ok === false) return { ok: false, reason: `Can't read your ${PROVIDER_NAME[p]} calendar. Update the login in the Calendars card.` };
  }
  const ticked = (["nextcloud", "icloud"] as Provider[]).some((p) => creds[p] && (cfg.found?.[p] ?? []).some((c) => (cfg.selected ?? []).includes(c.id)));
  if (!ticked) return { ok: false, reason: "No calendar is connected and ticked yet. Add one in the Calendars card." };
  return { ok: true, reason: null };
}

async function calStatus(): Promise<Response> {
  const [cfg, creds, shared] = await Promise.all([calSettings(), calCreds(), nextcloudShared()]);
  const one = (p: Provider) => ({ connected: !!creds[p], calendars: cfg.found?.[p] ?? [], checked: cfg.checked?.[p] ?? null });
  return Response.json({ ok: true, nextcloud: { ...one("nextcloud"), shared_login: !!creds.nextcloud && shared }, icloud: one("icloud"), selected: cfg.selected ?? [], book_to: cfg.book_to ?? null,
    hours: cfg.hours ?? DEFAULT_HOURS, turo_window_min: cfg.turo_window_min ?? TURO_WINDOW_MIN, find_times: findTimesState(cfg, creds) }, { headers: CORS });
}

/** Save Calendars-card choices (which calendars count, where Ava books, hours, the Turo window). Validated, merged into ava_settings.calendars. */
async function calSave(b: Record<string, unknown>): Promise<Response> {
  const cfg = await calSettings();
  const known = new Set((["nextcloud", "icloud"] as Provider[]).flatMap((p) => (cfg.found?.[p] ?? []).map((c) => c.id)));
  const patch: Partial<CalCfg> = {};
  if (Array.isArray(b.selected)) patch.selected = (b.selected as unknown[]).map(String).filter((id) => known.has(id));
  if (b.book_to === null || typeof b.book_to === "string") {
    const nc = new Set((cfg.found?.nextcloud ?? []).filter((c) => c.writable).map((c) => c.id));
    patch.book_to = b.book_to && nc.has(String(b.book_to)) ? String(b.book_to) : null;
  }
  const h = b.hours as Partial<Hours> | undefined;
  if (h && typeof h === "object") {
    const start = Number(h.start), end = Number(h.end), days = Array.isArray(h.days) ? [...new Set((h.days as unknown[]).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))] : null;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > 24 || end - start < 1 || !days?.length) return jerr("Pick at least one day, and an end hour after the start.");
    patch.hours = { start, end, days };
  }
  if (b.turo_window_min !== undefined) {
    const w = Math.round(Number(b.turo_window_min));
    if (!Number.isFinite(w) || w < 0 || w > 240) return jerr("The Turo window is 0 to 240 minutes.");
    patch.turo_window_min = w;
  }
  const next = await saveCal(patch);
  return Response.json({ ok: true, selected: next.selected ?? [], book_to: next.book_to ?? null, hours: next.hours ?? DEFAULT_HOURS, turo_window_min: next.turo_window_min ?? TURO_WINDOW_MIN }, { headers: CORS });
}

/** Jared types an app password into the admin form; it goes straight to Vault. The value is never logged and never sent back. */
async function calSecretPut(b: Record<string, unknown>): Promise<Response> {
  const name = String(b.name ?? ""), value = String(b.value ?? "").trim();
  if (!CAL_SECRETS.includes(name)) return jerr("That isn't a calendar login field.");
  if (!value || value.length > 200) return jerr("Type the value first.");
  const { error } = await db.rpc("ava_secret_put", { p_name: name, p_value: value });
  if (error) return jerr("Couldn't save it to the vault. Try again.", 500);
  return Response.json({ ok: true }, { headers: CORS });
}

async function calDisconnect(b: Record<string, unknown>): Promise<Response> {
  const p = b.provider === "icloud" ? "icloud" : b.provider === "nextcloud" ? "nextcloud" : null;
  if (!p) return jerr("Pick nextcloud or icloud.");
  for (const n of p === "nextcloud" ? CAL_SECRETS.slice(0, 2) : CAL_SECRETS.slice(2)) await db.rpc("ava_secret_put", { p_name: n, p_value: "" });
  if (p === "nextcloud" && (await calCreds()).nextcloud) return Response.json({ ok: true, still_connected: true }, { headers: CORS });   // the shared Bestly login stays; only the override was cleared
  const cfg = await calSettings();
  const gone = new Set((cfg.found?.[p] ?? []).map((c) => c.id));
  const found = { ...(cfg.found ?? {}) }; delete found[p];
  const checked = { ...(cfg.checked ?? {}) }; delete checked[p];
  await saveCal({ found, checked, selected: (cfg.selected ?? []).filter((id) => !gone.has(id)), book_to: cfg.book_to && gone.has(cfg.book_to) ? null : cfg.book_to ?? null });
  return Response.json({ ok: true }, { headers: CORS });
}

/** Test a connection: list the calendars the login can see. First time for a provider, every calendar is ticked (Jared unticks the ones that don't count). */
async function calTest(b: Record<string, unknown>): Promise<Response> {
  const p = b.provider === "icloud" ? "icloud" : b.provider === "nextcloud" ? "nextcloud" : null;
  if (!p) return jerr("Pick nextcloud or icloud.");
  const creds = (await calCreds())[p];
  if (!creds) return jerr(`${PROVIDER_NAME[p]} isn't connected yet. Enter both fields and save them first.`, 412);
  const now = new Date().toISOString(), cfg = await calSettings();
  const trace: string[] = [];
  try {
    const cals = await discover(p, creds, trace);
    const had = (cfg.found?.[p] ?? []).length > 0;
    const found = { ...(cfg.found ?? {}), [p]: cals.map((c) => ({ id: c.id, href: c.href, name: c.name, writable: c.writable })) };
    const selected = had ? cfg.selected ?? [] : [...new Set([...(cfg.selected ?? []), ...cals.map((c) => c.id)])];
    // signed in but nothing to read is a problem, not a success: Find times has nothing to look at
    const checked = { ...(cfg.checked ?? {}), [p]: cals.length ? { at: now, ok: true, last_ok_at: now } : { at: now, ok: false, last_ok_at: cfg.checked?.[p]?.last_ok_at ?? null, error: `signed in to ${PROVIDER_NAME[p]} but no calendars are visible` } };
    // keep the choice if it is still there; otherwise Ava books nowhere until Jared picks (she never guesses a calendar to write to)
    const bookTo = cfg.book_to && cals.some((c) => c.id === cfg.book_to && c.writable) ? cfg.book_to : (p === "nextcloud" ? null : cfg.book_to ?? null);
    await saveCal({ found, selected, checked, book_to: bookTo });
    return Response.json({ ok: true, provider: p, calendars: found[p], ...(cals.length ? {} : { warning: "Signed in, but no calendars are visible.", trace }) }, { headers: CORS });
  } catch (e) {
    await saveCal({ checked: { ...(cfg.checked ?? {}), [p]: { at: now, ok: false, last_ok_at: cfg.checked?.[p]?.last_ok_at ?? null, error: errText(e) } } });
    return Response.json({ ok: false, error: `${errText(e)}.`, trace }, { status: 502, headers: CORS });
  }
}

/** Busy intervals from the ticked calendars plus the Turo Watch trips (Turo: only the window around each pickup and return, 60 minutes each side by default). */
async function busyIntervals(from: number, to: number): Promise<Busy[]> {
  const [cfg, creds] = await Promise.all([calSettings(), calCreds()]);
  const all: Cal[] = (["nextcloud", "icloud"] as Provider[]).flatMap((p) => (cfg.found?.[p] ?? []).map((c) => ({ ...c, provider: p })));
  const cals = all.filter((c) => (cfg.selected ?? []).includes(c.id) && creds[c.provider]);
  if (!cals.length) throw new Error("No calendar is connected and ticked yet. Add one in the Calendars card.");
  let busy: Busy[];
  const turoMin = cfg.turo_window_min ?? TURO_WINDOW_MIN;
  try { busy = await busyFrom(cals, creds, from, to, turoMin); }
  catch (e) { throw new Error(`Couldn't read your calendar (${errText(e)})`); }
  try {
    const { data } = await db.from("turo_trips").select("starts_at, ends_at").eq("status", "BOOKED").gte("ends_at", new Date(from - 4 * 3600_000).toISOString()).lte("starts_at", new Date(to + 4 * 3600_000).toISOString());
    for (const t of (data ?? []) as { starts_at: string | null; ends_at: string | null }[]) {
      if (t.starts_at && t.ends_at) turoWindows(Date.parse(t.starts_at), Date.parse(t.ends_at), turoMin * 60_000, busy);
    }
  } catch { /* Turo Watch is optional */ }
  return busy;
}

async function computeSlots(o: { purpose?: string; durationMin?: number | null; constraints?: string | null; count?: number; days?: number }): Promise<{ slots: Slot[]; duration_min: number; constraints: string | null }> {
  const dur = durationFor(o.purpose ?? "", o.durationMin), days = o.days ?? 14, cfg = await calSettings();
  const cons = (o.constraints ?? "").trim().slice(0, 200) || null;
  const busy = await busyIntervals(Date.now(), Date.now() + (days + 1) * 86400_000);
  const slots = freeSlots(busy, { durationMin: dur, count: o.count ?? 6, days, hours: cfg.hours ?? DEFAULT_HOURS, constraints: cons ? parseConstraints(cons) : undefined });
  return { slots, duration_min: dur, constraints: cons };
}

/** "Find times": read-only. Accepts an action_id (uses the length and availability the caller gave) or explicit duration_min / constraints / purpose. */
async function freeSlotsAction(b: Record<string, unknown>): Promise<Response> {
  let dur = Number(b.duration_min) || null, cons = String(b.constraints ?? "").trim() || null, purpose = String(b.purpose ?? "").slice(0, 200);
  if (b.action_id) {
    const { data: a } = await db.from("ava_actions").select("payload, kind").eq("id", String(b.action_id)).maybeSingle();
    const pl = (a?.payload ?? {}) as Record<string, unknown>;
    if (a && a.kind === "find_times") { dur = dur ?? (Number(pl.appt_duration_min) || null); cons = cons ?? (String(pl.appt_constraints ?? pl.preferred_times ?? "").trim() || null); purpose = purpose || String(pl.appointment_purpose ?? ""); }
  }
  const [cfg, creds] = await Promise.all([calSettings(), calCreds()]);
  const st = findTimesState(cfg, creds);
  if (!st.ok) return jerr(st.reason ?? "Calendars aren't ready.", 412);
  try {
    const r = await computeSlots({ purpose, durationMin: dur, constraints: cons, count: 6, days: 14 });
    return Response.json({ ok: true, ...r }, { headers: CORS });
  } catch (e) { return jerr(errText(e), 412); }
}

/**
 * "today": the calendar part of the morning brief. Reads the ticked calendars for one Pacific day (day_offset 0 today, 1 tomorrow) and writes
 * the events into ava_brief_cache (the SQL job composes the text from it). Only counts come back here; titles stay on the server.
 * A Turo trip shows only at its pickup and its return, never as an all-day block. Same calendar code as Find times.
 */
async function todayAction(b: Record<string, unknown>): Promise<Response> {
  const offset = Math.min(Math.max(Math.round(Number(b.day_offset) || 0), 0), 7);
  const p = ptParts(Date.now());
  const from = zonedToUtc(p.y, p.mo, p.d + offset, 0, 0), to = zonedToUtc(p.y, p.mo, p.d + offset + 1, 0, 0);
  const dayStr = (() => { const q = ptParts(from + 12 * 3600_000); return `${q.y}-${String(q.mo).padStart(2, "0")}-${String(q.d).padStart(2, "0")}`; })();
  const [cfg, creds] = await Promise.all([calSettings(), calCreds()]);
  const all: Cal[] = (["nextcloud", "icloud"] as Provider[]).flatMap((pv) => (cfg.found?.[pv] ?? []).map((c) => ({ ...c, provider: pv })));
  const cals = all.filter((c) => (cfg.selected ?? []).includes(c.id) && creds[c.provider]);
  const save = async (events: unknown[], ok: boolean, error: string | null) => {
    await db.from("ava_brief_cache").upsert({ day: dayStr, events, ok, error, fetched_at: new Date().toISOString() }, { onConflict: "day" });
  };
  if (!cals.length) { await save([], true, null); return Response.json({ ok: true, day: dayStr, calendars: 0, count: 0 }, { headers: CORS }); }
  try {
    const evs = await eventsIn(cals, creds, from, to);
    const out: { t: string; title: string; kind: string }[] = [];
    for (const ev of evs) {
      if (ev.free) continue;
      const title = (ev.summary || "Busy").replace(/\s+/g, " ").trim().slice(0, 80);
      if (ev.turo) {
        // pickup and return only, and only when they fall on this day
        if (ev.start >= from && ev.start < to) out.push({ t: new Date(ev.start).toISOString(), title: "", kind: "pickup" });
        if (ev.end > ev.start && ev.end >= from && ev.end < to) out.push({ t: new Date(ev.end).toISOString(), title: "", kind: "return" });
        continue;
      }
      if (ev.allDay) continue;                                       // birthdays, holidays
      if (ev.end <= from || ev.start >= to) continue;
      out.push({ t: new Date(Math.max(ev.start, from)).toISOString(), title, kind: "event" });
    }
    out.sort((x, y) => x.t.localeCompare(y.t));
    await save(out, true, null);
    return Response.json({ ok: true, day: dayStr, calendars: cals.length, count: out.length }, { headers: CORS });
  } catch (e) {
    await save([], false, errText(e).slice(0, 200));
    return Response.json({ ok: false, error: `Couldn't read your calendar (${errText(e)}).`, day: dayStr }, { status: 502, headers: CORS });
  }
}

const ptLabel = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" })
  .format(new Date(iso)).replace(/[ \u202f\u00a0](AM|PM)/, "\u00a0$1");

/** ONE outbound call that offers the slot Jared tapped (his tap is the yes), with the next two free slots as fallbacks. Same spend cap and gate as every call. */
async function bookCall(b: Record<string, unknown>): Promise<Response> {
  const actionId = String(b.action_id ?? ""), slotStart = String(b.slot_start ?? "");
  const { data: a } = await db.from("ava_actions").select("*").eq("id", actionId).maybeSingle();
  if (!a || a.kind !== "find_times") return jerr("That action isn't there anymore.", 404);
  if (a.source !== "ava") return jerr("Booking calls come from your personal line, not RoofGuard.", 400);
  if (a.status !== "open") return jerr(`That action is already ${a.status}.`, 409);
  const pl = (a.payload ?? {}) as Record<string, string | null>;
  const phone = toE164(String(b.phone ?? pl.phone ?? ""));
  if (!phone) return jerr("There's no number to call back. Add the number they gave, then try again.", 400);
  if (pl.booking_call_id) {
    const { data: prev } = await db.from("ava_calls").select("status, created_at").eq("id", pl.booking_call_id).maybeSingle();
    if (prev && ["queued", "in_progress"].includes(prev.status) && Date.now() - Date.parse(prev.created_at) < 15 * 60_000) return jerr("Ava is already calling about this one.", 409);
  }
  const purposeText = String(pl.appointment_purpose ?? pl.purpose ?? "").trim().slice(0, 120) || "a meeting with Jared";
  const durMin = durationFor(purposeText, Number(b.duration_min) || Number(pl.appt_duration_min) || null);
  let slots: Slot[];
  try { slots = (await computeSlots({ purpose: purposeText, durationMin: durMin, constraints: String(pl.appt_constraints ?? pl.preferred_times ?? "") || null, count: 12, days: 14 })).slots; } catch (e) { return jerr(errText(e), 412); }
  const i = slots.findIndex((s) => Math.abs(Date.parse(s.start) - Date.parse(slotStart)) < 60_000);
  if (i < 0) return jerr("That time just filled up. Pick another one.", 409);
  const rest = [...slots.slice(i + 1), ...slots.slice(0, i)].slice(0, 2);
  const offered = [slots[i], ...rest];
  const { data: src } = a.source === "roofguard" ? await db.from("rg_calls").select("caller_name").eq("id", a.call_id).maybeSingle() : await db.from("ava_calls").select("caller_name").eq("id", a.call_id).maybeSingle();
  const person = String(src?.caller_name ?? "").trim(), biz = String(pl.business ?? "").trim() || null;
  const times = offered.map((s) => spoken(s.start));
  const purpose = `Jared asked you to call ${person || biz || "them"}${biz && person ? ` (${biz})` : ""} back to set up ${purposeText}.${pl.preferred_times ? ` They said ${String(pl.preferred_times).slice(0, 100)} works.` : ""} `
    + `Offer ${times[0]} first.${times[1] ? ` If it doesn't work, offer ${times[1]}${times[2] ? `, then ${times[2]}` : ""}.` : ""} If one works, say it back once. If none works, ask what does, and say you'll pass it on to Jared.`;
  const booking: Booking = { action_id: a.id, source_call_id: a.call_id, source: a.source, slot: slots[i].start, offered: offered.map((s) => s.start), purpose: purposeText, duration_min: durMin, business: biz, who: person || biz || "them", phone };
  const r = await place({ phone, name: person, purpose,
    first_line: `Hi${person ? ` ${person.split(/\s+/)[0]}` : ""}, it's Ava, Jared's AI assistant, on a recorded line. I'm calling you back to set up a time with Jared.`, booking });
  if (!r.ok) return jerr(r.error, r.status);
  await db.from("ava_actions").update({ payload: { ...pl, booking_call_id: r.call_id, offered: offered.map((s) => s.start) } }).eq("id", a.id);
  return Response.json({ ok: true, call_id: r.call_id, calling: r.calling, offered }, { headers: CORS });
}

/** After a booking call: did they agree to one of the offered times? Yes -> calendar event, action closed, Scout push. Returns null when this wasn't a booking call. */
async function bookingResult(callId: string, bk: Booking, bookedRaw: string | null, who: string): Promise<{ ok: boolean } | null> {
  if (!bk?.action_id) return null;
  const t = bookedRaw ? Date.parse(bookedRaw) : NaN;
  const hit = Number.isFinite(t) ? bk.offered.find((o) => Math.abs(Date.parse(o) - t) < 10 * 60_000) : undefined;
  const url = "/admin/ava";
  if (!hit) {
    await db.rpc("scout_notify", { p_title: `Ava (assistant): no time booked with ${bk.who}`,
      p_body: bookedRaw ? `They named a time that wasn't one of the three she offered (${bookedRaw.slice(0, 60)}). Nothing was added to your calendar.` : `They didn't settle on one of the offered times for ${bk.purpose}. The button is still on the message if you want to try again.`,
      p_severity: "info", p_push: true, p_url: url, p_dedupe: `ava-booking-none-${callId}` });
    return { ok: false };
  }
  const end = new Date(Date.parse(hit) + durationFor(bk.purpose, bk.duration_min) * 60_000).toISOString();
  await db.from("ava_calls").update({ booked_slot: hit }).in("id", [callId, bk.source_call_id]);   // on the booking call and on the message that asked for it
  let calendarNote = "";
  try {
    const cfg = await calSettings(), creds = await calCreds();
    const target = (cfg.found?.nextcloud ?? []).find((c) => c.id === cfg.book_to);
    if (!creds.nextcloud || !target) throw new Error("no calendar is marked Ava books here");
    await putEvent(creds.nextcloud, target.href, { uid: `ava-${callId}@bestly.tech`, start: hit, end, summary: `${bk.purpose} with ${bk.who}`,
      description: `Booked by Ava (assistant). ${bk.business ? `${bk.business}. ` : ""}Phone ${bk.phone}.` });
    calendarNote = " Added to your calendar.";
  } catch (e) { calendarNote = ` It is NOT on your calendar yet (${errText(e)}).`; }
  await db.from("ava_actions").update({ status: "done" }).eq("source", bk.source).eq("call_id", bk.source_call_id).eq("status", "open");
  await db.rpc("scout_notify", { p_title: `Ava (assistant): booked your ${bk.purpose.replace(/^(a|an|the)\s+/i, "")} for ${ptLabel(hit)}`,
    p_body: `With ${who}.${calendarNote}`, p_severity: calendarNote.includes("NOT") ? "warning" : "info", p_push: true, p_url: url, p_dedupe: `ava-booked-${callId}` });
  return { ok: true };
}

/** Watchdog (inside the 10-minute health run): each connected calendar is checked once an hour; a failure is retried on the next run and alerts at most hourly. */
async function calendarHealth(): Promise<string[]> {
  const notes: string[] = [];
  try {
    const [cfg, creds] = await Promise.all([calSettings(), calCreds()]);
    const nowIso = new Date().toISOString(), hour = nowIso.slice(0, 13);
    const checked = { ...(cfg.checked ?? {}) };
    let changed = false;
    for (const p of ["nextcloud", "icloud"] as Provider[]) {
      const c = creds[p]; if (!c) continue;
      const ck = checked[p];
      if (ck?.ok && Date.now() - Date.parse(ck.at) < 55 * 60_000) continue;
      try {
        const seen = await discover(p, c);
        if (!seen.length) {
          // signing in works but nothing is visible: Find times would have nothing to look at, so this counts as down
          checked[p] = { at: nowIso, ok: false, last_ok_at: ck?.last_ok_at ?? null, error: `signed in to ${PROVIDER_NAME[p]} but no calendars are visible` }; changed = true;
          notes.push(`${PROVIDER_NAME[p]} calendar lists nothing`);
          await db.rpc("scout_notify", { p_title: `Ava (assistant): I can sign in to ${PROVIDER_NAME[p]} but can't see your calendars`,
            p_body: `The login works, but ${PROVIDER_NAME[p]} lists no calendars, so Find times has nothing to check. She re-tries every 10 minutes. If it stays like this, open the Calendars card on /admin/ava and test the connection.`,
            p_severity: "warning", p_push: true, p_url: "https://bestly.tech/admin/ava", p_dedupe: `ava-cal-empty-${p}-${hour}` });
          continue;
        }
        checked[p] = { at: nowIso, ok: true, last_ok_at: nowIso }; changed = true;
        if (ck && !ck.ok) notes.push(`${PROVIDER_NAME[p]} calendar is back`);
      } catch (e) {
        checked[p] = { at: nowIso, ok: false, last_ok_at: ck?.last_ok_at ?? null, error: errText(e) }; changed = true;
        notes.push(`${PROVIDER_NAME[p]} calendar failed`);
        await db.rpc("scout_notify", { p_title: `Ava (assistant): can't read your ${PROVIDER_NAME[p]} calendar`,
          p_body: `${errText(e)}. Find times is switched off until it works again. She re-checks on her own every 10 minutes; if it keeps failing, enter a fresh ${p === "icloud" ? "Apple app-specific password" : "app password"} in the Calendars card on /admin/ava.`,
          p_severity: "warning", p_push: true, p_url: "https://bestly.tech/admin/ava", p_dedupe: `ava-cal-fail-${p}-${hour}` });
      }
    }
    if (changed) await saveCal({ checked });
  } catch { /* the line check still runs */ }
  return notes;
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
  const { data: existing } = await db.from("ava_calls").select("id, direction, booking").eq("conversation_id", d.conversation_id).maybeSingle();
  const direction = existing?.direction ?? (pc.direction === "outbound" ? "outbound" : "inbound");

  // forwarded from Jared's cell? The init hook says so in the dynamic variables it returned; the SIP-ish fields are a second chance.
  const dyn = (d.conversation_initiation_client_data?.dynamic_variables ?? {}) as Record<string, unknown>;
  const sipFields = flatten({ phone_call: pc, dyn: Object.fromEntries(Object.entries(dyn).filter(([k]) => /^(system__|sip_)/.test(k))) });
  const det: Fwd = direction === "inbound" && phone !== JARED_CELL ? detectForward(sipFields) : { forwarded: false, from: null, why: null };
  const forwarded = direction === "inbound" && (String(dyn.forwarded ?? "") === "yes" || det.forwarded);
  const forwardedFrom = forwarded ? (String(dyn.forwarded_from ?? "") || det.from || JARED_CELL) : null;
  const voiceTag: "jared" | null = forwarded && String(dyn.call_voice ?? "") === "jared" ? "jared" : null;
  if (direction === "inbound") {
    await logDebug({ kind: "post", keys: { data: Object.keys(d), metadata: Object.keys(d.metadata ?? {}), phone_call: Object.keys(pc), dynamic_variables: Object.keys(dyn) },
      fields: sipFields, fwd: { forwarded, from: forwardedFrom, why: det.why }, note: `conversation ${String(d.conversation_id ?? "").slice(0, 40)}` });
  }

  // deno-lint-ignore no-explicit-any
  const llm = (d.transcript ?? []).reduce((sum: number, turn: any) => sum + Object.values(turn?.llm_usage?.model_usage ?? {}).reduce((a: number, u: any) =>
    a + (u?.input?.price ?? 0) + (u?.output_total?.price ?? 0) + (u?.input_cache_read?.price ?? 0) + (u?.input_cache_write?.price ?? 0), 0), 0);

  // spam intel: a saved contact is never spam, and a spam call leaves no message or call-back to chase
  const isSpam = direction === "inbound" && !contact && val("is_spam") === "true";
  const spamCb = val("spam_callback_number");
  const spam = { is_spam: isSpam, robocall: isSpam && val("robocall") === "true", spam_company: isSpam ? val("spam_company")?.slice(0, 120) ?? null : null,
    spam_website: isSpam ? val("spam_website")?.slice(0, 160) ?? null : null, spam_callback_number: isSpam && spamCb ? (toE164(spamCb) ?? spamCb.slice(0, 40)) : null,
    spam_caller_name: isSpam ? val("spam_caller_name")?.slice(0, 80) ?? null : null, spam_offer: isSpam ? val("spam_offer")?.slice(0, 160) ?? null : null };

  // next-action data (the voice platform's own post-call analysis)
  const intentRaw = (val("intent") ?? "").toLowerCase().replace(/[\s-]+/g, "_").replace(/^callback_request$/, "callback");
  const intent = isSpam ? "spam" : INTENTS.has(intentRaw) ? intentRaw : null;
  const cpPhone = val("counterpart_phone");
  const next = { intent, counterpart_business: val("counterpart_business")?.slice(0, 120) ?? null,
    counterpart_phone: cpPhone ? (toE164(cpPhone) ?? cpPhone.slice(0, 40)) : null, appointment_purpose: val("appointment_purpose")?.slice(0, 200) ?? null,
    preferred_times: val("preferred_times")?.slice(0, 200) ?? null, next_actions: val("next_actions")?.slice(0, 400) ?? null,
    appt_duration_min: intent === "appointment" ? durationFor("", Number(val("appt_duration_min"))) : null, appt_constraints: intent === "appointment" ? val("appt_constraints")?.slice(0, 200) ?? null : null };
  const bookedRaw = val("booked_slot");

  const message = isSpam ? null : val("message_for_jared");
  const urgent = !isSpam && val("urgent") === "true";
  const callerName = val("caller_name") ?? contact?.name ?? null;
  const cbNum = isSpam ? null : val("callback_number");
  const row = {
    phone, contact_id: contact?.id ?? null, caller_name: callerName, status: "completed", summary: d.analysis?.transcript_summary ?? null,
    message: message ? (cbNum ? `${message} (call back: ${cbNum})` : message) : null, urgent, callback_wanted: !isSpam && val("callback_wanted") === "true",
    callback_number: cbNum ? toE164(cbNum) : null,
    duration_sec: d.metadata?.call_duration_secs ?? null, transcript: d.transcript ?? null, llm_cost: Math.round(llm * 10000) / 10000,
    ended_at: new Date().toISOString(), ...spam, ...next,
    ...(forwarded ? { forwarded: true, forwarded_from: forwardedFrom } : {}), ...(voiceTag ? { voice: voiceTag } : {}),
  };
  let callId: string | null = existing?.id ?? null;
  if (existing) await db.from("ava_calls").update(row).eq("id", existing.id);
  else {
    const ins = await db.from("ava_calls").insert({ ...row, direction, conversation_id: d.conversation_id }).select("id").single();
    callId = ins.data?.id ?? null;
  }

  // the permanent copy of a spam call's recording: after the response (the audio is usually ready within seconds); the watchdog retries
  if (isSpam && callId) {
    const keep = (async () => { await new Promise((r) => setTimeout(r, 20_000)); await saveEvidence(callId!); })().catch(() => {});
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime; if (rt?.waitUntil) rt.waitUntil(keep); else await keep;
  }

  // the transfer tool must never run on a forwarded call (his cell would forward right back)
  // deno-lint-ignore no-explicit-any
  if (forwarded && (d.transcript ?? []).some((x: any) => (x?.tool_calls ?? []).some((tc: any) => /transfer/i.test(String(tc?.tool_name ?? tc?.name ?? ""))))) {
    await db.rpc("scout_notify", { p_title: "Ava (assistant): she tried to transfer a forwarded call",
      p_body: "She used the connect tool on a call forwarded from your cell, which can loop. Check the call on /admin/ava.", p_severity: "warning", p_push: true,
      p_url: "https://bestly.tech/admin/ava", p_dedupe: `ava-fwd-transfer-${d.conversation_id}` });
  }

  const who = callerName ?? (phone ? phone.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") : "Someone");
  // a booking call (Jared tapped a free time): record what was agreed, put it on his calendar, close the action
  const booked = existing?.booking && callId ? await bookingResult(callId, existing.booking as Booking, bookedRaw, who) : null;
  if (booked) return Response.json({ ok: true, direction, forwarded, booked: booked.ok });
  if (isSpam) {
    // quiet: the bell, no push. The push comes at the 2nd call from the same company (a database trigger).
    await db.rpc("scout_notify", { p_title: `Ava (assistant): spam call from ${spam.spam_company ?? who}`,
      p_body: [spam.spam_offer, forwarded ? "Came through your cell." : null].filter(Boolean).join(" ") || (row.summary ?? ""), p_severity: "info", p_push: false,
      p_url: "/admin/ava", p_dedupe: `ava-spam-${d.conversation_id}` });
  } else if (message || direction === "inbound") {
    await db.rpc("scout_notify", { p_title: `Ava (assistant): ${urgent ? "Urgent: " : ""}Message from ${who}`,
      p_body: message ?? row.summary ?? (forwarded ? "Missed call on your cell, no message left." : "Called Ava, no message left."),
      p_severity: urgent ? "warning" : "info", p_push: true, p_url: "/admin/ava", p_dedupe: `ava-msg-${d.conversation_id}` });
  } else {
    await db.rpc("scout_notify", { p_title: `Ava (assistant): call with ${who} finished`, p_body: row.summary ?? "", p_severity: "info", p_push: true,
      p_url: "/admin/ava", p_dedupe: `ava-out-${d.conversation_id}` });
  }
  return Response.json({ ok: true, direction, forwarded, message: !!message, spam: isSpam });
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
  if (body.action === "live") return live(body.call_id ? String(body.call_id) : null, /^[\w-]{6,80}$/.test(String(body.conversation_id ?? "")) ? String(body.conversation_id) : null);
  if (body.action === "audio") return audio(String(body.call_id ?? ""));
  if (body.action === "voices") return voices(body);
  if (body.action === "voice_say") return voiceSay(body);
  if (body.action === "voice_test_call") return voiceTestCall(body);
  if (body.action === "voice_use") return voiceUse(body);
  if (body.action === "voice_clone") return voiceClone(body);
  if (body.action === "voice_preview") return voicePreview(body);
  if (body.action === "voice_delete") return voiceDelete();
  if (body.action === "voice_resume") return voiceResume();
  if (body.action === "spam_complaint") return spamComplaint(body);
  if (body.action === "spam_letter") return spamLetter(body);
  if (body.action === "evidence") return evidence(body);
  if (body.action === "cal_status") return calStatus();
  if (body.action === "cal_secret_put") return calSecretPut(body);
  if (body.action === "cal_save") return calSave(body);
  if (body.action === "cal_disconnect") return calDisconnect(body);
  if (body.action === "cal_test") return calTest(body);
  if (body.action === "free_slots") return freeSlotsAction(body);
  if (body.action === "today") return todayAction(body);
  if (body.action === "book_call") return bookCall(body);
  return Response.json({ ok: false, error: "unknown action" }, { status: 400, headers: CORS });
});
