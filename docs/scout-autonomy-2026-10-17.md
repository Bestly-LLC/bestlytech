# Scout autonomy audit and v70

Date: 2026-10-17
Asked for: "review Scout's chat history, see where he does well and where he doesn't, make a plan to fix him to run free when he can and try to take on all and any tasks, even if he needs to spin up sub agents. Then execute the improvements."

## What was reviewed

Every row in `admin_chat_messages` (4,086 messages, 2,016 from Jared, 753 threads) and `admin_chat_actions` (10,000+ tool calls) from 2026-09-20 to 2026-10-17 20:33 UTC, plus `ai_spend` for the last 7 days and the open incident set.

## Where Scout is strong

- **Reading and evidence.** 3,964 successful `run_sql` reads, 1,465 `read_file`, 1,377 `list_files`, 233 `search_code`. When he reads first, his answers hold up: the mail-queue diagnosis, the FreeLLM tunnel diagnosis, the light/HA repair, and the call debriefs are all concrete and correct.
- **Machine work.** 522 successful `mac_run` jobs and 181 successful `pi_command` calls. He can diagnose and repair the estate when the fix fits a tool he already has.
- **Self-correction.** The lesson loop (`scout_lessons`, 46 saved lessons) and the "read the real columns" heal step visibly reduce repeated `run_sql` mistakes.
- **Recovery from paid-AI scarcity.** v38 free parity (commit_files, db_write, mac_command on free) and the 3-try escalation are a real improvement over the old "I need paid AI" wall.

## Where he fails, measured

1. **Autopilot has no hands. 510 fix-ladder attempts, only 30 ended `FIXED`, 251 ended `NEEDS_YES`.** The same incidents recur every 20 minutes (`key.windowsignal` 36, `car.roster` 33, `studio` 29, `scout.tools` 26). `AUTOPILOT_NEVER` blocked every repair, so the ladder could only describe the fix and ask for a yes nobody was there to give. This is the single biggest waste in the system.
2. **Paid replies dying on a protocol error. 32 replies: "anthropic 400: This model does not support assistant message prefill."** The 30-message history can end on an assistant turn (a progress note, or an auto-carried-on hop), and Anthropic rejects that. The request was already paid for and returned nothing.
3. **Invented admin pages. At least 10 replies told him to open `/admin/automations`, `/admin/acls`, `/admin/automation`, `/admin/client-asks` and others that do not exist.** On 2026-10-17 he said "that is not a real page", "stop lying", "stop arguing" and Scout repeated the same fake URL three times. No route list was in the prompt and no rule told him to believe the person looking at the screen.
4. **270 hand-typed "keep going" in four weeks.** Free runs stopped after 4 auto-hops, so jobs that needed 10-15 reads kept handing the baton back to him.
5. **Free capacity is the real ceiling.** `freellm` (the Pi router) failed 3,500+ calls in 7 days against 1,056 successes; Groq and Cloudflare carry the rest and Cloudflare hits its 10K-neuron daily cap by afternoon. 29 "Free AI is out of room" replies. This cannot be fixed in code without more provider keys (Gemini and OpenRouter are configured `private_ok=false`, so they are skipped for private chats).

## The real blocker, found live: Groq's 7K token gate

The autopilot kept answering `STUCK: The free AI isn't answering right now` in ~400 ms. Instrumenting the failure showed why: `freellm/skipped_off, groq/skipped_size, cloudflare/skipped_budget, gemini/skipped_privacy, openrouter/skipped_privacy` — **no provider was ever called**.

- `trimForBudget` measured only the chat messages, at `chars / 3.8`. `llmChat` measures messages **plus the tool schemas** plus the 1,200-token reply budget, at `chars / 3.5`. A request the trimmer thought was 3.7K tokens was 7.1K to Groq, so every Groq rung was skipped as `skipped_size`. Cloudflare was at its 9,000-neuron daily cap and FreeLLM was in cooldown, so the run died instantly.
- Fixes: the trimmer counts the tool payload at free-llm's own 3.5 divisor and targets 6,400; the free prompt keeps 15 lessons (was 30) and 8 queue items (was 12); autopilot tool descriptions are 150 chars; autopilot drops the admin-route and queue blocks it does not need; autopilot gets 110 s instead of the chat's 85 s; and the failure message now names the skipped rungs and the estimated request size.
- Result on the same incidents: 400 ms no-op failures became 5-tool-call runs (`run_sql`, `read_file`, `search_code`) that diagnose the real cause. They still hit the 110 s wall on the two hardest incidents (a code rule change and an upstream telemetry gap), but they now do work instead of dying.

## A second bug, found live after the first deploy

The first fix-ladder tick after the reset was due on 13 incidents at once. It fired 13 free diagnoses back to back through `llmChat`; they share Groq's per-minute budget, so every Groq model 429'd and the single Scout call in that tick failed in 360 ms with "The free AI isn't answering right now" — a `STUCK` verdict from a provider squeeze. `supabase/functions/fix-ladder/index.ts` now:

- caps cloud free diagnoses at **2 per tick** (the rest get `fix_next_at` +3 min),
- treats `Free AI is out of room` / `isn't answering right now` as **busy**, not stuck: the incident retries in 5 minutes instead of moving to the claude / needs-a-human pile.

## What changed (v70)

`supabase/functions/admin-chat/index.ts`, plus the two fixes above in `supabase/functions/fix-ladder/index.ts`.

- **Autopilot can repair.** `AUTOPILOT_NEVER` now only holds things that reach a person or spend money: `notify`, `clear_alerts`, `ask_user`, `make_video`, `send_email`, `report_spam`. `mac_run`, `commit_files`, `code_job`, `db_write`, `mac_command` and `pi_command` are `AUTOPILOT_REPAIRS`: they run unattended **only when `scout_settings.auto_run` is on** (his standing yes). With auto-run off, behavior is exactly as before. Code deploys still wait for his Run tap.
- **Unattended scripts are fenced.** A new `UNSAFE_AUTO_SCRIPT` guard refuses `sudo`, force pushes, `rm -rf /`/`~`, disk wipes, reboots, `launchctl unload/bootout` and `curl | sh` on a fix-ladder script. Scout is told to rewrite the step or return `NEEDS_YES`.
- **No more fake paid offer from autopilot.** The fallback that wrote `NEEDS_YES: Let Scout work on this with paid AI` is gone; autopilot never spends (v69), so it now returns the agent's own verdict.
- **Paid always gets a user turn.** The paid message list is closed with a user turn when a progress note or a hop left an assistant turn last. Kills the prefill 400.
- **Real routes only.** `ADMIN_ROUTES` (from `src/App.tsx`) is in both the paid and free system prompts, plus a hard rule: if he says a page is not real, believe him, stop repeating it, and check `src/App.tsx` or `src/pages` before naming a path again.
- **`delegate`: sub-agents.** New tool, paid and free, and always offered on the fix ladder. It runs 1-4 read-only sub-agents in parallel (5 steps / 55 s each, staggered 350 ms to spread Groq's per-minute budget), each with one narrow goal, and returns their findings. Children can only read (`run_sql`, `read_file`, `list_files`, `search_code`, `incidents`, `today`, mail, transcripts); the parent does every write, so a sub-agent cannot change the estate. Under 25 s left in the round it refuses and tells the parent to do the work itself.
- **Longer free runs.** `AUTO_HOPS` 4 -> 8 for a task; questions still never carry on, and the no-progress brake (two empty hops) is unchanged.

## Verify

1. `npx -y deno@2 check --node-modules-dir=auto --no-lock supabase/functions/admin-chat/index.ts` — clean.
2. `supabase functions deploy admin-chat --project-ref rcqfqhguwpmaarseifqg` — done 2026-10-17.
3. Live: `select created_at, role, left(body,300) from admin_chat_messages order by created_at desc limit 20;` after a fix-ladder tick should show `FIXED:` verdicts with tool calls, not `NEEDS_YES: Let Scout work on this with paid AI`.
4. `select tool, ok, count(*) from admin_chat_actions where tool='delegate' group by 1,2;` shows sub-agent use once a multi-part job arrives.

## Rollback

The pre-change production source is at `/tmp/scout-audit/supabase/functions/admin-chat/index.ts` on the Mac mini (v69 + kitchen_chef). Redeploy it with the same deploy command. The pre-change `fix-ladder` matches `origin/main`, so `git checkout origin/main -- supabase/functions/fix-ladder/index.ts` restores it. Turning `scout_settings.auto_run` off immediately restores the old autopilot behavior without a deploy.
