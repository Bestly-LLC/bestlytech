# Agent template: Maya parity + "+ New agent" — opusplan (2026-10-10)

Planned by Opus, executed by Sonnet in two runs. Jared, Oct 10 5:49 PM: "match the other UI UX pieces we have with Reese and Ava. There's a lot missing. Include the ability to have this as a template to start from (then we code and tailor the use case like we are with RoofGuard). I want a + button and quick bits that autofill with AI to create a new agent easily, cheaply or for free when we can; if need be it has a one-click copy-paste to Claude to build, alternatively paid AI with Scout."

## Why a generic layer (read this first)

The Ava/Reese pages are wired to exactly two agents: `Source = "ava" | "roofguard"` in TS, `CHECK (source in ('ava','roofguard'))` on ~8 tables, if/elsif RPCs, separate call tables (`ava_calls`, `rg_calls` with a NOT NULL lead link), singleton settings rows. Maya has none of it: no call table, no webhook ingest, no spend, coach, voice or settings.

Widening every two-agent table would mean removing CHECK constraints (the Supabase MCP cancels those statements) and touching live Ava/Reese code paths. Instead:

- **Ava and Reese stay exactly as they are** (legacy pages; no refactor, no behavior change).
- A **generic agent layer** (`voice_agents` registry + `agent_*` tables + one `agent-hub` edge function + one `AgentDesk` page) serves Maya now and every new agent later. It copies the **look and interaction patterns** of the Ava/Reese components (same cards, orb, chips, sheets, CollapsibleSection) rather than their data plumbing.
- New agents = a row in `voice_agents` + an ElevenLabs agent. Tailoring beyond the template = code, like RoofGuard (copy-to-Claude or Scout).

## Global rules (both runs)

1. **No SQL text containing the object-removal keyword (d-r-o-p)** anywhere. No constraint removal. Additive only: `create table if not exists`, `create or replace`, `alter table ... add column if not exists`. One or two statements per MCP call. If a call returns `{"status":"cancelled"}`, retry once smaller, then skip and report. Never UPDATE `bestly_memory`; insert.
2. Do not change Ava's or Reese's pages, edge functions (`ava-assistant`, `roofguard-caller`, `ava-coach`, `ava-voices`, `ava-call-quality`) or their tables. Do not touch Maya's billing code (`maya-billing`, `maya-pay`, `maya_billing_*`, `maya_verifications`, `maya_pay_links`, refunds) or Vera's privacy code beyond what this plan says.
3. Maya's live ElevenLabs agent (`agent_3701m4jbjnyef6ga4ys73xtbz37s`) is customer-facing. The only changes allowed on it: attach the post-call webhook (Run 1, Phase 1) and voice/LLM/prompt changes Jared makes himself from the new UI. Never rewrite her prompt or tools from code.
4. Admin RPCs: SECURITY DEFINER, first line `if not team_is_admin() then raise exception 'not allowed'; end if;` (fixed today to use session_user), revoke from public/anon/authenticated, grant to authenticated.
5. Every new table holding phones/emails/names gets `privacy_data_map` rows in the same migration (CLAUDE.md rule).
6. Every scheduled job gets a team card via `team_onboard` (CLAUDE.md rule). Every alert signed by the employee that owns it.
7. UI: `.claude/skills/apple-design` first, then `ui-ux-pro-max` pass. Admin dark. Match Ava's page visual language exactly (`rounded-3xl bg-white/[0.03] ring-1 ring-white/10`, AvaOrb, chips, sheets). 12-hour times, no "..." truncation, numbers never split from units, no emoji, 44px targets, phone-first.
8. Free AI first: wizard and coach use `_shared/free-llm.ts` `llm({... paid: "never"})` or the `free-llm` edge function `{op:"run"}`. Paid AI only through Scout (`askScout`) when Jared taps it.
9. Commit + push to main per phase (`git pull --rebase origin main` first; other sessions push in parallel). Attribution lines as instructed.

---

# RUN 1 — the generic layer and Maya parity

## Phase 1: data + ingest

Migration `supabase/migrations/20261011030000_agent_layer.sql` (apply in small MCP calls):

- **`voice_agents`**: slug text pk (`^[a-z][a-z0-9-]{1,31}$`), name, purpose (text: "Personal", "Bestly", "RoofGuard", or free text), kind (`legacy` | `template`), page_url, elevenlabs_agent_id, phone_number_id (ElevenLabs), line_e164, voice_id, llm, orb_hue int (0-359), status (`draft` | `live` | `paused`), modules text[] (template feature modules, e.g. `{tickets,privacy,calls,coach,voice,knowledge,spend}`), settings jsonb (`cost_per_min` numeric default 0.12, `daily_cap` numeric default 10, `coach_on` bool default true, `watch` text null), tool_ids text[], webhook_id text, created_at, updated_at. RLS admin only.
  Seed: `ava` (legacy, "Personal", page `/admin/ava`), `reese` (legacy, "RoofGuard", page `/admin/roofguard`), `maya` (template, "Bestly", page `/admin/maya`, elevenlabs_agent_id `agent_3701m4jbjnyef6ga4ys73xtbz37s`, phone_number_id `phnum_2501m4jea1d1enjt3tkyq4nps914`, line `+12136410074`, modules `{tickets,privacy,calls,coach,voice,knowledge,spend}`, tool_ids `{tool_7901m4m0e2dvf0x9y469gf3cb4zn}` plus any other tool ids currently attached to her (read them with the ElevenLabs MCP `agents_get` and copy them; do not change the agent), settings.watch `maya-watch`).
- **`agent_calls`**: id uuid pk, agent_slug fk → voice_agents, call_no int (per agent, assigned by trigger: max+1), conversation_id text unique, direction (`inbound`|`outbound`|`web`), phone text, caller_name text, started_at, duration_secs int, status text, summary text, title text, transcript jsonb (`[{role,text,t}]`), data jsonb (data-collection results), cost numeric (duration/60 × agent cost_per_min), has_audio bool, read_at, archived_at, created_at. Index (agent_slug, started_at desc). RLS admin only. Privacy map rows: `agent_calls.phone` → delete (phone match).
- **`agent_reviews`**: id, call_id fk, agent_slug, score int 0-10, went_well text, fix text, model text, created_at. **`agent_playbook`**: id, agent_slug, line text, why text, status (`proposed`|`on`|`off`), source_call_id, created_at, decided_at. **`agent_health`**: agent_slug pk, ok bool, problems jsonb, healed bool, checked_at, last_ok_at, last_sync_at.
- RPCs (admin): `admin_agents()` (registry for the sidebar and pages, legacy included), `admin_agent(slug)`, `admin_agent_set(slug, patch jsonb)` (whitelisted keys: name, purpose, orb_hue, status, settings.cost_per_min 0–5, settings.daily_cap 0–500, settings.coach_on), `admin_agent_calls(slug, view text default 'all', lim int default 50)` (views all/unread/archived), `admin_agent_call(id)`, `admin_agent_call_set(id, action text)` (read/unread/archive/unarchive/delete — delete removes the row; it never touches ElevenLabs), `admin_agent_spend(slug)` → `{today, cap, over, month}`, `admin_agent_coach(slug)` → `{avg_score_7d, reviews:[...20], proposed:[...], on:[...]}`, `admin_agent_playbook_set(id, status)`.

Edge function **`agent-hub`** (`supabase/functions/agent-hub/index.ts`). Two doors:
- `POST ?hook=post` (verify_jwt **false**; add to `config.toml`): ElevenLabs post-call webhook. Verify the HMAC exactly like `roofguard-caller` `hook()` does, using a secret saved in Vault via `home_hub_vault_put('agent_hub_webhook_secret', ...)` and read with `home_hub_vault_get` (service role). Accept only `post_call_transcription` events whose `agent_id` matches a `voice_agents` row of kind `template`; ignore everything else with 200. Upsert `agent_calls` by conversation_id (phone from `metadata.phone_call.external_number`, direction, duration, summary from `analysis.transcript_summary`, title from `analysis.call_summary_title`, data from `analysis.data_collection_results`, transcript slimmed like ava-assistant's `slim()`).
- Everything else: verify_jwt is false for the hook, so the function itself must check the admin for non-hook actions (copy `isAdmin()` from `ava-assistant`; also accept the service role for cron). Actions:
  - `setup {slug}`: create the workspace webhook "Agent hub post-call" pointing at `.../agent-hub?hook=post` if `voice_agents.webhook_id` is null (store its secret via `home_hub_vault_put`), then attach it to that agent through `platform_settings.workspace_overrides.webhooks.post_call_webhook_id` (exactly as `ava-assistant` setup does around its line 453). Read back the agent to confirm. **This is the only change made to Maya's agent.**
  - `sync {slug, limit=100}`: list the agent's conversations, upsert any missing into `agent_calls` (backfills history; also the watchdog's safety net).
  - `live {slug}`: in-progress conversations with transcript so far (same shape as `ava-assistant` `live`).
  - `audio {id}`: stream the recording (`GET /v1/convai/conversations/{cid}/audio`).
  - `voices {slug}` / `voice_say {voice_id, text}` / `voice_use {slug, voice_id}`: list the account's voices, preview, set the agent's TTS voice (PATCH `conversation_config.tts.voice_id`) and `voice_agents.voice_id`.
  - `kb_list {slug}` / `kb_get {doc_id}` / `kb_save {slug, doc_id?, name, text}`: list the agent's knowledge docs, read one, save (create a new text doc and swap it into the agent's KB list, keeping the others; ElevenLabs text docs are not edited in place).
  - `prompt_get {slug}` / `prompt_set {slug, prompt, first_message}`: for template agents only, and only when Jared presses Save in the UI.
  - `playbook_push {slug}`: rewrite only the block between `<!-- playbook -->` and `<!-- /playbook -->` in the agent prompt with the `on` playbook lines (append the block at the end if missing). Called when Jared approves a playbook line.
- Deploy; run `setup` and `sync` for `maya`; confirm her test call `conv_7501m4m0w24efvgadywfzj1jd3rh` shows up as call #1.

## Phase 2: watchdog + coach

- Edge function **`agent-watch`** (verify_jwt true) + cron `agent-watch` `8-59/10 * * * *` (inside `if not exists`). For each template agent: agent exists; post-call webhook still attached (re-attach); every `tool_ids` entry still attached (re-attach); if `settings.watch` is null, its phone number is still assigned to it (reassign); `sync` the last 20 conversations (heals missed webhooks); today's spend over cap → raise `<Name>: I'm over today's spend cap ($x of $y)` (money → interrupt). Write `agent_health`. Alerts `bestly_raise('agent.<slug>', ...)` signed with the agent's name. Team card: slug `agent-watch`, name **Switchboard**, role "Agent line keeper", reports_to `scout`, owns `agent.`.
- Edge function **`agent-coach`** + cron `agent-coach` every 15 min at :11 (if not exists). For template agents with `coach_on`: review new calls over 20 s with free AI (`llm({task:"write", json:true, paid:"never", job:"agent-coach"})`): score 0–10, one thing that went well, one thing to fix. Once a week (Mondays 6:30 AM Pacific) propose up to 3 playbook lines per agent from the week's fixes (status `proposed`). Nothing goes live without Jared's Approve (which calls `playbook_push`). Team card: slug `agent-coach`, name **Coach**, role "Call coach for template agents", reports_to `hr`.

## Phase 3: the template page — `AgentDesk`

`src/pages/admin/AgentDesk.tsx` + `src/components/admin/agent/*`. Route `/admin/agents/:slug`; `/admin/maya` renders `<AgentDesk slug="maya" />` (keep the URL). Data from `admin_agent(slug)` etc.

Top (mirrors Ava's header, in this order):
1. **AvaOrb** tinted by `orb_hue` (add an optional `hue` prop to `AvaOrb.tsx` that defaults to today's look; Ava/Reese render unchanged), name, purpose chip ("Bestly"), line number with copy button.
2. **Status lights** row (new `AgentLights`, same look as `AvaStatusLights`): Line (agent_health), Calls in (last sync / webhook freshness), Coach, Spend.
3. **Live pill + live banner** with `LiveTranscript` (reuse the component from `AvaCalls.tsx`; poll `agent-hub live` every 10 s only while the tab is visible and the pill says live).
4. **Spend chip** (today vs cap; tap → cap editor) and **Settings button** → sheet: cost per minute, daily cap, coach on/off, status (live/paused), orb color, "Run setup again" (agent-hub setup), "Sync calls now".

Body (modules, in collapsible columns; Maya keeps her Sales · Service · Messages columns from `docs/maya-desk-columns-opusplan.md`):
- **Messages / Calls** (module `calls`): replace Maya's `MayaCallsList` (maya-admin) with `agent_calls`: numbered rows "#12 · Today 4:04 PM · 3 min · (213) 555-0100", title/summary, unread dot, ticket chips. Tap → **call sheet** modeled on Ava's `MessageSheet`: transcript bubbles, recording player (agent-hub audio), Share (copy a plain-text transcript), coach review (score + notes), Archive, Delete (confirm). "Archived" disclosure at the bottom.
- **Tickets / Privacy** (modules `tickets`, `privacy`): Maya's existing Sales and Service columns and `TicketCard` + `PrivacyCasePanel`, unchanged.
- **Coach** (module `coach`), collapsible section below the columns: 7-day average score chip, recent reviews, proposed playbook lines with Approve / Skip, live playbook lines with Turn off. Same look as Ava's `CoachSection`.
- **Voice** (module `voice`): current voice, list with preview (play sample line "Hey, this is {name} with {purpose}. What can I help you with?"), Use this voice.
- **Knowledge** (module `knowledge`): the agent's knowledge docs (name, size), open to read, edit and save (agent-hub kb_save), add new.
- **Prompt** (template agents, collapsed by default): greeting + prompt editor with Save (agent-hub prompt_set), plus "Improve with free AI" (free-llm `{op:"run"}`: tighten the prompt per Jared's one-line note, show a diff-ish before/after, Save only on tap). Maya's section shows a banner "Customer-facing: changes go live on her next call."
- **Tailor this agent** card (always last): see Run 2 Phase 5; in Run 1 render it with the Copy-for-Claude and Ask Scout buttons only.

Sidebar: Agents group renders from `admin_agents()` (fallback to today's three static items if the call fails): `"<name> (<purpose>)"`, legacy ones keep their URLs and icons, template ones go to `page_url` with a tinted orb icon. Maya keeps her badge.

Verify Run 1: tsc (ignore pre-existing errors you didn't cause), build, Playwright screenshots of `/admin/maya` (desktop + phone) via an isolated mock entry like the columns run did (delete it before committing), webhook ingest proven by `sync` + one synthetic hook POST with a bad signature → 401. Commit per phase. Insert bestly_memory `agents/template-layer-2026-10-11`.

---

# RUN 2 — "+ New agent" wizard, template, tailoring

## Phase 4: the + button and wizard

- In the sidebar Agents group header: a **+** button (aria-label "New agent") → `/admin/agents/new`. Also a "New agent" button on each AgentDesk header overflow.
- `src/pages/admin/AgentNew.tsx`, one screen, phone-first, sections stacked:
  1. **Who is it for?** Purpose chips: Personal · Bestly · RoofGuard · A client business · Something else (free text). Name field (suggest names via free AI, 3 chips, tap to use).
  2. **Quick bits** (multi-select chips, each maps to prompt blocks + modules): Answers questions · Takes messages · Books appointments · Qualifies leads · Sells a product · Support tickets · Privacy requests · Calls people (outbound) · Website chat. Selecting Support tickets / Privacy requests adds the `tickets` / `privacy` modules and attaches the existing `file_ticket` tool only if Jared ticks "Use Maya's ticket desk" (otherwise none).
  3. **One line about the job** (text) + **Autofill with free AI** button → free-llm `{op:"run", task:"write", json:true, paid:"never"}` returns `{greeting, prompt, knowledge_starter, data_fields:[{name,description}], team_card:{role, what_it_does}, orb_hue}`; every field lands in an editable box (nothing is hidden). Show "Free AI · $0" under the button. If free AI fails 2x: show "Autofill with Scout (paid)" → `askScout(...)` with the full spec, and the copy-for-Claude button.
  4. **Voice**: same picker as the Voice module (agent-hub voices list + preview); default to Maya's voice.
  5. **Line**: Web only (free) · Use a spare number (lists ElevenLabs phone numbers with no agent assigned, from agent-hub `numbers_free`) · Buy a number: not automated; shows "Buying a number costs money. Ask Scout" → `askScout("Buy a phone number for agent <slug> ...")`. Never buys anything itself.
  6. **Create** → agent-hub `create {spec}`: creates the ElevenLabs agent (`POST /v1/convai/agents/create`, LLM default = Maya's current LLM, prompt = generated prompt + an empty playbook block, first message, voice, knowledge doc from `knowledge_starter`, data collection fields, `end_call` built-in), assigns the spare number if chosen, inserts `voice_agents` (kind template, status live), runs `setup`, onboards the team card (`team_onboard`, dept from purpose: Personal→desk, Bestly→sales, RoofGuard→sales, client→sales, reports_to `jared`, owns `agent.<slug>`), returns the page URL. Show a checklist as it runs (Agent made · Voice set · Knowledge added · Number assigned · Calls hooked up · On the Team page) with a retry per failed step (agent-hub `create` must be idempotent per slug).
- Cost line on the page: "Making the agent: free. Calls: about $<cost_per_min> a minute." No emoji.

## Phase 5: tailoring (template → custom, like RoofGuard)

"Tailor this agent" card on every AgentDesk:
- Text box "What should it do that the template can't?"
- **Copy build prompt for Claude** (one click, reuse the CopyButton with execCommand fallback from `RoofGuard.tsx:105`): copies a complete Claude Code prompt: repo `Bestly-LLC/bestlytech`, read `CLAUDE.md` and `docs/agent-template-opusplan.md`, the agent's registry row (slug, ElevenLabs agent id, modules, purpose), the text box content, the rule "plan with Opus in docs/<slug>-opusplan.md, build with Sonnet", the global rules above, and "keep it on the template unless a custom page is truly needed; if so add `src/pages/admin/agents/<Slug>.tsx` and point `page_url` at it, like RoofGuard".
- **Ask Scout to build it (paid AI)** → `askScout(samePrompt, { about: "agent:<slug>" })`.
- **Free AI first**: if the request is prompt-only (tone, script, knowledge), offer "Try with free AI" that runs the Improve-prompt flow instead of a code change.

## Phase 6: docs, verify, ship

- `docs/agents.md`: what the template gives you, how to make one (+ button), how to tailor, where code lives, the legacy vs template split.
- CLAUDE.md rule line: "New phone agents start from the agent template (`voice_agents`, `agent-hub`, `AgentDesk`); never fork Ava's or Reese's pages."
- End-to-end test: create a **test agent** `test-desk` (Web only, no number, Autofill with free AI), confirm the page renders and the team card exists, then set it to `paused` and leave it (do not delete agents in ElevenLabs; report its id).
- tsc, build, screenshots of `/admin/agents/new` and the new agent page (desktop + phone, isolated mock entry, removed before commit).
- Commit per phase, push, insert bestly_memory `agents/new-agent-wizard-2026-10-11`.

## Out of scope

- Migrating Ava or Reese onto the template (later, on purpose).
- Buying phone numbers, outbound calling for template agents, texting.
- Reply guard, people/contacts, calendars, voice cloning for template agents.
