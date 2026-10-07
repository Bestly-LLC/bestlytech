# Scout on free AI can do everything paid Scout can (opusplan)

Jared, 2026-10-06 9:00 PM, after Scout said "only the paid AI can edit the admin's code ... turn on paid AI for one
hour to fix it, or leave it broken and let the 13 errors/hour continue":
"This should not be true, there is free AI coding from LLM. Rework how Scout runs: he should have all the same
abilities as paid AI, and only call on paid AI when it fails after 3 tries."

Planned by Opus, executed by Sonnet. Three parts, one push. Mac mini install of the Deployer is done by Opus after.

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

1. **Same tools.** Free agent gets every tool paid Scout has: add `commit_files`, `db_write`, `mac_command` (and the
   new `apply_migration`, Part C) to `FREE_TOOLS`. Delete `PAID_ONLY_WHY` and the early return that hands those calls
   to paid. Confirmation rules are identical to paid (same `confirmed:true` after his yes / auto-run rules, same
   AUTOPILOT_NEVER list). Add them to `TOOL_TOPICS` so they ride along when the conversation is about code, data,
   schema, deploys, bugs, "fix", "build", "change".
2. **Free coding model.** When the free agent is about to write code (`commit_files`, `apply_migration`, or the
   conversation is a CODE job), route that step through the code ladder: `routes("code", "private")` already prefers
   FreeLLM `qwen3-coder-480b`. Make `llmChat` accept `task: "code"` and use that ladder with a larger
   `maxTokens` (4,000) and longer per-step deadline that still fits the 150 s platform limit. Reading steps keep the
   normal fast ladder.
3. **freeTry no longer punts CODE/DATA.** `NEEDS_TOOLS: CODE` / `DATA` / `ACTION` all go to the free agent with
   tools, never straight to a paid ask. Update the freeTry prompt and `FREE_WHY` copy accordingly.
4. **Three tries, then paid.** Replace `ask_paid` as a first resort with an escalation counter kept in
   `admin_chat_threads.run_state` (`tries`, `try_log: [{at, what, why}]`, reset when he sends a new request):
   - A **try** = one free attempt at the job that ends in a real failure: `commit_files` reverted by a failed
     build, `apply_migration` rejected or rolled back, the same tool failing twice in a row with no new approach,
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

## Part C: schema changes and function deploys without a human

Neither paid nor free Scout can change the database schema today, and code pushed by `commit_files` under
`supabase/functions/` never deploys. That's why the run_sql fix was "impossible". Close both gaps.

### C1. `apply_migration` tool (paid and free)
- New table `public.scout_migrations` (id uuid pk, thread_id uuid, name text, up_sql text, down_sql text,
  status text check in ('applied','failed','reverted'), error text, applied_at timestamptz, reverted_at timestamptz,
  created_at). RLS on; admin read policy (`has_role(auth.uid(),'admin')`).
- New function `public.scout_apply_migration(p_name text, p_up text, p_down text, p_thread uuid, p_allow_destructive boolean default false)`:
  SECURITY DEFINER, `set search_path = public`, **service_role only** (same check as `admin_sql_write`), revoked from
  public/anon/authenticated.
  - Refuses without a `p_down` (every change keeps an undo).
  - Refuses destructive statements unless `p_allow_destructive` (which the edge fn only passes after Jared's explicit
    yes): `drop table|schema|database`, `truncate`, `alter table ... drop column`, `delete`/`update` without `where`,
    anything touching `auth.`, `vault.`, `storage.`, `pg_catalog`, roles/grants to anon.
  - Runs `p_up` inside a `begin ... exception` block; on error records `failed` + error and re-raises nothing
    (returns `{ok:false,error}`).
  - On success inserts into `supabase_migrations.schema_migrations (version, name, statements)` with a
    `yyyymmddhhmmss` version so the migration history stays true, records `applied`, returns `{ok:true, version}`.
- New function `public.scout_revert_migration(p_id uuid)`: same guards, runs the stored `down_sql`, marks `reverted`.
- Edge tool `apply_migration` in admin-chat: `{name, up, down, confirmed}`; calls the RPC, then commits the same SQL
  to `supabase/migrations/<version>_<name>.sql` through `gitCall` so the repo matches. Tool result includes the
  revert id. Destructive changes require `confirmed:true` after his explicit yes; additive changes (create table,
  add column, create or replace function/view, create index, policies, cron schedules) follow the normal
  `confirmed` rule like `commit_files`.
- Add `scout_apply_migration` to whatever list Ares's audit uses so it isn't auto-locked (it's not anon-callable,
  so check that the audit only targets anon-callable functions and leave it if so).

### C2. Deployer (Mac mini, free, local)
- Script `tools/mac/deployer/deployer.py` + `tools/mac/deployer/tech.bestly.deployer.plist` (launchd, every 120 s).
  Opus installs it on the Mac mini after you push; write it so it's ready to drop in.
- Each run: `git ls-remote` main; if the head moved since the last deployed sha (state in
  `~/Library/Application Support/bestly-deployer/state.json`), shallow-clone main to a fresh temp dir, list
  `supabase/functions/<fn>/` folders changed since the last deployed sha (any change under `_shared/` = every function
  that imports the changed shared file; grep imports), run
  `supabase functions deploy <fns...> --project-ref rcqfqhguwpmaarseifqg --use-api`, delete the temp dir.
- Report every run to Supabase: new table `public.function_deploys` (id, sha, functions text[], ok boolean, output text
  (last 2 KB), at timestamptz) via an RPC `deployer_report(...)` callable with the service key the Mac already uses
  (find how existing Mac scripts like `scripts/mac/improver.py` authenticate and reuse that; never hard-code a key).
  On failure call `scout_notify` signed by the Deployer's owner.
- Heartbeat: write `agent_beat` (or the existing Mac job heartbeat pattern, see improver.py) every run so the watchdog
  catches a dead Deployer.
- Team card via `team_onboard` in the migration: slug `deployer`, name "Deployer", role "Ships edge functions",
  `tool_of` the head of engineering/CTO slug if one exists in `bestly_agents` (look it up; else `reports_to: "jared"`),
  `runs_on: "mac"`, pulse on `function_deploys.at` with gap 15 and alert true.
- `commit_files`: when the committed paths include `supabase/functions/`, the result says
  "Edge function change: the Deployer ships it within about 3 minutes" and Scout can check `function_deploys` with
  run_sql.

## Verify (Sonnet, before committing)
- Part A tests above pass via Supabase MCP `execute_sql`.
- `npx -y esbuild@0.24.0 supabase/functions/admin-chat/index.ts --loader:.ts=ts --log-level=error > /dev/null` and the
  same for `_shared/free-llm.ts` parse.
- `scout_apply_migration` dry test: apply a harmless migration (`create table public._scout_mig_test(id int)` with
  down `drop table public._scout_mig_test`) as service role, then `scout_revert_migration`, then confirm the table is
  gone and both rows are recorded; a destructive up without the flag is refused; `has_function_privilege('anon', ...)`
  and `('authenticated', ...)` are false for both functions.
- `python3 -m py_compile tools/mac/deployer/deployer.py`; `plutil -lint`-equivalent sanity (well-formed XML).
- `npx tsc --noEmit -p tsconfig.app.json` still clean (no frontend changes expected).
- Do NOT deploy edge functions (Opus deploys and installs the Deployer).

## Ship
Commit with the session attribution lines, `git fetch origin main && git rebase origin/main && git push origin HEAD:main`,
confirm origin/main == HEAD. Report: commit, migrations, what changed in admin-chat (with line refs), test results,
anything you couldn't verify.
