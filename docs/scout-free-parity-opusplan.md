# Scout on free AI can do everything paid Scout can (opusplan)

Jared, 2026-10-06 9:00 PM, after Scout said "only the paid AI can edit the admin's code ... turn on paid AI for one
hour to fix it, or leave it broken and let the 13 errors/hour continue":
"This should not be true, there is free AI coding from LLM. Rework how Scout runs: he should have all the same
abilities as paid AI, and only call on paid AI when it fails after 3 tries."

Planned by Opus, executed by Sonnet. Parts A and B plus the one-tap rules in C, one push.

---

## Part A: the bug Scout found (run_sql calls SELECTs "writes")

`public.admin_sql_read` scans the raw query text for keywords (`call|do|set|copy|notify|...`) **including inside
string literals**. `SELECT ... WHERE kind = 'call'` is refused with "read-only: that statement changes things".
13+ failures in 2 days, all on scout_daily `kind='call'`.

Fix (new migration, `create or replace`, same signature and grants):
1. Before the keyword scan, build a "code only" copy of the query with everything that can't be code removed:
   single-quoted strings (with `''` escapes), dollar-quoted strings (`$tag$...$tag$`), double-quoted identifiers,
   `--` line comments and `/* */` comments. Scan only that copy. Execute the original.
2. Keep the existing secret-table and `net.` blocks (scan the code-only copy for those too).
3. Belt and braces: execution already wraps the query as `select * from (%s) q`, which Postgres refuses for any
   INSERT/UPDATE/DELETE, including data-modifying CTEs. Keep it.
4. Test inside the migration's verification (run as SQL after applying): the 4 failing queries from
   `admin_chat_actions` now return rows; `select 1; delete from x` still fails; `with d as (delete from scout_daily
   where false returning 1) select * from d` still fails; `select pg_read_file('x')` still fails.

## Part B: free Scout = paid Scout, paid only after 3 failed tries

File: `supabase/functions/admin-chat/index.ts` (read the v28-v37 header notes first; keep their lessons).

1. **Same tools.** Free agent gets every tool paid Scout has: add `commit_files`, `db_write`, `mac_command` to `FREE_TOOLS`. Delete `PAID_ONLY_WHY` and the early return that hands those calls
   to paid. Confirmation rules are identical to paid (same `confirmed:true` after his yes / auto-run rules, same
   AUTOPILOT_NEVER list). Add them to `TOOL_TOPICS` so they ride along when the conversation is about code, data,
   schema, deploys, bugs, "fix", "build", "change".
2. **Free coding model.** When the free agent is about to write code (`commit_files`, or the conversation is a CODE job), route that step through the code ladder: `routes("code", "private")` already prefers
   FreeLLM `qwen3-coder-480b`. Make `llmChat` accept `task: "code"` and use that ladder with a larger
   `maxTokens` (4,000) and longer per-step deadline that still fits the 150 s platform limit. Reading steps keep the
   normal fast ladder.
3. **freeTry no longer punts CODE/DATA.** `NEEDS_TOOLS: CODE` / `DATA` / `ACTION` all go to the free agent with
   tools, never straight to a paid ask. Update the freeTry prompt and `FREE_WHY` copy accordingly.
4. **Three tries, then paid.** Replace `ask_paid` as a first resort with an escalation counter kept in
   `admin_chat_threads.run_state` (`tries`, `try_log: [{at, what, why}]`, reset when he sends a new request):
   - A **try** = one free attempt at the job that ends in a real failure: `commit_files` reverted by a failed
     build, the same tool failing twice in a row with no new approach,
     or the free agent declaring STUCK / calling `ask_paid`.
   - After a failed try, the free agent automatically starts the next try with the failure in its notes
     ("Try 2 of 3: the build failed with <error>; fix that"). These chain like the existing auto-continue hops.
   - **On the 3rd failed try:** if the Paid AI switch is ON, hand the job (with the try log) to paid Scout
     automatically. If it is OFF, post one message: what it was doing, the 3 tries in one line each, and
     `OPTIONS: Yes, use paid AI | Leave it`. The Paid AI switch stays the single master control (v30); never turn
     it on silently.
   - `ask_paid` stays as a tool but counts as a try, it doesn't skip straight to paid unless it's the 3rd.
5. **Copy.** Scout never says "only the paid AI can ..." again. Remove that wording everywhere (grep for
   "only the paid AI", "which only the paid", "free model doesn't have"). The system prompts (paid and free) get the
   same capability list.
6. **Privacy for code and data.** Code and data steps run `privacy: "private"` only. Fix the provider table so it
   matches its own notes: `gemini` and `openrouter` train on prompts, so `private_ok = false` for both (data
   migration in Part A's migration file is fine).
7. Version header: add `v38` at the top of the file with the why, house style.

## Part C (Jared chose option B, 2026-10-06 9:28 PM): schema and backend deploys stay one tap

No autonomous database-structure changes and no auto-deploy of edge functions. Instead:
- **Edge function code:** after `commit_files` touches `supabase/functions/`, Scout (paid or free) proposes a `mac_run`
  job that deploys exactly the changed functions from a fresh temp clone on the Mac mini
  (`supabase functions deploy <fns> --project-ref rcqfqhguwpmaarseifqg --use-api`, then delete the clone). Jared taps
  Run. Add this to both system prompts and make `commit_files`' result say so when such paths changed.
- **Schema / cron changes:** Scout files them in `improver_ideas` (kind 'schema', exact SQL in `change`) and tells
  Jared in one line it is queued, as the v37 prompt already says. No new migration tool.

## Verify (Sonnet, before committing)
- Part A tests above pass via Supabase MCP `execute_sql`.
- `npx -y esbuild@0.24.0 supabase/functions/admin-chat/index.ts --loader:.ts=ts --log-level=error > /dev/null` and the
  same for `_shared/free-llm.ts` parse.
- `npx tsc --noEmit -p tsconfig.app.json` still clean (no frontend changes expected).
- Do NOT deploy edge functions (Opus deploys after review).

## Ship
Commit with the session attribution lines, `git fetch origin main && git rebase origin/main && git push origin HEAD:main`,
confirm origin/main == HEAD. Report: commit, migrations, what changed in admin-chat (with line refs), test results,
anything you couldn't verify.
