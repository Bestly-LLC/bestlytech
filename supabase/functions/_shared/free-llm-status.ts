// _shared/free-llm-status.ts — plain-words status of the free AI ladder, and what to connect next.
//
// Pure functions only (no network, no Deno APIs, no imports) so admin-chat, the free-llm self-test and the deno tests can all use them.
// 2026-10-27 (Jared: "Scout should never [just say free AI is out of room]. He should be switching providers, and if he's out, he
// should suggest a new one for me to connect."): when every free rung has been tried and failed, Scout now says WHY per provider
// (real cause, real times in Pacific 12-hour), recommends ONE new free provider that does not train on prompts, and only offers
// paid AI if Jared has not said no to it in the thread.
//
// CANDIDATES below is the single source of truth for adapters (free-llm.ts reads url/model/keyName) and for the recommendation text.
// The SQL side (llm_candidates_autoconnect in the scout-free-fallback migration) keeps a matching list; the self-test compares them.

export interface ProviderRow {
  name: string;
  enabled?: boolean | null;
  private_ok?: boolean | null;
  cooldown_until?: string | null;
  cooldown_reason?: string | null;
  daily_cap?: number | null;
  last_ok_at?: string | null;
  last_error?: string | null;
  /** Plain-words reason a human wrote for a long outage (llm_providers.outage_note, added by the scout-free-fallback migration). Read, never hard-coded. */
  outage_note?: string | null;
}
/** need/max: tokens this step needs vs the rung's per-request ceiling (skipped_size). used/cap: requests today vs the daily allowance (skipped_budget). */
export interface TriedLite { provider: string; model: string; outcome: string; ms?: number; need?: number; max?: number; used?: number; cap?: number }
/** In-process hints from free-llm.ts (rateLimitHints): model -> epoch ms until which it sits out. */
export interface Hints { modelSkipUntil?: Record<string, number> }

/* ───────── candidates: free providers that do NOT train on prompts, best first ───────── */

export interface Candidate {
  name: string;            // llm_providers.name once connected
  label: string;           // what Jared reads
  kind: "free" | "trial";  // "free" = a plan that renews; "trial" = credits that run out
  keyName: string;         // Vault secret name (llm_keys() must list it)
  keyUrl: string;          // where he gets the key
  baseUrl: string;         // OpenAI-compatible chat completions URL
  model: string;           // default rung model (supports native tool calls)
  maxIn: number;           // input+output token ceiling used for the rung
  dailyCap: number;        // requests per day Scout allows itself (llm_providers.daily_cap), a little under the real limit
  why: string;             // one line, plain words: what it is and why it is safe
  freeTier: string;        // the limits, plain words
  policyUrls: string[];    // where the no-training statement lives
  checked: string;         // date the policy + limits were last read
}

export const CANDIDATES: Candidate[] = [
  {
    name: "sambanova", label: "SambaNova Cloud", kind: "free",
    keyName: "sambanova_api_key", keyUrl: "https://cloud.sambanova.ai/apis",
    baseUrl: "https://api.sambanova.ai/v1/chat/completions", model: "gpt-oss-120b", maxIn: 100_000, dailyCap: 18,
    why: "its terms limit use of your prompts to answering you and nothing else (no training), and the free plan needs no credit card",
    freeTier: "no card needed; 20 requests a minute, 20 a day, 200,000 tokens a day, on gpt-oss-120b, Llama 3.3 70B and DeepSeek V3.1",
    policyUrls: [
      "https://sambanova.ai/hubfs/23945802/PubSec/fast-api-program-tos.pdf",
      "https://community.sambanova.ai/t/data-handling-and-retention/1314",
      "https://docs.sambanova.ai/docs/en/models/rate-limits",
    ],
    checked: "2026-10-27",
  },
  {
    name: "cerebras", label: "Cerebras", kind: "trial",
    keyName: "cerebras_api_key", keyUrl: "https://cloud.cerebras.ai",
    baseUrl: "https://api.cerebras.ai/v1/chat/completions", model: "gpt-oss-120b", maxIn: 100_000, dailyCap: 400,
    why: "its terms say it gets no right to train on your prompts and its privacy policy says it keeps no inputs or outputs",
    freeTier: "a $5 trial credit for 30 days (needs a card on file), then pay as you go; gpt-oss-120b gets 1,000,000 tokens a day while it lasts",
    policyUrls: [
      "https://www.cerebras.ai/terms-of-service",
      "https://www.cerebras.ai/privacy-policy",
      "https://inference-docs.cerebras.ai/support/rate-limits",
    ],
    checked: "2026-10-27",
  },
];
// Looked at and left out (2026-10-27), so nobody re-researches them:
//   GitHub Models      retired July 30, 2026 (docs.github.com/en/github-models).
//   Mistral Experiment its help center says Experiment-plan API requests "may be used to train Mistral's models".
//   Google Gemini      free tier prompts are used to improve Google products (already in llm_providers, private_ok = false).
//   OpenRouter :free   some upstream hosts train on free prompts (already in llm_providers, private_ok = false).
//   NVIDIA NIM         free endpoints are logged and one-off credits only.
//   Ollama Cloud       no free usage included (pay as you go).
//   Cohere trial key   1,000 calls a month and no data-use page could be read.
//   Together, Hyperbolic, Fireworks: no renewing free plan.

/** Extra (non-core) providers the ladder can call once a key is in Vault and the provider row exists. */
export const EXTRA_PROVIDER_NAMES = CANDIDATES.map((c) => c.name);

/** First candidate that is not already a row in llm_providers (connected or not). */
export function pickCandidate(existing: string[]): Candidate | null {
  const have = new Set(existing.map((n) => n.toLowerCase()));
  return CANDIDATES.find((c) => !have.has(c.name)) ?? null;
}

/* ───────── time in plain words (Pacific, 12-hour) ───────── */

const PT = "America/Los_Angeles";
const dayKey = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: PT, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
const noSpace = (s: string) => s.replace(/[\u202f\u00a0 ]+(?=AM|PM)/g, "\u00a0").replace(/^([A-Za-z]{3}) (\d)/, "$1\u00a0$2");   // a number never wraps away from its unit (non-breaking space)
export const ptClock = (ms: number) => noSpace(new Date(ms).toLocaleTimeString("en-US", { timeZone: PT, hour: "numeric", minute: "2-digit" }));

/** "5:05 PM" for today, "yesterday at 5:05 PM", "tomorrow at 5:00 PM", else "Oct 24 at 5:05 PM". bare = drop "today at". */
export function ptWhen(ms: number, now = Date.now(), bare = false): string {
  const d = dayKey(ms), today = dayKey(now);
  if (d === today) return bare ? ptClock(ms) : `today at ${ptClock(ms)}`;
  if (d === dayKey(now - 86_400_000)) return `yesterday at ${ptClock(ms)}`;
  if (d === dayKey(now + 86_400_000)) return `tomorrow at ${ptClock(ms)}`;
  const md = noSpace(new Date(ms).toLocaleDateString("en-US", { timeZone: PT, month: "short", day: "numeric" }));
  return `${md} at ${ptClock(ms)}`;
}

/** "about 3 minutes" / "about 2 hours" / "under a minute". */
export function inWords(secs: number): string {
  if (secs < 60) return "under a minute";
  if (secs < 5400) return `about ${Math.round(secs / 60)} minute${Math.round(secs / 60) === 1 ? "" : "s"}`;
  const h = Math.round(secs / 3600);
  return `about ${h} hour${h === 1 ? "" : "s"}`;
}

/** 00:00 UTC after `now`. Cloudflare's free Neurons reset then (5:00 PM Pacific in summer, 4:00 PM in winter). */
export const nextUtcMidnight = (now = Date.now()) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); };

/** The timestamp llm_providers.last_error starts with ("2026-10-27T22:30:02.500Z error: ..."), and the outcome word after it. */
export function parseLastError(s: string | null | undefined): { at: number; outcome: string; message: string } | null {
  const m = String(s ?? "").match(/^(\d{4}-\d\d-\d\dT[\d:.]+Z)\s+([a-z_]+):\s*([\s\S]*)$/i);
  if (!m) return null;
  const at = Date.parse(m[1]);
  return Number.isFinite(at) ? { at, outcome: m[2].toLowerCase(), message: m[3] } : null;
}

/* ───────── per-provider reasons ───────── */

const LABEL: Record<string, string> = {
  freellm: "FreeLLM (the free AI server)", groq: "Groq", cloudflare: "Cloudflare", local: "The Mac mini's local AI",
  gemini: "Google Gemini", openrouter: "OpenRouter", anthropic: "Paid AI (Claude)",
  ...Object.fromEntries(CANDIDATES.map((c) => [c.name, c.label])),
};
export const providerLabel = (n: string) => LABEL[n] ?? n;

export interface Diagnosis { name: string; line: string; backAt?: number; down?: boolean; tooBig?: boolean; /** not waiting on anything: off, skipped on purpose, no key, or not for live chat */ excluded?: boolean }

const num = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** "about 9,400 tokens ... about 7,000" built from the numbers the ladder recorded; plain words when it recorded none. */
function sizeLine(lbl: string, sized: TriedLite[]): string {
  const need = Math.max(0, ...sized.map((t) => t.need ?? 0)), max = Math.max(0, ...sized.map((t) => t.max ?? 0));
  const nums = need && max ? ` It sends about ${num(Math.round(need / 100) * 100)} tokens (the tool list plus the chat so far) and the free plan allows about ${num(Math.round(max / 100) * 100)} per request.` : "";
  return `${lbl} cannot take this step: it is bigger than the free per-request limit.${nums} Waiting will not fix that, only a provider with a bigger window will.`;
}

const stripDot = (s: string) => s.trim().replace(/[.\s]+$/, "");
const FREELLM_UNREACHABLE = /resolve host|dns error|failed to lookup|error sending request|connection (refused|reset)|couldn'?t|could not|timed? ?out|unreachable/i;

/**
 * Why one provider did not answer, in plain words. Reads the llm_providers row, what this request tried, and (optionally) the
 * in-process sit-out times. `incident` is the newest incident note about the provider's host (bestly_memory), used only when
 * nobody wrote an outage_note on the row.
 */
export function diagnoseProvider(row: ProviderRow, tried: TriedLite[], now = Date.now(), hints: Hints = {}, incident?: string): Diagnosis {
  const name = row.name, lbl = providerLabel(name);
  const mine = tried.filter((t) => t.provider === name);
  const has = (o: string) => mine.some((t) => t.outcome === o);
  const err = parseLastError(row.last_error);
  const cooling = !!row.cooldown_until && Date.parse(row.cooldown_until) > now;
  if (row.enabled === false) return { name, excluded: true, line: `${lbl} is switched off.` };
  if (row.private_ok === false) return { name, excluded: true, line: `${lbl} is skipped on purpose: it can train on prompts, and Scout's work is private.` };
  if (has("skipped_nokey")) return { name, excluded: true, line: `${lbl} has no key saved yet.` };

  if (name === "freellm") {
    const note = stripDot(row.outage_note ?? "");
    const blob = `${row.cooldown_reason ?? ""} ${err?.message ?? ""}`;
    const unreachable = FREELLM_UNREACHABLE.test(blob) || has("timeout") || (has("error") && !has("rate_limited")) || /freellm_watch/i.test(row.cooldown_reason ?? "");
    if (note || unreachable) {
      const okAt = row.last_ok_at ? Date.parse(row.last_ok_at) : NaN;
      const since = Number.isFinite(okAt) ? ` since ${ptWhen(okAt, now)}` : "";
      const cause = /resolve host|dns error|failed to lookup/i.test(blob) ? "the cloud cannot find its server on the network"
        : /refused|reset/i.test(blob) ? "its server refused the connection"
        : /timed? ?out/i.test(blob) || has("timeout") ? "it stopped answering"
        : "the cloud cannot reach it";
      const why = note || (incident ? `${cause} (latest incident note: "${stripDot(incident)}")` : cause);
      return { name, down: true, line: `${lbl} has been offline${since}: ${why}.` };
    }
    if (has("rate_limited")) return { name, line: `${lbl} is up, but every model on it is rate-limited right now.` };
  }

  if (name === "cloudflare") {
    const dayStart = nextUtcMidnight(now) - 86_400_000;
    const capped = /^Daily free cap/i.test(row.cooldown_reason ?? "") || has("skipped_budget")
      || (!!err && err.at >= dayStart && /daily free allocation|neurons/i.test(err.message));
    if (capped) {
      const reset = nextUtcMidnight(now);
      const mineCap = mine.find((t) => t.outcome === "skipped_budget" && t.cap);
      const neuronsOut = /^Daily free cap/i.test(row.cooldown_reason ?? "") || (!!err && err.at >= dayStart && /daily free allocation|neurons/i.test(err.message));
      if (mineCap && !neuronsOut) {
        return { name, backAt: reset, line: `${lbl}: the ${num(mineCap.cap!)} requests a day I allow myself on its free plan are used up (${num(mineCap.used ?? mineCap.cap!)} so far); that resets at ${ptWhen(reset, now, true)}.` };
      }
      return { name, backAt: reset, line: `${lbl}'s daily free limit is used up; it resets at ${ptWhen(reset, now, true)}.` };
    }
  }

  const sized = mine.filter((t) => t.outcome === "skipped_size");
  if (name === "groq" && !has("rate_limited") && !has("skipped_budget") && sized.length) {
    return { name, tooBig: true, line: sizeLine(lbl, sized) };
  }
  if (name === "groq" && (has("rate_limited") || has("skipped_budget"))) {
    const models = [...new Set(mine.filter((t) => t.outcome === "rate_limited" || t.outcome === "skipped_budget").map((t) => t.model))];
    const untils = models.map((m) => hints.modelSkipUntil?.[m] ?? 0).filter((u) => u > now).sort((a, b) => a - b);
    const first = untils[0];
    const longWait = first && first - now > 30 * 60_000;
    const daily = longWait || /per day|tokens per day|\bTPD\b/i.test(err?.message ?? "") || has("skipped_budget");
    const n = models.length;
    const which = n === 1 ? "its one free model" : `all ${n} of its free models`;
    const line = daily
      ? `${lbl} used up today's free tokens on ${which}${first ? `; the first resets at ${ptWhen(first, now, true)}` : ""}.`
      : `${lbl}: ${which} ${n === 1 ? "is" : "are"} at the per-minute limit${first ? `; the first frees up in ${inWords(Math.max(1, (first - now) / 1000))}` : ", which clears within a few minutes"}.`;
    return { name, backAt: first, tooBig: sized.length > 0, line: sized.length ? `${line} This step is also over its per-request limit on some models, which waiting will not fix.` : line };
  }

  if (name === "local") return { name, excluded: true, line: `${lbl} is not used for live chat (it cannot call tools)${row.last_ok_at ? `; it last answered ${ptWhen(Date.parse(row.last_ok_at), now)}` : ""}.` };

  // Anything else, including a newly connected provider.
  if (has("skipped_budget")) {
    const b = mine.find((t) => t.outcome === "skipped_budget" && t.cap);
    return { name, line: `${lbl}'s free limit for today is used up${b ? ` (${num(b.used ?? b.cap!)} of the ${num(b.cap!)} requests a day I allow myself)` : ""}.` };
  }
  if (has("rate_limited")) return { name, line: `${lbl} is at its rate limit right now.` };
  if (has("timeout")) return { name, line: `${lbl} timed out.` };
  if (has("error") || has("invalid")) return { name, line: `${lbl} answered with an error${err ? ` (${stripDot(err.message).slice(0, 80)})` : ""}.` };
  if (has("skipped_size")) return { name, tooBig: true, line: sizeLine(lbl, sized) };
  if (cooling) return { name, line: `${lbl} is paused${row.cooldown_reason ? ` (${stripDot(row.cooldown_reason).slice(0, 80)})` : ""}.` };
  return { name, line: `${lbl} did not answer.` };
}

const ORDER = ["freellm", "groq", "cloudflare", ...EXTRA_PROVIDER_NAMES, "local", "gemini", "openrouter"];

export interface RoomInput {
  rows: ProviderRow[];
  tried: TriedLite[];
  now?: number;
  /** Jared has said no to paid AI in this thread: do not offer it. */
  noPaid: boolean;
  hints?: Hints;
  /** provider name -> title of the newest incident note about its host, from bestly_memory (fallback when outage_note is empty). */
  incidents?: Record<string, string>;
}
export interface RoomOut { text: string; options: string; backAt: number; candidate: Candidate | null; lines: Diagnosis[] }

const keepUnits = (s: string) => s.replace(/(\d) (AM|PM|minutes?|hours?|requests?|tokens?|days?|seconds?|GB|MB)\b/g, "$1 $2");

/**
 * The reply when every free rung has been tried and failed. Never "out of room" with nothing else: it says why per provider, names
 * ONE vetted new free provider to connect (with where to get the key), and offers paid AI only if he has not refused it.
 * No ellipses anywhere (house rule: never truncate text with "...").
 */
export function buildOutOfRoom(i: RoomInput): RoomOut {
  const now = i.now ?? Date.now();
  const byName = new Map(i.rows.map((r) => [r.name, r]));
  const names = [...ORDER.filter((n) => byName.has(n)), ...i.rows.map((r) => r.name).filter((n) => n !== "anthropic" && !ORDER.includes(n))];
  const lines = names.map((n) => diagnoseProvider(byName.get(n)!, i.tried, now, i.hints, i.incidents?.[n]));
  const times = lines.map((l) => l.backAt).filter((t): t is number => typeof t === "number" && t > now + 60_000).sort((a, b) => a - b);
  const backAt = times[0] ?? now + 30 * 60_000;
  const candidate = pickCandidate(i.rows.map((r) => r.name));
  const parts: string[] = [
    "I tried every free AI provider I have and none can answer right now. Here is exactly why:",
    lines.map((l) => `- ${l.line}`).join("\n"),
  ];
  const tooBig = lines.some((l) => l.tooBig);
  if (candidate) {
    parts.push(`Best new one to connect: ${candidate.label}${candidate.kind === "trial" ? " (a trial, not a renewing free plan)" : ""}. Why it is safe: ${candidate.why}. What you get: ${candidate.freeTier}. `
      + `${tooBig ? `It also takes up to ${num(candidate.maxIn)} tokens per request, so it fixes the size problem above. ` : ""}`
      + `Get a key at ${candidate.keyUrl}, save it in Supabase Vault as ${candidate.keyName}, and I switch it on within 10 minutes.`);
  } else {
    parts.push("Every provider on my vetted no-training list is already connected. Say the word and I will research the next one.");
  }
  if (!i.noPaid) parts.push("Paid AI costs about 5 to 50 cents; yes turns the Paid AI switch on for one hour, then it turns itself off.");
  const back = ptWhen(backAt, now, true);
  const options = i.noPaid ? `OPTIONS: Wait and retry at ${back} | Check what's using the free AI` : `OPTIONS: Use paid AI for this one | Wait and retry at ${back}`;
  return { text: keepUnits(parts.join("\n\n")), options, backAt, candidate, lines };
}

/** What the self-test and the unit tests assert about a built message. Returns the list of problems (empty = good). */
export function checkRoomMessage(out: RoomOut, opts: { noPaid: boolean; expectOffline?: string }): string[] {
  const bad: string[] = [];
  const t = out.text;
  if (/undefined|NaN|\[object|\.\.\.|…/.test(t + out.options)) bad.push("has undefined/NaN/ellipsis");
  if (!out.lines.length) bad.push("no per-provider reasons");
  if (out.candidate && !(t.includes(out.candidate.keyUrl) && t.includes(out.candidate.keyName))) bad.push("recommendation lacks key url/name");
  if (!/\b(AM|PM)\b/.test(t + out.options)) bad.push("no 12-hour time");
  if (/\b(1[3-9]|2[0-3]):\d\d\b/.test(t + out.options)) bad.push("24-hour time");
  if (opts.noPaid && /paid ai/i.test(t.replace(/Paid AI \(Claude\)/g, ""))) bad.push("offers paid AI after a no");
  if (!opts.noPaid && !/Use paid AI/.test(out.options)) bad.push("paid option missing");
  if (opts.expectOffline && !out.lines.some((l) => l.name === opts.expectOffline && l.down)) bad.push(`${opts.expectOffline} not reported offline`);
  return bad;
}


/* ───────── 2026-10-28: Scout's own status text must never come back as a model's answer ───────── */

/**
 * An assistant message that is Scout's own status note (not something the model said and not something Jared needs the model to see):
 * progress notes, "Worked N steps", the out-of-room / waiting messages, stopped notes. Dropped from the context before ANY model call.
 * Live case Oct 28, 1:52 PM: FreeLLM answered fine, but the thread's context held "Free AI is out of room until 2:16 PM. Please choose to
 * use paid AI or wait." and the model copied it back as its reply.
 */
const STATUS_NOTE: RegExp[] = [
  /^\s*(Working:|Worked \d+ steps|Stopped after \d+ steps?:)/i,
  /^\s*Free AI is out of room/i,
  /^\s*Waiting for the free AI/i,
  /I tried every free AI provider I have/i,
  /^\s*Free AI tried \d+ times and it did not work/i,
  /^\s*Free AI stopped making progress/i,
  /^\s*My last step came back as working notes/i,
];
export const isStatusNote = (body: unknown): boolean => STATUS_NOTE.some((r) => r.test(String(body ?? "")));

/** The thread rows a model may see: Scout's status notes removed, and (for free models) the OPTIONS button lines too. */
export function cleanHistory<T extends { role: string; body: string }>(rows: T[], opts: { stripOptions?: boolean } = {}): T[] {
  const out: T[] = [];
  for (const m of rows) {
    if (m.role === "assistant") {
      if (isStatusNote(m.body)) continue;
      if (opts.stripOptions) {
        const body = String(m.body ?? "").replace(/^\s*OPTIONS:.*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
        if (!body) continue;
        out.push({ ...m, body });
        continue;
      }
    }
    out.push(m);
  }
  return out;
}

/** A model reply that is Scout's out-of-room text or the old "use paid AI or wait" choice. Never an answer: the ladder moves to the next rung. */
const PARROT: RegExp[] = [
  /free AI is out of room/i,
  /tried every free AI provider I have/i,
  /none can answer right now/i,
  /^\s*Working:/i,
  /waiting for the free AI to free up/i,
  /\bpaid AI\b[^.\n]{0,60}\bor (wait|retry)\b/i,
  /\b(wait|retry)\b[^.\n]{0,40}\bor (use |choose |switch to )?paid AI\b/i,
  /\bplease (choose|pick|select)\b[^.\n]{0,60}\bpaid AI\b/i,
  /^\s*OPTIONS:\s*(Yes, )?use paid AI/im,
  /wait and retry at/i,
];
export const looksLikeStatusParrot = (text: unknown): boolean => PARROT.some((r) => r.test(String(text ?? "")));

/**
 * The single, short, in-place status for a run that cannot get an answer from any free provider right now. It is the "Working:" note
 * itself (edited in place), so there is never a dead end and never a button: what each provider is waiting on, the one provider to
 * connect, and a promise the run picks itself back up. No paid offer (Jared: "he should never tell me no, only switch providers").
 */
export function waitingNote(room: RoomOut, steps: number): string {
  const waits = room.lines.filter((l) => !l.excluded).map((l) => `- ${l.line}`);
  const parts = [`Working: waiting for the free AI (${steps} ${steps === 1 ? "step" : "steps"}). I try every provider again by myself and carry on the moment one answers.`];
  if (waits.length) parts.push(waits.join("\n"));
  const c = room.candidate;
  if (c) parts.push(`To add room now, connect ${c.label}: get a key at ${c.keyUrl} and save it in Supabase Vault as ${c.keyName}. I switch it on within 10 minutes.`);
  return keepUnits(parts.join("\n"));
}

/** How long a parked run sleeps before it tries again: when the first provider is due back, but never under 1 minute or over 5. */
export function parkDelayMs(room: RoomOut, now = Date.now()): number {
  const until = room.backAt - now;
  return Math.min(5 * 60_000, Math.max(60_000, Number.isFinite(until) ? until : 5 * 60_000));
}
