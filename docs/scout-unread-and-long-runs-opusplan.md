# Scout: unread dots + longer free-AI runs (opusplan)

Jared, 2026-10-06 7:26 PM: "if I have unread messages from Scout in chat have a purple dot with normal
things waiting for me, and orange for urgent or needs follow-up from me. Can we also have Scout go on
longer runs to get the task done on free AI?"

Planned by Opus, executed by Sonnet. Two independent parts; ship both in one push.

---

## Part A: unread dots (purple = waiting, orange = needs you)

### What he sees
- **Launcher (desktop pill, bottom right):** a dot on the Scout pill.
  - **Orange** if anything needs him: an unread Scout reply that asks him something (see "needs you" below),
    a proposed Mac job waiting for Run, or an urgent Needs-you item (`urgent.length > 0`, today's red case).
  - **Purple** if there are only normal unread Scout replies or normal Needs-you items.
  - Nothing when there's nothing unread and nothing waiting.
- The existing count pill keeps its number but takes the same two colors (orange replaces today's red,
  purple replaces today's amber). With unread messages but no count, show just the dot (8 px, ring
  `ring-2 ring-white` so it reads on the white pill).
- **Phone:** find where the phone opens Scout (launcher is `hidden md:flex`; `MobileNav.tsx` has
  "Ask Scout" via `openScout()`; check the bottom tab bar / any Scout button on mobile) and put the same
  dot on that entry point. The dot must be visible without opening a sheet if a tab-bar item exists.
- **History list inside Scout:** each thread row gets the same dot (orange/purple) when unread.
- **Inside an open chat:** no dot for that thread (it's being read).

### Definitions
- **Unread** = thread has an `assistant` message with `created_at > admin_chat_threads.read_at`
  (null `read_at` = everything unread, but the migration backfills, see below).
- **Needs you** (orange) for a thread = its latest unread assistant message contains any of:
  `QUESTIONS:` (ask_user card), `NEEDS_YES` , `Yes, use paid AI`, `I'd need paid AI`,
  or the thread has a `mac_jobs` row with `status = 'proposed'`.
  Do NOT treat a plain `OPTIONS:` line as needs-you: Scout ends almost every reply with OPTIONS.

### Database (one migration, applied via Supabase MCP `apply_migration`, file in `supabase/migrations/`)
1. `alter table admin_chat_threads add column if not exists read_at timestamptz;`
2. Backfill so he doesn't open to 300 unread threads: `update admin_chat_threads set read_at = now();`
3. Replace view `admin_chat_thread_list`, keeping its current columns **in the same order**
   (id, title, created_at, updated_at, message_count, last_body) and appending:
   - `unread int` (count of assistant messages after `coalesce(read_at, '-infinity')`)
   - `needs_you boolean` (rules above; latest unread assistant message or proposed mac job)
4. RPC `public.admin_chat_mark_read(p_thread uuid) returns void`, `security definer`,
   `set search_path = public`, first line `perform public.admin_require_admin();`, sets
   `read_at = now()` on that thread. `revoke all on function ... from public, anon; grant execute ... to authenticated;`
   (CLAUDE.md: Ares locks any SECURITY DEFINER fn callable by anon, so the revoke is required.)
5. Regenerate types only if the build needs it; otherwise cast like the existing code does (`as any`).

### Frontend (`src/components/admin/Scout.tsx`, plus the phone entry point)
- New hook `useScoutUnread(open)` (own small file, e.g. `src/components/admin/scoutUnread.ts`):
  reads `admin_chat_thread_list` rows with `unread > 0` (select id, unread, needs_you), polls every 30 s
  and on `visibilitychange`, same pattern as `useNeedsYou`. Returns `{ threads, anyUnread, anyNeedsYou, refresh }`.
  If a tiny shared store/event is needed so the phone entry and the launcher agree, follow `scoutBus.ts`.
- Mark read: whenever the panel is open, `view === "chat"`, the doc is visible, and `threadId` is set,
  call `admin_chat_mark_read(threadId)` - on opening the thread and again when new messages land
  while he's looking (debounce ~1 s). Then refresh the unread hook.
- Color rule in one place: `dotColor = anyNeedsYou || urgent.length || pendingJobs ? orange : (anyUnread || needs) ? purple : none`.
  Use `#FF9F0A` (Apple orange) and `#BF5AF2` (Apple purple) to match the HIG tints already used in the admin.
- History rows: dot from the hook's per-thread data.
- Respect `prefers-reduced-motion` (existing `.scout-badge-pop` pattern already handles it).
- Accessibility: `aria-label` on the launcher includes "unread replies" / "needs you" when the dot shows.

## Part B: longer free-AI runs

### Why runs stop short today (from the data, 2026-10-06)
- A free run is 10 steps / 85 s per hop, then it re-invokes itself (`AUTO_HOPS = 8`).
- **Each hop starts from scratch.** `freeAgent()` rebuilds context from the last 10 chat messages only;
  the tool calls and results from the previous hop are gone. So hop N re-reads what hop N-1 already
  found. The 11:50 AM-11:58 AM run on Oct 6 posted eight "Found so far..." notes re-discovering the same
  meeting and to-dos, then ran out of hops and asked "Keep going". He then types "Keep going" by hand
  (41 times in 2 days).
- Every hop posts a new "...Still working on it." message: noise, and each one is a new unread.

### Changes (in `supabase/functions/admin-chat/index.ts`)
1. **Carry working memory across hops.** Add `admin_chat_threads.run_state jsonb` (same migration as Part A).
   At the end of every free hop that will continue, save a compact state:
   `{ goal, hop, started_at, notes: [...], calls: [{tool, args_hash, args (short), result (<= 600 chars)}...] }`
   capped at ~12 KB (keep the newest results; older ones collapse to one-line notes).
   At the start of a continuing hop (`auto_continue > 0`), load `run_state` and inject it as a message:
   "You are continuing your own run. Here is what you already did and found: ... Do not repeat these calls;
   pick up with what is left." Clear `run_state` when the run finishes, stops (`supersededSince`), or he sends
   a new message (new run).
2. **Skip repeat calls.** Inside the free tool loop, if a call's `tool + args_hash` is already in `run_state.calls`,
   return the saved result instead of running it again (marked `"(from earlier in this run)"`).
3. **More room per run.** `AUTO_HOPS` 8 -> 24, plus a wall-clock cap of 20 minutes per run
   (`chain_from` already marks the start). `FREE_STEPS` 10 -> 14 (the 85 s budget still bounds each hop).
4. **No-progress stop.** If a hop makes zero new (non-cached) tool calls, or two hops in a row add no new
   notes, stop and post the summary with `OPTIONS: Keep going | Yes, use paid AI` (as today). Never loop forever.
5. **One progress message, not eight.** The first hop posts its progress note; later hops **update that same
   message's body** (store its id in `run_state.progress_msg_id`) with the newest one-line status and a step count,
   e.g. "Still working on it (step 23, 4 min in): checking the Pi ports." The final answer is a new message
   (so it marks unread once). Make sure the window re-fetches an updated message (it reloads the thread;
   verify edits show without a reload).
6. Keep everything else as is: a new message from him still stops the chain (`supersededSince`), free Mac jobs
   still wait for his Run tap, paid AI budget untouched, autopilot path untouched.
7. Update the version header comment at the top of the file (v35) with the why, matching the house style.

### Not in scope
- Paid AI run length. Free AI only.
- Changing which tools the free model has.

## Verify (Sonnet does these before committing)
- `npx tsc --noEmit -p tsconfig.app.json` clean (two old WowButton errors allowed), `npm run build` passes.
- `npx -y esbuild@0.24.0 supabase/functions/admin-chat/index.ts --loader:.ts=ts --log-level=error > /dev/null` parses.
- Migration applied; `select id, unread, needs_you from admin_chat_thread_list limit 5` works;
  `admin_chat_mark_read` exists and is not executable by anon
  (`select has_function_privilege('anon','public.admin_chat_mark_read(uuid)','execute')` = false).
- Do NOT deploy edge functions (Opus deploys from the Mac mini after review).

## Ship
Commit (scoped message, attribution lines from the session) -> `git pull --rebase origin main` -> `git push origin main`.
