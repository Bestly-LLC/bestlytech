// roofguard-caller: the RoofGuard dialer, its one-time setup, and the post-call webhook (Spark, 2026-10-04).
//
// Jobs:
//   {action:"tick"}        pg_cron every 5 min, only while calling_enabled -> rg_next_call_batch() decides who may
//                          be dialed now; submits them to ElevenLabs batch calling; logs a queued rg_calls row each.
//   {action:"setup"}       admin button, after Jared puts the keys in Vault -> finds his Twilio number, creates the
//                          signed post-call webhook, creates/updates the ElevenLabs agent (prompt, voice, openers,
//                          voicemail, data collection), imports the number, saves the ids. Safe to re-run.
//   {action:"test_call"}   admin button -> one real call to rg_settings.test_phone with a real lead's script,
//                          logged as is_test (never touches the lead or the opener scoreboard).
//   {action:"line_types"}  admin button -> Twilio Lookup line type for unverified numbers (about $0.008 each);
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

  await db.from("rg_calls").insert(plan.map(({ lead: l, opener_key }) => ({ lead_id: l.lead_id, attempt: l.attempt, to_number: l.phone, batch_id: body.id ?? null, status: "queued", opener_key })));
  await db.from("rg_leads").update({ call_status: "in_progress" }).in("id", go.map((l) => l.lead_id));
  return Response.json({ ok: true, dialed: go.length, batch_id: body.id ?? null });
}


// ---------- shared: openers + submit ----------
type Planned = { lead: Next; opener_key: string; opener: string; hook: string; gk: string; industry: Record<string, string> };

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
async function submit(key: string, s: any, calls: (Planned & { to: string })[], name: string) {
  return fetch(`${XI}/convai/batch-calling/submit`, {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      call_name: `${name}-${new Date().toISOString().slice(0, 16)}`,
      agent_id: s.agent_id,
      agent_phone_number_id: s.phone_number_id,
      recipients: calls.map(({ lead: l, opener_key, opener, hook, gk, industry, to }) => ({
        phone_number: to,
        conversation_initiation_client_data: {
          dynamic_variables: {
            lead_id: l.lead_id, company: l.company, contact_name: l.contact_name ?? "the facilities director",
            contact_title: l.contact_title ?? "", pitch_angle: l.pitch_angle, category: l.category, state: l.state,
            callback_number: s.callback_number ?? "",
            opener_key, gk_opener: gk, dm_opener: opener, dm_hook: hook,
            industry_plural: industry.industry_plural ?? "facilities teams",
            industry_hook: industry.industry_hook ?? "keeping roof leaks from turning into downtime",
          },
        },
      })),
    }),
  });
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
  const res = await submit(key, s, [{ ...p, to: s.test_phone }], "roofguard-test");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return Response.json({ ok: false, status: res.status, error: body }, { status: 502 });
  await db.from("rg_calls").insert({ lead_id: lead.id, attempt: 0, to_number: s.test_phone, batch_id: body.id ?? null,
    status: "queued", opener_key: p.opener_key, is_test: true });
  return Response.json({ ok: true, calling: s.test_phone, as_lead: lead.company, opener: p.opener_key });
}

// ---------- line types (Twilio Lookup) ----------
async function lineTypes(): Promise<Response> {
  const sid = await vault("twilio_account_sid"), token = await vault("twilio_auth_token");
  if (!sid || !token) return Response.json({ ok: false, skipped: "Twilio keys missing from Vault" }, { status: 412 });
  const auth = "Basic " + btoa(`${sid}:${token}`);
  const started = Date.now();
  const { data: rows } = await db.from("rg_leads").select("id, phone").not("phone", "is", null)
    .eq("line_type", "unverified").order("priority", { ascending: false }).limit(400);
  const queue = [...(rows ?? [])] as { id: string; phone: string }[];
  const tally: Record<string, number> = {};
  const MAP: Record<string, string> = { landline: "landline", fixedVoip: "voip", nonFixedVoip: "voip", tollFree: "voip",
    mobile: "mobile", personal: "mobile", pager: "unknown", voicemail: "unknown", uan: "voip", sharedCost: "voip" };
  const worker = async () => {
    while (queue.length && Date.now() - started < 110_000) {
      const r = queue.shift()!;
      const res = await fetch(`https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(r.phone)}?Fields=line_type_intelligence`, { headers: { authorization: auth } });
      if (!res.ok) { tally.error = (tally.error ?? 0) + 1; continue; }
      const j = await res.json();
      const type = MAP[j.line_type_intelligence?.type ?? ""] ?? "unknown";
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

const VOICEMAIL = "Hi {{contact_name}}, this is Ava with RoofGuard, a maintenance program that looks after every roof at {{company}} for one flat monthly cost. Most commercial roof warranties need documented maintenance most owners never get to. If a quick call with Eli Cooper, who runs the program, would help, call us back at {{callback_number}}. Again, {{callback_number}}. Thanks.";

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
  const key = await vault("elevenlabs_api_key"), sid = await vault("twilio_account_sid"), token = await vault("twilio_auth_token");
  if (!key || !sid || !token) { log.push("Missing keys in Vault: " + [!key && "elevenlabs_api_key", !sid && "twilio_account_sid", !token && "twilio_auth_token"].filter(Boolean).join(", ")); return done(false); }
  const { data: s } = await db.from("rg_settings").select("*").eq("id", true).single();
  const xi = (path: string, method: string, body?: unknown) => fetch(`${XI}${path}`, { method, headers: { "xi-api-key": key, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

  // 1. the Twilio number she calls from
  const tw = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/IncomingPhoneNumbers.json?PageSize=20`, { headers: { authorization: "Basic " + btoa(`${sid}:${token}`) } });
  if (!tw.ok) { log.push(`Twilio rejected the keys (${tw.status}).`); return done(false); }
  const nums = ((await tw.json()).incoming_phone_numbers ?? []) as { phone_number: string }[];
  const from = (s?.from_number && nums.find((n) => n.phone_number === s.from_number)?.phone_number) ?? nums[0]?.phone_number;
  if (!from) { log.push("No phone number on the Twilio account yet. Buy one local number in Twilio, then run setup again."); return done(false); }
  log.push(`Calling number: ${from}`);

  // 2. signed post-call webhook (its secret goes straight to Vault)
  let webhookId = s?.webhook_id as string | null;
  if (!webhookId) {
    const r = await xi("/workspace/webhooks", "POST", { settings: { auth_type: "hmac", name: "RoofGuard post-call",
      webhook_url: `${Deno.env.get("SUPABASE_URL")}/functions/v1/roofguard-caller?hook=elevenlabs` } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.webhook_id) { log.push(`Could not create the post-call webhook (${r.status}).`); return done(false); }
    webhookId = j.webhook_id;
    if (j.webhook_secret) await db.rpc("rg_secret_put", { p_name: "elevenlabs_webhook_secret", p_value: j.webhook_secret });
    log.push("Post-call webhook created; signing secret stored in Vault.");
  }

  // 3. the agent
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
      tts: { voice_id: s?.voice_id ?? "EXAVITQu4vr4xnSDxMaL", model_id: "eleven_flash_v2_5" },
    },
    platform_settings: {
      data_collection: DATA_COLLECTION,
      workspace_overrides: { webhooks: { post_call_webhook_id: webhookId, events: ["transcript"], send_audio: false } },
    },
  };
  let agentId = s?.agent_id as string | null;
  const ar = agentId ? await xi(`/convai/agents/${agentId}`, "PATCH", agentBody) : await xi("/convai/agents/create", "POST", agentBody);
  const aj = await ar.json().catch(() => ({}));
  if (!ar.ok) { log.push(`Agent ${agentId ? "update" : "create"} failed (${ar.status}): ${JSON.stringify(aj).slice(0, 300)}`); return done(false); }
  agentId = agentId ?? aj.agent_id;
  log.push(`Agent ready: ${agentId}`);

  // 4. import the number into ElevenLabs and point it at the agent
  let phoneId = s?.phone_number_id as string | null;
  if (!phoneId) {
    const pr = await xi("/convai/phone-numbers", "POST", { provider: "twilio", phone_number: from, label: "RoofGuard",
      sid, token, agent_id: agentId, supports_inbound: false, supports_outbound: true });
    const pj = await pr.json().catch(() => ({}));
    if (!pr.ok || !pj.phone_number_id) { log.push(`Number import failed (${pr.status}): ${JSON.stringify(pj).slice(0, 300)}`); return done(false); }
    phoneId = pj.phone_number_id;
  } else {
    await xi(`/convai/phone-numbers/${phoneId}`, "PATCH", { agent_id: agentId });
  }
  log.push("Number connected to the agent.");

  await db.from("rg_settings").update({ agent_id: agentId, phone_number_id: phoneId, from_number: from, webhook_id: webhookId }).eq("id", true);
  log.push(s?.callback_number ? "Ready for a test call." : "Ready for a test call. Before going live, set the callback number voicemails read out.");
  return done(true, { agent_id: agentId, phone_number_id: phoneId, from_number: from });
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

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("hook") === "elevenlabs") return hook(req);
  if (!(await authorized(req))) return new Response("unauthorized", { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body.action === "tick") return tick();
  if (body.action === "setup") return setup();
  if (body.action === "test_call") return testCall();
  if (body.action === "line_types") return lineTypes();
  return Response.json({ ok: false, error: "unknown action" }, { status: 400 });
});
