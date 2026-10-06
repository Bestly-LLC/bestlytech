# Autonomy plan: employees do the work, Jared gets the result (2026-10-05)

Jared: "Needs you fills up every day and never clears. A lot of it is Scout's or an employee's job. I should only hear
about things that need critical thinking or are security risks. Security should fix itself, not wait for me to ask."

## Decisions (Jared, 2026-10-05 10:20 PM)
| Question | Answer |
|---|---|
| How much employees fix alone | **Fix, verify, keep an undo, tell him after.** Ask only for money, legal, deleting data, or anything a customer/client sees. Includes security fixes. |
| How he hears about finished work | **One daily recap, one screen, evening**, grouped by employee, done items only. |
| Studio previews / client asks | **Spark ships internal previews and reviews incoming clips.** Anything Elizabeth or another client sees still waits for Jared. |
| What still interrupts him (push + Needs you) | Security risk nobody could fix · Money · A real person waiting on him · Something down 1 hr+ that nobody fixed. **Nothing else.** |

## What's wrong today (measured 2026-10-05)
- **1,726 notifications in 7 days (~250 a day).** 425 of them are "fixed / back to normal" notes. 464 were already silent.
- **93% are unsigned** (1,604 of 1,726), breaking the rule that every alert comes from its employee.
- **Needs you had 21 cards; about 3 needed Jared.** The rest:
  - The same ATC problem shown **4 times** (home_hub_issues + 3 notifications from 3 emitters). CSP error shown twice.
  - Things already handled by their employee: Sweep cleaning the Mac mini disk (2 cards), the wall restarting before a GPU freeze, the projector browser rollback. Self-healed but "open, never resolved".
  - Owned jobs parked on Jared: 3 Turo trips not closed (Turo Reader), Ava coach flag (Scorecard & Coach), Pi job quiet (Home Hub).
  - Studio previews waiting since Sep 26 and a client clip unreviewed since Sep 11 (Spark).
- **Security: 14 findings open up to 11 nights**, each with the fix already written. 10 are "lock this database function from anonymous callers", 1 is "41 functions need a fixed search_path". Nobody applies them.
- Root cause: every rule says "raise to Jared"; almost nothing says "raise to the owner and let them finish it".

## The plan

### Phase 1: Clean the feed (SQL only, no AI cost)
1. **One card per problem.** Fingerprint every source (admin_notifications, home_hub_issues, monitor_issues, security_findings) by owner + problem. Repeats bump a counter, never a new card.
2. **Cards clear themselves.**
   - Closes when its source resolves or a matching "Fixed" note arrives.
   - Self-healed and info items never enter Needs you; they go straight to the recap.
   - A warning with no new occurrence for 24 hours closes into the recap as "went quiet".
3. **The interrupt gate.** `admin_today_rows()` only admits the 4 interrupt classes. Everything else goes to the owner's queue.
4. **Every note is signed.** Unsigned notes get their owner from `notification_owners` by prefix. No owner → Scout, and The Recruiter gets a "no owner" finding.

### Phase 2: Owners do the work
5. **Owner queue.** Each routed card lands on its employee (Team page shows it). The employee works it up the Fix Ladder: built-in heal, then free AI, then Scout on free AI. Paid AI only when the Paid AI switch is on.
6. **Security fixes itself (Ares + Fix Ladder).** For each finding:
   - Check callers first (repo, edge functions, Pi and Mac scripts, cron).
   - Apply the written fix with an undo saved next to it, re-run the check, then roll back by itself if anything breaks.
   - First batch: the 10 anonymous database functions, the 41 search_path functions, and the Pi's 14 unknown ports (Home Hub identifies, then closes or binds to localhost).
   - Domains in someone else's registrar account (El Dora in Rohit's GoDaddy) are a real person, so one card.
7. **Spark** ships internal Studio previews, reviews arrived clips, and closes stale drafts. Client-facing sends still come to Jared as one card.
8. **Turo Reader** closes finished trips (key off, Live Activity down) on its own. **Scorecard & Coach** handles call flags. **Sweep, Wall Watchdog, Home Hub** notes go silent unless the 1-hour-down rule trips.
9. **Scout keeps working on free AI until done** (Jared, Oct 5 4:54 PM): no stop-and-continue bursts unless the Paid AI switch is on or it needs his input.

### Phase 3: Tell Jared, briefly
10. **Evening recap, 7:00 PM, signed by Scout**, readable in 30 seconds:
    - Done today, grouped by employee, one line each.
    - Still being worked: count plus owner, no detail.
    - Anything that needs him: also already in Needs you.
    It runs on the Pi with free AI for the wording.
11. **Push notifications only for the 4 interrupt classes.** Everything else is silent.

### Phase 4: Keep it that way (watchdogs)
12. **Needs you watchdog.** If more than 5 cards are open or any card is older than 48 hours, Scout checks why. If it's a rule miss, it files the fix.
13. **Weekly review by The Improver.** Looks at what reached Jared that week, then proposes rule changes and reassigns jobs. Changes go in the recap.

## Guardrails (never automatic)
Money moves · deleting data · anything a client or customer sees · legal/registrar changes in someone else's account ·
turning on paid AI. Every automatic fix keeps an undo and is listed in the recap.

## Build order
Phase 1 first: it alone should take Needs you from ~21 cards to about 3. Then 6 (security), then 7-9, then 10-13.
Every new job gets a team card (`team_onboard`) and a pulse, per CLAUDE.md.

## Built (2026-10-06, overnight)
| Piece | Where | Result on day one |
|---|---|---|
| Push gate | `notify_route` + `interrupt_class()`; off: `autonomy_settings.push_gate` | Last week's ~800 phone alerts would have been ~44 (about 6 a day). Held items: `autonomy_held` + silent bell rows |
| Needs you gate + one card per problem | `admin_today_rows()` (old rules kept as `admin_today_rows_all()`); off: `needs_you_gate` | 21 cards → 4 (2 security, 2 client-facing) |
| Every alert signed | trigger `admin_notifications_sign` | Title name → owned prefix → kind → Scout |
| Auto-clear | `autonomy_sweep()` cron `autonomy-sweep` every 10 min | First run: 2 warnings closed by good news, 3 self-healed incidents resolved |
| Security fixes itself | `security_autofix()` cron `security-autofix` hourly (Ares's "Auto-Fixer") | 9 functions locked from the public key, 49 search paths pinned, 2 confirmed public on purpose (in the API logs), 2 handed to Jared (El Dora domain in Rohit's account, Pi ports), hoku-clean.com watched until 30 days. Undo for every change in `security_autofix_log` |
| Scout keeps going on free AI | admin-chat v33 (commit 5ad6e84, stub v46) | Out of steps → progress note → calls itself again, up to 8 rounds; a new message from Jared stops it |
| 7 PM recap | `autonomy_recap()` via `autonomy-recap` hourly tick; `recap_hour` setting | Scout-signed, one screen, done items by employee; Sundays add the week |
| Watchdog | `autonomy_watch()` cron `autonomy-watch` every 30 min ("Inbox Keeper") | Over 5 cards or 2 days → Scout incident; "still down after an hour" pushes once |
| Team cards | Inbox Keeper (tool of Scout), Auto-Fixer (tool of Ares) | |

Not done on purpose:
- **Studio previews are not auto-shipped.** The open ones are 10+ days old and built on an older Studio, so shipping them would roll back newer work (the Sep 20 incident). Internal previews stay with Spark; client ones stay in Needs you.
- **Turo "trip has not closed"** stays as designed on Oct 5 (key comes off at 2 hours anyway); it is now held, not pushed.
- **The Improver's weekly review** is the Sunday line in the recap for now; a deeper rule-tuning loop is a follow-up.
- `notify_route` no longer prunes `notify_ledger` (deletes needed his approval overnight); with the gate it gets a handful of rows a day. Add a prune job.
