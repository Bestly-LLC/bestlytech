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

export type LlmTask = "judge" | "pick" | "extract" | "triage" | "write" | "reflect" | "classify" | "summarize" | "code";
export type LlmPrivacy = "private" | "public";
type Provider = "groq" | "cloudflare" | "local" | "gemini" | "openrouter" | "freellm" | "anthropic";
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
  groqQwen: "qwen/qwen3.8-27b",       // v2 (2026-09-27): Groq's limits are per model, so each extra model is another 8K tokens/min

  cfBig: "@cf/openai/gpt-oss-120b",
  local: "qwen3:8b",
  gemini: "gemini-2.5-flash-lite",
  openrouter: "nvidia/nemotron-3-super-120b-a12b:free",
  freellm: "auto",
  freellmCode: "qwen2.5-coder-32b-instruct", // FreeLLM's dedicated coding agent; used for task=code
};
// Estimated input+output ceilings per rung. Groq free = 8K tokens/min PER MODEL, so prompt + output must fit.
// v2: LOCAL_MAX follows the Mac mini worker's num_ctx (8192, scripts/partner-ai/worker.py); it was 3000, which shut it out.
const GROQ_MAX = 7000, LOCAL_MAX = 7000, CF_MAX = 120_000, GEMINI_MAX = 200_000, OR_MAX = 100_000, FREELLM_MAX = 120_000;

// Cloudflare Neurons per 1M tokens [in, out] (pricing page 2026-09-23: $0.011 per 1K Neurons).
const CF_NEURONS: Record<string, [number, number]> = {
  "@cf/openai/gpt-oss-120b": [31_818, 68_182],
  "@cf/openai/gpt-oss-20b": [18_182, 27_273],
  "@cf/qwen/qwen3-30b-a3b-fp8": [4_625, 30_475],
};
const ANTHROPIC_PRICE: Record<string, [number, number]> = { haiku: [1, 5], sonnet: [3, 15], opus: [15, 75] };

function routes(task: LlmTask, privacy: LlmPrivacy): Rung[] {
  // v30 (2026-10-03): Groq/Cloudflare first (proven), then Gemini, OpenRouter, FreeLLM, then the Mac mini.
  // FreeLLM used to go first, but it lives on the Mac mini behind a private Tailscale address the cloud cannot
  // reach, so it only runs once freellm_base_url (a public https tunnel) is in Vault. Rungs without a key skip in 0 ms.
  const freellmRung: Rung = { provider: "freellm", model: M.freellm, maxIn: FREELLM_MAX };
  const freellmCodeRung: Rung = { provider: "freellm", model: M.freellmCode, maxIn: FREELLM_MAX };
  const tail: Rung[] = [
    { provider: "gemini", model: M.gemini, maxIn: GEMINI_MAX },
    { provider: "openrouter", model: M.openrouter, maxIn: OR_MAX },
    freellmRung,
    { provider: "local", model: M.local, maxIn: LOCAL_MAX },
  ];
  switch (task) {
    case "code":
      // Coding agent first, then general FreeLLM, then Groq's best, then the rest.
      return [{ provider: "groq", model: M.groqBig, maxIn: GROQ_MAX }, { provider: "cloudflare", model: M.cfBig, maxIn: CF_MAX },
        freellmCodeRung, ...tail];
    case "judge":
    case "pick":
      return [{ provider: "groq", model: M.groqBig, maxIn: GROQ_MAX }, { provider: "groq", model: M.groqQwen, maxIn: GROQ_MAX },
        { provider: "cloudflare", model: M.cfBig, maxIn: CF_MAX }, ...tail];
    case "classify":
      return [{ provider: "groq", model: M.groqSmall, maxIn: GROQ_MAX }, { provider: "groq", model: M.groqQwen, maxIn: GROQ_MAX },
        { provider: "cloudflare", model: M.cfBig, maxIn: CF_MAX }, ...tail];
    case "write":
      return [{ provider: "cloudflare", model: M.cfBig, maxIn: CF_MAX }, ...tail];
    default: // extract, reflect, triage, summarize
      return [{ provider: "groq", model: M.groqBig, maxIn: GROQ_MAX }, { provider: "groq", model: M.groqQwen, maxIn: GROQ_MAX },
        { provider: "cloudflare", model: M.cfBig, maxIn: CF_MAX }, ...tail];
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
  const raw = (!error && data && typeof data === "object") ? data as Record<string, string> : {};
  // People paste more than the key (Cloudflare's "test this token" curl line, quotes, spaces): keep only the key itself.
  const pick = (val: string | undefined, re: RegExp) => { const m = (val ?? "").match(re); return m ? m[0] : (val ?? "").trim(); };
  const v: Record<string, string> = { ...raw };
  if (raw.groq_api_key) v.groq_api_key = pick(raw.groq_api_key, /gsk_[A-Za-z0-9]{20,}/);
  if (raw.cloudflare_ai_token) v.cloudflare_ai_token = pick(raw.cloudflare_ai_token, /cfut_[A-Za-z0-9_\-]{20,}|(?<![A-Za-z0-9_\-])[A-Za-z0-9_\-]{40}(?![A-Za-z0-9_\-])/);
  if (raw.cloudflare_account_id) v.cloudflare_account_id = pick(raw.cloudflare_account_id, /[0-9a-f]{32}/);
  if (raw.gemini_api_key) v.gemini_api_key = pick(raw.gemini_api_key, /AIza[0-9A-Za-z_\-]{30,}/);
  if (raw.openrouter_api_key) v.openrouter_api_key = pick(raw.openrouter_api_key, /sk-or-[A-Za-z0-9_\-]{20,}/);
  if (raw.freellm_api_key) v.freellm_api_key = pick(raw.freellm_api_key, /freellmapi-[A-Za-z0-9]{20,}/);
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

/**
 * v2 (2026-09-27): Groq limits are per MODEL (8K tokens/min, 1000 req/day each). A 429 on one model used to pause
 * all of Groq for a minute, so Scout fell to Cloudflare (or asked for paid AI) while two other Groq models sat idle.
 * Now a Groq 429 only benches that model: for its retry-after on a per-minute limit, an hour on a per-day one.
 */
const modelSkip = new Map<string, number>();
async function rateLimited(rung: Rung, f: Fail) {
  if (rung.provider === "groq") {
    const daily = /per day|\b(TPD|RPD)\b/i.test(f.message);
    const tooBig = /request too large/i.test(f.message);
    const wait = Number(f.message.match(/try again in ([\d.]+)s/i)?.[1] ?? NaN);
    const secs = daily ? 3600 : tooBig ? 60 : Number.isFinite(wait) ? Math.max(1, Math.min(wait + 0.5, 120)) : Math.max(5, Math.min(f.retryAfter || 20, 120));
    modelSkip.set(rung.model, Date.now() + secs * 1000);
    return;
  }
  await cooldown(rung.provider, f.retryAfter, f.message);
}

const SECRET_RE = /(sk-ant-[A-Za-z0-9_\-]{10,}|sk-[A-Za-z0-9_\-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sb_secret_[A-Za-z0-9_\-]{10,}|gsk_[A-Za-z0-9]{20,}|cfut_[A-Za-z0-9_\-]{10,}|AIza[0-9A-Za-z_\-]{30,}|xox[abpr]-[A-Za-z0-9\-]{10,}|eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,})/g;
// A long value right after a key-ish word ("api_key": "...", password=..., Bearer ...).
const LABELLED_RE = /((?:api[_-]?key|secret|token|password|passwd|bearer|authorization)["'\s]*[:=]?\s*["']?)([A-Za-z0-9_\-.\/+=]{16,})/gi;
export function scrub(s: string): string {
  return s.replace(SECRET_RE, "[secret]").replace(LABELLED_RE, (_m, a) => `${a}[secret]`);
}

const estTokens = (s: string) => Math.ceil(s.length / 3.5);

function stripThink(t: string) {
  return t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

/**
 * gpt-oss (Groq + Cloudflare) sometimes leaves `content` empty and puts its answer elsewhere:
 * a native tool call (even with no tools offered), or only the reasoning field. Recover it instead of failing -
 * 2026-09-24 these "empty reply" misses tripped the provider watchdog on both rungs while both were healthy.
 */
function salvage(msg: any): string {
  const text = stripThink(String(msg?.content ?? ""));
  if (text) return text;
  const tc = msg?.tool_calls?.[0]?.function;
  if (tc?.name) {
    let args: unknown = {};
    try { args = typeof tc.arguments === "string" ? JSON.parse(tc.arguments || "{}") : (tc.arguments ?? {}); } catch { args = {}; }
    return JSON.stringify({ tool: String(tc.name).replace(/^functions\./, ""), args });
  }
  const r = String(msg?.reasoning ?? msg?.reasoning_content ?? "");
  const objs = r.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g);
  for (const o of (objs ?? []).reverse()) { try { JSON.parse(o); return o; } catch { /* next */ } }
  return "";
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
  // Error text can echo request headers (e.g. "Invalid header value: Bearer ..."): never let a key reach a log.
  constructor(public outcome: Outcome, msg: string, public retryAfter = 0) { super(scrub(msg).replace(/Bearer\s+\S+/gi, "Bearer [secret]")); }
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
  const text = salvage(j.choices?.[0]?.message);
  if (!text) throw new Fail("error", `empty reply (finish ${j.choices?.[0]?.finish_reason ?? "?"})`);
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
    k.cloudflare_ai_token, model, req, Math.min(t, 110_000), // big prompts (reflect: ~30K tokens) need more than a minute
    model.includes("gpt-oss") ? { reasoning_effort: "low" } : {}); // v2: default effort burned Neurons and time on long reasoning
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

/** FreeLLM's chat URL. It runs on the Mac mini; the cloud can only reach it through a public tunnel (Vault freellm_base_url).
 *  A private / Tailscale / LAN address would hang every call until the timeout, so those are skipped instantly. */
function freellmUrl(k: Record<string, string>): string {
  if (!k.freellm_api_key) throw new Fail("skipped_nokey", "no freellm_api_key");
  const base = (k.freellm_base_url ?? "").trim().replace(/\/+$/, "").replace(/\/v1$/, "");
  if (!/^https:\/\//i.test(base)) throw new Fail("skipped_off", "no public freellm_base_url (needs an https tunnel to the Mac mini)");
  if (/^https:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/i.test(base)) {
    throw new Fail("skipped_off", "freellm_base_url is a private address the cloud cannot reach");
  }
  return `${base}/v1/chat/completions`;
}

async function callFreeLLM(model: string, req: LlmRequest, t: number, k: Record<string, string>): Promise<Call> {
  return openaiCompat(freellmUrl(k), k.freellm_api_key, model, req, Math.min(t, 30_000));
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

/** Functions governed by Scout's Paid AI switch (keep in sync with public.scout_paid_fns()). Spark/Cookie Yeti are not. */
const SCOUT_FNS = new Set(["admin-chat", "voice-ask", "fix-ladder", "scout-daily", "todo-check", "free-llm"]);

async function callAnthropic(model: string, req: LlmRequest, t: number): Promise<Call> {
  const key = cleanAnthropicKey(Deno.env.get("ANTHROPIC_API_KEY"));
  if (!key) throw new Fail("skipped_nokey", "no ANTHROPIC_API_KEY");
  const { data: budget } = await db().rpc("ai_budget", { p_scope: req.scope ?? "background" });
  if ((budget as any)?.ok === false) {
    throw new Fail("skipped_budget", (budget as any).switch_off ? "Paid AI switch is off" : `cap $${(budget as any).cap}, spent $${(budget as any).spent}`);
  }
  // v30: Scout's own functions (voice, autopilot, chat) spend only while the Paid AI switch is ON. It overrides everything.
  if (SCOUT_FNS.has(req.fn ?? "")) {
    const { data: st } = await db().rpc("scout_paid_state_ro");
    if ((st as any)?.on !== true) throw new Fail("skipped_budget", "Paid AI switch is off");
  }
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
  // 2026-09-24: a paused (cooled-down) provider is skipped - except in a live chat, where Jared is waiting: if every
  // free rung was skipped only for being paused, try them once anyway before giving up (pauses can be false alarms).
  const cooled: Rung[] = [];
  for (let pass = 0; pass < 2; pass++) {
  const rungs = pass === 0 ? ladder : (req.scope === "chat" && !tried.some((x) => x.outcome === "ok") ? cooled : []);
  for (const rung of rungs) {
    const left = deadline - Date.now();
    const skip = (outcome: Outcome) => tried.push({ provider: rung.provider, model: rung.model, outcome, ms: 0 });
    if (left < 3000) { skip("timeout"); continue; }
    const p = prov[rung.provider];
    if (p && !p.enabled) { skip("skipped_off"); continue; }
    if (privacy === "private" && p && !p.private_ok) { skip("skipped_privacy"); continue; }
    if (pass === 0 && p?.cooldown_until && Date.parse(p.cooldown_until) > Date.now()) { cooled.push(rung); skip("rate_limited"); continue; }
    if ((modelSkip.get(rung.model) ?? 0) > Date.now()) { skip("rate_limited"); continue; }
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
        case "freellm": c = await callFreeLLM(rung.model, req, left, k); break;
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
      if (f.outcome === "rate_limited" && rung.provider !== "anthropic") await rateLimited(rung, f);
    }
  }
  }
  if (paid === "never") throw new LlmUnavailable("paid_never", tried);
  if (budgetHit) throw new LlmUnavailable("budget", tried);
  throw new LlmUnavailable("all_failed", tried);
}

/* ───────── chat with native tools (v2, 2026-09-27) ───────── */

/**
 * Multi-turn chat with real OpenAI-style function calling, free rungs only (never paid).
 *
 * Why: Scout's free agent used to describe its tools in prose and ask for one JSON object per step. gpt-oss is trained
 * to call tools natively, so it often emitted a native call the request never declared, and the provider dropped it:
 * content came back empty ("empty reply (finish stop)") - about 1 in 4 free calls failed that way on 2026-09-24..27,
 * and every failure became a paid-AI ask. With `tools` declared, Groq and Cloudflare return real `tool_calls`
 * (verified 2026-09-27 on gpt-oss-120b, gpt-oss-20b, qwen3.8-27b and Cloudflare gpt-oss-120b), and the tool schemas
 * cost a fraction of the old prose docs.
 *
 * Ladder: Groq gpt-oss-120b -> Groq Qwen -> Groq gpt-oss-20b -> Cloudflare gpt-oss-120b. Each Groq model has its own
 * 8K tokens/min, so rotating triples the headroom before Cloudflare's daily Neurons get touched.
 */
export interface ChatToolCall { id: string; name: string; args: Record<string, unknown>; raw: string }
export interface ChatRequest {
  messages: Record<string, unknown>[];
  tools?: Record<string, unknown>[];
  toolChoice?: "auto" | "none";
  maxTokens?: number;
  deadlineMs?: number;
  job: string;
  ref?: string | null;
  fn?: string;
  scope?: "background" | "chat";
}
export interface ChatResult { content: string; toolCalls: ChatToolCall[]; provider: Provider; model: string; tried: LlmResult["tried"] }

// v30 (2026-10-03): Groq's three models and Cloudflare's 10K Neurons run dry by midday, and this ladder stopped there,
// so every turn after that became a paid-AI ask. Gemini, OpenRouter and FreeLLM now follow; each skips in 0 ms until its key
// (and, for FreeLLM, a public freellm_base_url) is in Vault.
const CHAT_LADDER: Rung[] = [
  { provider: "groq", model: M.groqBig, maxIn: GROQ_MAX },
  { provider: "groq", model: M.groqQwen, maxIn: GROQ_MAX },
  { provider: "groq", model: M.groqSmall, maxIn: GROQ_MAX },
  { provider: "cloudflare", model: M.cfBig, maxIn: CF_MAX },
  { provider: "gemini", model: M.gemini, maxIn: GEMINI_MAX },
  { provider: "openrouter", model: M.openrouter, maxIn: OR_MAX },
  { provider: "freellm", model: M.freellm, maxIn: FREELLM_MAX },
];

async function postChat(url: string, key: string, body: Record<string, unknown>, timeoutMs: number): Promise<any> {
  let r: Response;
  try {
    r = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new Fail((e as Error).name === "TimeoutError" ? "timeout" : "error", (e as Error).message);
  }
  if (r.status === 429) {
    const ra = Number(r.headers.get("retry-after")) || 60;
    throw new Fail("rate_limited", `429 ${(await r.text()).slice(0, 200)}`, ra);
  }
  if (!r.ok) throw new Fail("error", `${r.status} ${(await r.text()).slice(0, 240)}`);
  return await r.json();
}

/** Cloudflare's schema wants every message content to be a string (null on a tool-call turn is a 400). */
function forCloudflare(messages: Record<string, unknown>[]) {
  return messages.map((m) => (m.content == null ? { ...m, content: "" } : m));
}

export async function llmChat(input: ChatRequest): Promise<ChatResult> {
  // Groq's per-minute budgets refill in seconds: when every rung is only rate-limited, wait for the first to free up
  // (inside the caller's deadline) instead of failing the whole turn. Up to 3 passes.
  const deadline = Date.now() + (input.deadlineMs ?? 45_000);
  let last: unknown;
  for (let pass = 0; pass < 3; pass++) {
    try { return await llmChatOnce({ ...input, deadlineMs: deadline - Date.now() }); } catch (e) { last = e; }
    const tried = (last as LlmUnavailable)?.tried ?? [];
    if (tried.some((t) => t.outcome === "ok" || t.outcome === "invalid" || t.outcome === "error" || t.outcome === "timeout")) break;
    const soonest = Math.min(...[...modelSkip.values()].filter((t) => t > Date.now()));
    const wait = soonest - Date.now();
    if (!Number.isFinite(wait) || wait > 20_000 || Date.now() + wait + 8000 > deadline) break;
    await new Promise((ok) => setTimeout(ok, wait + 250));
  }
  throw last;
}

async function llmChatOnce(input: ChatRequest): Promise<ChatResult> {
  const messages = input.messages.map((m) => (typeof m.content === "string" ? { ...m, content: scrub(m.content as string) } : m));
  const maxTokens = input.maxTokens ?? 1200;
  const deadline = Date.now() + (input.deadlineMs ?? 45_000);
  const need = estTokens(JSON.stringify(messages) + JSON.stringify(input.tools ?? [])) + maxTokens;
  const logReq: LlmRequest = { task: "judge", system: "", user: "", job: input.job, ref: input.ref ?? null, fn: input.fn, scope: input.scope ?? "chat" };
  const tried: LlmResult["tried"] = [];
  const [prov, k] = await Promise.all([providers(), keys()]);

  for (const rung of CHAT_LADDER) {
    const left = deadline - Date.now();
    const skip = (outcome: Outcome) => tried.push({ provider: rung.provider, model: rung.model, outcome, ms: 0 });
    if (left < 3000) { skip("timeout"); continue; }
    const p = prov[rung.provider];
    if (p && !p.enabled) { skip("skipped_off"); continue; }
    if (p && !p.private_ok) { skip("skipped_privacy"); continue; }
    // Provider pauses (free_llm_watch) are ignored here on purpose: Jared is waiting in a live chat, a paused rung
    // costs one quick request, and false pauses were a main reason Scout asked for paid AI (scout_free_watch lifts them).
    if ((modelSkip.get(rung.model) ?? 0) > Date.now()) { skip("rate_limited"); continue; }
    if (need > rung.maxIn) { skip("skipped_size"); continue; }
    if (p?.daily_cap && (await usedToday(rung.provider)) >= p.daily_cap) { skip("skipped_budget"); continue; }

    const gptOss = rung.model.includes("gpt-oss");
    const body: Record<string, unknown> = {
      model: rung.model,
      messages: rung.provider === "groq" ? messages : forCloudflare(messages), // Cloudflare + Gemini want string content
      max_tokens: maxTokens,
      ...(gptOss ? { reasoning_effort: "low" } : {}),
    };
    if (input.tools?.length) { body.tools = input.tools; body.tool_choice = input.toolChoice ?? "auto"; }

    const t0 = Date.now();
    try {
      let j: any;
      if (rung.provider === "groq") {
        if (!k.groq_api_key) throw new Fail("skipped_nokey", "no groq_api_key");
        j = await postChat("https://api.groq.com/openai/v1/chat/completions", k.groq_api_key, body, Math.min(left, 25_000));
      } else if (rung.provider === "freellm") {
        j = await postChat(freellmUrl(k), k.freellm_api_key, body, Math.min(left, 30_000));
      } else if (rung.provider === "gemini") {
        if (!k.gemini_api_key) throw new Fail("skipped_nokey", "no gemini_api_key");
        j = await postChat("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", k.gemini_api_key, body, Math.min(left, 30_000));
      } else if (rung.provider === "openrouter") {
        if (!k.openrouter_api_key) throw new Fail("skipped_nokey", "no openrouter_api_key");
        j = await postChat("https://openrouter.ai/api/v1/chat/completions", k.openrouter_api_key, body, Math.min(left, 30_000));
      } else {
        if (!k.cloudflare_ai_token || !k.cloudflare_account_id) throw new Fail("skipped_nokey", "no cloudflare token/account");
        j = await postChat(`https://api.cloudflare.com/client/v4/accounts/${k.cloudflare_account_id}/ai/v1/chat/completions`, k.cloudflare_ai_token, body, Math.min(left, 60_000));
      }
      const ms = Date.now() - t0;
      const msg = j.choices?.[0]?.message ?? {};
      const toolCalls: ChatToolCall[] = ((msg.tool_calls ?? []) as any[]).filter((c) => c?.function?.name).map((c, i) => {
        const raw = typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments ?? {});
        let args: Record<string, unknown> = {};
        try { const a = JSON.parse(raw || "{}"); if (a && typeof a === "object") args = a; } catch { /* keep {} */ }
        return { id: String(c.id ?? `call_${Date.now()}_${i}`), name: String(c.function.name).replace(/^functions\./, ""), args, raw: raw || "{}" };
      });
      const content = stripThink(String(msg.content ?? "")).trim();
      const inT = Number(j.usage?.prompt_tokens ?? 0), outT = Number(j.usage?.completion_tokens ?? 0);
      const c: Call = { text: content, model: String(j.model ?? rung.model), inT, outT, cost: 0 };
      if (rung.provider === "cloudflare") { const [ni, no] = CF_NEURONS[rung.model] ?? [40_000, 80_000]; c.units = Number(j.usage?.neurons) || (inT * ni + outT * no) / 1e6; }
      if (!content && !toolCalls.length) {
        // A blank turn is the model's miss, not the provider's: "invalid" keeps free_llm_watch from pausing a healthy provider.
        await log(logReq, rung.provider, c.model, "invalid", ms, c, `empty reply (finish ${j.choices?.[0]?.finish_reason ?? "?"})`);
        tried.push({ provider: rung.provider, model: c.model, outcome: "invalid", ms });
        continue;
      }
      await log(logReq, rung.provider, c.model, "ok", ms, c);
      tried.push({ provider: rung.provider, model: c.model, outcome: "ok", ms });
      return { content, toolCalls, provider: rung.provider, model: c.model, tried };
    } catch (e) {
      const ms = Date.now() - t0;
      const f = e instanceof Fail ? e : new Fail("error", (e as Error).message);
      tried.push({ provider: rung.provider, model: rung.model, outcome: f.outcome, ms });
      if (f.outcome.startsWith("skipped")) continue;
      await log(logReq, rung.provider, rung.model, f.outcome, ms, undefined, f.message);
      if (f.outcome === "rate_limited") await rateLimited(rung, f);
    }
  }
  throw new LlmUnavailable("all_failed", tried);
}

/* ───────── canary (not part of the frozen interface; used by the free-llm function) ───────── */

/** One tiny JSON call straight to one provider, bypassing the ladder. Clears its cooldown when it works. */
export async function llmProbe(provider: Exclude<Provider, "anthropic">): Promise<{ provider: string; ok: boolean; model?: string; ms: number; error?: string }> {
  const k = await keys();
  const req: LlmRequest = { task: "classify", system: "You are a health check.", user: 'Return {"ok":true}', json: true, maxTokens: 200, job: "canary", fn: "free-llm" };
  const model = provider === "groq" ? M.groqSmall : provider === "cloudflare" ? M.cfBig : provider === "local" ? M.local
    : provider === "gemini" ? M.gemini : provider === "freellm" ? M.freellm : M.openrouter;
  const t0 = Date.now();
  try {
    const c = provider === "groq" ? await callGroq(model, req, 20_000, k)
      : provider === "cloudflare" ? await callCloudflare(model, req, 30_000, k)
      : provider === "local" ? await callLocal(model, req, 45_000)
      : provider === "gemini" ? await callGemini(model, req, 20_000, k)
      : provider === "freellm" ? await callFreeLLM(model, req, 20_000, k) : await callOpenRouter(model, req, 20_000, k);
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
