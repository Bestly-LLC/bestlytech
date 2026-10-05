# Ava Live Calls: Opusplan

**Date:** 2026-10-04
**Author:** Claude (Spark), for Jared
**Surface:** bestly.tech/admin/roofguard, Calls tab
**Status:** Building

---

## TL;DR

Ava works end to end: she dials from (816) 429-9495, has a real conversation, and logs a summary when the call ends. Jared can't watch any of it yet. This plan adds a **Calls** screen built around three things:

1. **Live now.** A banner shows the call in progress, with the transcript scrolling as Ava and the prospect talk.
2. **Up next (left column).** The call queue: who Ava calls next, and why each lead is in that order.
3. **Called (right column).** Every finished call, with its outcome, where the lead now sits in the cycle, and the summary, meeting times, callback and full transcript one tap away.

The plan also fixes three problems the first live test calls exposed.

---

## What the first test calls showed (2026-10-04)

| Call | Result | Problem it exposed |
|---|---|---|
| Gerry #1 and #2 | Straight to voicemail, phone never rang | His iPhone silences unknown callers; carriers will also flag a brand-new number |
| Gerry #3 | Connected; Jared said "too AI" | Voice was Alice on the flash model. Now Lily on the turbo model, with a rewritten script |
| Eli | Callback set | Ava said "tomorrow, October 6th" on Oct 4. **She doesn't know today's date** |
| Every voicemail | "call us back at ___" | **The callback number isn't set yet** |

---

## Layout (Apple HIG, dark admin shell)

```
┌───────────────────────────────────────────────────────────────┐
│ Ava    ● Calling  (or ○ Paused)      Today: 12 calls · 2 booked │  ← header strip + pause / resume
├───────────────────────────────────────────────────────────────┤
│ ● LIVE  Lakeland Regional Health · Walt Pullins · 1:42        │  ← appears only during a call
│   Ava:  Hi there, it's Ava calling from RoofGuard...          │     transcript auto-scrolls,
│   Them: Who's this for?                                       │     refreshes every 2 sec
├──────────────────────────────┬────────────────────────────────┤
│ UP NEXT (queue)        24    │ CALLED                    37   │
│ ┌──────────────────────────┐ │ ┌────────────────────────────┐ │
│ │ Acme Schools   TX  9:40AM│ │ │ Lakeland Regional  Booked  │ │
│ │ Attempt 2 of 3 · Callback│ │ │ Tue 10 AM, Thu 2 PM · Walt │ │
│ └──────────────────────────┘ │ └────────────────────────────┘ │
│ Waiting (callbacks, gaps)    │ filter: All · Booked · Callback│
│                              │   · Voicemail · Not interested │
└──────────────────────────────┴────────────────────────────────┘
Tapping a Called row opens a sheet: outcome, stage, summary, decision maker,
meeting times + email, callback, opener used, recording, full transcript.
```

- On a phone the columns stack: Live, then Up next, then Called.
- Status uses SF-style pills: green Booked, blue Callback, gray Voicemail, orange Gatekeeper, red Not interested / DNC.
- A number never wraps away from its unit ("1:42", "3 of 3", "10 AM" stay together).
- Times show in 12-hour format, in the lead's own time zone, labeled.

---

## The lead cycle (one stage per lead, shown everywhere)

`Ready` → `Calling` → one of:
- **Booked**: meeting with Eli (terminal, success)
- **Callback**: they named a day and time
- **Voicemail**: attempt n of 3, then retried after a 2-business-day gap
- **Gatekeeper**: didn't reach the decision maker; retried
- **Not interested**: two clear no's (terminal)
- **Do not call** (terminal, added to rg_dnc)
- **Bad number** (terminal)
- **Exhausted**: 3 attempts, no contact (terminal)

The stage is derived in SQL from `rg_leads.call_status` plus the latest `rg_calls.outcome`, so the UI never has to guess.

---

## Build

### 1. Database (new migration, append-only)
- `rg_call_queue(p_limit)`: a **read-only** preview of who's next. Same rules as `rg_next_call_batch` (line type, DNC, local 9 AM to 5 PM on weekdays, holidays, attempts, gaps), but it never claims or changes a row. Returns the order plus a plain reason ("Callback due 10:00 AM CT", "Attempt 2 of 3").
- `rg_call_waiting()`: leads that are scheduled but not yet eligible (future callbacks, inside a retry gap, outside calling hours), with the time each becomes eligible.
- `rg_call_board(p_limit)`: finished calls joined to their lead, with the derived stage, a short summary, meeting times, callback, decision maker and opener. Real calls only; test calls are flagged.
- `rg_live_calls()`: calls with `status in ('queued','in_progress')` from the last 20 minutes.
- All four are `security definer` and admin-only (`has_role`), granted to `authenticated`.

### 2. Edge function `roofguard-caller`
- New action **`live`** (browser-callable). It verifies the user's JWT and checks `has_role(admin)`, then for each live call fetches `GET /v1/convai/conversations/{id}` from ElevenLabs and returns status, elapsed time and transcript so far. The API key never leaves the server.
- Calls placed through the single-call route already return a `conversation_id`; store it on the `rg_calls` row at dial time so the live view can find it.
- **Date fix:** pass `today` (e.g. "Sunday, October 4, 2026") and `local_time` in the lead's time zone as dynamic variables. The prompt says to use them for every "tomorrow" or "next week", and to state the weekday rather than a bare date when confirming.

### 3. UI (`src/pages/admin/RoofGuard.tsx`, Calls tab)
- A segmented control at the top: **Calls** (new, default) · Leads · Setup.
- Components: `LiveCallBanner`, `QueueColumn`, `CalledColumn`, `CallSheet`, `StagePill`.
- Polling: live view every 2 sec while a call is live, every 15 sec otherwise. Columns refresh every 30 sec. Polling pauses when the tab is hidden.
- The existing setup checklist moves into the **Setup** segment, unchanged.

### 4. Watchdog (Scout)
- Extend `rg_watch_calls`: any call stuck in `queued` or `in_progress` for more than 15 minutes gets marked `failed`, and Scout is alerted (`bestly_raise`, healed = true).
- If the live endpoint errors 3 times in a row, the UI shows "Live view unavailable" instead of a frozen transcript.

---

## Added the same evening (all shipped)

- **Playback.** Every call sheet has "Play recording" (edge `audio` action streams ElevenLabs' audio; key stays server-side).
- **Ava's follow-ups** (`rg_followups`, cron `roofguard-followups` every 5 min). A callback request schedules itself, Scout pings Jared 15 min ahead, test callbacks dial on time, and the watchdog fails and raises anything stuck. Real-lead callbacks ride the dialer queue (`next_call_at`); the task closes when that call goes out. First one: Eli, Mon Oct 5, 11:00 AM PT.
- **Partner demo calls.** On the Home screen of Eli's portal: an "Ava demo" tile. He types a number, Ava calls as a fictional hospital (Riverside Medical Center). Never a real prospect's number, 15 a day, live transcript, summary and recording. Demo calls never schedule callbacks.
- **Faster, more human Ava.** Lily voice on turbo v2, gemini-2.5-flash-lite, eager turn-taking, replies under 20 words, contractions and short reactions, banned stock-assistant phrases. Measured before: 1.0 to 1.7 sec from silence to speech.

## Before the 20-call pilot (Jared)

1. **Callback number** for voicemails: Eli's (816) 588-3683, or the RoofGuard line.
2. Confirm Lily's voice on a test call.
3. Press **Start pilot**.

## Later
- **Branded caller ID / CNAM** so the number shows "RoofGuard", not "Spam Likely".
- **Local presence:** 5 to 10 numbers matched to lead area codes.
- **Accept the batch-calling terms in ElevenLabs** once volume needs batches; single calls cover the pilot.

## Scorecard: is Ava earning her keep? (added 2026-10-04)

Jared's standard from Amazon Business door-to-door: **6 closes a week**. For Ava a close = a meeting booked with Eli.

**Law of Averages** (Thrive LA packet, weekly target zones): 55 doors, 30 contacts, 7 decision makers, 4.5 presentations, 2.5 accounts = about 1 close per 22 doors (4.5%). On the phone: dials, answered, decision maker, pitch, booked. Cold calls convert worse than walking in, so she starts at **1 meeting per 50 dials (2%)**:

- 6 a week ÷ 2% = **300 dials a week = 60 a day** (5 days)
- If she matched the door rate (4.5%) it would be 27 a day
- Her real rate replaces the 2% as calls come in (the assumption counts as 100 dials until she has volume)

**Hire status** (last 2 full weeks with 20+ dials): Retained = averaging 6+, Watch = 4 to 5, Probation = under 4, Ramping = fewer than 2 live weeks.

**Built:** `rg_ava_kpis()` (admin + partner), `/admin/roofguard#scorecard`, a one-line strip on the Calls tab, the Scorecard view in Eli's Ava sheet, a Friday 4:50 PM PT Scout push (`roofguard-weekly-review`), and optional auto-pace (`roofguard-pace`, 6:05 AM PT weekdays) that sets her daily cap to the target after the pilot.
