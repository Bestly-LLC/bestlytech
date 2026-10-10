# Maya Desk + Reese rename — opusplan (2026-10-10)

Planned by Opus, executed by Sonnet. Jared, Oct 10 4:06 PM: "make a new page/tab on /admin for this new Maya agent doing Bestly work. So we will have Ava for personal use, Maya for Sales and Service and RoofGuard Ava." Then chose: **personal keeps the name Ava; RoofGuard's caller is renamed Reese.**

## The three phone agents after this ships

| Agent | Line | Job | Admin |
|---|---|---|---|
| **Ava** | (816) 429-9495 | Jared's personal assistant (male voice = Ari) | `/admin/ava` (unchanged) |
| **Maya** | (213) 641-0074 | Bestly Sales & Service: support for every Bestly product, privacy requests, Bestly Agent sales | **`/admin/maya` (new)** |
| **Reese** | RoofGuard number | RoofGuard cold caller + inbound, books meetings with Eli | `/admin/roofguard` (labels renamed) |

## What already exists (built earlier today, NOT yet in the repo)

All live in Supabase project `rcqfqhguwpmaarseifqg`, applied through MCP. See bestly_memory `maya/onboarded-2026-10-10` and `maya/support-desk-2026-10-10`.

- ElevenLabs agent `agent_3701m4jbjnyef6ga4ys73xtbz37s` ("Maya - Bestly Sales Outreach"), phone `phnum_2501m4jea1d1enjt3tkyq4nps914`, Telnyx connection `3067494961063659261`. 10 knowledge-base docs (one per product). Webhook tool `file_ticket` = `tool_7901m4m0e2dvf0x9y469gf3cb4zn`.
- Table `support_tickets` (code `M-####`, kind `support|billing|privacy|callback|sales_lead`, product, name, email, phone, issue, privacy_action, conversation_id, status `open|done|spam`, due_at, resolved_at, note). RLS: `team_is_admin()` only.
- `maya_file_ticket(jsonb)` SECURITY DEFINER (execute revoked from public/anon/authenticated). Due: privacy 45 days, callback 4 hours, else 1 business day. Pushes a `scout_notify` titled `Maya: ...`, dedupe `maya-ticket-<code>`.
- `ava_line_health` check constraint widened to allow source `maya`.
- Edge functions `maya-ticket` (v2, verify_jwt **false**, auth = ElevenLabs confirms the conversation belongs to Maya and started < 2 h ago, max 3 tickets per call, phone falls back to caller ID) and `maya-watch` (v2, verify_jwt true; line + desk watchdog, self-heals number assignment, Telnyx FQDN and the ticket tool).
- Cron `maya-watch` at `6-59/10 * * * *` → `invoke_edge_function('maya-watch')`.
- Team cards `maya` (Sales & Support Rep, owns alert prefixes `maya`, `maya-ticket`) and tool `maya-line-check`.

## Hard rules for whoever executes this

1. **Supabase MCP `execute_sql` / `apply_migration` calls are cancelled at the approval layer if the SQL text contains the object-removal keyword (d-r-o-p), anywhere, even in a comment or string.** Never use it. Use `create or replace`, `alter ... add`, `if not exists`. Keep each MCP SQL call small (one or two statements). Updates to `bestly_memory` have also been cancelled: **insert** new memory rows instead of updating.
2. Migration files in the repo are append-only and must match what you applied. Same rule: no d-r-o-p in them, so they can be re-applied through MCP.
3. Admin RPCs: SECURITY DEFINER, first line `if not team_is_admin() then raise exception 'not allowed'; end if;`, then `revoke all ... from public, anon, authenticated; grant execute ... to authenticated;` (the guard stops non-admins). Do **not** add them to `security_public_rpcs`.
4. UI rules (Jared's standing rules): load `.claude/skills/apple-design` first, then a `ui-ux-pro-max` pass. Admin is dark (`admin-shell`). 12-hour times (`3:05 PM`), never 24-hour. A number never wraps away from its unit (`whitespace-nowrap` on "3 min", "45 days"). **Never truncate text with "..."**: shorten or wrap instead (no `truncate`/`line-clamp` on ticket text or names). Mobile-first: everything must work on a phone. No emoji.
5. Every alert is signed by its employee (`Maya: ...`, `Reese: ...`). Only the 4 interrupt kinds reach Jared (see `docs/autonomy-opusplan.md`); a real person waiting = Maya tickets, which is correct.
6. Commit and push to `main` without asking (CLAUDE.md). `git pull --rebase origin main` first.

## Phase 0 — put today's live pieces in the repo (source of truth)

- `mcp__Supabase__get_edge_function` for `maya-ticket` and `maya-watch`; write them verbatim to `supabase/functions/maya-ticket/index.ts` and `supabase/functions/maya-watch/index.ts`.
- Add `[functions.maya-ticket] verify_jwt = false` to `supabase/config.toml` (maya-watch stays default/true; add `[functions.maya-admin]` only if you need to state it).
- New migration `supabase/migrations/20261011000000_maya_support_desk.sql` recording what is already live: the `support_tickets` table + index + policy (`create policy` guarded with a `do $$ begin if not exists (select 1 from pg_policies where policyname = 'support_tickets_admin') then ... end if; end $$;`), the `ava_line_health` constraint (re-add via `alter table ... add constraint` inside an `if not exists` check on `pg_constraint`; it already exists live so do not re-run it), `maya_file_ticket`, the revoke, the `notification_owners` insert, and the `maya-watch` cron (inside `if not exists (select 1 from cron.job where jobname = 'maya-watch')`). Pull the live definitions with `pg_get_functiondef` rather than retyping. Do not re-apply this file; it documents state.

## Phase 1 — backend for the page

New migration `20261011001000_maya_desk_admin.sql`, applied through `execute_sql` one function per call:

- `admin_maya_tickets(p_view text default 'open')` → rows of `support_tickets` plus computed `overdue boolean` and `due_in_minutes int`. Views: `open` (status open, kind <> sales_lead, order by due_at), `leads` (kind sales_lead, status open, newest first), `done` (status in done/spam, resolved_at desc, limit 100), `all` (limit 200).
- `admin_maya_ticket_set(p_code text, p_status text, p_note text default null)` → validates status in `open|done|spam`; sets `resolved_at = now()` when done/spam, null when reopened; appends note (`note = concat_ws(E'\n', note, p_note)`). Returns the row.
- `admin_maya_counts()` → `jsonb {open, overdue, leads, privacy_open}`. Used by the sidebar badge (open + leads) and the page header.
- Extend the sidebar counts source: find where `counts` in `AdminSidebar.tsx` is filled (an RPC like `admin_nav_counts` or similar). Add a `maya` key = open tickets + open leads. If that RPC is SQL, `create or replace` it with the added key, keeping every existing key exactly.

New edge function `supabase/functions/maya-admin/index.ts` (verify_jwt **true**; copy the `isAdmin()` check and CORS block from `ava-assistant/index.ts` lines ~80-100; ElevenLabs key via `ava_secret('elevenlabs_api_key')` RPC or the `vault()` helper pattern there):

- `POST {action:"calls", limit?:25}` → `GET https://api.elevenlabs.io/v1/convai/conversations?agent_id=agent_3701m4jbjnyef6ga4ys73xtbz37s&page_size=25`, then for each conversation return `{conversation_id, started_at (ISO), duration_secs, status, caller (metadata.phone_call.external_number when present), direction, summary (analysis.transcript_summary or call_summary_title), tickets: [codes from support_tickets where conversation_id = id]}`. Fetch details with bounded concurrency (5 at a time). Cache nothing in localStorage on the client.
- `POST {action:"call", conversation_id}` → full transcript `[{role, text, t}]` (same `slim()` shape as ava-assistant), summary, data_collection results, tickets.
- On any upstream failure: return `{ok:false, error}` with a plain message, and `bestly_raise('maya.admin', 'problem', 'warning', 'Maya: my admin page can''t load calls', ..., 'maya')`; on success resolve it.
- Deploy with `mcp__Supabase__deploy_edge_function` (verify_jwt true).

## Phase 2 — the page: `/admin/maya` ("Maya Desk")

File `src/pages/admin/MayaDesk.tsx` (+ small components under `src/components/admin/maya/` if it grows past ~400 lines). Lazy route in `src/App.tsx` next to `ava` and `roofguard`: `<Route path="maya" element={<MayaDesk />} />`.

Reuse, don't fork: `src/components/admin/roofguard/AvaShared.tsx` has `LineStatus({source})` and `useLineHealth(source)` reading `ava_line_health`. Widen its `Source` type to include `"maya"` and use `<LineStatus source="maya" />`. Use the existing `table()` / `rpcArgs()` helpers from there (no types regeneration needed). Do not touch Ava or RoofGuard behavior.

Layout (top to bottom, phone first):

1. **Header**: "Maya" + subtitle "Sales & Service · (213) 641-0074" (number is a `tel:` link). `LineStatus` pill. Small stats row from `admin_maya_counts`: Open, Overdue (orange when > 0), Leads, Privacy.
2. **Segmented control** (iOS style): **Needs follow-up** (default) · **Leads** · **Calls** · **Done**.
3. **Needs follow-up** list (view `open`): one card per ticket.
   - Line 1: code (monospace) · kind chip (Support / Billing / Privacy / Call back) · product.
   - Line 2: name, phone (`tel:`), email (`mailto:`) — wrap, never truncate.
   - Body: issue text in full.
   - Due line: "Due today 7:56 PM", "Due Mon 3:04 PM", "Overdue by 2 hr" (orange), privacy: "Legal deadline Nov 24" plus days left; within 10 days = orange.
   - Actions: **Done** (primary), **Spam**, optional note field (expands on tap). Optimistic update, then refetch counts. Undo toast for 5 s that calls `admin_maya_ticket_set(code,'open')`.
   - Empty state: "Nothing waiting. Maya has it covered."
4. **Leads** (view `leads`): same card, kind "Demo request", actions **Contacted** (= done with note "contacted") and **Not a fit** (= done with note) and Spam.
5. **Calls**: list from `maya-admin` `calls`: time (12-hour, "Today 4:04 PM"), duration ("3 min"), caller number, one-line summary (wraps), ticket chips. Tap → bottom sheet (reuse `AvaSheet.tsx` if it fits) with transcript bubbles and the tickets. Pull-to-refresh / Refresh button. Loading skeletons, plain error text with Retry.
6. **Done**: view `done`, with **Reopen**.

Polling: counts every 60 s while visible (pause on `document.hidden`). No localStorage except the selected segment (wrapped in try/catch).

Sidebar (`src/components/admin/AdminSidebar.tsx`): new section **"Maya"** placed right after "Ava", item `{ title: "Maya", url: "/admin/maya", icon: Headset, countKey: "maya" }` (lucide `Headset`). Add it to `ALL_NAV_URLS` and `ADMIN_NAV_SECTIONS`. Check `MobileNav.tsx` and any section-order persistence (`admin_nav_prefs`) so a new section shows up for an existing saved order (append unknown sections at the end, or after Ava). Rename the RoofGuard nav item title to **"Reese"** and keep its section label "RoofGuard".

Team card: set `bestly_agents.admin_url = '/admin/maya'` for slug `maya`.

## Phase 3 — rename RoofGuard's caller to Reese

Spoken name and every label for the RoofGuard agent changes from Ava to Reese. Personal Ava is untouched. Historic call transcripts are not edited.

1. **Edge function `supabase/functions/roofguard-caller/index.ts`**: every spoken or prompt use of "Ava" for the RoofGuard agent → "Reese" (openers, `INBOUND_FIRST`, `KNOWN_FIRST`, voicemail, callback/inbound/outbound prompts, data-collection descriptions "True if Reese spoke ...", demo opener, user-facing errors like "Reese isn't set up yet.", notify titles `RoofGuard Ava:` → `Reese:`). Leave voice-clone library names (`Ava – <name>`) alone. Add one line to the inbound and callback prompts: `If a caller asks for Ava, say Ava was the old name for this line, you're Reese and you can help.` Deploy with MCP (verify_jwt must match what is live: check `supabase/config.toml` and the current deployment via `get_edge_function` before deploying).
2. **ElevenLabs**: rename the RoofGuard agent (`roofguard_settings.agent_id` or the row the function reads; find it with SQL) to `RoofGuard caller (Reese)` and update its first message if it is stored on the agent. Use `mcp__ElevenLabs__agents_update` for the name; only change the prompt there if the function does not push prompts on every call (read `roofguard-caller` setup to see which side owns the prompt).
3. **Stored scripts and knowledge** in the DB: find RoofGuard script/opener rows containing "Ava" (the table behind `scripts.get("gk_role_first")`, plus the knowledge list "What Ava can share") and update them to Reese. Inspect before writing; one table per call.
4. **SQL functions** whose bodies say `RoofGuard Ava`: list them first (`select proname from pg_proc where prosrc ilike '%RoofGuard Ava%'`). For each, take `pg_get_functiondef`, replace `RoofGuard Ava` → `Reese` (and `RoofGuard Ava's` → `Reese's`), `create or replace` it, one function per call. Save the same definitions into migration `20261011002000_rename_roofguard_ava_reese.sql`.
5. **Team cards** (`bestly_agents`): slug `roofguard-caller` name → `Reese`; fix `what_it_does` text on its tools and on `ava-call-quality`, `rg-review`, `rg-scorecard`, etc. that say "RoofGuard Ava" or "both Avas" → "Reese" / "Ava and Reese".
6. **Frontend**: in `src/pages/admin/RoofGuard.tsx`, `src/components/admin/roofguard/*` and `src/pages/partner/PartnerKnowledge.tsx`, change user-visible strings that mean the RoofGuard agent. Shared components (`AvaShared.tsx`, `AvaCalls.tsx`, `AvaVoice.tsx`, `AvaCoach.tsx`, `AvaStatusLights.tsx`, …) serve both lines through `source`: add a tiny helper `agentName(source) => source === "roofguard" ? "Reese" : source === "maya" ? "Maya" : "Ava"` in `AvaShared.tsx` and use it wherever a label says "Ava" and the component is shared. Do not rename files, components, tables, columns or RPCs (internal names stay; only what Jared sees changes).
7. **ava-coach / ava-call-quality** edge functions: if their prompts or notify titles name the RoofGuard agent "Ava", switch to `agentName(source)`. Deploy any changed function.

## Phase 4 — verify, ship, record

- `npx tsc --noEmit -p tsconfig.app.json` (ignore the two known `WowButton.tsx` errors) and `npm run build` must pass.
- SQL checks: `select admin_maya_counts()` as postgres works; `admin_maya_tickets('done')` returns the closed test ticket `M-6523`.
- Edge: `curl` the `maya-admin` function without auth → 401. Run `select invoke_edge_function('maya-watch','{}'::jsonb, 90000)` and confirm `ok:true` in `net._http_response`.
- `grep -rn "RoofGuard Ava" src supabase/functions` returns nothing user-visible.
- Commit in logical commits (`maya desk backend`, `maya desk page`, `rename RoofGuard caller to Reese`), `git pull --rebase origin main`, `git push origin main`. End commit messages with the attribution lines from the session.
- Insert (do not update) a `bestly_memory` row: area `maya`, key `maya/desk-page-2026-10-11`, kind `decision`, listing what shipped, commits, and anything skipped. Insert another: area `roofguard`, key `roofguard/renamed-reese-2026-10-11`.

## Out of scope

- Carrying out privacy deletions (only intake + tracking).
- A web chat widget for Maya on bestly.tech.
- Changing Maya's prompt or knowledge base.
