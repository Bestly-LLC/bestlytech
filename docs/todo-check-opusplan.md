# Opusplan: "Check if it's done" button on to-dos

**Status:** phase 1 + auto-close BUILT 2026-09-23 (migration `20260923200000_todo_check.sql`, edge fn `todo-check` v1, `ScoutToday.tsx`). Phases 2–3 below still open.
**Depends on:** `supabase/functions/_shared/free-llm.ts`, owned by the parallel Scout free-LLM plan (`docs/scout-free-llm-opusplan.md`). This feature only *uses* that helper; it never edits it.

## TL;DR

- **One tap on any open to-do.** Scout searches your email, memory, Vault, Deck/docs, git, and (later) iMessage for proof, then answers **Done / Partly / Not yet / Can't tell**, citing sources.
- **The search is plain database queries and costs nothing.** Only the final judgement uses an LLM: a free model first, then Haiku capped by `ai_budget('background')` (about 0.2¢ per check).
- **It never marks a to-do done by itself in v1.** If it finds proof you get a "Mark done" button; you tap it.
- **No proof means "Can't tell"**, never a guess.

## Where the button goes

| Surface | Rows | Writes via |
|---|---|---|
| `ScoutToday.tsx`: Today's 3 and From calls | `scout_daily` kind `pick` / `call`, status `open` | `scout_daily_set()` |
| `CommandHero.tsx`: partner tasks | partner tasks | `partner_task_set()` |
| Later: a "Check all open" button at the top | all of the above | same |

Button: a small ghost button reading **"Check if it's done"** (lucide `SearchCheck`), which shows a spinner while it runs. The result shows up as a chip under the to-do:

- 🟢 **Done**: 1–3 evidence lines (source, date, one-line quote, link) plus **[Mark done]** and [Not really].
- 🟡 **Partly**: what's done, what's left, and a suggested next step.
- ⚪ **Not yet** / **Can't tell**: what was searched, so you know it looked.

(Admin UI only; emoji chips are fine there per CLAUDE.md.)

## Backend: new edge function `todo-check`

- `verify_jwt = false`, with its own check: admin JWT → `has_role(admin)`, or service role. This avoids the verify_jwt problem with the new keys.
- Reads keys through the new-key pattern: `SUPABASE_SECRET_KEYS` → `default`, falling back to `SUPABASE_SERVICE_ROLE_KEY`.
- Input `{ source: "scout_daily" | "partner_task", id, force? }`.
- Cache: if `action.check` is less than 30 minutes old and `force` isn't set, it returns the cached result.

### Step 1: gather evidence (no LLM, free)

Search window: from the to-do's `created_at` minus 1 day to now. Terms: keywords and names from the title and `why`. A tiny tokenizer drops stopwords and keeps proper nouns, emails, domains and numbers. No LLM here.

| Source | How | Notes |
|---|---|---|
| **Email** (`bestly_mail`, about 1,700 rows, ingested) | Postgres full-text on subject + body_text, **Sent first** (proof you replied or sent), then Inbox (their confirmation) | Add a GIN `tsvector` index. Top 8 hits, body sliced to 600 characters |
| **Memory** (`bestly_memory`) | FTS on title + body, `active = true`, `updated_at >= window` | Strong signal: we log finished work there |
| **Vault** | New RPC `vault_evidence(terms)`, security definer, admin only. Returns **only name, description and created/updated time. Never the secret.** | Answers to-dos like "store the Stripe key" |
| **Deck / Nextcloud docs** | The card linked in `action.deck_card`: is it in the Done stack or archived? Then Nextcloud unified search for the terms (`nextcloud_cred`) | Deck status alone is often enough |
| **Git** | GitHub commit search on Bestly-LLC repos plus cookie-yeti-unified since the window (already reachable through `bestly-git`) | Answers code to-dos |
| **Scout's own actions** | `admin_chat_actions`, `mac_jobs` (finished and ok), `scout_daily` wrap rows | "Scout already did it" |
| **iMessage** (phase 3) | Mac mini job: read-only SQLite query on `~/Library/Messages/chat.db` for the terms. Returns at most 5 snippets, 300 characters each | Needs **Full Disk Access for python3 on the Mac mini** (Jared-only, still pending). Runs as a fixed, pre-approved script, not a free-form `mac_jobs` script |

Every source has a 4-second timeout. If a source fails, it's listed as "not searched" rather than failing the whole check.

### Step 2: judge (LLM)

`llm({ task: "judge", json: true, job: "todo-check", ref: id, ... })` from `_shared/free-llm.ts`.

- **Prompt contract:** "Decide from the evidence ONLY. Every claim must cite an evidence id. With no relevant evidence the answer is `unknown`."
- **Output:** `{ verdict: "done"|"partly"|"not_done"|"unknown", confidence: 0-1, evidence_ids: [], summary, remaining, next_step }`.
- **Checked by code, not trusted:** evidence_ids must exist; a "done" verdict with confidence below 0.6 or no evidence is downgraded to `partly` / `unknown`.
- **Privacy routing:** if the evidence has email or iMessage text, only providers the free-LLM plan marks **no-training** may be used. Otherwise it goes to Haiku, under budget. If the budget is spent, it returns the evidence list with verdict `unknown`: still useful and $0.

### Step 3: save and show

- Saved to `scout_daily.action.check = { verdict, confidence, summary, remaining, next_step, evidence:[{src, ref, at, quote, url}], checked_at, model }`. Partner tasks get the same shape in a jsonb column (a migration adds `check jsonb` if the column is missing).
- The result goes back to the UI, and the chip renders from `action.check`, so it survives a reload.
- Spend is logged to `ai_spend` (cost 0 for free models), so it shows in the "Cookie Yeti and other AI" / background line.

## Migrations (append-only)

1. `..._todo_check.sql`
   - GIN index on `bestly_mail` (to_tsvector of subject || body_text).
   - GIN index on `bestly_memory`.
   - `vault_evidence(text[])`: names only, admin only.
   - `todo_check_save(p_source, p_id, p_check jsonb)`.
   - `ai_caps` row `todo-check`: 200 a day, 30 an hour.
2. Later: a `check` column on the partner tasks table, if needed.

## Phases

| # | Ships | Sources | Est. |
|---|---|---|---|
| 1 | Button on ScoutToday rows, `todo-check` function, cached chip | Email, memory, Vault names, Deck card, Scout actions | 1 session |
| 2 | Partner tasks, "Check all open" (runs 3 at a time) | + git, Nextcloud search | ½ session |
| 3 | iMessage | + chat.db via Mac mini | after Full Disk Access |
| 4 (opt-in) | Auto-close: a nightly pass marks done when confidence is at least 0.9 and 2+ independent sources agree, and says so in the 6pm wrap with Undo | all | only if Jared says yes |

## Tests

- Seed 3 fake to-dos: one clearly done (a sent email exists), one partly done, and one with no trace. The expected verdicts are done, partly and unknown.
- Kill the free provider (bad key): it falls back to Haiku; with the budget at 0 it returns evidence with `unknown`.
- The Vault RPC never returns `decrypted_secret` (a test asserts the column list).
- A non-admin JWT gets 401.

## Decisions for Jared

1. **Auto-mark done (phase 4)?** Default is no. You tap Mark done.
2. **iMessage scope:** all chats, or only the people tied to Bestly work?
3. **Nothing is ever sent as you.** This feature only reads.

## Built 2026-09-23 (Jared: "yes, but let me put it back, thumbs down, self-heal and learn")

- **Auto-close is ON.** Nightly at 10 PM LA (`todo-check-tick` cron, :35 hourly, runs once at hour 22). Closes a to-do only when:
  verdict done, confidence ≥ `todo_check_settings.threshold` (starts 0.90), ≥2 kinds of evidence, owner is Jared (or a pick),
  and Jared has never corrected a check on that to-do. The button never auto-closes; it offers **Mark done**.
- **Put back**: the "Closed by Scout" list on /admin (last 3 days), and on closed picks. `todo_check_feedback(check, 'undo')` reopens it.
- **Thumbs up / down** on every result. Down asks "What's actually true? (optional)".
- **Learning**: down or put-back → `todo-check` op learn writes one general rule to `scout_lessons` (scope `todo-check`, source `feedback`);
  every judge reads the top 12 (wins minus losses). Lessons used in a wrong check get a loss, a right one a win.
  Prior corrections on the same to-do are passed to the judge too.
- **Self-tuning**: a put-back on an auto-close raises the threshold +0.02 (max 0.98). >10% put-backs in 30 days → at least 0.93;
  >30% (and at least 5) → auto-close pauses and Scout pushes an alert. 20+ clean → threshold eases toward 0.85.
- **Self-healing** (`todo_check_watchdog`, :50 hourly): reruns a missed nightly pass after 11 PM, retries lessons that failed to write,
  alerts on 5+ errors a day or 2 days without a run. Each evidence source has its own timeout plus one retry; a failed judge degrades to a no-AI read.
- **Toggle**: the ⋯ menu on "Scout's picks" → "Check which to-dos are done" (sweep) and the auto-close on/off switch.
- **Judge model**: Haiku under `ai_budget('background')` via a local `llm()` with the same signature as the planned `_shared/free-llm.ts`. Swap when that lands.
- **Gaps**: only INBOX mail is synced (no Sent folder yet), so "I emailed X" to-dos rely on their reply. iMessage waits on Full Disk Access.

## v2 (2026-09-23 evening): up top, and it keeps going when you leave

- **Where**: the "Your to-dos from calls" card at the top of /admin (`CommandHero.tsx`) now opens with the check panel:
  "Did any of these get done?" + **Check them all**, a live progress bar ("Checking 5 of 12…"), the last run's result,
  and the **Close them for me** switch. Every to-do has a **Check** button; results sit on their own line under it.
  "Closed by Scout" with **Put back** lives in the same card. Shared code: `src/components/admin/todoCheck.tsx`.
- **Leave the page**: every check is a row in `todo_check_jobs` under a `todo_check_runs` row
  (migration `20260923210000_todo_check_queue.sql`). `todo-check` v2 queues and returns at once, works the queue in
  the background (`EdgeRuntime.waitUntil`), and `todo_check_drain()` (cron every minute) requeues stuck jobs (3 tries)
  and wakes the worker if anything is left. A finished run sends a Scout notification (web push; nightly stays quiet
  unless something looks done). The page polls every 3s while work is running, 30s otherwise, and on tab focus.

## What's next (in order)

1. **Free models**: swap `llm()` for `_shared/free-llm.ts` when the Scout free-LLM chat ships it (one import).
2. **Sent mail**: sync the Sent folders into `bestly_mail`, so "I emailed X" to-dos prove themselves without a reply.
3. **iMessage** (phase 3): needs Full Disk Access for python3 on the Mac mini (Jared, one toggle), then a fixed read-only chat.db job.
4. **Partners**: the same check on Eli's portal for his to-dos (check only, never auto-close someone else's).
5. **Scout does it**: when a check says "Not yet", offer the one next step as a button (draft the email, open the card).
