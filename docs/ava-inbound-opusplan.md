# Ava answers both lines: opusplan (2026-10-04)

**Ask (Jared):** calling either number didn't reach Ava. Ava should answer **both** lines, help callers as much as she can from what she knows, like Scout does, without ever sharing secrets, API keys, private info or sensitive work. She takes messages and does follow-up calls. All of it shows in the UI on **both** /admin/ava and /admin/roofguard, built to Apple HIG. Planned by Opus, built by Sonnet.

## TL;DR

- **Why calls failed:** (816) 429-9495 reaches the voice platform, but its number record has incoming calls **off**. (816) 544-0206 has **no incoming route** (outbound-only connection) and its agent has no first line for incoming calls.
- **Fix:** turn incoming on for both, give RoofGuard an inbound connection, and add a "who's calling" lookup that sets her greeting and context per caller.
- **Knows what to say, not what to hide:** a curated `ava_knowledge` table of shareable facts is the **only** knowledge source. No path from a call to Vault, bestly_memory or other tables. The reply guard gains a `leak` check.
- **Messages + follow-ups:** every incoming call can leave a message. Ava proposes a follow-up call, and Jared taps **Call back** (nothing goes out as Jared without his yes).
- **Same UI on both pages:** Messages, Follow-ups, What Ava knows, and a line-health chip, as shared components.
- **Watchdog:** a line check every 10 minutes. If a number stops routing to Ava, it re-runs setup and alerts Scout.

---

## Phase 0: make both lines ring Ava (blocker)

| Line | Problem | Fix |
|---|---|---|
| (816) 429-9495 personal | ElevenLabs number `phnum_8701m44te3effder71azcctnr7fh` has `supports_inbound: false` | `ava-assistant` setup: in the PATCH branch, send `supports_inbound: true` (add `inbound_trunk_config` if the API requires it). Verify with GET `/v1/convai/phone-numbers`. |
| (816) 544-0206 RoofGuard | On Telnyx credential connection "RoofGuard ElevenLabs" (outbound only); ElevenLabs `supports_inbound: false`; agent `first_message` is `{{gk_opener}}`, which is empty on an incoming call | `roofguard-caller` setup: create FQDN connection **"RoofGuard in"** (TCP, `sip.rtc.elevenlabs.io:5060`, ANI `+E.164`), the same as "Ava assistant in", and assign 544-0206 to it. Outbound keeps working through the credential connection (that's how Ava's line already works). Set `supports_inbound: true`. Add an init webhook (below). |

**RoofGuard init webhook** (`roofguard-caller?hook=init`, secret header like Ava's `x-ava-init`; secret in Vault `rg_init_secret`):
- Outbound calls already carry their own variables. Keep them as they are, so only incoming calls get the inbound treatment.
- Incoming: look up the caller in `rg_leads` by phone. Return `conversation_config_override` with an **inbound prompt** and **first message**: "RoofGuard, this is Ava. How can I help?" (or "Hi, it's Ava from RoofGuard, thanks for calling back" if they're a lead we called). Variables: company, last call summary, open follow-up.
- Inbound prompt (receptionist mode): answer questions from shareable facts; book the 20-minute call with Eli the same way as outbound; otherwise take a message.
- **Callback routing to Eli stays on hold (Eli/Bill).** She never promises Eli will call. She says "I'll get this to the team and someone will follow up." Never transfer.
- Enable `overrides.enable_conversation_initiation_client_data_from_webhook` + `workspace_overrides.conversation_initiation_client_data_webhook` on the RoofGuard agent.

**Personal inbound** already has an init webhook (contact lookup). Add: today's date, local time, and the knowledge block (Phase 1).

## Phase 1: what she knows (safe by design)

- **New table `ava_knowledge`**: `id, scope ('personal'|'roofguard'|'both'), topic, fact, active bool, updated_at`, with admin RLS. It is the **only** knowledge source for calls.
- **Seed (shareable only):**
  - Personal: Jared runs Bestly LLC, a privacy-first product studio (bestly.tech); one-liners for InventoryProof, Cookie Yeti and In-House Cloud. For business inquiries she takes a message. She's his AI assistant and handles calls and messages.
  - RoofGuard: the program facts already in her prompt. Eli Cooper runs the program. Commercial roof maintenance for one monthly cost. No prices; Eli gives figures after a free assessment.
- **Compiled into the prompt** at setup ("What you can share") and sent fresh by the init webhook. Edge functions read only `ava_knowledge where active` and `ava_contacts` / `rg_leads` caller rows. **They never read Vault, bestly_memory, scout_*, or any other table into a prompt.**
- **Never share (prompt rule, both Avas):** Jared's cell, home address, schedule or whereabouts, finances, health, passwords, API keys, account details, internal tools or systems, client lists, other people's details, anything about how Bestly's software is built. Also "I can't share that, but I can take a message." Never confirm or deny what systems exist.
- **Reply guard gains `leak`:** scans agent lines for key-like strings (`sk-`, `xi-`, `eyJ`, 32+ hex characters), the words "api key", "password", "vault" or "token", Jared's cell number on an inbound call, and the home street. A hit raises a high-severity Scout push and a mandatory "work on" item. Add it to `ava_reply_scan` / `ava_reply_incidents.kind`.

## Phase 2: messages and follow-up calls (both lines)

- **RoofGuard inbound storage:** `rg_calls.lead_id` is NOT NULL. Add an **"Inbound caller (unknown)" placeholder lead** (like the demo lead, `rg_settings.inbound_lead_id`, `dnc = true` so the queue never dials it). Add to `rg_calls`: `direction text default 'outbound'`, `caller_name`, `message`, `urgent bool`, `callback_wanted bool`, `read_at`. Known leads attach to their own lead.
- **Post-call webhooks:** data collection for inbound adds `caller_name`, `message`, `urgent`, `callback_wanted` and `callback_time`. RoofGuard's hook **inserts** a row for incoming calls (there is no row yet). Scout push: "RoofGuard message from X: …" / "Message from X: …".
- **New table `ava_followups`** (shared by both): `id, source ('ava'|'roofguard'), call_id, phone, name, reason, due_at, status ('proposed'|'approved'|'dialing'|'done'|'dismissed'), result_call_id, created_at`. Admin RLS. A trigger on both call tables creates a `proposed` follow-up when `callback_wanted`.
- **Follow-up call:** Jared taps **Call back now** or **Approve for [time]**. Ava calls with context ("Hi, it's Ava, Jared's assistant, calling you back about …"). Approved and due rows get dialed by the existing 5-minute follow-up cron (extend `rg_followups_tick` or add `ava_followups_tick`). Nothing dials while `proposed`.
- **Personal callbacks** use the `ava-assistant` `call` action with `purpose` from the follow-up. **RoofGuard callbacks** use a new `roofguard-caller` `callback` action (receptionist-tone prompt, same rules).

## Phase 3: UI, the same on both pages (Apple HIG)

Shared components in `src/components/admin/roofguard/AvaShared.tsx`, each taking `source`:
- **`LineStatus`**: a chip next to the number. Green "Answering calls" or amber "Not answering, fixing…", from the watchdog's last result.
- **`MessagesInbox`**: unread dot, name, urgent / wants-a-call-back tags, time, message; tap opens the call sheet. Personal already has one; move it here and use it on both pages.
- **`FollowupsList`**: proposed (Call back now / Approve for… / Dismiss), scheduled (time in the caller's zone, Cancel), done (result call #).
- **`KnowledgeList`**: "What Ava can share". Facts by topic, add/edit sheet, on/off switch, scope picker. The footer says plainly: "Ava never shares anything outside this list."
- RoofGuard Calls tab: LineStatus in the top bar, Messages and Follow-ups above the two columns. Incoming calls show in "Called" with an incoming icon and get call numbers. The personal page gets Follow-ups and What Ava knows.
- HIG: 44px targets, `tabular-nums`, nbsp between number and unit, icon plus word for every status, dark admin shell, no browser dialogs (inline confirms like `DeleteCallButton`). Review with the `anthropic-skills:ui-ux-pro-max` skill before shipping.

## Phase 4: watchdog and self-heal (Scout)

- **`health` action** on both edge functions. It checks the Telnyx number's `connection_id` is the inbound FQDN connection, the ElevenLabs number has `supports_inbound: true` and the right agent, and the agent's init webhook is set. Results go to `ava_line_health (source, ok, problems, checked_at)`.
- **Cron every 10 minutes** (fold into `ava-watch` and `roofguard-watch`): call `health`. If not ok → **run setup** (self-heal), re-check, and push Scout "Ava's line wasn't answering, fixed" (or "still broken: <problem>" at high severity, deduped).
- Reply guard `leak` (Phase 1) and existing `code_leak` / `no_hangup` / `repeat` also cover incoming calls.
- Token rule: these are plain scripts, with no AI in the checks.

## Phase 5: prove it

1. **AI-to-AI test, both directions, for a few cents:** personal Ava calls 544-0206 ("Ask about RoofGuard pricing, then leave a message for the team, wants a call back"), and RoofGuard Ava demo-calls 429-9495 ("leave a message for Jared"). Check both transcripts: right greeting, no secrets, message captured, follow-up proposed, Scout push sent, reply guard clean.
2. `npx tsc --noEmit -p tsconfig.app.json` (ignore the 2 WowButton errors) and `npm run build`.
3. Commit, `git pull --rebase origin main`, push. Write a `bestly_memory` note (area `ava`, key `inbound/2026-10-04`).
4. Tell Jared: call both numbers yourself.

## Rules for the builder

- Migrations are append-only, and `apply_migration` **cancels any SQL containing the word DROP**: use `create or replace`, `add column if not exists`, and placeholder rows instead of `drop not null`.
- Deploy edge functions with `mcp__Supabase__deploy_edge_function` (verify_jwt false). **If a deploy is blocked by a safety check, stop and report. Don't try another route.**
- Secrets only in Vault, via `ava_secret` / `ava_secret_put` (extend the allowlist for `rg_init_secret`). Never print a secret.
- Don't touch: RoofGuard's hard rules, the AI disclosure, DNC handling, and callback routing to Eli (on hold).
- Keep personal Ava (`ava_*`) and RoofGuard (`rg_*`) separable for a sale. `ava_followups`, `ava_knowledge` and `ava_reply_incidents` are shared tables keyed by `source`/`scope`, so a buyer copies only the `roofguard` rows.

## Open question for Jared (after it works)

- Now that 544-0206 answers, should RoofGuard's voicemails give it out as the callback number? That would unblock live dialing. Calls would land with Ava as messages, not routed to Eli.
