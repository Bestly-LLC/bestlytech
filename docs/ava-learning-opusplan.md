# Ava Learns: Opusplan

**Date:** 2026-10-04
**Author:** Claude (Spark), for Jared
**Covers:** both Avas, kept separate. **RoofGuard Ava** (sales caller: `rg_*`, `roofguard-*`) and **personal Ava** (your assistant: `ava_*`, `ava-assistant`).
**Status:** Plan. Nothing here is built yet.

---

## TL;DR

Every call gets a **coach's review** the moment it ends: a score for each step of the sales cycle you learned at Amazon Business, what went well, and **one thing to work on**. Every week the coach looks across all the reviews, works out what actually leads to booked meetings and what kills calls, and writes **small, specific changes to Ava's playbook**. Each change is **tested against the old way** on real calls. Changes that win stay; changes that lose roll back on their own. Her hard rules can never be touched.

To do the coaching, Ava gets an employee: **the Coach**, hired through the Team page, reporting to her.

---

## What "a good call" means (the rubric)

### RoofGuard Ava: your Thrive LA playbook, scored 1 to 5 per step

| Step (5 Steps to a Sale) | What the Coach looks for in the transcript |
|---|---|
| **1. Opening / rapport** | Did the opener land? Did they keep talking past the first line? Did she sound warm, quick and unscripted? |
| **2. Qualify (Short Story)** | Did she confirm they look after the roofs and roughly how many buildings? Did she get the decision maker's name (the Fab 5)? |
| **3. Present (Establish a Need)** | One angle, in one or two sentences (warranty gap, what's under the roof, or cost structure). K.I.S.S. |
| **4. Close** | Did she ask for the meeting with confidence, as a choice between two times ("later this week or early next week")? Did she get two times plus an email? |
| **5. Rehash / lock it in** | Did she read back the time and email, ask who else should join, and which buildings cause the most trouble? |

Plus the impulse factors and objection handling:
- **Indifference:** relaxed, not needy, no pushing past two clear no's.
- **Fear of loss / urgency:** only the honest kind, like storm season. Never a made-up deadline.
- **Objections, using the 3 Rs:** Repeat ("ah, fair enough"), Reassure ("most people we talk to…"), Resume, then back to the ask. Each objection is tagged so we learn which comebacks work: already have a roofer, send info, price, busy, not interested.
- **BOLT read:** did she match the person (fast and bottom-line for a Bull, careful and detailed for an Owl)?
- **Sounds human:** reply speed, replies under 20 words, no stock lines ("Absolutely", "Great question"), no hedging.
- **Hard-rule check:** never "replacement", never insurance, no fake social proof, no invented deadlines, honest about being an AI. **Any slip is flagged to you right away.**

### Personal Ava: a simpler rubric

Did she get the caller's name, the message (accurately), whether it's urgent, and whether they want a callback? Was she warm and brief? Did she keep your private details private?

---

## How she gets better (the loop)

```
call ends ─► Coach reviews it (scores, what went well, one thing to work on, objection tags)
                │
every Monday ───┴─► Coach looks across the week:
                      • which openers, angles and comebacks led to "kept talking", decision maker, booked
                      • where calls die (which step, which objection)
                      • her most common "work on" item
                    ─► writes 1 to 3 small playbook changes ("when they say 'we already have a roofer', try …")
                    ─► each change runs as a test: half her calls use it, half don't
                    ─► after enough calls: the winner stays in the playbook, the loser rolls back automatically
```

- **Same method as the opener A/B test already running:** even split while learning, then lean toward the winner.
- **What the Coach can change:** a "learned playbook" section of her script (comebacks, angle wording, pacing notes, the confidence of her close).
- **What it can never change:** the hard rules, the AI disclosure, the do-not-call handling, calling hours, caps. Those sit outside the learned section, and the Coach's tools can't edit them.
- **Your say:** small wording changes test themselves automatically. Anything bigger (a new angle, a new opener) shows up as "Your call" for one tap first. You get a weekly line in Scout: "Ava tried 2 new things this week; 1 won (+4% kept talking), 1 rolled back."
- **Confidence:** tracked as a number (hedges per call, replies under 20 words, how direct her close is). It should climb week over week.

### Reply guard (built 2026-10-04, live now)

After call #8 (RoofGuard Ava said "tool_code print(default_api.end_call(…))" out loud), every finished call on both Avas is scanned by a database trigger (`ava_reply_scan` / `ava_reply_guard`):

| Kind | What it catches | What happens |
|---|---|---|
| `code_leak` | she speaks code, a tool name, or a `{{variable}}` | Scout push (high) + **self-heal**: switch to the next model in `llm_fallbacks` that hasn't leaked in 7 days, re-run setup |
| `no_hangup` | she says goodbye but the line stays open 10+ sec | Scout alert, logged |
| `repeat` | the same line twice in one call | logged |

- Incidents live in `ava_reply_incidents` (with call number). The **Reply guard** card on /admin/ava and /admin/roofguard shows unreviewed ones.
- **The Coach treats every incident as a mandatory "work on" item** and turns repeat offenders into a fixed call-flow rule (not a test). Rules added this way so far: never speak tool names; hang up right after goodbye; wait quietly when put on hold; don't re-ask the opener after a yes; don't repeat a line.
- Model chain today: `gpt-4.1-mini` → `claude-haiku-4-5` → `gemini-3.5-flash` (gemini-2.5-flash-lite is deprecated and caused the leak).

---

## Where it shows up

- **Every call sheet:** the Coach's scorecard (5 step scores, impulse factors, "went well", "work on") next to the transcript and recording.
- **Scorecard tab:** a **"Getting better"** panel: average step scores by week, her current "work on" focus, playbook changes being tested, and what's won so far.
- **Eli's portal:** the same "Getting better" panel. It's a good story for Bill and investors.
- **Personal Ava:** the same review card on /admin/ava, kept simpler.

---

## Team / HR

Today: **RoofGuard Caller** is an "open role, planned" under RoofGuard Outreach. **Personal Ava** isn't on the chart.

1. **Hire RoofGuard Ava**: turn the open role into "Ava (RoofGuard caller)", run her through the four onboarding steps, and she graduates to live on her first good call report.
2. **Add personal Ava** as "Ava (Jared's assistant)", reporting to Scout.
3. **Hire the Coach** through the normal flow: The Recruiter writes it up, The Improver vets it, you tap Hire. It reports to RoofGuard Ava. A light second job reviews personal Ava's calls, stored in `ava_*` so the RoofGuard side stays separable.
4. Each one gets a heartbeat, so Team Watch flags it if it goes quiet. That's the watchdog.
5. **Hire the Tech Scout** (Jared, 2026-10-04). Its job is to keep Bestly current: each week it reads what's new and suggests how to use it.
   - **Watches:** new and cheaper voice and AI models (free and open ones first), ElevenLabs/Telnyx/Supabase release notes, trending GitHub repos and scripts, and price changes that cut cost per call.
   - **Output:** a short Monday brief in Scout with at most 3 ideas. Each says what's new, what it would change for us (cost, speed, quality), effort (S/M/L), and a one-tap "Try it" that opens a test. A model idea runs as a 10% A/B test on Ava, using the playbook test machinery.
   - **Example of what it should catch:** "gemini-2.5-flash-lite is deprecated; gpt-4.1-mini is the fast, reliable replacement." That's the swap we made by hand after call #8.
   - **Runs on the Pi or Mac mini with free AI** (token rule): RSS, release feeds and the GitHub trending API, summarized locally. Paid AI only as a capped fallback.
   - **Can't** switch production models or install anything on its own. Every change goes through "Your call".
   - Reports to The Improver. Heartbeat on Team Watch.

---

## Build (when you say go)

1. **Tables:** `rg_call_reviews` (scores per step, impulse factors, objections, went well, work on, rule flags), `rg_playbook` (versioned learned rules with test status), `ava_call_reviews`.
2. **Coach job:** runs right after each call's report lands, on **free AI on the Pi or Mac mini** (your token rule). Transcripts are short. A paid model is only the fallback, and it's capped.
3. **Weekly learning job:** Mondays, after The Improver. It writes candidate playbook changes and starts the tests.
4. **Ava's script:** setup injects the current winning "learned playbook" section, and each call is tagged with which variant it got.
5. **UI:** review card in the call sheet, the "Getting better" panel (admin + Eli), and "Your call" approvals for bigger changes.
6. **Watchdog:** reviews that don't land within 15 minutes of a call are retried, then raised to Scout. A test whose numbers drop sharply is stopped early.

## Separation (for a RoofGuard buyer)

All RoofGuard learning lives in `rg_*` with its own Coach job. If RoofGuard's owners buy that piece, the reviews, playbook history and Coach go with it. Personal Ava keeps hers.
