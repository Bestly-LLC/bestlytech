# Scout on free LLMs — plan (not built)

Written 2026-09-23 (Cowork, Opus).

**Status 2026-09-23 night — phase 1 BUILT and live:** `_shared/free-llm.ts` (interface §3, unchanged), edge fn `free-llm` v1 (ops canary / test / run), migration `20260923230000_free_llm_phase1.sql` (llm_providers, ai_spend provider/ok/ms/free_units/outcome, ai_spend_mix_today, llm_keys, llm_key_set, llm_shadow, free_llm_watch), crons `free-llm-watch` (every 15 min) and `free-llm-canary` (12:30 UTC = 5:30 AM PDT). Self-test passed on the Mac mini rung (qwen3:8b, 6–11 s): scrub, JSON judge, privacy default, size skip, paid-never. **Waiting on the 3 Vault secrets (§5)**; until then Groq/Cloudflare rungs report `skipped_nokey` and incident `ai.free.keys` stays open. scout-daily, admin-chat and the to-do UI are untouched (phases 2–4).
Owner of `supabase/functions/_shared/free-llm.ts`: **this plan**. The to-do "Check if it's done" chat (`docs/todo-check-opusplan.md`) consumes it and must not edit it.

## TL;DR

- **Most of Scout can run free, on providers that do not train on our data.** Two signups (Groq, a Cloudflare API token), about 5 minutes, no card.
- **Chain (private data):** Groq → Cloudflare Workers AI → Mac mini Ollama (already running, `qwen3:8b`) → Claude Haiku (paid, under `ai_budget`).
- **Free-safe jobs:** morning picks, reflect, call to-dos (after a 1-week shadow test), the chat's triage step, todo-check "judge".
- **Stays on Claude:** writing the email drafts (free model only picks which emails need a reply), and Scout's tool-using chat/autopilot loop (free model only for triage and read-only answers).
- **Never on a training provider** (Gemini free, OpenRouter `:free`, Mistral free): email, iMessage/SMS, call transcripts, customer/guest/client info, money, health. In practice Scout never uses them; the helper allows them only for `privacy: "public"`.
- **Honest math:** background jobs already cost pennies a day on Haiku. The real spend was the Sonnet chat loop (credit ran out 9:25 PM Sep 22). Free triage in front of the chat is where the money is.

---

## 1. Free tiers checked today (2026-09-23)

Verified against each provider's own docs today. Numbers change, so the helper reads 429s and cooldowns and does not trust these numbers.

| Provider | Free, no card | Limits (free) | Trains on prompts? | Commercial use | Use for Scout |
|---|---|---|---|---|---|
| **Groq** (`api.groq.com/openai/v1`, OpenAI-compatible) | Yes | gpt-oss-120b / gpt-oss-20b / qwen3.8-27b: 30 RPM, 1,000 RPD, **8K tokens/min**, 200K tokens/day; 131k context | No retention by default ("By default, Groq does not retain customer data for inference requests"); up to 30 days only for abuse/reliability. No training stated. | No restriction found | **Yes, private OK.** Short prompts only (≤ ~6K tokens because of 8K TPM). Fastest (~1–2 s). JSON schema + tool calling. |
| **Cloudflare Workers AI** (`api.cloudflare.com/client/v4/accounts/{id}/ai/v1`, OpenAI-compatible) | Yes (account already exists for bestly.tech DNS) | 10,000 Neurons/day free (≈ $0.11/day). ≈300K input tokens/day on gpt-oss-120b, ≈2M on qwen3-30b-a3b. Free plan fails with an error past the cap (no bill). | **No** — "Cloudflare does not use your Customer Content to train any AI models" | Yes | **Yes, private OK.** The long-context workhorse (gpt-oss-120b, 131k). |
| **Mac mini Ollama** (via `fix_ai_jobs` queue) | Already running | Model `qwen3:8b`. Last 14 days: 57 jobs, avg 27 s, p90 65 s, prompts ≤ 3K chars. Only when `partner_ai_status.seen_at` < 3 min. | **Never leaves the house** | n/a | **Yes, most private.** Short tasks only; slow; offline when the Mac sleeps. Ollama's default context is small — prompts over ~3K tokens need `num_ctx` raised on the Mac. |
| Google Gemini (AI Studio key) | Yes | Flash models ≈ 20 RPD, Flash-Lite ≈ 500 RPD (Google no longer publishes; third-party measured) | **Yes, with human review.** "Do not submit sensitive, confidential, or personal information to the Unpaid Services." | Yes (not for EEA/UK/CH users) | **Public data only.** Not in any Scout chain. |
| OpenRouter `:free` | Yes | 20 RPM, **50 RPD** unless $10 of credit bought (we won't) | **Mostly yes** — free endpoints require the training/publishing toggles on | Unverified | **Public data only.** Not in any Scout chain. |
| Mistral free | Yes | 1 req/s, 1B tokens/month | **Yes** unless opted out; "intended for evaluation and prototyping" | Not a clear licence | Skip. |
| GitHub Models | — | **Retired 2026-07-30** | — | — | Gone. |
| Cerebras | **No** (needs card for a $5 trial) | — | No | — | Skip (card rule). |
| NVIDIA build.nvidia.com | Yes | ~40 RPM | Unclear | **No** — "internal testing and evaluation… not in production" | Skip. |
| SambaNova Cloud | Yes | 20 RPD per model | Unverified | Unverified | Parked until its terms are checked. |
| Cohere trial / HF credits / Z.ai | — | evaluation-only / $0.10/mo / unverified | — | — | Skip. |

Sources are at the bottom.

---

## 2. Fallback chain per Scout job

Rule: every chain ends at Claude Haiku (paid, `ai_budget('background')` or `('chat')`), and every chain is **no-training only** because every Scout job touches private data.

| Job | What goes in | Size | Chain (first → last) | Free-safe? |
|---|---|---|---|---|
| **morning** (Today's 3) | admin_today items, incident titles, call to-do titles, draft subjects | 3–6K tok in, ~1K out, JSON | Groq gpt-oss-120b → Cloudflare gpt-oss-120b → Mac qwen3:8b → Haiku. Code fallback (top of queue) already exists if all fail. | **Yes.** Low stakes, code validates every `source_key`. |
| **reflect** (lessons, 2 AM) | admin_chat_actions, mac_jobs, incidents | 10–15K tok in, ~3K out, JSON | Cloudflare gpt-oss-120b → Haiku | **Yes.** Nobody is waiting; secrets scrubbed first (see §4). |
| **call** (to-dos from transcripts) | a full call transcript | up to ~25K tok in, ~2.5K out, JSON | Cloudflare gpt-oss-120b → Haiku | **Yes after shadow week.** Owner attribution is the risky part; check agreement with Haiku for 7 days before switching. |
| **drafts** (email replies as Jared) | up to 40 emails | ~20K tok in, ~4K out | Split in two: **(a) triage** "which of these need a reply" → Cloudflare gpt-oss-120b → Haiku; **(b) writing** the ≤5 chosen replies → **Haiku** (small input: only the chosen emails) | **Triage yes, writing no.** His voice matters and it's the one output people read. Cuts this job's paid tokens ~75%. |
| **chat triage** (admin-chat `freeTry`: answer or NEEDS_TOOLS DATA/ACTION/CODE) | the message, page, last 7 messages, FREE_FACTS | 1–3K tok | Groq gpt-oss-20b → Cloudflare gpt-oss-120b → Mac qwen3:8b | **Yes.** Today this is Mac-only and dead when the Mac sleeps; Groq answers in ~1 s. |
| **chat / autopilot tool loop** (run_sql, commit_files, mac_run…) | full system prompt + tools, many turns | 10–20K tok per turn | **Claude Sonnet** (unchanged) | **No.** Free models on 8K-TPM/300K-per-day quotas can't carry a 10-turn tool loop, and a wrong write is expensive. Phase 5 experiment only: free model with **read-only** tools, escalating to Claude for any write. |
| **todo-check judge** (other chat) | to-do + ≤8 evidence snippets (may include email/iMessage) | 2–4K tok, JSON | Groq gpt-oss-120b → Cloudflare gpt-oss-120b → Mac qwen3:8b → Haiku | **Yes.** Interactive, so fast providers first. |

**Daily free budget check (Cloudflare 10K Neurons ≈ $0.11):** reflect ≈ $0.008, two calls ≈ $0.021, drafts triage ≈ $0.008, morning overflow ≈ $0.003 → **≈ $0.04/day ≈ 3,600 Neurons.** Leaves ~6K Neurons for todo-check and chat overflow. The helper stops using Cloudflare at 9,000 estimated Neurons (safety margin) and moves on.

**Groq:** 1,000 requests and 200K tokens/day per model; ~50–150 short calls/day fits easily.

---

## 3. The shared helper — interface (FROZEN for the other chat)

File: `supabase/functions/_shared/free-llm.ts`. Import from a function as `import { llm, LlmUnavailable } from "../_shared/free-llm.ts";` (deploy the function with its `_shared` import included).

```ts
export type LlmTask =
  | "judge"      // todo-check: decide from evidence, JSON
  | "pick"       // scout-daily morning
  | "extract"    // scout-daily call: transcript -> commitments JSON
  | "triage"     // scout-daily drafts step (a): which mails need a reply
  | "write"      // prose in Jared's voice (defaults to paid-first; see routes)
  | "reflect"    // scout-daily reflect
  | "classify"   // admin-chat freeTry: answer or NEEDS_TOOLS
  | "summarize"; // generic

export type LlmPrivacy = "private" | "public";

export interface LlmRequest {
  task: LlmTask;
  system: string;
  user: string;
  maxTokens?: number;        // output cap, default 1500
  json?: boolean;            // true: ask for JSON, parse it, put it in .json; unparseable = try next provider
  job: string;               // ai_spend.job, e.g. "morning", "todo-check"
  ref?: string | null;       // ai_spend.ref (row id, meeting id, to-do id)
  fn?: string;               // ai_spend.fn, e.g. "scout-daily", "todo-check" (default "free-llm")
  scope?: "background" | "chat"; // ai_budget scope for the paid rung (default "background")
  privacy?: LlmPrivacy;      // default "private" = no-training providers only. "public" also allows Gemini/OpenRouter.
  paid?: "fallback" | "never" | "first"; // default "fallback"
  paidModel?: string;        // default "claude-haiku-4-5"
  deadlineMs?: number;       // total time across all rungs, default 90_000 (interactive callers: 20_000)
  validate?: (json: any) => string | null; // optional: return an error string to reject a reply and try the next rung
}

export interface LlmResult {
  text: string;              // raw text, <think> blocks stripped
  json?: any;                // present when json: true
  model: string;             // e.g. "openai/gpt-oss-120b"
  provider: "groq" | "cloudflare" | "local" | "gemini" | "openrouter" | "anthropic";
  cost_usd: number;          // 0 for free providers
  tried: { provider: string; model: string; outcome: "ok" | "rate_limited" | "timeout" | "error" | "bad_json" | "invalid" | "skipped_size" | "skipped_off" | "skipped_budget"; ms: number }[];
}

export class LlmUnavailable extends Error {
  reason: "budget" | "all_failed" | "paid_never";
  tried: LlmResult["tried"];
}

export function llm(req: LlmRequest): Promise<LlmResult>;
```

**Guarantees the caller can rely on**
1. `privacy` defaults to `"private"`: email, iMessage and customer text are safe to pass without extra flags. Training providers are only ever tried when the caller says `privacy: "public"`.
2. Secret scrub before any send, any provider: key-shaped strings (`sk-ant-`, `sk-`, `ghp_`, `sb_secret_`, `eyJ…` JWTs, 32+ char tokens) are replaced by `[secret]`. Same patterns as the bestly_memory trigger.
3. Every attempt is logged to `ai_spend` (cost 0 for free; failed attempts too, with `ok = false`), so the spend dashboard shows the free vs paid mix.
4. The paid rung checks `ai_budget(scope)` first; over cap = `LlmUnavailable("budget")`, never a silent charge.
5. It never throws on a single provider's failure; it only throws `LlmUnavailable` when every rung is done. Callers keep their own no-AI fallback (morning: top of queue; todo-check: verdict `unknown` at $0).
6. `json: true` returns a parsed object or moves on; callers never parse model text themselves.

**Example (todo-check)**
```ts
try {
  const r = await llm({ task: "judge", system: JUDGE_RULES, user: JSON.stringify({ todo, evidence }),
                        json: true, job: "todo-check", ref: todo.id, fn: "todo-check", deadlineMs: 20_000,
                        validate: (j) => ["done","partly","not_done","unknown"].includes(j?.verdict) ? null : "bad verdict" });
  return r.json;
} catch (e) {
  if (e instanceof LlmUnavailable) return { verdict: "unknown", evidence, why: e.reason };
  throw e;
}
```

### Routes (inside the helper, per task)

| task | rungs (private) | extra for public |
|---|---|---|
| judge, pick, classify | groq `openai/gpt-oss-120b` (classify: `openai/gpt-oss-20b`) → cloudflare `@cf/openai/gpt-oss-120b` → local `qwen3:8b` → anthropic | gemini `flash-lite`, openrouter free, inserted before anthropic |
| extract, reflect, triage, summarize | groq (only if ≤ 6K tokens) → cloudflare `@cf/openai/gpt-oss-120b` → anthropic | same |
| write | anthropic first (`paid: "first"` implied); cloudflare only if paid is over budget | — |

Size check before each rung: estimated tokens = chars ÷ 3.5 + maxTokens. Groq is skipped above 6K; local above 3K (until the Mac's `num_ctx` is raised); Cloudflare above 120K.

### How it works (for the builder)

- **Provider adapters:** Groq and Cloudflare share one OpenAI-compatible `chat/completions` call (`response_format: {type:"json_object"}` when `json`). Local = insert `fix_ai_jobs {issue_key: "llm:<job>:<ref>", prompt}` and poll every 1.5 s, same as admin-chat's `freeTry`, only if `partner_ai_status.seen_at` < 3 min. Anthropic = the existing Messages call (cache-aware pricing from admin-chat's `logSpend`).
- **Failure handling:** 429 → read `retry-after` / `x-ratelimit-reset-*`, write `llm_providers.cooldown_until`, next rung. Timeout (Groq 20 s, Cloudflare 60 s, local 45 s, all capped by `deadlineMs`) → next rung. 5xx → one retry after 1 s, then next rung. Bad/invalid JSON → next rung (no retry on the same model).
- **Keys:** read once per isolate (cached 10 min) with `db.rpc("llm_keys")` — a security-definer function, service role only, that returns the Vault values by name. Never logged.
- **Supabase client:** `SUPABASE_SECRET_KEYS` (JSON, `"default"`) with fallback to `SUPABASE_SERVICE_ROLE_KEY`, sent as `apikey` (not only Bearer):
  ```ts
  const secret = (() => { try { return JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default; } catch { return undefined; } })()
                 ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, secret, { auth: { persistSession: false }, global: { headers: { apikey: secret } } });
  ```

### Database (one additive migration)

- `llm_providers (name pk, enabled bool default true, private_ok bool, cooldown_until timestamptz, daily_cap int, note text)` — rows: groq, cloudflare, local (private_ok true); gemini, openrouter (private_ok false, enabled false). **This table is the off switch.**
- `ai_spend` gets `provider text`, `ok bool default true`, `ms int`, `free_units numeric` (Cloudflare Neuron estimate). Existing rows and sums are unchanged (new free rows cost 0).
- View `ai_spend_mix_today`: provider, calls, ok calls, tokens, cost — for the spend panel ("Free 92% · Paid 8% · $0.03 today").
- `llm_keys()` security definer, `revoke all from public, anon, authenticated` — returns `{groq, cloudflare_token, cloudflare_account}` from Vault.
- `llm_key_set(name, value)` admin-only RPC used by the paste boxes (below); allowlisted names only.

---

## 4. Privacy — what may never go to a training provider

**Never to Gemini free, OpenRouter `:free`, Mistral free, or anything unverified:**
- Email: bodies, subjects, addresses (`bestly_mail`, drafts).
- iMessage/SMS, including SkyTouch client texts.
- Call and meeting transcripts, summaries and to-dos (Eli, Elizabeth, anyone).
- Customer/client/guest info: Turo guests, LAX pass links, Centering YOU/Elizabeth, Shopify customers, Studio client boards, Vesta users.
- Money (Mercury, invoices, CalFresh), health, legal.
- Anything from Vault or `bestly_credential_registry` values — not even to paid providers. (Names only.)
- Scout tool logs (`admin_chat_actions`, `mac_jobs` output) — they echo SQL results and mail.

**OK for a training provider (`privacy: "public"`):** generic writing with no real names, public web pages, code questions with no data, marketing copy drafts for public posts. None of Scout's jobs qualify, which is why Scout's chains don't include them.

**No-training providers used for private data:** Mac mini Ollama (never leaves the house), Cloudflare Workers AI (contract: no training, no use to improve services), Groq (no retention by default; training not stated — acceptable, re-check their terms at rollout and drop Groq from private routes if that changes), Anthropic paid API.

**Defence in depth:** the secret scrub (§3 guarantee 2) runs on every call. `privacy` defaults to private, so a forgotten flag fails safe.

---

## 5. Keys — what Jared does (about 5 minutes, no card, no paid plan)

1. **Groq** — sign in at https://console.groq.com/keys (Google sign-in is fine) → **Create API Key** → copy.
2. **Cloudflare** (account already exists) — https://dash.cloudflare.com/profile/api-tokens → **Create Token** → template **"Workers AI"** (Workers AI: Read + Edit) → your account → Create → copy. Account ID is on the dashboard home page, right column. Do **not** add a payment method or switch to Workers Paid; on the free plan Cloudflare refuses calls past 10K Neurons instead of billing.
3. Paste them into **Supabase → Integrations → Vault → Add new secret** (https://supabase.com/dashboard/project/rcqfqhguwpmaarseifqg/integrations/vault/secrets), one secret each, named exactly `groq_api_key`, `cloudflare_ai_token`, `cloudflare_account_id`. Never in chat. (`llm_key_set(name, value)` exists for a future admin paste box; Claude is not allowed to write secrets itself.)

**Vault names:** `groq_api_key`, `cloudflare_ai_token`, `cloudflare_account_id`. Optional later, public-only, not needed for Scout: `gemini_api_key` (https://aistudio.google.com/apikey — the "Default Gemini Project" already exists), `openrouter_api_key` (https://openrouter.ai/keys; never buy the $10 credit).

Registry: add rows to `bestly_credential_registry` for groq and cloudflare-workers-ai (`secret_home = 'Supabase Vault'`, `secret_ref` = the names above). The Cloudflare token is **Workers AI only**; it does not unblock the parked DNS/Worker work (that needs Workers Scripts:Edit, a separate decision).

---

## 6. Rollout, tests, watchdog, rollback

**Phase 0 — Jared:** the two keys (§5). Everything else waits on nothing.

**Phase 1 — helper + migration (no behaviour change)**
- Build `_shared/free-llm.ts` exactly to §3, the migration, the key card.
- Tests (Deno, run against live keys from a throwaway function `free-llm-test`, deleted after):
  1. Each provider answers a tiny JSON prompt; `ai_spend` gets a row with the provider, cost 0.
  2. Bad Groq key → falls to Cloudflare; bad both → local; local offline → Haiku with a cost row.
  3. Forced 429 (mock) → cooldown written, next rung used.
  4. 10K-token prompt skips Groq (`skipped_size`) and lands on Cloudflare.
  5. `privacy` omitted → Gemini/OpenRouter never tried, even when enabled.
  6. Secret scrub: a prompt containing a fake `sk-ant-…` arrives as `[secret]` (check with an echo prompt).
  7. `ai_budget` over cap → `LlmUnavailable("budget")`, no Anthropic request made.
  8. `json: true` with a model that returns prose → `bad_json`, next rung.
- The other chat can build todo-check against §3 the moment this lands.

**Phase 2 — scout-daily v6, shadow week**
- morning, call, reflect: run the free chain **and** Haiku; ship Haiku's result; log both to `llm_shadow (job, ref, free_json, paid_json, agree_score, at)`.
- Agreement checks: morning = same slots/sources ≥ 2 of 3; call = same owner on ≥ 90% of matched to-dos, no invented to-dos; reflect = eyeball.
- Cost of the week = today's cost plus ~0 (free side is free).

**Phase 3 — switch**
- morning, reflect → free first. call → free first if the shadow numbers pass. drafts → free triage + Haiku writing.
- scout-daily's `claude()` wrapper becomes a thin call to `llm()`; the no-AI fallbacks stay.

**Phase 4 — admin-chat triage**
- `freeTry` calls `llm({ task: "classify", scope: "chat", paid: "never", deadlineMs: 20_000 })` — Groq first, Mac Ollama as one rung instead of the only one. Same NEEDS_TOOLS contract, same "never claim it did something" rule.

**Phase 5 — experiment, behind a flag:** autopilot read-only diagnosis on a free model with read-only tools; any write escalates to the existing paid path with the existing yes-gate.

**Watchdog (Scout, self-healing — required)**
- SQL `free_llm_watch()` on cron every 15 min:
  - provider with ≥ 3 attempts and > 50% failures in the last hour → set `cooldown_until = now()+1h`, `bestly_raise('ai.free.<provider>')`; a clean hour resolves it.
  - paid share of background calls > 50% over 24 h → `bestly_raise('ai.free.fallback_high')` (free side is broken and we're quietly paying).
  - Cloudflare `free_units` today > 8,000 → warning (near the free cap).
  - key missing → incident whose `needs_jared` is the one step (§5), shown on Today.
- Canary: scout-daily `op llm_canary` at 5:30 AM LA runs a 20-token JSON prompt on each enabled provider, writes results, clears cooldowns that pass. The fix ladder's auto rung can run the canary before escalating.

**Rollback (no deploy needed)**
- One provider misbehaving: `update llm_providers set enabled = false where name = 'groq';`
- All free off, back to today's behaviour: `update llm_providers set enabled = false;` — every call goes straight to Haiku under `ai_budget`, exactly like scout-daily v5.
- Code: scout-daily v5 and admin-chat v23 sources are committed before phase 3 changes, so a redeploy of the previous version is one step. Deploys are manual; record each deployed version in `house/ai/free-llm-plan`.

---

## Open decisions (Jared)

1. OK to use **Groq** for private data on the strength of "no retention by default" (no explicit no-training clause)? Recommended yes; otherwise drop it from private routes and Cloudflare carries the load.
2. Raise the Mac mini's Ollama context (`num_ctx` 16K) or move it to a bigger model if RAM allows — makes the fully-private rung useful for calls. Optional.

## Sources

- Groq: https://console.groq.com/docs/rate-limits · https://console.groq.com/docs/your-data · https://console.groq.com/docs/structured-outputs · https://console.groq.com/docs/tool-use
- Cloudflare: https://developers.cloudflare.com/workers-ai/platform/pricing/ · https://developers.cloudflare.com/workers-ai/platform/data-usage/ · https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/ · https://developers.cloudflare.com/workers-ai/features/json-mode/
- Gemini: https://ai.google.dev/gemini-api/docs/pricing · https://ai.google.dev/gemini-api/terms · https://ai.google.dev/gemini-api/docs/rate-limits
- OpenRouter: https://openrouter.ai/docs/api/reference/limits · https://openrouter.ai/docs/guides/privacy/data-collection · https://openrouter.zendesk.com/hc/en-us/articles/51690904755227
- Mistral: https://help.mistral.ai/en/articles/225174-what-are-the-limits-of-the-free-tier · https://help.mistral.ai/en/articles/347617-do-you-use-my-user-data-to-train-your-artificial-intelligence-models
- GitHub Models retired: https://github.blog/changelog/2026-07-30-github-models-is-now-retired/
- Cerebras: https://inference-docs.cerebras.ai/support/rate-limits
- NVIDIA trial terms: https://assets.ngc.nvidia.com/products/api-catalog/legal/NVIDIA%20API%20Trial%20Terms%20of%20Service.pdf
- SambaNova: https://docs.sambanova.ai/docs/en/models/rate-limits
- Internal: `fix_ai_jobs` timings (14 days), `partner_ai_status.model = qwen3:8b`, scout-daily v5 source, admin-chat v23 source, `docs/todo-check-opusplan.md`.
