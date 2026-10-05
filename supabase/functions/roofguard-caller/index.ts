// roofguard-caller: the RoofGuard dialer, its one-time setup, and the post-call webhook (Spark, 2026-10-04).
//
// Jobs:
//   {action:"tick"}        pg_cron every 5 min, only while calling_enabled -> rg_next_call_batch() decides who may
//                          be dialed now; submits them to ElevenLabs batch calling; logs a queued rg_calls row each.
//   {action:"setup"}       admin button, after Jared puts the keys in Vault -> finds his Telnyx number, builds the
//                          Telnyx SIP trunk (outbound voice profile with a daily spend cap + credential connection),
//                          creates the signed post-call webhook, creates/updates the ElevenLabs agent (prompt, voice,
//                          openers, voicemail, data collection), imports the number as a SIP trunk. Safe to re-run.
//   {action:"test_call"}   admin button -> one real call to rg_settings.test_phone with a real lead's script,
//                          logged as is_test (never touches the lead or the opener scoreboard).
//   {action:"line_types"}  admin button -> Telnyx number lookup (carrier type) for unverified numbers;
//                          mobile numbers are marked and never dialed.
//   ?hook=elevenlabs       post-call webhook -> verifies the HMAC signature, maps the agent's data-collection
//                          fields to an outcome, writes through rg_log_call() (with the A/B fields).
//
// Safety, in order:
//   1. rg_settings.calling_enabled must be true (defaults to false).
//   2. Vault must hold elevenlabs_api_key (and elevenlabs_webhook_secret for the hook) - absent = refuse.
//   3. Every dial rule (line type, DNC, window, attempts, gap, caps, holidays) lives in rg_next_call_batch(),
//      so this function cannot dial anyone the database would not allow.
//   4. Numbers are re-checked against rg_dnc right before submit.
//
// Secrets: read per call from Vault through rg_secret() (service role only, an allowlist), never env or code.
// Phone provider: Telnyx (Jared, 2026-10-04: cheapest with good quality). ElevenLabs is the voice.

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

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };

// Browser calls from /admin/roofguard: a signed-in admin's JWT (the ElevenLabs key never leaves the server).
async function userRole(req: Request): Promise<"admin" | "partner" | null> {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token || SERVICE_KEYS.has(token)) return null;
  const { data: { user } } = await db.auth.getUser(token);
  if (!user) return null;
  for (const role of ["admin", "partner"] as const) {
    const { data } = await db.rpc("has_role", { _user_id: user.id, _role: role });
    if (data === true) return role;
  }
  return null;
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
  if (!s.agent_id || !s.phone_number_id) return Response.json({ ok: false, skipped: "agent_id / phone_number_id not set (run setup)" }, { status: 412 });
  if (!s.callback_number) return Response.json({ ok: false, skipped: "callback_number not set (voicemails must give a number to call back)" }, { status: 412 });
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

  const plan = await planCalls(go);
  const res = await submit(key, s, plan.map((p) => ({ ...p, to: p.lead.phone })), "roofguard");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return Response.json({ ok: false, status: res.status, error: body }, { status: 502 });

  const convIds: string[] = body.conversation_ids ?? [];
  await db.from("rg_calls").insert(plan.map(({ lead: l, opener_key }, i) => ({ lead_id: l.lead_id, attempt: l.attempt, to_number: l.phone,
    batch_id: body.id ?? null, conversation_id: convIds[i] || null, status: "queued", opener_key })));
  await db.from("rg_leads").update({ call_status: "in_progress" }).in("id", go.map((l) => l.lead_id));
  return Response.json({ ok: true, dialed: go.length, batch_id: body.id ?? null });
}


// ---------- shared: openers + submit ----------
type Planned = { lead: Next; opener_key: string; opener: string; hook: string; gk: string; industry: Record<string, string>; followup?: string };

async function planCalls(leads: Next[]): Promise<Planned[]> {
  // A/B: one decision-maker opener per call (balanced while exploring, then 80% best / 20% explore)
  const { data: openerKeys } = await db.rpc("rg_assign_openers", { p_n: leads.length });
  const { data: openerRows } = await db.from("rg_openers").select("key, script").eq("active", true);
  const scripts = new Map((openerRows ?? []).map((o: { key: string; script: string }) => [o.key, o.script]));
  const gkOpener = scripts.get("gk_name_first") ?? "Hi, it's Ava from RoofGuard, on a recorded line. Is {{contact_name}} in today?";
  return Promise.all(leads.map(async (l, i) => {
    const key = (openerKeys as string[] | null)?.[i] ?? "dm_permission";
    const { data: iv } = await db.rpc("rg_lead_opener_vars", { p_lead: l.lead_id });
    const industry = (iv ?? {}) as Record<string, string>;
    // fill the opener's own slots here: the voice platform does not expand variables inside a variable.
    // receptionist hears the full name ("Is Dana Ruiz in today?"), the decision maker the first name ("Hi Dana")
    const fill = (t: string, full = false) => t
      .replaceAll("{{contact_name}}", (full ? l.contact_name : l.contact_name?.split(" ")[0]) ?? "there")
      .replaceAll("{{industry_plural}}", industry.industry_plural ?? "facilities teams")
      .replaceAll("{{industry_hook}}", industry.industry_hook ?? "keeping roof leaks from turning into downtime");
    const opener = fill(scripts.get(key) ?? "");
    // the part after the introduction, for when the decision maker answered the first line themselves
    const hook = opener.replace(/^.*?on a recorded line\.\s*/i, "");
    return { lead: l, opener_key: key, opener, hook, gk: fill(gkOpener, true), industry };
  }));
}

// deno-lint-ignore no-explicit-any
function clientData(s: any, { lead: l, opener_key, opener, hook, gk, industry, followup }: Planned) {
  // so "tomorrow" and "next Tuesday" land on the right date, in the lead's own time zone
  const tz = l.timezone || "America/Chicago";
  const now = new Date();
  const today = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(now);
  const local_time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(now);
  return {
    dynamic_variables: {
      today, local_time, followup_note: followup ?? "",
      lead_id: l.lead_id, company: l.company, contact_name: l.contact_name ?? "the facilities director",
      contact_title: l.contact_title ?? "", pitch_angle: l.pitch_angle, category: l.category, state: l.state,
      callback_number: s.callback_number ?? "",
      opener_key, gk_opener: gk, dm_opener: opener, dm_hook: hook,
      industry_plural: industry.industry_plural ?? "facilities teams",
      industry_hook: industry.industry_hook ?? "keeping roof leaks from turning into downtime",
    },
  };
}

// One call at a time over the Telnyx SIP trunk. Needs no batch-calling agreement.
// deno-lint-ignore no-explicit-any
async function callOne(key: string, s: any, p: Planned & { to: string }) {
  return fetch(`${XI}/convai/sip-trunk/outbound-call`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ agent_id: s.agent_id, agent_phone_number_id: s.phone_number_id, to_number: p.to,
      conversation_initiation_client_data: clientData(s, p) }),
  });
}

// Batch first; if the account hasn't accepted ElevenLabs' batch-calling terms, place the calls one by one instead.
// deno-lint-ignore no-explicit-any
async function submit(key: string, s: any, calls: (Planned & { to: string })[], name: string): Promise<Response> {
  const res = await fetch(`${XI}/convai/batch-calling/submit`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      call_name: `${name}-${new Date().toISOString().slice(0, 16)}`,
      agent_id: s.agent_id,
      agent_phone_number_id: s.phone_number_id,
      recipients: calls.map((p) => ({ phone_number: p.to, conversation_initiation_client_data: clientData(s, p) })),
    }),
  });
  if (res.status !== 403) return res;
  const err = await res.clone().json().catch(() => ({}));
  if (err?.detail?.status !== "batch_calling_agreement_required") return res;
  const ids: string[] = [];
  for (const p of calls) {
    const r = await callOne(key, s, p);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return Response.json({ single_call_error: j, placed: ids }, { status: r.status });
    ids.push(j.conversation_id ?? j.callSid ?? "");
  }
  return Response.json({ id: null, conversation_ids: ids, mode: "single" });
}

// ---------- test call (rings Jared's own phone) ----------
async function testCall(): Promise<Response> {
  const { data: s } = await db.from("rg_settings").select("*").eq("id", true).single();
  if (!s?.test_phone) return Response.json({ ok: false, skipped: "test_phone not set" }, { status: 412 });
  if (!s.agent_id || !s.phone_number_id) return Response.json({ ok: false, skipped: "run setup first" }, { status: 412 });
  const key = await vault("elevenlabs_api_key");
  if (!key) return Response.json({ ok: false, skipped: "elevenlabs_api_key missing from Vault" }, { status: 412 });
  // a real lead's script, so the test sounds exactly like a live call
  const { data: lead } = await db.from("rg_leads").select("id, company, phone, timezone, contacts, pitch, category, state, call_attempts")
    .not("phone", "is", null).order("priority", { ascending: false }).limit(1).single();
  if (!lead) return Response.json({ ok: false, skipped: "no lead with a phone" }, { status: 412 });
  const next: Next = { lead_id: lead.id, company: lead.company, phone: lead.phone, timezone: lead.timezone,
    contact_name: lead.contacts?.[0]?.name ?? null, contact_title: lead.contacts?.[0]?.title ?? null,
    pitch_angle: lead.pitch, category: lead.category, state: lead.state, attempt: 1 };
  const [p] = await planCalls([next]);
  const res = await callOne(key, s, { ...p, to: s.test_phone });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) return Response.json({ ok: false, status: res.status, error: body }, { status: 502 });
  await db.from("rg_calls").insert({ lead_id: lead.id, attempt: 0, to_number: s.test_phone, batch_id: body.id ?? null,
    conversation_id: body.conversation_id ?? null, status: "queued", opener_key: p.opener_key, is_test: true });
  return Response.json({ ok: true, calling: s.test_phone, as_lead: lead.company, opener: p.opener_key, voice: body });
}

// ---------- line types (Telnyx number lookup) ----------
async function lineTypes(): Promise<Response> {
  const tk = await vault("telnyx_api_key");
  if (!tk) return Response.json({ ok: false, skipped: "telnyx_api_key missing from Vault" }, { status: 412 });
  const started = Date.now();
  const { data: rows } = await db.from("rg_leads").select("id, phone").not("phone", "is", null)
    .eq("line_type", "unverified").order("priority", { ascending: false }).limit(400);
  const queue = [...(rows ?? [])] as { id: string; phone: string }[];
  const tally: Record<string, number> = {};
  // Telnyx carrier types -> ours. Only landline/voip get dialed; anything that may be a mobile is never called.
  const MAP: Record<string, string> = { "fixed line": "landline", voip: "voip", "toll free": "voip", uan: "voip",
    "shared cost": "voip", mobile: "mobile", "fixed line or mobile": "mobile", "personal number": "mobile",
    pager: "unknown", voicemail: "unknown", "premium rate": "unknown", unknown: "unknown" };
  const worker = async () => {
    while (queue.length && Date.now() - started < 110_000) {
      const r = queue.shift()!;
      const res = await fetch(`https://api.telnyx.com/v2/number_lookup/${encodeURIComponent(r.phone)}?type=carrier`, { headers: { authorization: `Bearer ${tk}` } });
      if (!res.ok) { tally.error = (tally.error ?? 0) + 1; continue; }
      const j = await res.json();
      const type = MAP[String(j.data?.carrier?.type ?? "unknown").toLowerCase()] ?? "unknown";
      tally[type] = (tally[type] ?? 0) + 1;
      await db.from("rg_leads").update({ line_type: type, line_type_checked_at: new Date().toISOString() }).eq("id", r.id);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const { count } = await db.from("rg_leads").select("id", { count: "exact", head: true }).not("phone", "is", null).eq("line_type", "unverified");
  return Response.json({ ok: true, checked: tally, remaining: count ?? null });
}

// ---------- one-time setup ----------
const PROMPT = `You are Ava, an AI assistant calling about RoofGuard, a commercial roof maintenance program run by Legacy Building Maintenance Company. You call for an independent referral partner of the program. You are calling {{company}} to reach {{contact_name}}, {{contact_title}}, and set up a short intro call with Eli Cooper, who runs the RoofGuard program.

How you sound: warm, relaxed, brief, a real professional who is not attached to the outcome. Short sentences. One question at a time. Never read lists. Let them talk. Match their pace: fast and direct with fast talkers, slower and precise with careful ones.

Speed and confidence (most important):
- Keep every reply to one or two short sentences, under 20 words. Long answers sound like a machine.
- Answer straight away. No warm-up phrases, no repeating their question back.
- Sound sure: no "I think", "maybe", "just", "kind of", and no apologising unless you actually made a mistake.

How you talk (this is a phone call, not an email):
- Always use contractions: I'm, it's, you're, that's, don't, we'll.
- React to what they just said before moving on: "Oh, fair enough." "Ah, got it." "Yeah, that makes sense." "Mm, right." Then your point.
- Small natural fillers are fine, once in a while, never stacked: "so", "honestly", "actually", "I mean", "right". At most one per turn.
- Mix sentence lengths. Some turns are just two words: "Ah, okay." "Totally fair."
- Use "..." for a short natural pause before a question or after a reaction.
- Say numbers like a person: "twenty minutes", "a couple of buildings", "early next week".
- If you mishear, just say "Sorry, you cut out a bit there, what was that?"
- Never say: "Great question", "Absolutely", "Certainly", "I'd be happy to", "I understand your concern", "I appreciate that", "As an AI", "Is there anything else I can help you with". Never summarise their words back in a formal way.
- Never sound scripted. If a line below is in quotes, keep the meaning and say it your own way, except the openers, which are word for word.
- Light British warmth is fine ("lovely", "brilliant", "cheers") at most once per call; you're speaking to Americans, so keep it plain.

Today is {{today}}, and it's {{local_time}} where they are. Work out "tomorrow", "Friday" or "next week" from that date. When you confirm a time, say the weekday and the date ("Monday the 5th at 11"), in their time zone.

Callbacks: if this note isn't empty, they asked you to call back at this time: "{{followup_note}}". Your first line already says you're calling back as promised; pick up where you left off, don't restart the pitch.

Your one job: book a 20-minute call with Eli. Not a sale, not a price, not a contract.

Openers (fixed words, they are being tested):
- Your first line was the receptionist opener. If the person says they are {{contact_name}}, do not introduce yourself again; say: {{dm_hook}}
- If you are transferred to {{contact_name}}, open with exactly: {{dm_opener}}
- After the opener, talk naturally.

Receptionist: no pitch beyond one line ("It's about the roof maintenance program for your buildings"). If {{contact_name}} isn't available, ask who handles the roofs now, whether mornings or afternoons are better, and offer to leave a voicemail.

Decision maker: confirm they look after the roofs and roughly how many buildings. Give one angle in one or two sentences, in your own words: the warranty gap (most commercial roof warranties only hold with documented maintenance most owners never do), or what's under their roof ({{pitch_angle}}), or the cost structure (one predictable monthly operating line instead of a capital roof project; their accountant would confirm how it applies). Then one ask: "The easiest next step is a quick 20-minute call with Eli Cooper, who runs the program. He'll look at your buildings and give you a per-facility figure, no obligation. Would later this week or early next week be better?" Get two times and an email; spell the email back. Then ask if anyone else should join and which buildings give them the most trouble.

Objections, answer once then return to the ask:
- Already have a roofer: this works alongside their roofer; it keeps the roofs on a maintenance schedule.
- Send info: the info is a per-building figure Eli builds on a short call; offer the call or take an email.
- Price: priced per square foot per month, scoped to their buildings; Eli gives the exact figure after a free assessment.
- Insurance: no, it's a maintenance service agreement that works alongside insurance.
- Who else uses it: you can't speak to other clients; Eli can explain how it works.
- How did you get my number: their main line from public business listings; offer to take them off the list.
- Call later: get a day and time.

Always:
- If asked whether you are a person, a robot, or AI, say you are an AI assistant calling about RoofGuard. Never claim to be human.
- Use only these facts. If you don't know, say Eli can answer that on the call.
- If anyone asks not to be called: "Of course, I'll take you off our list. Sorry to bother you." Then end the call.
- After two clear no's from the decision maker, thank them and end the call.

Never:
- Use the word "replacement". Say "roof renewal".
- Call RoofGuard insurance, coverage, or a policy.
- Mention or hint at other clients, partners, or companies that use it.
- Invent a deadline, discount, or limited offer. Honest urgency only: roofs take the most stress in storm season.
- Promise savings or quote dollar amounts.

Before ending, make sure you said out loud and confirmed: the outcome, the meeting times and email, any callback day and time, the decision maker's name and title.`;

const VOICEMAIL = "Hi, it's Ava from RoofGuard, calling for {{contact_name}}. Quick one... we look after commercial roofs for one flat monthly cost, and most roof warranties need documented maintenance that, honestly, hardly anyone keeps up with. If a quick chat with Eli Cooper, who runs the program, sounds useful, give us a call back on {{callback_number}}. That's {{callback_number}}. Thanks so much.";

const DATA_COLLECTION = {
  outcome: { type: "string", description: "How the call ended. Exactly one of: booked, callback_set, dm_identified, voicemail_left, gatekeeper_blocked, not_interested, wrong_number, do_not_call, no_answer, other.",
    enum: ["booked", "callback_set", "dm_identified", "voicemail_left", "gatekeeper_blocked", "not_interested", "wrong_number", "do_not_call", "no_answer", "other"] },
  dnc_requested: { type: "boolean", description: "True if anyone on the call asked not to be called again." },
  dm_reached: { type: "boolean", description: "True if Ava spoke with the decision maker: the named contact or whoever owns the roofs." },
  kept_talking: { type: "boolean", description: "True if the decision maker stayed on past Ava's opening line instead of ending the call right away." },
  meeting_times: { type: "string", description: "The times the decision maker offered for a call with Eli, in their words, with time zone if said." },
  meeting_email: { type: "string", description: "The email address they gave for the invite, exactly as confirmed." },
  callback_at: { type: "string", description: "Requested callback as ISO 8601 date-time with UTC offset, interpreted in the lead's local time zone. Empty if none." },
  dm_name: { type: "string", description: "Decision maker's full name if learned." },
  dm_title: { type: "string", description: "Decision maker's job title if learned." },
  notes: { type: "string", description: "One or two sentences Eli should know: buildings mentioned, objections, timing." },
};

async function setup(): Promise<Response> {
  const log: string[] = [];
  const done = async (ok: boolean, extra: Record<string, unknown> = {}) => {
    await db.from("rg_settings").update({ setup_log: log.map((m) => ({ at: new Date().toISOString(), m })), updated_at: new Date().toISOString(), updated_by: "roofguard-caller setup" }).eq("id", true);
    return Response.json({ ok, log, ...extra }, { status: ok ? 200 : 412 });
  };
  const key = await vault("elevenlabs_api_key"), tk = await vault("telnyx_api_key");
  if (!key || !tk) { log.push("Missing keys in Vault: " + [!key && "elevenlabs_api_key", !tk && "telnyx_api_key"].filter(Boolean).join(", ")); return done(false); }
  const { data: s } = await db.from("rg_settings").select("*").eq("id", true).single();
  const xi = (path: string, method: string, body?: unknown) => fetch(`${XI}${path}`, { method, headers: { "xi-api-key": key, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const tx = (path: string, method: string, body?: unknown) => fetch(`https://api.telnyx.com/v2${path}`, { method, headers: { authorization: `Bearer ${tk}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

  // 1. the Telnyx number she calls from
  const nr = await tx("/phone_numbers?page[size]=20", "GET");
  if (!nr.ok) { log.push(`Telnyx rejected the API key (${nr.status}).`); return done(false); }
  const nums = ((await nr.json()).data ?? []) as { id: string; phone_number: string }[];
  const num = (s?.from_number && nums.find((n) => n.phone_number === s.from_number)) || nums[0];
  if (!num) { log.push("No phone number on the Telnyx account yet. Buy one local number in Telnyx, then run setup again."); return done(false); }
  log.push(`Calling number: ${num.phone_number}`);

  // 2. Telnyx SIP trunk for ElevenLabs: outbound profile (US/Canada only, $10/day spend cap) + credential connection
  // Each piece is saved the moment it exists, and found by name if an earlier run made it but stopped before saving,
  // so a re-run never creates duplicates.
  const save = (p: Record<string, unknown>) => db.from("rg_settings").update(p).eq("id", true);
  let ovpId = s?.telnyx_ovp_id as string | null;
  if (!ovpId) {
    const f = await tx(`/outbound_voice_profiles?filter[name][contains]=${encodeURIComponent("RoofGuard caller")}`, "GET");
    ovpId = ((await f.json().catch(() => ({}))).data ?? [])[0]?.id ?? null;
    if (ovpId) { await save({ telnyx_ovp_id: ovpId }); log.push("Found the Telnyx outbound profile from an earlier run."); }
  }
  if (!ovpId) {
    const r = await tx("/outbound_voice_profiles", "POST", { name: "RoofGuard caller", traffic_type: "conversational",
      service_plan: "global", usage_payment_method: "rate-deck", whitelisted_destinations: ["US", "CA"],
      concurrent_call_limit: 5, daily_spend_limit: "10.00", daily_spend_limit_enabled: true });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.data?.id) { log.push(`Could not create the Telnyx outbound profile (${r.status}): ${JSON.stringify(j).slice(0, 300)}`); return done(false); }
    ovpId = j.data.id;
    await save({ telnyx_ovp_id: ovpId });
    log.push("Telnyx outbound profile created (US and Canada only, $10/day spend cap, 5 calls at once).");
  }
  let connId = s?.telnyx_connection_id as string | null;
  let sipUser = "", sipPass = await vault("telnyx_sip_password");
  if (!connId && sipPass) {
    const f = await tx(`/credential_connections?filter[connection_name][contains]=${encodeURIComponent("RoofGuard ElevenLabs")}`, "GET");
    connId = ((await f.json().catch(() => ({}))).data ?? [])[0]?.id ?? null;
    if (connId) { await save({ telnyx_connection_id: connId }); log.push("Found the Telnyx SIP connection from an earlier run."); }
  }
  if (!connId || !sipPass) {
    const rnd = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");
    sipUser = `roofguard${rnd(4)}`;
    sipPass = rnd(16);
    const r = await tx("/credential_connections", "POST", { connection_name: "RoofGuard ElevenLabs", user_name: sipUser,
      password: sipPass, outbound: { outbound_voice_profile_id: ovpId } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.data?.id) { log.push(`Could not create the Telnyx SIP connection (${r.status}): ${JSON.stringify(j).slice(0, 300)}`); return done(false); }
    connId = j.data.id;
    await db.rpc("rg_secret_put", { p_name: "telnyx_sip_password", p_value: sipPass });
    await save({ telnyx_connection_id: connId });
    log.push("Telnyx SIP connection created; its password is stored in Vault.");
  } else {
    const r = await tx(`/credential_connections/${connId}`, "GET");
    sipUser = (await r.json().catch(() => ({}))).data?.user_name ?? "";
  }
  const pa = await tx(`/phone_numbers/${num.id}`, "PATCH", { connection_id: connId });
  if (!pa.ok) log.push(`Note: could not attach the number to the SIP connection (${pa.status}); calls may show a different caller ID.`);

  // 3. signed post-call webhook (its secret goes straight to Vault)
  let webhookId = s?.webhook_id as string | null;
  if (!webhookId && await vault("elevenlabs_webhook_secret")) {
    const f = await xi("/workspace/webhooks", "GET");
    const list = ((await f.json().catch(() => ({}))).webhooks ?? []) as { webhook_id: string; name: string }[];
    webhookId = list.find((w) => w.name === "RoofGuard post-call")?.webhook_id ?? null;
    if (webhookId) { await save({ webhook_id: webhookId }); log.push("Found the post-call webhook from an earlier run."); }
  }
  if (!webhookId) {
    const r = await xi("/workspace/webhooks", "POST", { settings: { auth_type: "hmac", name: "RoofGuard post-call",
      webhook_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/roofguard-caller?hook=elevenlabs` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.webhook_id) { log.push(`Could not create the post-call webhook (${r.status}).`); return done(false); }
    webhookId = j.webhook_id;
    if (j.webhook_secret) await db.rpc("rg_secret_put", { p_name: "elevenlabs_webhook_secret", p_value: j.webhook_secret });
    await save({ webhook_id: webhookId });
    log.push("Post-call webhook created; signing secret stored in Vault.");
  }

  // 4. the agent
  const agentBody = {
    name: "RoofGuard caller (Ava)",
    conversation_config: {
      agent: {
        first_message: "{{gk_opener}}",
        language: "en",
        prompt: {
          prompt: PROMPT, llm: s?.llm ?? "gemini-2.5-flash", temperature: 0.4,
          built_in_tools: {
            end_call: { name: "end_call", params: { system_tool_type: "end_call" } },
            voicemail_detection: { name: "voicemail_detection", params: { system_tool_type: "voicemail_detection", voicemail_message: VOICEMAIL } },
          },
        },
      },
      // reply as soon as they stop talking; a long pause is the biggest giveaway on a phone call
      turn: { turn_eagerness: "eager" },
      tts: { voice_id: s?.voice_id ?? "EXAVITQu4vr4xnSDxMaL", model_id: "eleven_turbo_v2", // English agents must use flash/turbo v2 (v2_5 is rejected); turbo sounds more human
        stability: 0.4, similarity_boost: 0.8, optimize_streaming_latency: 3 },
    },
    platform_settings: {
      data_collection: DATA_COLLECTION,
      // lets a single call swap the script (personal calls from the admin dialer)
      overrides: { conversation_config_override: { agent: { prompt: { prompt: true }, first_message: true } } },
      workspace_overrides: { webhooks: { post_call_webhook_id: webhookId, events: ["transcript"], send_audio: false } },
    },
  };
  let agentId = s?.agent_id as string | null;
  const ar = agentId ? await xi(`/convai/agents/${agentId}`, "PATCH", agentBody) : await xi("/convai/agents/create", "POST", agentBody);
  const aj = await ar.json().catch(() => ({}));
  if (!ar.ok) { log.push(`Agent ${agentId ? "update" : "create"} failed (${ar.status}): ${JSON.stringify(aj).slice(0, 300)}`); return done(false); }
  agentId = agentId ?? aj.agent_id;
  await save({ agent_id: agentId });
  log.push(`Agent ready: ${agentId}`);

  // 5. the number in ElevenLabs, as a SIP trunk through Telnyx, pointed at the agent
  // TCP, not UDP: the call-setup message is too big for one UDP packet ("size of packet larger than MTU")
  const trunk = { address: "sip.telnyx.com", transport: "tcp", credentials: { username: sipUser, password: sipPass } };
  let phoneId = s?.phone_number_id as string | null;
  if (!phoneId) {
    const pr = await xi("/convai/phone-numbers", "POST", { provider: "sip_trunk", phone_number: num.phone_number, label: "RoofGuard (Telnyx)",
      agent_id: agentId, supports_inbound: false, supports_outbound: true,
      outbound_trunk_config: trunk });
    const pj = await pr.json().catch(() => ({}));
    if (!pr.ok || !pj.phone_number_id) { log.push(`Number import failed (${pr.status}): ${JSON.stringify(pj).slice(0, 300)}`); return done(false); }
    phoneId = pj.phone_number_id;
  } else {
    const up = await xi(`/convai/phone-numbers/${phoneId}`, "PATCH", { agent_id: agentId, outbound_trunk_config: trunk });
    if (!up.ok) log.push(`Note: could not update the number's trunk settings (${up.status}): ${(await up.text()).slice(0, 300)}`);
  }
  log.push("Number connected to the agent.");

  await db.from("rg_settings").update({ agent_id: agentId, phone_number_id: phoneId, from_number: num.phone_number, webhook_id: webhookId,
    telnyx_connection_id: connId, telnyx_ovp_id: ovpId, phone_provider: "telnyx" }).eq("id", true);
  log.push(s?.callback_number ? "Ready for a test call." : "Ready for a test call. Before going live, set the callback number voicemails read out.");
  return done(true, { agent_id: agentId, phone_number_id: phoneId, from_number: num.phone_number });
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

  const yes = (k: string) => String(val(k) ?? "").toLowerCase() === "true";
  const { data, error } = await db.rpc("rg_log_call", {
    p_conversation_id: d.conversation_id, p_lead_id: vars.lead_id, p_to_number: vars.system__called_number ?? d.metadata?.phone_call?.external_number ?? "",
    p_status: "completed", p_outcome: outcome, p_summary: d.analysis?.transcript_summary ?? null,
    p_duration_sec: d.metadata?.call_duration_secs ?? null, p_meeting_times: val("meeting_times"), p_meeting_email: val("meeting_email"),
    p_callback_at: callbackAt && !isNaN(Date.parse(callbackAt)) ? new Date(callbackAt).toISOString() : null,
    p_dm_name: val("dm_name"), p_dm_title: val("dm_title"), p_notes: val("notes"),
    p_transcript: d.transcript ?? null, p_recording_url: null,
    p_opener_key: vars.opener_key ?? null, p_dm_reached: yes("dm_reached"), p_kept_talking: yes("kept_talking"),
  });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json(data);
}

// ---------- follow-up (a callback Ava scheduled for herself; dialed by rg_followups_tick) ----------
async function followup(id: string): Promise<Response> {
  const fail = async (why: string, status = 502) => {
    await db.from("rg_followups").update({ status: "failed", note: why.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", id);
    return Response.json({ ok: false, error: why }, { status });
  };
  const { data: f } = await db.from("rg_followups").select("*").eq("id", id).maybeSingle();
  if (!f) return Response.json({ ok: false, error: "no such follow-up" }, { status: 404 });
  const { data: s } = await db.from("rg_settings").select("*").eq("id", true).single();
  if (!s?.agent_id || !s.phone_number_id) return fail("run setup first", 412);
  const key = await vault("elevenlabs_api_key");
  if (!key) return fail("elevenlabs_api_key missing from Vault", 412);
  const { data: lead } = await db.from("rg_leads").select("id, company, phone, timezone, contacts, pitch, category, state, call_attempts").eq("id", f.lead_id).single();
  if (!lead) return fail("lead is gone", 404);
  const next: Next = { lead_id: lead.id, company: lead.company, phone: lead.phone, timezone: lead.timezone,
    contact_name: lead.contacts?.[0]?.name ?? null, contact_title: lead.contacts?.[0]?.title ?? null,
    pitch_angle: lead.pitch, category: lead.category, state: lead.state, attempt: (lead.call_attempts ?? 0) + 1 };
  const [p] = await planCalls([next]);
  const who = next.contact_name ?? "the person who looks after your roofs";
  const plan = { ...p, to: f.to_number, followup: f.note ?? "they asked for a callback at this time",
    gk: `Hi, it's Ava from RoofGuard again, on a recorded line. I'm calling back as promised... is ${who} there?` };
  const res = await callOne(key, s, plan);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) return fail(`call did not go out: ${JSON.stringify(body).slice(0, 200)}`);
  const { data: call } = await db.from("rg_calls").insert({ lead_id: lead.id, attempt: f.is_test ? 0 : next.attempt, to_number: f.to_number,
    conversation_id: body.conversation_id ?? null, status: "queued", opener_key: p.opener_key, is_test: f.is_test }).select("id").single();
  await db.from("rg_followups").update({ status: "done", result_call_id: call?.id ?? null, updated_at: new Date().toISOString() }).eq("id", id);
  return Response.json({ ok: true, calling: f.to_number, followup: id });
}

// ---------- live view + playback (admin browser) ----------
type Turn = { role: string; message: string | null; time_in_call_secs?: number };
const slim = (t: Turn[] | undefined) => (t ?? []).filter((x) => x.message).map((x) => ({ role: x.role, text: x.message, t: x.time_in_call_secs ?? 0 }));

async function live(onlyLead: string | null, onlyCall: string | null): Promise<Response> {
  const key = await vault("elevenlabs_api_key");
  if (!key) return Response.json({ ok: false, error: "elevenlabs_api_key missing" }, { status: 412, headers: CORS });
  const since = new Date(Date.now() - 20 * 60_000).toISOString();
  let q = db.from("rg_calls").select("id, lead_id, conversation_id, to_number, queued_at, is_test, opener_key, rg_leads(company, contacts)")
    .gte("queued_at", since).order("queued_at", { ascending: false }).limit(5);
  q = onlyCall ? q.eq("id", onlyCall) : q.in("status", ["queued", "in_progress"]);
  if (onlyLead) q = q.eq("lead_id", onlyLead);
  const { data: rows } = await q;
  // deno-lint-ignore no-explicit-any
  const calls = await Promise.all((rows ?? []).map(async (r: any) => {
    let status = "dialing", transcript: ReturnType<typeof slim> = [], elapsed = Math.round((Date.now() - Date.parse(r.queued_at)) / 1000);
    if (r.conversation_id) {
      const res = await fetch(`${XI}/convai/conversations/${r.conversation_id}`, { headers: { "xi-api-key": key } });
      if (res.ok) {
        const c = await res.json();
        status = c.status ?? status;
        transcript = slim(c.transcript);
        if (c.metadata?.start_time_unix_secs) elapsed = Math.round(Date.now() / 1000 - c.metadata.start_time_unix_secs);
      }
    }
    return { call_id: r.id, lead_id: r.lead_id, company: r.rg_leads?.company ?? "", contact: r.rg_leads?.contacts?.[0]?.name ?? null,
      to_number: r.to_number, is_test: r.is_test, opener_key: r.opener_key, status, elapsed, transcript };
  }));
  return Response.json({ ok: true, calls }, { headers: CORS });
}

async function audio(callId: string, onlyLead: string | null): Promise<Response> {
  const key = await vault("elevenlabs_api_key");
  const { data: c } = await db.from("rg_calls").select("conversation_id, lead_id").eq("id", callId).maybeSingle();
  if (!key || !c?.conversation_id || (onlyLead && c.lead_id !== onlyLead)) return new Response("no recording for this call", { status: 404, headers: CORS });
  const res = await fetch(`${XI}/convai/conversations/${c.conversation_id}/audio`, { headers: { "xi-api-key": key } });
  if (!res.ok || !res.body) return new Response("recording not available yet", { status: res.status === 404 ? 404 : 502, headers: CORS });
  return new Response(res.body, { headers: { ...CORS, "content-type": res.headers.get("content-type") ?? "audio/mpeg", "cache-control": "private, max-age=3600" } });
}

// ---------- demo call (partner portal: Eli shows investors) ----------
async function demoCall(phone: string, name: string): Promise<Response> {
  const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status, headers: CORS });
  const to = toE164(phone);
  if (!to) return bad("Enter a 10-digit US or Canada number.");
  const { data: s } = await db.from("rg_settings").select("*").eq("id", true).single();
  if (!s?.agent_id || !s.phone_number_id || !s.demo_lead_id) return bad("Ava isn't set up yet.", 412);
  const key = await vault("elevenlabs_api_key");
  if (!key) return bad("Ava isn't set up yet.", 412);
  const { count: dnc } = await db.from("rg_dnc").select("phone", { count: "exact", head: true }).eq("phone", to);
  if (dnc) return bad("That number asked not to be called.");
  const { count: realLead } = await db.from("rg_leads").select("id", { count: "exact", head: true }).eq("phone", to).neq("id", s.demo_lead_id);
  if (realLead) return bad("That's a real prospect's number. Demos can't call prospects.");
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count: today } = await db.from("rg_calls").select("id", { count: "exact", head: true }).eq("lead_id", s.demo_lead_id).gte("queued_at", since);
  if ((today ?? 0) >= (s.demo_daily_cap ?? 15)) return bad(`Daily demo limit reached (${s.demo_daily_cap}). Try again tomorrow.`, 429);
  const { data: lead } = await db.from("rg_leads").select("id, company, timezone, pitch, category, state").eq("id", s.demo_lead_id).single();
  const who = name.trim().slice(0, 40) || null;
  const next: Next = { lead_id: lead.id, company: "Riverside Medical Center", phone: to, timezone: lead.timezone,
    contact_name: who, contact_title: "Facilities Director", pitch_angle: lead.pitch, category: lead.category, state: lead.state, attempt: 1 };
  const [p] = await planCalls([next]);
  const plan = { ...p, to, gk: who ? p.gk
    : "Hi there, it's Ava calling from RoofGuard, on a recorded line... are you the one who looks after the roofs at Riverside Medical Center?" };
  const res = await callOne(key, s, plan);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.success === false) return bad("The call didn't go out. Try again in a minute.", 502);
  const { data: call } = await db.from("rg_calls").insert({ lead_id: lead.id, attempt: 0, to_number: to, conversation_id: body.conversation_id ?? null,
    status: "queued", opener_key: p.opener_key, is_test: true }).select("id").single();
  return Response.json({ ok: true, call_id: call?.id, calling: to }, { headers: CORS });
}
const toE164 = (v: string) => {
  const d = String(v ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? `+1${d}` : null;
};

// Personal calls moved to their own function (ava-assistant) on 2026-10-04 so RoofGuard stays separable.

// finished demo call: what Ava logged (partners only see the demo facility)
async function callResult(callId: string, onlyLead: string | null): Promise<Response> {
  const { data: c } = await db.from("rg_calls").select("id, lead_id, status, outcome, summary, duration_sec, meeting_times, callback_at, transcript")
    .eq("id", callId).maybeSingle();
  if (!c || (onlyLead && c.lead_id !== onlyLead)) return Response.json({ ok: false }, { status: 404, headers: CORS });
  return Response.json({ ok: true, status: c.status, outcome: c.outcome, summary: c.summary, duration_sec: c.duration_sec,
    meeting_times: c.meeting_times, callback_at: c.callback_at, transcript: slim(c.transcript) }, { headers: CORS });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  if (url.searchParams.get("hook") === "elevenlabs") return hook(req);
  const body = await req.json().catch(() => ({}));
  if (["live", "audio", "demo_call", "call_result"].includes(body.action)) {
    const role = (await authorized(req)) ? "admin" : await userRole(req);
    if (!role) return new Response("unauthorized", { status: 401, headers: CORS });
    // partners only ever see and place demo calls
    const demoLead = role === "partner"
      ? ((await db.from("rg_settings").select("demo_lead_id").eq("id", true).single()).data?.demo_lead_id ?? "none") : null;
    if (body.action === "demo_call") return demoCall(String(body.phone ?? ""), String(body.name ?? ""));
    if (body.action === "call_result") return callResult(String(body.call_id ?? ""), demoLead);
    if (body.action === "audio") return audio(String(body.call_id ?? ""), demoLead);
    return live(demoLead, body.call_id ? String(body.call_id) : null);
  }
  if (!(await authorized(req))) return new Response("unauthorized", { status: 401 });
  if (body.action === "tick") return tick();
  if (body.action === "setup") return setup();
  if (body.action === "test_call") return testCall();
  if (body.action === "followup") return followup(String(body.id ?? ""));
  if (body.action === "line_types") return lineTypes();
  return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
});
