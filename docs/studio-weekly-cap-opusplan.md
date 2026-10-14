# Studio weekly cap: one week definition, structural guard (Opus plan, 2026-10-14)

Owner: Spark. Migration: `supabase/migrations/20261014075500_studio_weekly_cap.sql`.

## Problem (verified 12:40 AM PT Oct 14)

Jared: "It's still showing for next week six posts and we're supposed to have a maximum of five posts a week."
Centering YOU is 5 posts a week, auto-post on.

Dated posts were Sun 10/18 CY26, Mon 10/19 CY07, Tue 10/20 CY12, Wed 10/21 CY15, Thu 10/22 CY19, Fri 10/23 CY22.
Mon-Sun Oct 19-25 = 5, Sun-Sat Oct 18-24 = 6.
CY22 had internal_status `changes` yet sat in lane `sched` and would auto-post Fri Oct 23.

## Plan (as given)

1. Find every place a "week" is computed and record its start day.
2. One week definition: per-client setting plus one SQL helper, used by the planner, the cap check and any counts.
3. Enforce the cap structurally: at slot assignment, with a trigger on scheduled_for/scheduled_at, and with a watchdog in `studio_autopost_tick` (bump the latest excess to the next open slot, log it, Spark-signed non-interrupting alert).
4. Fix next week now and every future week through November.
5. Auto-post gate: a post the team marked `changes` must not be in lane `sched` and must never auto-post; lane, autopost and `studio_posting_gate` use one rule.
6. Verify: counts per Sun-Sat and Mon-Sun week, Studio calendar, board, phone feed.
7. Migrations append-only, committed, pushed. 8. Memory row `studio/weekly-cap-2026-10-14`.

## Refinements (found while doing it)

- Week starts found: `studio_cal_day_free` (planner) and `studio_cal_week_count` / `studio_cal_week_full` (hand-picked times, Post now) all used `date_trunc('week')` = Monday. Studio grid (`a.setDate(1 - a.getDay())`, DOW starts "Sun") and the board month grid (`gridFrom`, same) start Sunday. The phone feed (`calendar_feed_read`) has no week logic; phone calendars default to Sunday in the US. So the SQL was the odd one out; the grids are right.
- Default is `sunday`. The grids are hard-wired to Sunday, so no app change was needed or shipped. `monday` is allowed in the column but should not be set until the grids read it (noted in the column comment).
- Counting now uses the grid's day rule: Pacific date of posted_at, else scheduled_at, else scheduled_for (`studio_item_day`), in the client's tz (`studio_client_tz`).
- Cap value reused: `social_brand_settings.posts_per_week` (CY = 5), via `studio_week_cap(client)`.
- The gate is already one function: `studio_clear_state` feeds `studio_posting_gate`, `studio_cal_ready`, `studio_lane_of` and the app's `it.clear`. So fixing it there fixes lane, autopost and the app together.

## Why CY22 counted as cleared

`approval_clients.client_yes_is_final` is on for Centering YOU: her yes alone clears a post, and the team's sign-off is not needed.
The only team stop honoured under that rule was a staff `killed`/`changes` review at the current content version.
CY22's `changes` status is not a staff review at v56. Elizabeth asked for changes Sep 24, approved v56 Sep 30, and Jared noted "Agreed to keep in the meeting" Sep 29 (no decision). The status field stayed `changes`.
So the gate saw: client approved this version, no staff stop review, therefore clear.

CY07/12/15/19 (status `pending`, sign-off lapsed when the version bumped) are legitimately cleared under client_yes_is_final: she approved the current version and nobody on the team stopped them. Left alone.

Fix: under client_yes_is_final, `internal_status = 'changes'` is also a stop (`team_stopped`, "The team: asked for changes"). To release CY22, the team approves it (or clears the changes status) in Studio. This tightens an earlier deliberate rule only for an explicit team `changes` flag.

## What was built

- `approval_clients.week_start` (default `sunday`), `studio_client_tz`, `studio_week_start(client, day)`, `studio_week_of(client, ts)`, `studio_week_cap`, `studio_item_day`.
- `studio_cal_week_count`, `studio_cal_week_full`, `studio_cal_day_free` rewritten on the helpers.
- Guard trigger `items_week_cap` (BEFORE INSERT/UPDATE OF scheduled_at, scheduled_for): a write that would make a 6th post in the week is bumped to the next open day (day free, not blacked out, week under cap) with a `slot_reason`; logs a `calendar_slot` event; raises an info alert.
- Watchdog `studio_cal_enforce_cap()` called by `studio_autopost_tick` right after `studio_cal_clear_uncleared`: keeps posted, queued and time-locked posts, then the earliest-dated; the rest of an over-cap week are undated (event `calendar_withdrawn`, why `week_full`) and `studio_autoslot` re-places them.
- Alerts: `bestly_raise('studio.weekly-cap.<client>.<yyyymmdd>', 'problem', 'info', ..., healed=true)`; `notification_owners` row `studio.weekly-cap` -> `spark`. Bell only, signed Spark, no push.
- `studio_clear_state`: the `changes` stop above. `studio_cal_clear_uncleared`: now says who the post is waiting on.

## Result

Done 2026-10-14. See the end of this file for the final numbers.

Moved: CY22 Fri Oct 23 12:30 PM -> unscheduled (gate: team asked for changes; slot_reason says so). Nothing else moved; CY26/07/12/15/19 kept their dates.

Weekly counts after (Sun-Sat / Mon-Sun, Pacific), Centering YOU:

| Week of (Sun) | Sun-Sat | Mon-Sun |
|---|---|---|
| Oct 11 | 4 | 5 |
| Oct 18 | 5 | 4 |
| Oct 25 | 0 | 0 |
| Nov 1 | 1 | 1 |
| Nov 8 | 0 | 0 |
| Nov 15 | 0 | 0 |
| Nov 22 | 1 | 1 |
| Nov 29 | 0 | 0 |

Tests (each rolled back): moving CY25 into the full Oct 18 week via a normal write bumped it to Oct 25 with a reason; forcing 6 with the trigger off made the watchdog undate the latest (CY19) and re-slot it; both raised a Spark-signed info bell.

Verification: Studio calendar screenshot `/tmp/claude-0/sp/cal/studio-cal-oct-2026.png` (week Oct 18-24 shows 5 dots). Phone/board feed rule (lane sched/ready/posted) returns 5 for Oct 18-24. No staff preview of the client board exists, and signing in as Elizabeth was off limits, so no board screenshot.

Rollback: `drop trigger items_week_cap on approval_items;` restore previous bodies of `studio_cal_week_count`, `studio_cal_week_full`, `studio_cal_day_free` (Monday `date_trunc('week')`), `studio_autopost_tick` (without `studio_cal_enforce_cap`), `studio_clear_state` (without the `elsif internal_status = 'changes'` branch). The `week_start` column is additive.

Note: one autopost tick failed at 12:45 AM PT (a `->>`/`||` precedence slip in `studio_cal_clear_uncleared`, fixed within minutes; the next ticks ran clean). The migration file has the fixed version.
