// hunter-score: Hunter's lead scorer (Phase 1.5, 2026-10-11). Zero Claude tokens.
//
// Gives every lead a caller may dial one row of odds in hunter_lead_scores: the chance a call reaches the decision maker,
// how the call is likely to end (decision maker, gatekeeper, voicemail, no answer, wrong number), who picks up, the best
// window, and the product fit. Maya's leads (maya_leads) and Reese's (rg_leads) are both scored; only the lead id and the
// numbers are stored, never a phone, email or person name.
//
//   {op:"run",      limit?:120, maya?:200, reese?:150, all?:false, ignore_cap?:false, reese_target?:N, budget_ms?:100000}
//                   score what is missing or older than 7 days: Jev when a key is saved and working, else the free AI ladder
//   {op:"backfill"} run with all leads, the Reese target of 100, caps ignored (the first fill)
//   {op:"test",     lead_id?}                                  score one lead and return the result (the Jev card's button)
//
// Callers: pg_cron (hunter-score), the Hunter page (admin JWT), the watchdog in hunter-run.
// Auth: Vault edge_proxy_key (x-proxy-key), the service key, or an admin JWT. verify_jwt = false (own check).
//
// Jev (TypeSafe AI) API, confirmed from docs.typesafe.ai (quickstart and primitives) on 2026-10-11:
//   POST https://api.typesafe.ai/v1/systemone    Authorization: Bearer <key>    Content-Type: application/json
//   body  {state: string, model: "jev-latest", questions: {<id>: {type: "choice"|"score"|"noul", instructions, criteria?}}}
//         choice.criteria = {option: description}; score.criteria = [level descriptions]; noul.criteria optional
//   reply {model, answers: {<id>: {type, choice, probabilities, confidence} | {type, score, probabilities, confidence, legend} | {type, noul}}, usage: {input_tokens, output_tokens}}
// Not confirmed (docs do not say): rate limits, error body shape, calibration guarantees. Any non-200 or odd answer falls back to the free AI.

import { createClient } from "jsr:@supabase/supabase-js@2";

const __keys = (n: string) => { try { return JSON.parse(Deno.env.get(n) ?? "{}").default as string | undefined; } catch { return undefined; } };
const SB_SECRET: string = __keys("SUPABASE_SECRET_KEYS") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const SERVICE_KEYS = new Set([SB_SECRET, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""].filter(Boolean));
// deno-lint-ignore no-explicit-any
const db: any = createClient(Deno.env.get("SUPABASE_URL")!, SB_SECRET, { auth: { persistSession: false } });
const PT = "America/Los_Angeles";
const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const JEV_MODEL = "jev-latest";
// Jev is also on Vercel AI Gateway (no waitlist), same request and reply shape. A gateway key starts with "vck_".
// Docs: vercel.com/docs/ai-gateway/sdks-and-apis/typesafe (checked 2026-10-11).
const GW_URL = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";
const GW_MODEL = "typesafe-ai/jev";
const jevRoute = (key: string) => key.startsWith("vck_") ? { url: GW_URL, model: GW_MODEL } : { url: JEV_URL, model: JEV_MODEL };

const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey, x-client-info, x-proxy-key", "access-control-allow-methods": "POST, OPTIONS" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", ...CORS } });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function authorized(req: Request): Promise<"service" | "admin" | null> {
  const k = req.headers.get("x-proxy-key");
  if (k) {
    for (const n of ["edge_proxy_key_sha256", "edge_proxy_key_prev_sha256"]) {
      const { data } = await db.rpc("edge_key_ok", { p_name: n, p_key: k });
      if (data === true) return "service";
    }
  }
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  const apikey = (req.headers.get("apikey") ?? "").trim();
  if ([bearer, apikey].some((t) => t && SERVICE_KEYS.has(t))) return "service";
  if (bearer && bearer.split(".").length === 3) {
    const { data } = await db.auth.getUser(bearer);
    if (data?.user) {
      const { data: ok } = await db.rpc("has_role", { _user_id: data.user.id, _role: "admin" });
      if (ok) return "admin";
    }
  }
  return null;
}

/* ───────── types and vocabulary ───────── */

const OUTCOMES = ["decision_maker", "gatekeeper", "voicemail", "no_answer", "wrong_number"] as const;
const ROLES = ["owner", "manager", "office_manager", "unknown"] as const;
const WINDOWS = ["morning", "midday", "afternoon", "late"] as const;
type Outcome = typeof OUTCOMES[number];
type Owner = "maya" | "reese";
type Scored = {
  p_reach_dm: number; outcome_probs: Record<Outcome, number>; dm_role: string; best_window: string; p_fit: number;
  model: string; latency_ms: number | null; tokens_in: number | null;
};
type Item = { owner: Owner; lead_table: string; lead_id: string; input: Record<string, any> };

const CAT_LABEL: Record<string, string> = {
  auto_repair: "auto repair shop", salon: "salon", home_services: "home-service contractor", clinic: "small clinic",
};
const label = (c: unknown) => CAT_LABEL[String(c ?? "")] ?? String(c ?? "business").replace(/_/g, " ");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const clamp01 = (n: unknown) => { const x = Number(n); return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : NaN; };

function normalizeProbs(raw: Record<string, unknown> | undefined): Record<Outcome, number> {
  const p = {} as Record<Outcome, number>;
  let sum = 0;
  for (const k of OUTCOMES) {
    const v = clamp01(raw?.[k] ?? 0);
    if (Number.isNaN(v)) throw new Error("odds were not numbers");
    p[k] = v; sum += v;
  }
  if (sum <= 0) throw new Error("odds were all zero");
  let acc = 0, big: Outcome = OUTCOMES[0];
  for (const k of OUTCOMES) { p[k] = Math.round((p[k] / sum) * 10000) / 10000; acc += p[k]; if (p[k] > p[big]) big = k; }
  p[big] = Math.round((p[big] + (1 - acc)) * 10000) / 10000;
  return p;
}

/* ───────── what the model is shown ───────── */

function stateText(owner: Owner, i: Record<string, any>): string {
  const tries = Number(i.call_attempts ?? 0);
  const line = ({ landline: "a landline", voip: "a VoIP line", mobile: "a mobile phone", unknown: "an unknown line type", unverified: "an unchecked line type" } as Record<string, string>)[String(i.line_type)] ?? "a phone line";
  if (owner === "maya") {
    return [
      "A cold call is placed to a local business's main phone number during business hours by an AI phone assistant that offers an AI receptionist (answers every call, books appointments).",
      `Business: ${i.company}, a ${label(i.category)}${i.city ? " in " + i.city : ""}, ${i.state ?? "CA"}.`,
      `Opening hours: ${i.hours || "not listed"}.`,
      `The number is ${line}.`,
      `Website: ${i.has_website ? `yes (${i.site === "ok" ? "read" : i.site === "blocked" ? "asks robots not to read it" : "did not load"})` : "none listed"}.`,
      i.site_summary ? `What we know: ${i.site_summary}` : "",
      `Earlier call attempts: ${tries}.`,
      "Staff size is not listed; local businesses of this kind are usually owner-run with 1 to 10 people.",
    ].filter(Boolean).join("\n");
  }
  return [
    "A cold call is placed to the main phone number of a commercial or institutional facility by an AI phone assistant for a roof-risk program that wants to reach whoever maintains the roof.",
    `Organization: ${i.company}, a ${label(i.category)} in ${i.state ?? "the US"} (time zone ${i.timezone ?? "unknown"}).`,
    i.contact_title ? `The contact on file has the title: ${i.contact_title}.` : "No named contact on file.",
    `The number is ${line}.`,
    [i.site_model ? `Sites: ${i.site_model}.` : "", i.roof_volume ? `Roof volume: ${i.roof_volume}.` : "", i.footprint ? `Footprint: ${i.footprint}.` : "", i.risk_tier ? `Storm risk tier: ${i.risk_tier}.` : ""].filter(Boolean).join(" "),
    i.angle ? `Why they matter: ${i.angle}` : "",
    `Earlier call attempts: ${tries}.`,
  ].filter(Boolean).join("\n");
}

const OUTCOME_CRITERIA = {
  decision_maker: "The owner or a person who makes purchasing decisions answers or is put through, so the pitch reaches them",
  gatekeeper: "A receptionist, front desk, assistant or phone tree answers and screens the call without putting it through",
  voicemail: "The call goes to voicemail or an answering machine",
  no_answer: "Nobody picks up and there is no voicemail",
  wrong_number: "The number is disconnected, wrong, or not a business line",
};
const QUESTIONS = (owner: Owner) => ({
  outcome: { type: "choice", instructions: "What is the most likely result of this cold call?", criteria: OUTCOME_CRITERIA },
  dm_role: {
    type: "choice", instructions: "Who is the person most likely to be reached who can decide?",
    criteria: { owner: "The owner or founder of the business", manager: "A general manager, facilities director or department head", office_manager: "An office manager or front-desk coordinator", unknown: "Impossible to tell" },
  },
  window: {
    type: "choice", instructions: "Which local-time window gives the best chance of reaching that person? Think about the daily rhythm of this kind of business (salons are quiet mornings, clinics are with patients all morning, trades are on jobs most of the day, facilities directors answer mid-morning or early afternoon).",
    criteria: { morning: "8 to 11 AM", midday: "11 AM to 1 PM", afternoon: "1 to 4 PM", late: "4 to 6 PM" },
  },
  fit: {
    type: "noul",
    instructions: owner === "maya"
      ? "This business would clearly benefit from an AI receptionist that answers every call and books appointments"
      : "This organization would clearly benefit from a free roof-risk assessment and storm-readiness program",
  },
});

/* ───────── Jev ───────── */

class JevError extends Error { constructor(public status: number, msg: string) { super(msg); } }
const jevMessage = (e: unknown): string => {
  if (e instanceof JevError) {
    if (e.status === 401 || e.status === 403) return "Jev rejected the key. Paste a fresh one on the Jev card.";
    if (e.status === 402) return "Jev says the account is out of credit.";
    if (e.status === 429) return "Jev is limiting requests right now.";
    if (e.status === 0) return "Jev did not answer in time.";
    return `Jev answered ${e.status}.`;
  }
  return String((e as Error)?.message ?? e).slice(0, 120);
};

async function jevScore(key: string, owner: Owner, input: Record<string, any>): Promise<Scored> {
  const t0 = Date.now();
  const route = jevRoute(key);
  let res: Response;
  try {
    res = await fetch(route.url, {
      method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ state: stateText(owner, input), model: route.model, questions: QUESTIONS(owner) }),
    });
  } catch { throw new JevError(0, "timeout"); }
  const latency = Date.now() - t0;
  if (!res.ok) { await res.text().catch(() => ""); throw new JevError(res.status, `HTTP ${res.status}`); }
  const j = await res.json();
  const a = j?.answers ?? {};
  const probs = normalizeProbs(a.outcome?.probabilities ?? (a.outcome?.choice ? { [a.outcome.choice]: 1 } : undefined));
  const role = String(a.dm_role?.choice ?? "unknown");
  const win = String(a.window?.choice ?? "");
  const fit = clamp01(a.fit?.noul);
  if (!ROLES.includes(role as never) || !WINDOWS.includes(win as never) || Number.isNaN(fit)) throw new Error("Jev answered in a shape I did not expect");
  return { p_reach_dm: probs.decision_maker, outcome_probs: probs, dm_role: role, best_window: win, p_fit: Math.round(fit * 10000) / 10000,
    model: String(j.model ?? route.model), latency_ms: latency, tokens_in: Number(j.usage?.input_tokens ?? 0) || null };
}

/* ───────── free AI ladder, asked for the same shape ───────── */

const FREE_SYSTEM = `You estimate what happens when an AI phone agent cold-calls a business's main phone line, and how well the offer fits.
Reply with JSON only, exactly this shape:
{"outcome_probs":{"decision_maker":0.0,"gatekeeper":0.0,"voicemail":0.0,"no_answer":0.0,"wrong_number":0.0},"dm_role":"owner|manager|office_manager|unknown","best_window":"morning|midday|afternoon|late","p_fit":0.0}
The five outcome numbers are chances from 0 to 1 and must add up to 1.
decision_maker = the owner or a decider is reached. gatekeeper = a receptionist or phone tree screens the call. voicemail, no_answer, wrong_number are what they say.
Base rates for small owner-run local businesses: decision_maker 0.10 to 0.25, gatekeeper 0.30 to 0.45, voicemail 0.20 to 0.30, no_answer 0.10 to 0.20, wrong_number 0.01 to 0.04.
Hospitals, casinos, hotels and other large institutions: decision_maker 0.03 to 0.08, gatekeeper 0.55 or more.
Mobile lines reach the owner more often. VoIP lines reach voicemail more often. Earlier attempts with no luck lower the chances a little.
dm_role is who is most likely to be reached. best_window is the local time with the best chance: morning 8 to 11 AM, midday 11 AM to 1 PM, afternoon 1 to 4 PM, late 4 to 6 PM.
Window guide: salons and barbershops are slowest on weekday mornings, so midday or afternoon; clinics and dental offices are with patients all morning, so midday (lunch) or late; auto repair and home-service owners are on the floor or on jobs most of the day and answer best early morning or late afternoon; facilities and plant-operations directors at large institutions are best reached mid-morning or early afternoon. Do not default to morning.
p_fit is 0 to 1: how clearly the offer helps this business. Use only the facts given. Do not invent facts.`;

async function askFreeAi(user: string): Promise<{ json: any; ms: number }> {
  let last = "no answer";
  const t0 = Date.now();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/free-llm`, {
        method: "POST", signal: AbortSignal.timeout(60_000),
        headers: { "content-type": "application/json", authorization: `Bearer ${SB_SECRET}`, apikey: SB_SECRET },
        body: JSON.stringify({ op: "run", task: "classify", system: FREE_SYSTEM, user, json: true, privacy: "private", paid: "never", maxTokens: 400 }),
      });
      const j = await r.json();
      if (j?.ok && j.json && typeof j.json === "object") return { json: j.json, ms: Date.now() - t0 };
      last = j?.error ?? "unusable answer";
    } catch (e) { last = String(e).slice(0, 100); }
  }
  throw new Error("free AI unavailable: " + last);
}

async function freeScore(owner: Owner, input: Record<string, any>): Promise<Scored> {
  const { json, ms } = await askFreeAi(stateText(owner, input));
  const probs = normalizeProbs(json.outcome_probs);
  const role = ROLES.includes(json.dm_role) ? json.dm_role : "unknown";
  const win = WINDOWS.includes(json.best_window) ? json.best_window : "morning";
  const fit = clamp01(json.p_fit);
  if (Number.isNaN(fit)) throw new Error("free AI gave no fit number");
  return { p_reach_dm: probs.decision_maker, outcome_probs: probs, dm_role: role, best_window: win, p_fit: Math.round(fit * 10000) / 10000, model: "free-ladder", latency_ms: ms, tokens_in: null };
}

/* ───────── the one line a caller can say ───────── */

const WINDOW_PHRASE: Record<string, string> = {
  morning: "mornings, 8 to 11 AM", midday: "midday, 11 AM to 1 PM", afternoon: "afternoons, 1 to 4 PM", late: "late afternoons, 4 to 6 PM",
};
const firstSentence = (s: string) => (s.trim().match(/^[^.!?]+[.!?]?/)?.[0] ?? "").trim();
function reasonFor(owner: Owner, i: Record<string, any>, r: Scored): string {
  const win = WINDOW_PHRASE[r.best_window] ?? "mornings";
  if (owner === "maya") {
    let base = firstSentence(String(i.site_summary ?? "")).replace(/[.!?]$/, "");
    if (!base || base.length > 110) base = `${cap(label(i.category))}${i.city ? " in " + i.city : ""}; calls after hours likely go unanswered`;
    return `${base}. Try ${win}.`;
  }
  const title = String(i.contact_title ?? "").trim();
  return title
    ? `${title} is the contact on file. Try ${win}, their local time.`
    : `${cap(label(i.category))} with no named contact. Try ${win}, their local time.`;
}

/* ───────── bookkeeping ───────── */

function ptDayStart(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: PT, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const off = new Intl.DateTimeFormat("en-US", { timeZone: PT, timeZoneName: "shortOffset" }).formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "GMT-8";
  const h = Number(off.replace("GMT", "").split(":")[0] || -8);
  return new Date(`${parts}T00:00:00${h < 0 ? "-" : "+"}${String(Math.abs(h)).padStart(2, "0")}:00`).toISOString();
}

async function usedToday(source: "jev" | "free_ai"): Promise<number> {
  const { data } = await db.from("hunter_runs").select("checked").eq("step", "score").eq("source", source).gte("started_at", ptDayStart());
  return (data ?? []).reduce((a: number, r: { checked: number }) => a + (r.checked ?? 0), 0);
}

async function markOk(slug: string) {
  const now = new Date().toISOString();
  await db.from("hunter_sources").update({ last_run_at: now, last_ok_at: now, fail_streak: 0, last_error: null }).eq("slug", slug);
}
// A failure counts once per Pacific day, so "failing 2 nights" means two nights, not two retries.
async function markFail(slug: string, error: string) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: PT }).format(new Date());
  const { data: s } = await db.from("hunter_sources").select("fail_streak, cursor").eq("slug", slug).maybeSingle();
  const cur = (s?.cursor ?? {}) as Record<string, unknown>;
  const first = cur.fail_day !== today;
  await db.from("hunter_sources").update({
    last_run_at: new Date().toISOString(), last_error: error.slice(0, 300), cursor: { ...cur, fail_day: today },
    ...(first ? { fail_streak: (s?.fail_streak ?? 0) + 1 } : {}),
  }).eq("slug", slug);
}

async function saveScore(it: Item, r: Scored, scorer: "jev" | "free_ai") {
  const { error } = await db.from("hunter_lead_scores").upsert({
    owner: it.owner, lead_table: it.lead_table, lead_id: it.lead_id, scorer, model: r.model, p_reach_dm: r.p_reach_dm,
    outcome_probs: r.outcome_probs, dm_role: r.dm_role, best_window: r.best_window, p_fit: r.p_fit,
    reason: reasonFor(it.owner, it.input, r), inputs: it.input, latency_ms: r.latency_ms, tokens_in: r.tokens_in, scored_at: new Date().toISOString(),
  }, { onConflict: "owner,lead_id" });
  if (error) throw new Error("could not save a score: " + error.message);
}

async function jevKey(): Promise<string | null> {
  const { data: src } = await db.from("hunter_sources").select("enabled").eq("slug", "jev").maybeSingle();
  if (src && src.enabled === false) return null;
  const { data } = await db.rpc("hunter_secret", { p_name: "jev_api_key" });
  return typeof data === "string" && data.length > 8 ? data : null;
}

async function freshReese(): Promise<number> {
  const { count } = await db.from("hunter_lead_scores").select("id", { count: "exact", head: true }).eq("owner", "reese").gte("scored_at", new Date(Date.now() - 7 * 864e5).toISOString());
  return count ?? 0;
}

async function prune() {
  for (const [owner, table] of [["maya", "maya_leads"], ["reese", "rg_leads"]]) {
    const { data: sc } = await db.from("hunter_lead_scores").select("lead_id").eq("owner", owner);
    const ids = (sc ?? []).map((r: { lead_id: string }) => r.lead_id);
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      const { data: ex } = await db.from(table).select("id").in("id", chunk);
      const have = new Set((ex ?? []).map((r: { id: string }) => r.id));
      const gone = chunk.filter((x: string) => !have.has(x));
      if (gone.length) await db.from("hunter_lead_scores").delete().eq("owner", owner).in("lead_id", gone);
    }
  }
}

/* ───────── RUN ───────── */

async function opRun(body: Record<string, any>) {
  const started = new Date().toISOString();
  const t0 = Date.now(), budget = Math.max(20_000, Math.min(Number(body.budget_ms ?? 100_000), 125_000));
  const { data: st } = await db.from("hunter_settings").select("enabled, score_cap_jev, score_cap_free").eq("id", true).maybeSingle();
  if (st && st.enabled === false) return { ok: true, skipped: "paused" };
  const ignoreCap = body.ignore_cap === true;
  const key = await jevKey();
  let jevRoom = key ? (ignoreCap ? 1e9 : Math.max(0, (st?.score_cap_jev ?? 500) - (await usedToday("jev")))) : 0;
  let freeRoom = ignoreCap ? 1e9 : Math.max(0, (st?.score_cap_free ?? 150) - (await usedToday("free_ai")));
  const room = jevRoom + freeRoom;
  if (room <= 0) return { ok: true, skipped: "nightly scoring caps reached" };

  const limit = Math.min(room, Math.max(1, Math.min(Number(body.limit ?? 120), 400)));
  let reeseN = Math.max(0, Math.min(Number(body.reese ?? 150), 400));
  if (body.reese_target != null) reeseN = Math.max(0, Number(body.reese_target) - (await freshReese()));
  const { data: q, error: qe } = await db.rpc("hunter_score_queue", { p_maya: Math.min(Number(body.maya ?? 200), 400), p_reese: reeseN, p_all: body.all === true });
  if (qe) { await markFail("lead_scorer", "queue failed: " + qe.message); return { ok: false, error: qe.message }; }
  const items = ((q ?? []) as Item[]).sort((a, b) => (a.owner === b.owner ? 0 : a.owner === "maya" ? -1 : 1)).slice(0, limit);
  if (!items.length) { await prune(); return { ok: true, scored: 0, note: "nothing to score" }; }

  const jev = { ok: 0, failed: 0, latency: 0, tokens: 0 }, free = { ok: 0, failed: 0, latency: 0 };
  let jevDown = false, jevErr = "", freeErr = "", fellBack = 0;
  const sample: Array<{ company: string; scorer: string; reach: number }> = [];

  const one = async (it: Item) => {
    if (key && !jevDown && jevRoom > 0) {
      jevRoom--;
      try {
        const r = await jevScore(key, it.owner, it.input);
        await saveScore(it, r, "jev");
        jev.ok++; jev.latency += r.latency_ms ?? 0; jev.tokens += r.tokens_in ?? 0;
        if (sample.length < 3) sample.push({ company: it.input.company, scorer: "jev", reach: r.p_reach_dm });
        return;
      } catch (e) {
        jev.failed++; jevErr = jevMessage(e);
        if (e instanceof JevError && (e.status === 401 || e.status === 403 || e.status === 402)) jevDown = true;
        if (jev.ok === 0 && jev.failed >= 4) jevDown = true;
        fellBack++;
      }
    }
    if (freeRoom > 0) {
      freeRoom--;
      try {
        const r = await freeScore(it.owner, it.input);
        await saveScore(it, r, "free_ai");
        free.ok++; free.latency += r.latency_ms ?? 0;
        if (sample.length < 3) sample.push({ company: it.input.company, scorer: "free_ai", reach: r.p_reach_dm });
      } catch (e) { free.failed++; freeErr = String((e as Error).message ?? e).slice(0, 120); }
    }
  };

  const inflight = new Set<Promise<void>>();
  const conc = key ? 5 : 3;
  for (const it of items) {
    if (Date.now() - t0 > budget) break;
    const p = one(it).catch(() => { /* counted above */ });
    inflight.add(p); p.finally(() => inflight.delete(p));
    if (inflight.size >= conc) await Promise.race(inflight);
  }
  await Promise.all(inflight);

  const rows: Record<string, unknown>[] = [];
  if (jev.ok + jev.failed > 0) rows.push({ started_at: started, finished_at: new Date().toISOString(), step: "score", source: "jev", checked: jev.ok, rejected: jev.failed,
    error: jev.ok === 0 ? jevErr : null, detail: { calls: jev.ok, failed: jev.failed, latency_ms: jev.latency, tokens_in: jev.tokens, fell_back: fellBack } });
  if (free.ok + free.failed > 0) rows.push({ started_at: started, finished_at: new Date().toISOString(), step: "score", source: "free_ai", checked: free.ok, rejected: free.failed,
    error: free.ok === 0 ? freeErr : null, detail: { calls: free.ok, failed: free.failed, latency_ms: free.latency } });
  if (rows.length) await db.from("hunter_runs").insert(rows);

  if (key && jev.ok + jev.failed > 0) { if (jev.ok > 0) await markOk("jev"); else await markFail("jev", jevErr || "no answer"); }
  const scored = jev.ok + free.ok;
  if (jev.ok + jev.failed + free.ok + free.failed > 0) { if (scored > 0) await markOk("lead_scorer"); else await markFail("lead_scorer", freeErr || jevErr || "nothing could be scored"); }
  return { ok: scored > 0, scored, jev: { ok: jev.ok, failed: jev.failed }, free_ai: { ok: free.ok, failed: free.failed }, fell_back: fellBack, jev_error: jevErr || null, free_error: freeErr || null, queue: items.length, sample };
}

/* ───────── TEST (the Jev card's button) ───────── */

async function opTest(body: Record<string, any>) {
  let id: string | undefined = body.lead_id;
  if (!id) {
    const { data } = await db.from("maya_leads").select("id").in("status", ["queued", "checked"]).order("fit_score", { ascending: false, nullsFirst: false }).limit(1);
    id = data?.[0]?.id;
  }
  if (!id) return { ok: false, error: "There is no lead to score yet." };
  const { data: q, error } = await db.rpc("hunter_score_queue", { p_lead: id });
  const it = (q ?? [])[0] as Item | undefined;
  if (error || !it) return { ok: false, error: "That lead was not found." };
  const key = await jevKey();
  const started = new Date().toISOString();
  try {
    let r: Scored, scorer: "jev" | "free_ai";
    if (key) { r = await jevScore(key, it.owner, it.input); scorer = "jev"; }
    else { r = await freeScore(it.owner, it.input); scorer = "free_ai"; }
    await saveScore(it, r, scorer);
    await db.from("hunter_runs").insert({ started_at: started, finished_at: new Date().toISOString(), step: "score", source: scorer, checked: 1,
      detail: { calls: 1, failed: 0, latency_ms: r.latency_ms ?? 0, tokens_in: r.tokens_in ?? 0, test: true } });
    if (scorer === "jev") await markOk("jev");
    return { ok: true, scorer, company: it.input.company, owner: it.owner, model: r.model, latency_ms: r.latency_ms, p_reach_dm: r.p_reach_dm, outcome_probs: r.outcome_probs,
      dm_role: r.dm_role, best_window: r.best_window, p_fit: r.p_fit, reason: reasonFor(it.owner, it.input, r), note: key ? null : "No Jev key is saved, so this is the free AI estimate." };
  } catch (e) {
    const msg = key ? jevMessage(e) : String((e as Error).message ?? e).slice(0, 140);
    if (key) await markFail("jev", msg);
    return { ok: false, error: msg, scorer: key ? "jev" : "free_ai" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const who = await authorized(req);
  if (!who) return J({ ok: false, error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({}));
  try {
    switch (body.op) {
      case "run": return J(await opRun(body));
      case "backfill": return J(await opRun({ all: true, ignore_cap: true, reese_target: 100, maya: 200, limit: 400, budget_ms: 115_000, ...body }));
      case "test": return J(await opTest(body));
      default: return J({ ok: false, error: "unknown op" }, 400);
    }
  } catch (e) {
    await sleep(0);
    return J({ ok: false, error: String(e).slice(0, 300) }, 500);
  }
});
