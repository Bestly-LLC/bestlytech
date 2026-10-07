# Scout as chief of staff: plan (Opus), build (Sonnet)

Date: 2026-10-07. Owner: Scout (admin-chat). Supersedes nothing; builds on `docs/scout-free-parity-opusplan.md` (v38).

## Jared's ask (verbatim intent)
"Scout is basically unusable. I need him to do tasks just as if I'm asking Claude: change code, build websites, anything
and everything, my full chief of staff. Anything I throw his way, he tries with free AI if possible. FreeLLM has
additional keys for additional models I can provide. This chat should get a concise, correct answer. Instead it keeps
saying keep working, still working, still finding out."

## Evidence (ai_spend + admin_chat_actions, Oct 7)
| Thread | Ask | Tool calls | LLM calls | Input tokens | Model doing the work |
|---|---|---|---|---|---|
| 82f712a8 | "what should I call the invoice services for Elizabeth" | 241 (237 run_sql) | 245 | 2,159,260 | freellm `dots-3-note-preview:free` x237 |
| 6421e836 | "why is this Eli to-do here" | 65 | 87 | 585,498 | dots-3-note-preview x59 |
| fb15a107 | autopilot | 28 | 15 | 90,261 | dots-3-note-preview x15 |

Findings, in order of damage:
1. **FreeLLM `model:"auto"` lands on a weak preview model** (`dots-studio/dots-3-note-preview:free`). It loops (re-read the
   same email 4x, paged `substr(body_text, 6001, 10000)`), and writes tool calls as TEXT (`<dots_function_call><invoke ...>`)
   which went straight into Jared's chat.
2. **FreeLLM has ONE key/route** ("All models exhausted: 1 route checked"). One loop drains it; then ~4 h cooldown, then
   Groq per-minute limits, then "The free AI is busy" forever. FreeLLMAPI supports 34 providers and has `POST /api/keys`.
3. **No answer discipline.** A one-line question ran 114 + 135 + 144 steps across "Keep going" taps. Nothing forces
   "you have enough, answer now". The 24-hop / 20-minute auto-continue (v36) makes a bad loop longer, not better.
4. **Context starved for the big models.** `trimForBudget(3800)` and 300/1,200-char tool results were sized for Groq's
   8K tokens/min. FreeLLM/Cloudflare/Gemini take 100K+. The model can't see what it already read, so it reads it again.
5. **Dishonest status text.** The free model said "No action needed from you; it will pick up" and invented an incident
   link. Progress notes ("Still working on it, step 69") replace answers.
6. **Code is only "edit a file in bestlytech via commit_files"**: no build/run, no new repos, no sites, no other repos.
   The Mac mini has Claude Code (`~/.local/bin/claude`), node, git with push, and FreeLLM; nothing uses them for coding.

## Target behavior (acceptance tests: all must pass before done)
Replay these exact asks in a fresh thread with Paid AI OFF. Each must finish within the limits shown.
| # | Ask | Must | Limit |
|---|---|---|---|
| A | what should I call the invoice services for Elizabeth to bill | concrete answer (line-item names) grounded in her emails | <= 12 tool calls, < 90 s, one reply |
| B | why is the task "prepare and send the meeting invite for the 20-min call with Eli Cooper" on Eli's list | says it came from the Ava demo on the Oct 5 call | <= 6 tool calls |
| C | what needs me today | ranked short list | <= 3 tool calls |
| D | add a zoom in/out button to the sky on /admin | a real commit, build green, live URL | ends with a done message or one clear question |
| E | build a one-page site for "Test Bakery" with hours and a map | new repo + Vercel deploy + short link | ends with a live URL |
Plus: no reply ever contains `<invoke`, `<*_function_call>`, `NEEDS_TOOLS`, raw JSON tool args, or "No action needed".

## Design

### 1. Model routing (`_shared/free-llm.ts`)
- Never send bare `auto` for agent/chat work. Chat + agent ladder uses an explicit vetted list, strongest first, each a
  separate rung so a 429 on one moves to the next. Start from FreeLLM's catalog (`GET /api/fallback`, `/v1/models`) and
  pick models that pass a **tool-call probe** (step 1.3). Seed candidates: gpt-oss-120b, qwen3-coder-480b, kimi-k2*,
  glm-4.6*, deepseek-v3*/r1 (non-thinking variant), llama-4-maverick, gemini-2.5-flash. Keep `auto:smartest` as the last
  FreeLLM rung, never `auto`.
- Denylist in code (and in FreeLLM's chain if its API allows disabling): `dots-*`, `*-note-preview*`, `ling-*flash*`,
  `*qwen3*-flash*`, any model that failed the probe. Store the list in `llm_providers.note`-adjacent table
  `llm_model_health(model, provider, ok_tool_calls bool, last_probe_at, fails_24h, benched_until)`.
- 1.3 **Probe**: a daily + on-demand job (Pi or Mac mini, free, not Claude) sends each candidate one tool-calling request
  and records pass/fail. A model that answers with text-encoded tool calls, empty content, or wrong JSON fails.
- **Text tool-call rescue**: in `llmChat`, if `content` contains `<invoke name=`, `<function_call>`, `<*_function_call>`
  or a ```json {"name":..,"arguments":..}``` block and `tool_calls` is empty, parse it into real tool calls once; then bench
  that model for this request and record a strike in `llm_model_health`. Never pass that text to Jared.

### 2. More capacity: Jared's extra keys (UI, not SQL)
- New admin card "Free AI keys" on the Scout settings area (pattern: `ChargingCard.tsx`). Fields: provider (dropdown from
  FreeLLM's supported list), key. Submit -> admin-guarded edge function `freellm-keys` -> FreeLLM `POST /api/keys` on the
  Pi (base URL from Vault `freellm_base_url`; FreeLLM admin login creds in Vault, never in code). Card shows per-provider
  key count and status (`/api/keys`, `/api/fallback/rate-limit-usage`) with no key values ever returned to the browser.
- Card copy, least-informed reader: "Add a free AI key. More keys = Scout stays fast when one runs out." Link each provider
  name to its free signup page.
- Executor: first read what's configured now (expect 1 key). Report it.

### 3. Answer discipline (admin-chat `freeAgent`)
- **Classify every message** in code (no LLM): QUESTION (who/what/why/how/should/which, ends with ?) vs TASK (imperative
  verbs, "take this off my plate", "build", "fix", "send"). 
- QUESTION budget: 8 tool calls, then the next model call runs with `toolChoice:"none"` and "Answer now from what you
  found. If you're missing something, say exactly what in one line." TASK budget: 25 tool calls per hop, max 4 hops.
- Kill the 24-hop / 20-minute auto-continue for questions. Tasks keep auto-continue but max 4 hops, and only if the last
  hop made a NEW successful write or a new finding (not just reads).
- **Repeat guard**: the same tool+args (hash) a 2nd time returns the cached result plus "you already have this". A 3rd
  time ends the hop and forces an answer. Same table/id read in pieces (`substr(`, OFFSET paging on one row) -> refuse
  with "use read_email / the full row".
- Per-request token ceiling (free): 250K input tokens; on hit, answer with what it has.

### 4. Context sized to the rung
- `trimForBudget(maxTokens)` takes the rung's window: Groq 3,800 (unchanged), FreeLLM/Cloudflare/Gemini 24,000.
  Tool results kept at 6,000 chars for the newest two, 1,500 older (big rungs).
- New compact tools so the model doesn't page raw rows:
  - `read_email {id}`: subject, from, to, date, body with quoted replies and signatures stripped, max 8,000 chars.
  - `search_mail {who?, about?, days?}`: 10 newest matches, one line each (id, date, from, subject, 160-char snippet).
  - (exists) `meeting_transcript {find}` from v41.
- Add both to FREE_TOOLS and the topic regexes.

### 5. Honest status, no spam
- Progress: one in-place message, updated at most every 20 s: "Working: <what it's doing in 5-8 words> (N steps)".
  Final answer replaces nothing; it's a new message.
- When free AI is truly out (every free rung benched): ONE message: "Free AI is out of room until <time>. OPTIONS: Use
  paid AI for this one | Wait and retry at <time>". If Paid AI switch is ON, go to paid without asking. Never "keep
  going" loops, never "No action needed".
- Output scrub before any message is saved: strip `<invoke`/`<*_function_call>` blocks, `NEEDS_TOOLS:` lines, think-leaks
  (`thinkingLeak` exists), raw JSON tool args. If nothing is left, it's a failed step, not a reply.
- Add to `CLAIMS_WORK`: "no action needed", "it will pick up", "I'll keep going" from the free model -> rejected.

### 6. Real coding: `code_job` (the "just like Claude" part)
- New tool `code_job {repo, goal, new_site?: {name, domain?}}`. Scout writes the job; the Mac mini does it.
- Mac mini worker `~/bestly-agents/code-worker/` (launchd `tech.bestly.code-worker`), polls `code_jobs` table:
  1. fresh temp clone (or `gh repo create Bestly-LLC/<slug> --private` + Vite/React template for new sites),
  2. run a coding agent: **opencode** (`npm i -g opencode-ai`) pointed at FreeLLM with the vetted model list (NOT `auto`),
     3 tries; each try = agent run + `npm run build` (+ tests if present),
  3. on 3 failures: if Paid AI switch ON -> `claude -p` (Claude Code CLI already at `~/.local/bin/claude`) with the try log;
     if OFF -> job status `needs_yes` and Scout posts one "Use paid AI for this one" button,
  4. green build -> commit + push to main (bestlytech: Vercel auto-deploys) / new site: `vercel` deploy + short link
     `bestly.tech/s/<slug>` (preference: short links only),
  5. edge function changes -> `supabase functions deploy` (allowed here: the worker is the deploy path Jared already
     approved by asking for code; log every deploy),
  6. writes result (diff summary, commit sha, live URL, build log tail) back to `code_jobs`; Scout reports in 2 lines.
- Scout's `commit_files` stays for one-line edits; anything multi-file, new, or needing a build goes to `code_job`.
- Guardrails: worker only touches `Bestly-LLC/*` repos; never prints or commits secrets (`gitleaks`/grep for key
  patterns before push); never force-pushes; job timeout 20 min; one job at a time.

### 7. Watchdog + team card (house rules)
- Team card via `team_onboard`: "Code Worker" (Mac mini, reports_to Scout, owns `code.*` alerts, pulse = launchd job) and
  "Model Prober" (owns `freellm.*` model alerts).
- Scout Health checks every 10 min (Pi cron or existing monitor): any chat reply with > 30 tool calls, any reply leaking
  tool syntax, FreeLLM routes < 2 healthy models, code worker heartbeat > 10 min old -> incident `scout.health` signed by
  Scout, auto-recovery = bench the offending model / restart the worker (launchctl kickstart).

## Build order (Sonnet executes, one commit per step, push after each)
1. free-llm.ts: vetted ladder, denylist, text-tool-call rescue, `llm_model_health` migration. Deploy every function that
   imports free-llm (grep `_shared/free-llm`).
2. admin-chat: classify + budgets + repeat guard + rung-sized context + output scrub + honest out-of-room message.
   Add `read_email`, `search_mail`. Deploy.
3. Run acceptance tests A, B, C live (POST to admin-chat as the service, or via the admin UI). Fix until they pass.
4. Free AI keys card + `freellm-keys` function. Report current key count.
5. Code worker + `code_job` tool + `code_jobs` migration. Tests D, E.
6. Model prober, Scout Health checks, team cards.
7. Write the outcome to `bestly_memory` (area scout) and a lesson in `scout_lessons`.

## Out of scope
- Changing the Paid AI switch semantics (still the one master control; never turned on silently).
- Any change to Ava / RoofGuard callers.
