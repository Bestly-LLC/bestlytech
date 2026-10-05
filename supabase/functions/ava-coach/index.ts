// ava-coach — the Coach inside both Avas' Scorecards (docs/ava-learning-opusplan.md, migration 20261005160000_ava_coach.sql).
//
//   {op:"review"}   every 10 min (cron ava-coach): reviews finished calls that have no review yet, both Avas, on FREE AI
//                   only (private providers, paid:"never" — Jared's token rule). A few calls per run, newest first.
//   {op:"weekly"}   Mondays 10:05 AM Pacific (cron ava-coach-weekly): reads the week's reviews and proposes 1-3 small
//                   playbook changes per Ava (coach_propose guards them against her hard rules).
//   {op:"one", source, call_id}  admin/service: review one call now (testing).
//
// The coach never changes her hard rules, AI disclosure, do-not-call handling, hours or caps: it can only add short
// lines to the "learned playbook", which reaches her through the coach_notes dynamic variable.
// verify_jwt = false: callers prove themselves with the service key (cron) or an admin JWT.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { llm, LlmUnavailable } from "../_shared/free-llm.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
const db = createClient(URL, SB_SECRET, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...CORS } });

// the cron (invoke_edge_function sends the service key) or a signed-in admin
async function allowed(req: Request): Promise<boolean> {
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if ([bearer, (req.headers.get("apikey") ?? "").trim()].some((t) => t && SERVICE_KEYS.has(t))) return true;
  if (!bearer) return false;
  const { data: { user } } = await db.auth.getUser(bearer);
  if (!user) return false;
  const { data } = await db.rpc("has_role", { _user_id: user.id, _role: "admin" });
  return data === true;
}

// ---------- rubrics ----------
const RG_SYSTEM = `You are the sales coach for Ava, an AI that cold-calls facilities and building managers for RoofGuard (a commercial roof maintenance program). Her only goal on a call: book a short intro call with Eli Cooper.
Score ONE call transcript with the "5 Steps to a Sale" door-to-door playbook. Be strict and specific. Score only what happened.

Steps, 1-5 each (null if the call never got that far, e.g. voicemail or a receptionist who blocked her):
- opening: did the opener land, did they keep talking past the first line, warm, quick, unscripted?
- qualify: did she confirm they look after the roofs, roughly how many buildings, and get the decision maker (the person who maintains the roofs)?
- present: one angle in one or two sentences (warranty gap, what's under the roof, cost structure). Simple.
- close: did she ask for the meeting with confidence, as a choice between two times, and get two times plus an email?
- rehash: did she read back the time and email, ask who else should join?

If nobody answered or it went to voicemail: every step is null and the impulse factors are null; judge only the voicemail she left (short, clear, honest, callback number said twice) for overall, confidence and work_on. If a receptionist blocked her: score opening (her opener to the receptionist) and leave the rest null.
Impulse factors, 1-5: indifference (relaxed, not needy, stops after two clear no's), honest_urgency (only honest urgency like storm season, never made up), bolt_match (matched their style: fast and bottom-line or careful and detailed), sounds_human (short replies, no stock phrases like "Absolutely" or "Great question", no hedging).
objections: tags for objections the other person raised, from: already_have_roofer, send_info, price, busy, not_interested, wrong_person, call_back_later, other.
rule_flags: ONLY real slips of her hard rules, from: said_replacement (she said "replacement" instead of renewal), called_it_insurance, fake_social_proof (named or implied partners/clients), invented_deadline, denied_being_ai (claimed to be human when sincerely asked), income_projection. Empty if none. Never flag something she didn't say.
went_well: one short sentence. work_on: ONE specific, actionable thing for her next call, written as an instruction to Ava (max 25 words).
overall: 1-5 for the whole call. confidence: 1-5 (direct close, no hedging, replies under 20 words).
If this was NOT a real sales attempt (an incoming prank, spam or wrong number, a test where nobody played along, dead air, or under two real exchanges), don't score it: reply {"skip":true,"reason":"<a few words>"}.
Otherwise reply with JSON only: {"scores":{"opening":n,"qualify":n,"present":n,"close":n,"rehash":n},"impulse":{"indifference":n,"honest_urgency":n,"bolt_match":n,"sounds_human":n},"objections":[],"rule_flags":[],"went_well":"","work_on":"","overall":n,"confidence":n}`;

const AVA_SYSTEM = `You are the coach for Ava, Jared's personal AI phone assistant. She answers his line, takes messages, makes calls he asks for, and handles spam callers. Score ONE call transcript. Be strict and specific. Score only what happened.

Scores 1-5 each. Use null (not 1) whenever a score doesn't apply to this call:
- On a call Jared asked her to make (outbound errand): name = did she confirm who she reached; message = did she get the errand done or the answer he needed; urgency and callback are null unless they came up.
- On an incoming call: all six apply when the caller had something to say; if they hung up first, leave name/message/urgency/callback null.
- name: did she get the caller's name (or confirm who she reached)?
- message: did she capture the message or the result of the errand accurately?
- urgency: did she find out whether it's urgent?
- callback: did she find out whether they want a callback and the best number/time?
- warm_brief: warm, casual and direct, short replies, no rambling, no stock phrases.
- privacy: kept Jared's private details private (no address, schedule, other people's info, money, codes), said she is his assistant and never claimed to be him.
rule_flags: ONLY real slips, from: shared_private_info, claimed_to_be_jared, denied_being_ai, made_commitment_for_jared. Empty if none.
went_well: one short sentence. work_on: ONE specific, actionable thing for her next call, written as an instruction to Ava (max 25 words).
overall: 1-5.
If there was no real conversation (dead air, an instant hang-up, a robocall menu with no one to talk to), don't score it: reply {"skip":true,"reason":"<a few words>"}.
Otherwise reply with JSON only: {"scores":{"name":n,"message":n,"urgency":n,"callback":n,"warm_brief":n,"privacy":n},"rule_flags":[],"went_well":"","work_on":"","overall":n}`;

const n15 = (v: unknown) => v === null || v === undefined || v === "" ? null : Math.min(5, Math.max(1, Math.round(Number(v)))) || null;
const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const RG_FLAGS = ["said_replacement", "called_it_insurance", "fake_social_proof", "invented_deadline", "denied_being_ai", "income_projection"];
const AVA_FLAGS = ["shared_private_info", "claimed_to_be_jared", "denied_being_ai", "made_commitment_for_jared"];
const OBJ = ["already_have_roofer", "send_info", "price", "busy", "not_interested", "wrong_person", "call_back_later", "other"];

function cleanReview(source: "roofguard" | "ava", j: any) {
  if (!j || typeof j !== "object") return null;
  if (j.skip === true) return { skip: true, went_well: clip(j.reason ?? "not a real conversation", 200) };
  const s = j.scores ?? {};
  if (source === "roofguard") {
    const flags = (Array.isArray(j.rule_flags) ? j.rule_flags : []).map(String).filter((f: string) => RG_FLAGS.includes(f));
    return {
      scores: { opening: n15(s.opening), qualify: n15(s.qualify), present: n15(s.present), close: n15(s.close), rehash: n15(s.rehash) },
      impulse: { indifference: n15(j.impulse?.indifference), honest_urgency: n15(j.impulse?.honest_urgency),
                 bolt_match: n15(j.impulse?.bolt_match), sounds_human: n15(j.impulse?.sounds_human) },
      objections: [...new Set((Array.isArray(j.objections) ? j.objections : []).map(String).filter((o: string) => OBJ.includes(o)))],
      rule_flags: flags, went_well: clip(j.went_well, 300), work_on: clip(j.work_on, 300),
      overall: n15(j.overall), confidence: n15(j.confidence),
    };
  }
  return {
    scores: { name: n15(s.name), message: n15(s.message), urgency: n15(s.urgency), callback: n15(s.callback),
              warm_brief: n15(s.warm_brief), privacy: n15(s.privacy) },
    rule_flags: (Array.isArray(j.rule_flags) ? j.rule_flags : []).map(String).filter((f: string) => AVA_FLAGS.includes(f)),
    went_well: clip(j.went_well, 300), work_on: clip(j.work_on, 300), overall: n15(j.overall),
  };
}

const EMPTY_ADVICE = /^(n\/?a|none|nothing|no (change|changes|improvement)s?( needed)?|-)\b/i;
const validate = (source: "roofguard" | "ava") => (j: any) => {
  if (j && j.skip === true) return null;
  if (!j || typeof j !== "object" || !j.scores) return "missing scores";
  if (n15(j.overall) === null) return "missing overall";
  const w = String(j.work_on ?? "").trim();
  if (!w || EMPTY_ADVICE.test(w)) return "work_on must be one concrete thing to do (or skip the call)";
  return null;
};

// deno-lint-ignore no-explicit-any
function callContext(source: "roofguard" | "ava", c: any, force = false): string {
  const ctx = callContextBase(source, c);
  // backfill: Jared asked for every past call to be scored, tests included. Only skip if there was truly nothing said.
  return force ? "NOTE FROM JARED: score this call even if it was a test or short. Judge what she said. Skip only if she never got a word in.\n\n" + ctx : ctx;
}
// deno-lint-ignore no-explicit-any
function callContextBase(source: "roofguard" | "ava", c: any): string {
  if (source === "roofguard") {
    return [`Call #${c.call_no ?? "?"}${c.is_test ? " (TEST call to Jared's own phone, playing a lead)" : ""}`,
      `Company: ${c.company ?? "?"} (${c.category ?? "?"})`, `Direction: ${c.direction ?? "outbound"}`,
      `Outcome logged: ${c.outcome ?? "?"}; decision maker reached: ${c.dm_reached ?? "?"}; kept talking: ${c.kept_talking ?? "?"}`,
      `Opener used: ${c.opener_key ?? "?"}`, `Length: ${c.duration_sec ?? "?"} sec`, "", "TRANSCRIPT:", c.transcript].join("\n");
  }
  return [`Call #${c.call_no ?? "?"}`, `Direction: ${c.direction}${c.forwarded ? " (forwarded from Jared's cell)" : ""}${c.is_spam ? " (spam caller)" : ""}`,
    c.purpose ? `Errand Jared gave her: ${c.purpose}` : "", c.caller_name ? `Caller: ${c.caller_name}` : "",
    `Logged: message="${clip(c.message, 200)}", urgent=${c.urgent ?? "?"}, callback=${c.callback_wanted ?? "?"}`,
    `Length: ${c.duration_sec ?? "?"} sec`, "", "TRANSCRIPT:", c.transcript].filter((l) => l !== "").join("\n");
}

async function reviewOne(source: "roofguard" | "ava", c: any, force = false) {
  try {
    const r = await llm({ task: "judge", system: source === "roofguard" ? RG_SYSTEM : AVA_SYSTEM, user: callContext(source, c, force),
      json: true, validate: validate(source), maxTokens: 700, job: "ava-coach", ref: c.id, fn: "ava-coach",
      privacy: "private", paid: "never", deadlineMs: 55_000 });
    const review = cleanReview(source, r.json);
    if (!review) throw new Error("coach returned no usable review");
    const { error } = await db.rpc("coach_save", { p_source: source, p_call: c.id, p_review: review, p_provider: r.provider, p_model: r.model });
    if (error) throw new Error(error.message);
    return { id: c.id, call_no: c.call_no, ok: true, provider: r.provider, overall: (review as any).overall ?? null, skipped: (review as any).skip === true };
  } catch (e) {
    const msg = e instanceof LlmUnavailable ? `free AI unavailable (${e.reason})` : (e as Error).message;
    await db.rpc("coach_save", { p_source: source, p_call: c.id, p_review: {}, p_provider: null, p_model: null, p_error: msg });
    return { id: c.id, call_no: c.call_no, ok: false, error: msg };
  }
}

async function review(limit = 3) {
  const started = Date.now();
  const out: Record<string, unknown[]> = { roofguard: [], ava: [] };
  for (const source of ["roofguard", "ava"] as const) {
    const { data, error } = await db.rpc("coach_next", { p_source: source, p_limit: limit });
    if (error) { out[source].push({ error: error.message }); continue; }
    for (const c of (data ?? []) as any[]) {
      if (Date.now() - started > 110_000) break;   // stay inside the edge function's time
      out[source].push(await reviewOne(source, c));
    }
  }
  return out;
}

// ---------- backfill: score every past call (tests too), oldest first, a few per run ----------
async function backfill(limit = 4, includeDeleted = false, only?: "roofguard" | "ava") {
  const started = Date.now();
  const out: Record<string, unknown[]> = { roofguard: [], ava: [] };
  for (const source of (only ? [only] : ["roofguard", "ava"]) as ("roofguard" | "ava")[]) {
    const { data, error } = await db.rpc("coach_backfill_list", { p_source: source, p_limit: limit, p_include_deleted: includeDeleted });
    if (error) { out[source].push({ error: error.message }); continue; }
    for (const c of (data ?? []) as any[]) {
      if (Date.now() - started > 110_000) break;
      out[source].push(await reviewOne(source, c, true));
    }
  }
  return out;
}

// ---------- weekly: the week's lessons -> small playbook changes ----------
const WEEK_RG = `You coach Ava, an AI that cold-calls building managers for RoofGuard to book intro calls with Eli. Below are this week's call reviews, her current learned playbook, and any slips the reply guard caught.
Find the 1-3 changes most likely to get more people to keep talking and more meetings booked. Each change is ONE short instruction added to her script (max 40 words), concrete enough to act on in the moment, e.g. a comeback for a common objection, a better way to ask for the meeting, pacing.
Never touch or contradict her hard rules: never say "replacement" (always "renewal"), never call it insurance, never name or imply partners or clients we don't have, never invent deadlines, always honest that she is an AI, no money promises. Don't repeat anything already in her playbook.
size: "small" for a wording/comeback/pacing tweak, "big" for a new angle, a new opener or a different call flow.
Reply with JSON only: {"changes":[{"rule":"","why":"evidence from the reviews in one sentence","kind":"comeback|wording|pacing|close|flow|other","size":"small|big"}]}. Return {"changes":[]} if the data doesn't support a change.`;
const WEEK_AVA = `You coach Ava, Jared's personal AI phone assistant (takes messages, makes calls for him, handles spam). Below are this week's call reviews, her current learned playbook and any slips the reply guard caught.
Find the 1-3 changes that would most improve her calls. Each change is ONE short instruction for her script (max 40 words), concrete enough to act on in the moment.
Never contradict her rules: she is Jared's assistant and never claims to be him, she keeps his private details private, she never commits to anything for him, she is honest about being an AI when sincerely asked. Don't repeat anything already in her playbook.
Reply with JSON only: {"changes":[{"rule":"","why":"evidence in one sentence","kind":"comeback|wording|pacing|close|flow|other","size":"small|big"}]}. Return {"changes":[]} if there isn't enough to go on.`;

async function weekly() {
  const out: Record<string, unknown> = {};
  for (const source of ["roofguard", "ava"] as const) {
    const { data: wk, error } = await db.rpc("coach_week", { p_source: source });
    if (error) { out[source] = { error: error.message }; continue; }
    const reviews = (wk?.reviews ?? []) as unknown[];
    if (reviews.length < 3) { out[source] = { skipped: `only ${reviews.length} reviewed calls this week` }; continue; }
    try {
      const r = await llm({ task: "reflect", system: source === "roofguard" ? WEEK_RG : WEEK_AVA,
        user: JSON.stringify(wk).slice(0, 24_000), json: true, maxTokens: 900, job: "ava-coach-weekly", fn: "ava-coach",
        privacy: "private", paid: "never", deadlineMs: 70_000,
        validate: (j: any) => Array.isArray(j?.changes) ? null : "changes must be an array" });
      const { data: res } = await db.rpc("coach_propose", { p_source: source, p_rules: r.json.changes });
      out[source] = { reviewed: reviews.length, proposed: r.json.changes.length, ...(res ?? {}) };
      const kept = (res as any)?.kept ?? 0;
      const owner = source === "roofguard" ? "RoofGuard Ava" : "Ava";
      await db.rpc("scout_notify", {
        p_title: `${owner}: my coach's Monday notes`,
        p_body: kept ? `${reviews.length} calls reviewed this week. ${kept} new move${kept === 1 ? "" : "s"} for her playbook` +
                  (source === "roofguard" ? " (small ones start testing on half her calls; big ones wait for your tap)." : " (waiting for your tap).")
              : `${reviews.length} calls reviewed this week. Nothing worth changing yet.`,
        p_severity: "info", p_push: false, p_url: source === "roofguard" ? "/admin/roofguard#scorecard" : "/admin/ava#scorecard",
        p_dedupe: `coach-week-${source}-${new Date().toISOString().slice(0, 10)}` });
    } catch (e) {
      out[source] = { error: e instanceof LlmUnavailable ? `free AI unavailable (${e.reason})` : (e as Error).message };
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (!(await allowed(req))) return J({ ok: false, error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  try {
    switch (body.op) {
      case "review": return J({ ok: true, ...(await review(Math.min(6, Number(body.limit) || 3))) });
      case "weekly": return J({ ok: true, ...(await weekly()) });
      case "backfill": return J({ ok: true, ...(await backfill(Math.min(6, Number(body.limit) || 4), body.include_deleted === true,
        body.source === "ava" || body.source === "roofguard" ? body.source : undefined)) });
      case "one": {
        const source = body.source === "ava" ? "ava" : "roofguard";
        const { data } = await db.rpc("coach_next", { p_source: source, p_limit: 50 });
        const c = ((data ?? []) as any[]).find((x) => x.id === body.call_id);
        if (!c) return J({ ok: false, error: "that call is already reviewed or has no transcript" }, 404);
        return J({ ok: true, result: await reviewOne(source, c) });
      }
      default: return J({ ok: false, error: "op must be review, weekly, backfill or one" }, 400);
    }
  } catch (e) {
    return J({ ok: false, error: (e as Error).message }, 500);
  }
});
