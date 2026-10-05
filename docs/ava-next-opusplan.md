# Ava, what's next: opusplan (2026-10-05)

**Ask (Jared):** what's missing for Ava; cleaner UI (collapse what I don't need, settings in one place, one voice panel); make the reply guard tell me what to do; plan the Do Not Call registration. Planned by Opus, built by Sonnet.

**Jared's picks (2026-10-05):**
- Next skills: **follow-up texts, morning brief, email follow-ups.**
- **Collapsed by default:** Calendars, Your cell, Ava's voice. **Merge the two voice panels into one.** All calls and Messages always stay open.
- **Reply guard:** the Coach fixes problems. The Coach shipped today from another chat (`0626340`), so this plan hooks into it and doesn't rebuild it.
- **RoofGuard pilot:** not yet; wait for Bill.
- Personal Ava's **Dial button goes green**. RoofGuard's stays as it is.

## TL;DR

1. **Fix now:** iCloud signs in but Ava finds **0 calendars**. That's a discovery bug on our side, not your password.
2. **UI cleanup (both pages, same components):** collapsible sections that remember open/closed, one **Settings** sheet per Ava (spend cap, hours, Turo window, voice, forwarding), one merged **Voice** panel, and a green Dial button on personal Ava.
3. **Reply guard becomes a to-do list.** Each issue shows who's on it and what's left: *Coach learned it* / *Coach is testing a fix* / *Needs you*. Every issue gets real buttons, and "Mark reviewed" is only for issues with nothing left to do.
4. **Morning brief:** one Scout push at 8 AM from Ava. Messages waiting, call-backs owed, today's calendar, anything the guard caught. Built as plain script, no AI.
5. **Texts and emails:** both already have plans from other chats (`ava-texting-opusplan.md`, `ava-email-opusplan.md`). They're next in line after this batch. Texting has a slow first step (carrier registration, days to weeks), so that starts first.
6. **Do Not Call registration:** not needed yet. RoofGuard only calls business landlines and the pilot is on hold. It's ready to do in 10 minutes when it's needed (below).

## 1. iCloud: 0 calendars

- iCloud sign-in works (`cal_test icloud` → ok), but the calendar list comes back empty. Likely cause: iCloud CalDAV needs the 3-step discovery: `PROPFIND` on `caldav.icloud.com` for `current-user-principal`, then `calendar-home-set` (it points at a per-account `pXX-caldav.icloud.com` host), then `PROPFIND Depth:1` on that home. Our code probably stops at step 1 or ignores the host change.
- Fix in `supabase/functions/ava-assistant/calendar.ts`. Test with `cal_test icloud` until Jared's calendars list, then include them by default (Turo-named calendars get the Turo rule).
- Watchdog: an iCloud provider that's "ok but 0 calendars" counts as a problem → Scout "Ava (assistant): I can sign in to iCloud but can't see your calendars".

## 2. UI cleanup (Apple HIG, shared components, both Ava pages)

- **`CollapsibleSection`** (shared): a header row with a title, a one-line summary when closed (e.g. "Calendars · Personal, iCloud Home · OK"), and a chevron that rotates. A 44px target, keyboard and screen-reader friendly. Remembers open/closed per section in localStorage, wrapped in try/catch.
  - Personal page, collapsed by default: **Calendars, Your cell, Voice, Spam & Do Not Call, What Ava can share, People Ava knows.** Always open: **Messages for you, All calls, live calls.**
  - RoofGuard page: the same component for its Setup-type sections. The Calls tab columns stay open.
- **Settings sheet per Ava:** a gear button in each top bar opens a sheet with everything set-and-forget:
  - **Personal:** daily spend cap, working hours, Turo window, forwarding switch + voice choice, "Ava books here" calendar, re-run setup.
  - **RoofGuard:** daily spend cap, calling cap, the voice, re-run setup.
  - The spend cap editor moves out of the top of the page. The top bar keeps only the line, Dial, "Today $X of $Y", and "Spent so far".
- **One Voice panel:** merge `VoicePicker` (Ava's voice) and the "Your voice" clone card into a single collapsible **Voice** section with two segments, **Ava's voice** and **My voice**. The voice bank work from `907ecbd` lives inside "My voice".
- **Dial button:** personal Ava's Dial is green (`#30D158` with dark text). RoofGuard's is unchanged.

## 3. Reply guard → actions (with the Coach)

Every incident row gets a **status** and **buttons**:

| Status | Meaning | Buttons |
|---|---|---|
| **Fixed automatically** | the guard already self-healed (e.g. switched model) | Undo fix · Mark reviewed |
| **Coach is on it** | the Coach turned it into a playbook rule being tested (`rg_playbook` / `ava_playbook` row linked) | See the rule · Mark reviewed |
| **Coach learned it** | the rule won its test and is live | See the rule · Mark reviewed |
| **Needs you** | no automatic fix (e.g. a prompt bug, a hard-rule question) | **Teach the Coach** · **Ask Scout to fix** · Ignore |

- **Teach the Coach:** turns the incident into a proposed playbook line (fixed templates per kind; for example, a code leak becomes "Never say tool or function names out loud"), sent through `coach_propose`, which already guards hard rules. RoofGuard lines A/B test on their own; personal lines wait for Jared's tap, per the Coach's design.
- **Ask Scout to fix:** files a fix request for the engineering queue (Scout's existing task/lesson table) with the call number, excerpt and transcript link. Status shows "Scout has it" until closed.
- New columns on `ava_reply_incidents`: `action_state` ('auto_fixed','coach_testing','coach_learned','needs_you','scout_has_it','ignored'), `playbook_id`, `scout_task_ref`. Set automatically where possible: a self-heal sets `auto_fixed`; a Coach rule created from the incident sets `coach_testing` and later `coach_learned` when `rg_playbook_decide` keeps it.
- The card title says what's left: "Reply guard · 1 needs you · 2 handled". "Mark reviewed" sits on handled rows only.

## 4. Morning brief (new)

- **What:** one Scout push at **8:00 AM Pacific**, signed "Ava (assistant): your morning". It covers:
  - unread messages (count and the top 2 names);
  - call-backs owed or approved for today;
  - today's calendar (time and title, with Turo pickup/return marked);
  - anything the reply guard flagged as "needs you";
  - spend yesterday.
  - RoofGuard adds one line: calls yesterday, booked, and today's plan (paused while the pilot waits).
- **Where it runs:** a SQL function plus pg_cron, plain text, **no AI** (token rule). The calendar read uses the existing free-slots code path (an edge function action `today`).
- **Skip rule:** if there's nothing at all, no push.
- **Watchdog:** if the brief didn't send by 8:15 AM, Scout alerts once, and the job is listed on Ava's team card.
- **UI:** a "Morning brief" switch and time in Settings, plus a preview of what tomorrow's would say.

## 5. Texts and emails (next batch, plans already written)

- **Emails** (`ava-email-opusplan.md`): `ava@bestly.tech` through Resend, free, with a template the other chat already started (`9d0e939` on a branch on the Mac, not on main yet). Merge that branch work first, then build.
- **Texts** (`ava-texting-opusplan.md`): consent-first, under 160 characters, a short `bestly.tech/r/…` link, STOP handling, and 10DLC carrier registration. **Start the 10DLC registration first; it takes days to weeks.** That's a form Jared submits in the Telnyx portal; it creates no new accounts.
- Order: email first (works the same day), then texts once 10DLC clears.

## 6. Do Not Call registry access (when it's needed)

**Not needed today.** RoofGuard only dials verified business landlines, and the pilot is waiting on Bill. It becomes required before Ava calls anything that might be a home or cell number for sales.

When it's needed (about 10 minutes, Jared does it, since it means creating an account in Bestly's name):
1. Go to **telemarketing.donotcall.gov** and create an organization profile: **Bestly LLC, 733 North Kings Road #205, Los Angeles, CA 90069**, contact Jared, phone (816) 500-7236, email jared@bestly.tech. Entity type: **seller** (Bestly calls for its own programs; if Bestly calls *for* LBMC, also list LBMC as the seller you call for).
2. Pick **up to 5 area codes (free)**. Start with the area codes of the states RoofGuard will call. More area codes cost a yearly fee per code.
3. You'll get a **Subscription Account Number (SAN)**. Put the SAN and the login into the Settings sheet; it saves to the vault.
4. Then we build the monthly scrub (a Pi job downloads the area-code files every 31 days, which is the legal maximum) and the compliance gate checks it (see `ava-calling-compliance-opusplan.md`).

## Build order (this batch)

1. iCloud calendar fix (blocks "Find times").
2. UI cleanup: collapsible sections, Settings sheets, one Voice panel, green Dial.
3. Reply guard actions + Coach/Scout hooks.
4. Morning brief + watchdog + team card.
5. Verify: tsc, build, `cal_test icloud` lists calendars, a preview of tomorrow's brief, commit and push. Deploy edge functions from Jared's Mac mini CLI if the files are too big for the deploy tool (that route worked on 2026-10-05).

Then the next batch: emails, then texts.
