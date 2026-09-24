// _shared/free-llm.ts — run a prompt on free, no-training providers first; paid Claude only as the last rung.
//
// Plan + frozen interface: docs/scout-free-llm-opusplan.md §3. Owned by that plan; consumers (todo-check,
// scout-daily, admin-chat) import it and must not edit it.
//
//   import { llm, LlmUnavailable } from "../_shared/free-llm.ts";
//   const r = await llm({ task: "judge", system, user, json: true, job: "todo-check", ref: id, fn: "todo-check" });
//
// Guarantees: privacy defaults to "private" (training providers never tried); secrets are scrubbed before any
// send; every real attempt is logged to ai_spend (free = cost 0); the paid rung checks ai_budget(scope) first;
// only throws LlmUnavailable when every rung is done.
//
// Off switch: public.llm_providers.enabled (per provider). Cooldowns: llm_providers.cooldown_until.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type LlmTask = "judge" | "pick" | "extract" | "triage" | "write" | "reflect" | "classify" | "summarize";
export type LlmPrivacy = "private" | "public";
type Provider = "groq" | "cloudflare" | "local" | "gemini" | "openrouter" | "anthropic";
type Outcome = "ok" | "rate_limited" | "timeout" | "error" | "bad_json" | "invalid"
  | "skipped_size" | "skipped_off" | "skipped_budget" | "skipped_privacy" | "skipped_nokey";

export interface LlmRequest {
  task: LlmTask;
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
  job: string;
  ref?: string | null;
  fn?: string;
  scope?: "background" | "chat";
  privacy?: LlmPrivacy;
  paid?: "fallback" | "never" | "first";
  paidModel?: string;
  deadlineMs?: number;
  validate?: (json: any) => string | null;
}

export interface LlmResult {
  text: string;
  json?: any;
  model: string;
  provider: Provider;
  cost_usd: number;
  tried: { provider: string; model: string; outcome: Outcome; ms: number }[];
}

export class LlmUnavailable extends Error {
  reason: "budget" | "all_failed" | "paid_never";
  tried: LlmResult["tried"];
  constructor(reason: LlmUnavailable["reason"], tried: LlmResult["tried"], detail = "") {
    super(`free-llm: ${reason}${detail ? ` (${detail})` : ""}`);
    this.name = "LlmUnavailable";
    this.reason = reason;
    this.tried = tried;
  }
}

/* ───────── config ───────── */

interface Rung { provider: Provider; model: string; maxIn: number }

const M = {
  groqBig: "openai/gpt-oss-120b",
  groqSmall: "openai/gpt-oss-20b",
  cfBig: "@cf/openai/gpt-oss-120b",
  local: "qwen3:8b",
  gemini: "gemini-2.5-flash-lite",
  openrouter: "nvidia/nemotron-3-super-120b-a12b:free",
};
// Estimated input-token ceilings per rung (Groq free = 8K tokens/min total, so prompt + output must fit).
const GROQ_MAX = 6000, LOCAL_MAX = 3000, CF_MAX = 120_000, GEMINI_MAX = 200_000, OR_MAX = 100_000;

// Cloudflare Neurons per 1M tokens [in, out] (pricing page 2026-09-23: $0.011 per 1K Neurons).
const CF_NEURONS: Record<string, [number, number]> = {
  "@cf/openai/gpt-oss-120b": [31_818, 68_182],
  "@cf/openai/gpt-oss-20b": [18_182, 27_273],
  "@cf/qwen/qwen3-30b-a3b-fp8": [4_625, 30_475],
};
const ANTHROPIC_PRICE: Record<string, [number, number]> = { haiku: [1, 5], sonnet: [3, 15], opus: [15, 75] };

function routes(task: LlmTask, privacy: LlmPrivacy): Rung[] {
  const pub: Rung[] = privacy === "public"
    ? [{ provider: "gemini", model: M.gemini, maxIn: GEMINI_MAX }, { provider: "openrouter", model: M.openrouter, maxIn: OR_MAX }]
    : [];
  switch (task) {
    case "judge":
    case "pick":
      return [{ provider: "groq", model: M.groqBig, maxIn: GROQ_MAX }, { provider: "cloudflare", model: M.cfBig, maxIn: CF_MAX },
        { provider: "local", model: M.local, maxIn: LOCAL_MAX }, ...pub];
    case "classify":
      return [{ provider: "groq", model: M.groqSmall, maxIn: GROQ_MAX }, { provider: "cloudflare", model: M.cfBig, maxIn: CF_MAX },
        { provider: "local", model: M.local, maxIn: LOCAL_MAX }, ...pub];
    case "write":
      return [{ provider: "cloudflare", model: M.cfBig, maxIn: CF_MAX }]; // used only when paid is over budget (paid "first")
    default: // extract, reflect, triage, summarize
      return [{ provider: "groq", model: M.groqBig, maxIn: GROQ_MAX }, { provider: "cloudflare", model: M.cfBig, maxIn: CF_MAX }, ...pub];
  }
}

/* ───────── plumbing ───────── */

function secretKey(): string {
  try {
    const k = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}")?.default;
    if (k) return k;
  } catch { /* fall through */ }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

let _db: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (_db) return _db;
  const key = secretKey();
  _db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false }, global: { headers: { apikey: key } } });
  return _db;
}

let _keys: { at: number; v: Record<string, string> } | null = null;
async function keys(): Promise<Record<string, string>> {
  if (_keys && Date.now() - _keys.at < 10 * 60_000) return _keys.v;
  const { data, error } = await db().rpc("llm_keys");
  const v = (!error && data && typeof data === "object") ? data as Record<string, string> : {};
  _keys = { at: Date.now(), v };
  return v;
}

let _prov: { at: number; v: Record<string, any> } | null = null;
async function providers(): Promise<Record<string, any>> {
  if (_prov && Date.now() - _prov.at < 60_000) return _prov.v;
  const { data } = await db().from("llm_providers").select("name, enabled, private_ok, cooldown_until, daily_cap");
  const v = Object.fromEntries((data ?? []).map((p: any) => [p.name, p]));
  _prov = { at: Date.now(), v };
  return v;
}

async function cooldown(p: Provider, seconds: number, why: string) {
  const until = new Date(Date.now() + Math.max(30, Math.min(seconds, 24 * 3600)) * 1000).toISOString();
  if (_prov?.v[p]) _prov.v[p].cooldown_until = until;
  await db().from("llm_providers").update({ cooldown_until: until, cooldown_reason: why.slice(0, 200), updated_at: new Date().toISOString() }).eq("name", p);
}

const SECRET_RE = /(sk-ant-[A-Za-z0-9_\-]{10,}|sk-[A-Za-z0-9_\-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sb_secret_[A-Za-z0-9_\-]{10,}|gsk_[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_\-]{30,}|xox[abpr]-[A-Za-z0-9\-]{10,}|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})/g;
// A long value right after a key-ish word ("api_key": "...", password=..., Bearer ...).
const LABELLED_RE = /((?:api[_-]?key|secret|token|password|passwd|bearer|authorization)["'\s]*[:=]?\s*["']?)([A-Za-z0-9_\-.\/+=]{16,})/gi;
export function scrub(s: string): string {
  return s.replace(SECRET_RE, "[secret]").replace(LABELLED_RE, (_m, a) => `${a}[secret]`);
}

const estTokens = (s: string) => Math.ceil(s.length / 3.5);

function stripThink(t: string) {
  return t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function parseJson(t: string): any {
  const c = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const s = c.indexOf("{"), a = c.indexOf("[");
  const start = s < 0 ? a : a < 0 ? s : Math.min(s, a);
  if (start < 0) throw new Error("no json");
  const end = Math.max(c.lastIndexOf("}"), c.lastIndexOf("]"));
  return JSON.parse(c.slice(start, end + 1));
}

class Fail extends Error {
  constructor(public outcome: Outcome, msg: string, public retryAfter = 0) { super(msg); }
}

function laDayStart(): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  // LA offset is -7 or -8; subtracting the LA hour from now gets LA midnight to within the minute.
  const now = new Date();
  return new Date(now.getTime() - (Number(p.hour) * 3600 + now.getUTCMinutes() * 60 + now.getUTCSeconds()) * 1000).toISOString();
}

async function usedToday(p: Provider): Promise<number> {
  const since = laDayStart();
  if (p === "cloudflare") {
    const { data } = await db().from("ai_spend").select("free_units").eq("provider", p).gte("at", since).limit(5000);
    return (data ?? []).reduce((a: number, r: any) => a + Number(r.free_units ?? 0), 0);
  }
  const { count } = await db().from("ai_spend").select("id", { count: "exact", head: true }).eq("provider", p).gte("at", since);
  return count ?? 0;
}

/* ───────── adapters ───────── */

interface Call { text: string; model: string; inT: number; outT: number; cost: number; units?: number }

async function openaiCompat(url: string, key: string, model: string, req: LlmRequest, timeoutMs: number, extraBody: Record<string, unknown> = {}): Promise<Call> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: req.maxTokens ?? 1500,
    messages: [{ role: "system", content: req.json ? `${req.system}\n\nReply with JSON only.` : req.system }, { role: "user", content: req.user }],
    ...extraBody,
  };
  if (req.json) body.response_format = { type: "json_object" };
  let r: Response;
  try {
    r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new Fail((e as Error).name === "TimeoutError" ? "timeout" : "error", (e as Error).message);
  }
  if (r.status === 429) {
    const ra = Number(r.headers.get("retry-after")) || 60;
    throw new Fail("rate_limited", `429 ${(await r.text()).slice(0, 160)}`, ra);
  }
  if (!r.ok) throw new Fail("error", `${r.status} ${(await r.text()).slice(0, 200)}`, r.status >= 500 ? 0 : -1);
  const j = await r.json();
  const text = stripThink(String(j.choices?.[0]?.message?.content ?? ""));
  if (!text) throw new Fail("error", "empty reply");
  return { text, model: String(j.model ?? model), inT: Number(j.usage?.prompt_tokens ?? 0), outT: Number(j.usage?.completion_tokens ?? 0), cost: 0 };
}

async function callGroq(model: string, req: LlmRequest, t: number, k: Record<string, string>): Promise<Call> {
  if (!k.groq_api_key) throw new Fail("skipped_nokey", "no groq_api_key");
  return openaiCompat("https://api.groq.com/openai/v1/chat/completions", k.groq_api_key, model, req, Math.min(t, 25_000),
    model.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {});
}

async function callCloudflare(model: string, req: LlmRequest, t: number, k: Record<string, string>): Promise<Call> {
  if (!k.cloudflare_ai_token || !k.cloudflare_account_id) throw new Fail("skipped_nokey", "no cloudflare token/account");
  const c = await openaiCompat(`https://api.cloudflare.com/client/v4/accounts/${k.cloudflare_account_id}/ai/v1/chat/completions`,
    k.cloudflare_ai_token, model, req, Math.min(t, 60_000));
  const [ni, no] = CF_NEURONS[model] ?? [40_000, 80_000];
  c.units = (c.inT * ni + c.outT * no) / 1e6;
  return c;
}

async function callGemini(model: string, req: LlmRequest, t: number, k: Record<string, string>): Promise<Call> {
  if (!k.gemini_api_key) throw new Fail("skipped_nokey", "no gemini_api_key");
  return openaiCompat("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", k.gemini_api_key, model, req, Math.min(t, 60_000));
}

async function callOpenRouter(model: string, req: LlmRequest, t: number, k: Record<string, string>): Promise<Call> {
  if (!k.openrouter_api_key) throw new Fail("skipped_nokey", "no openrouter_api_key");
  return openaiCompat("https://openrouter.ai/api/v1/chat/completions", k.openrouter_api_key, model, req, Math.min(t, 60_000));
}

async function callLocal(model: string, req: LlmRequest, t: number): Promise<Call> {
  const { data: st } = await db().from("partner_ai_status").select("seen_at, model").eq("id", 1).maybeSingle();
  if (!st?.seen_at || Date.now() - Date.parse(st.seen_at) > 3 * 60_000) throw new Fail("skipped_off", "Mac mini offline");
  const prompt = `${req.system}\n\n${req.user}${req.json ? "\n\nReply with JSON only." : ""}`;
  const { data: job, error } = await db().from("fix_ai_jobs").insert({ issue_key: `llm:${req.job}:${req.ref ?? ""}`.slice(0, 200), prompt }).select("id").single();
  if (error || !job) throw new Fail("error", `queue: ${error?.message ?? "no row"}`);
  const until = Date.now() + Math.min(t, 45_000);
  while (Date.now() < until) {
    await new Promise((ok) => setTimeout(ok, 1500));
    const { data: row } = await db().from("fix_ai_jobs").select("status, answer").eq("id", job.id).maybeSingle();
    if ((row as any)?.status === "done") {
      const text = stripThink(String((row as any).answer ?? ""));
      if (!text) throw new Fail("error", "empty reply");
      return { text, model: String(st.model ?? model), inT: estTokens(prompt), outT: estTokens(text), cost: 0 };
    }
    if ((row as any)?.status === "error") throw new Fail("error", "local job failed");
  }
  await db().from("fix_ai_jobs").update({ status: "error", answer: "abandoned: caller timed out" }).eq("id", job.id).eq("status", "pending");
  throw new Fail("timeout", "local model took too long");
}

function cleanAnthropicKey(raw: string | undefined) {
  const m = (raw ?? "").match(/sk-ant-[A-Za-z0-9_\-]{20,}/);
  return (m ? m[0] : raw ?? "").trim();
}

async function callAnthropic(model: string, req: LlmRequest, t: number): Promise<Call> {
  const key = cleanAnthropicKey(Deno.env.get("ANTHROPIC_API_KEY"));
  if (!key) throw new Fail("skipped_nokey", "no ANTHROPIC_API_KEY");
  const { data: budget } = await db().rpc("ai_budget", { p_scope: req.scope ?? "background" });
  if ((budget as any)?.ok === false) throw new Fail("skipped_budget", `cap $${(budget as any).cap}, spent $${(budget as any).spent}`);
  const system = req.json ? `${req.system}\n\nReturn JSON only.` : req.system;
  for (let attempt = 0; attempt < 2; attempt++) {
    let r: Response;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: req.maxTokens ?? 1500, system, messages: [{ role: "user", content: req.user }] }),
        signal: AbortSignal.timeout(Math.min(t, 100_000)),
      });
    } catch (e) {
      throw new Fail((e as Error).name === "TimeoutError" ? "timeout" : "error", (e as Error).message);
    }
    if (r.ok) {
      const j = await r.json();
      const m = String(j.model ?? model);
      const [pin, pout] = ANTHROPIC_PRICE[Object.keys(ANTHROPIC_PRICE).find((k) => m.includes(k)) ?? "sonnet"];
      const u = j.usage ?? {};
      const plain = Number(u.input_tokens ?? 0), cw = Number(u.cache_creation_input_tokens ?? 0), cr = Number(u.cache_read_input_tokens ?? 0);
      const outT = Number(u.output_tokens ?? 0);
      const cost = (plain * pin + cw * pin * 1.25 + cr * pin * 0.1 + outT * pout) / 1e6;
      const text = (j.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
      return { text, model: m, inT: plain + cw + cr, outT, cost };
    }
    if ((r.status === 429 || r.status >= 500) && attempt === 0) { await new Promise((ok) => setTimeout(ok, 2000)); continue; }
    throw new Fail(r.status === 429 ? "rate_limited" : "error", `anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
  throw new Fail("error", "anthropic: no reply");
}

async function log(req: LlmRequest, provider: Provider, model: string, outcome: Outcome, ms: number, c?: Call, err?: string) {
  try {
    await db().from("ai_spend").insert({
      fn: req.fn ?? "free-llm", scope: req.scope ?? "background", job: req.job, model, ref: req.ref ?? null,
      input_tokens: c?.inT ?? 0, output_tokens: c?.outT ?? 0, cost_usd: c?.cost ?? 0,
      provider, ok: outcome === "ok", ms, free_units: c?.units ?? null, outcome: err ? `${outcome}: ${err}`.slice(0, 300) : outcome,
    });
    if (outcome === "ok" && provider !== "anthropic") {
      await db().from("llm_providers").update({ last_ok_at: new Date().toISOString() }).eq("name", provider);
    } else if (outcome !== "ok" && err) {
      await db().from("llm_providers").update({ last_error: `${new Date().toISOString()} ${outcome}: ${err}`.slice(0, 300) }).eq("name", provider);
    }
  } catch (e) {
    console.error("free-llm log", (e as Error).message);
  }
}

/* ───────── main ───────── */

export async function llm(input: LlmRequest): Promise<LlmResult> {
  const req: LlmRequest = { ...input, system: scrub(input.system), user: scrub(input.user) };
  const privacy: LlmPrivacy = req.privacy ?? "private";
  const paid = req.paid ?? (req.task === "write" ? "first" : "fallback");
  const paidModel = req.paidModel ?? "claude-haiku-4-5";
  const deadline = Date.now() + (req.deadlineMs ?? 90_000);
  const need = estTokens(req.system + req.user) + (req.maxTokens ?? 1500);
  const tried: LlmResult["tried"] = [];
  const [prov, k] = await Promise.all([providers(), keys()]);

  const ladder: Rung[] = routes(req.task, privacy);
  const paidRung: Rung = { provider: "anthropic", model: paidModel, maxIn: 190_000 };
  if (paid === "first") ladder.unshift(paidRung);
  else if (paid === "fallback") ladder.push(paidRung);

  let budgetHit = false;
  for (const rung of ladder) {
    const left = deadline - Date.now();
    const skip = (outcome: Outcome) => tried.push({ provider: rung.provider, model: rung.model, outcome, ms: 0 });
    if (left < 3000) { skip("timeout"); continue; }
    const p = prov[rung.provider];
    if (p && !p.enabled) { skip("skipped_off"); continue; }
    if (privacy === "private" && p && !p.private_ok) { skip("skipped_privacy"); continue; }
    if (p?.cooldown_until && Date.parse(p.cooldown_until) > Date.now()) { skip("rate_limited"); continue; }
    if (need > rung.maxIn) { skip("skipped_size"); continue; }
    if (p?.daily_cap && rung.provider !== "anthropic" && (await usedToday(rung.provider)) >= p.daily_cap) { skip("skipped_budget"); continue; }

    const t0 = Date.now();
    try {
      let c: Call;
      switch (rung.provider) {
        case "groq": c = await callGroq(rung.model, req, left, k); break;
        case "cloudflare": c = await callCloudflare(rung.model, req, left, k); break;
        case "local": c = await callLocal(rung.model, req, left); break;
        case "gemini": c = await callGemini(rung.model, req, left, k); break;
        case "openrouter": c = await callOpenRouter(rung.model, req, left, k); break;
        default: c = await callAnthropic(rung.model, req, left);
      }
      const ms = Date.now() - t0;
      let parsed: any;
      if (req.json) {
        try { parsed = parseJson(c.text); } catch {
          await log(req, rung.provider, c.model, "bad_json", ms, c, "reply was not JSON");
          tried.push({ provider: rung.provider, model: c.model, outcome: "bad_json", ms });
          continue;
        }
        const bad = req.validate?.(parsed) ?? null;
        if (bad) {
          await log(req, rung.provider, c.model, "invalid", ms, c, bad);
          tried.push({ provider: rung.provider, model: c.model, outcome: "invalid", ms });
          continue;
        }
      }
      await log(req, rung.provider, c.model, "ok", ms, c);
      tried.push({ provider: rung.provider, model: c.model, outcome: "ok", ms });
      return { text: c.text, json: parsed, model: c.model, provider: rung.provider, cost_usd: c.cost, tried };
    } catch (e) {
      const ms = Date.now() - t0;
      const f = e instanceof Fail ? e : new Fail("error", (e as Error).message);
      tried.push({ provider: rung.provider, model: rung.model, outcome: f.outcome, ms });
      if (f.outcome === "skipped_budget") { budgetHit = true; continue; }
      if (f.outcome.startsWith("skipped")) continue; // nothing was sent; not logged
      await log(req, rung.provider, rung.model, f.outcome, ms, undefined, f.message);
      if (f.outcome === "rate_limited" && rung.provider !== "anthropic") await cooldown(rung.provider, f.retryAfter, f.message);
    }
  }
  if (paid === "never") throw new LlmUnavailable("paid_never", tried);
  if (budgetHit) throw new LlmUnavailable("budget", tried);
  throw new LlmUnavailable("all_failed", tried);
}

/* ───────── canary (not part of the frozen interface; used by the free-llm function) ───────── */

/** One tiny JSON call straight to one provider, bypassing the ladder. Clears its cooldown when it works. */
export async function llmProbe(provider: Exclude<Provider, "anthropic">): Promise<{ provider: string; ok: boolean; model?: string; ms: number; error?: string }> {
  const k = await keys();
  const req: LlmRequest = { task: "classify", system: "You are a health check.", user: 'Return {"ok":true}', json: true, maxTokens: 200, job: "canary", fn: "free-llm" };
  const model = provider === "groq" ? M.groqSmall : provider === "cloudflare" ? M.cfBig : provider === "local" ? M.local
    : provider === "gemini" ? M.gemini : M.openrouter;
  const t0 = Date.now();
  try {
    const c = provider === "groq" ? await callGroq(model, req, 20_000, k)
      : provider === "cloudflare" ? await callCloudflare(model, req, 30_000, k)
      : provider === "local" ? await callLocal(model, req, 45_000)
      : provider === "gemini" ? await callGemini(model, req, 20_000, k) : await callOpenRouter(model, req, 20_000, k);
    const ms = Date.now() - t0;
    const j = parseJson(c.text);
    await log(req, provider, c.model, j?.ok === true ? "ok" : "invalid", ms, c);
    if (j?.ok === true) {
      await db().from("llm_providers").update({ cooldown_until: null, cooldown_reason: null }).eq("name", provider);
      return { provider, ok: true, model: c.model, ms };
    }
    return { provider, ok: false, model: c.model, ms, error: "unexpected reply" };
  } catch (e) {
    const ms = Date.now() - t0;
    const f = e instanceof Fail ? e : new Fail("error", (e as Error).message);
    if (!f.outcome.startsWith("skipped")) await log(req, provider, model, f.outcome, ms, undefined, f.message);
    return { provider, ok: false, ms, error: `${f.outcome}: ${f.message}`.slice(0, 200) };
  }
}
