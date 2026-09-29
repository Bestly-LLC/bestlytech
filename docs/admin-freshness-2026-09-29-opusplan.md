# Admin to-dos and alerts: always fresh (opusplan, 2026-09-29)

Jared: "Make sure the todos and alerts and stuff are in sync with my admin, I'm seeing a lot of old content. I want it to be always fresh."

## What's wrong (audit, 1:40 PM)
| Surface | Store | Problem |
|---|---|---|
| Bell | `admin_notifications` | 193 unread, 98 over a day old (back to Sep 23). Most are FYIs ("Fixed: …", "… is fine", Scout notes) that are never marked read. The supersede trigger skips Scout notes. There is no expiry cron. |
| Scout Today (picks, calls, drafts, wrap) | `scout_daily` | 89 open, 57 over a day old. Earlier days' picks and wraps are never closed. Drafts never expire. Some calls are duplicates. |
| Scout Today query | `ScoutToday.tsx:76` | Loads the oldest 200 rows of the week (created_at ASC, limit 200). With 2,000+ rows, today's picks are cut off. |
| Home Assistant to-do sync | Pi `ha-todo-sync/sync.py` + RPC `ha_todo_sync` | Loops every minute on 5 items: remove, re-add, "new from HA", dismiss. It has created about 1,910 junk dismissed `ha:` rows today and dismissed real picks. |
| CommandHero call count | `CommandHero.tsx:60` | No day filter, so it counts calls from any date. |
| Wall "today" | `wall_today()` | Falls back to yesterday's open picks when none of today's are open. |

## Freshness rules (one definition, used everywhere)
- **Picks:** belong to their day. When a new day starts, earlier open picks become `expired`. Scout's morning run still sees them as candidates, and unfinished work comes back as a fresh pick.
- **Wrap:** only today's. Earlier wraps become `done`.
- **Drafts (email replies):** expire 3 days after their mail.
- **Calls (meeting to-dos):** are real work and stay open until done. Exception: exact duplicates of the same title and owner collapse into one (the newest is kept, the rest expire). Calls with no activity for 21 days expire and can be put back.
- **Bell:**
  - `success` and FYI (`info`) notes are marked read after 12 hours. Silent ones after 1 hour.
  - A problem note is marked read as soon as its issue resolves (`bestly_raise` already does this for `monitor:` notes).
  - Anything is marked read after 7 days.
  - Scout notes supersede each other by `dedupe_key` family.
- **Nothing is deleted except junk.** Expired and read rows stay in history, and "put back" still works.

## Workstreams
1. **HA sync loop.** Match HA items to Bestly by normalized title. Never turn a known title into a new "from HA" to-do. Give new adds a 10-minute grace before a "vanished" item counts as deleted. A loop guard stops touching a title that flips more than 3 times an hour and tells Scout. Repair: delete the junk dismissed `ha:` rows and re-open the real picks the loop dismissed today.
2. **Freshness sweep.** A DB function `admin_freshness_sweep()`, run by pg_cron every 10 minutes, applies the rules above and records counts in `admin_freshness_runs`.
3. **Admin UI.**
   - ScoutToday loads newest first and leaves out dismissed `ha:` junk.
   - CommandHero counts only calls from the last 21 days.
   - The bell shows unread first, and "Mark all read" covers every unread note.
4. **Wall.** `wall_today()` shows only today's picks.
5. **Watchdog (Scout).** `admin_freshness_watch()` runs hourly. It checks that the sweep ran in the last 30 minutes and that stale counts are about zero (open picks from earlier days, unread FYIs over a day old, `ha:` row growth over 30 an hour). Self-heal: run the sweep, and if the HA loop guard tripped, raise `bestly_raise('admin.freshness', …)`.

## Done when
- The bell shows only current, actionable items. FYIs clear themselves.
- Scout Today shows today's 3 picks, open calls and live drafts, with nothing from earlier days.
- The HA sync has no loop, and the `ha:` row growth rate is about zero.
- The watchdog is green and records a run every 10 minutes.

## Status (4:00 PM, Sep 29)
- [x] **HA sync loop** fixed on the Pi (`sync.py`: title matching, 10-minute grace, flip guard, tombstones). 1,925 junk `ha:` rows removed; no real rows lost. 39 HA items, no duplicates.
- [x] **Sweep** live every 10 minutes (migrations `20260929210000` to `20260929214000`). First runs: 169 + 5 bell notes cleared, 17 old picks, 7 wraps, 4 duplicate calls, 4 drafts.
- [x] **Bell pairs.** A problem note clears when its "Fixed: …" note arrives, and repeats collapse. Unread went from 193 to 22.
- [x] **Alert picks close when the alert is fixed.** Scout had picked "Restart Tesla worker" and "Disable Low Power Mode" from bells whose problems were fixed on Sep 27 and 28. Such picks now close within 10 minutes; the reason is in `action.auto_closed.why`.
- [x] **UI.** ScoutToday loads newest first and hides expired rows. CommandHero counts calls from the last 21 days. "Mark all read" covers every unread note.
- [x] **Wall.** `wall_today()` shows today only. Verified: mail card only, 3 done.
- [x] **Watchdog.** `admin_freshness_watch()` runs hourly at :17 and is green (0 old picks, 0 old FYIs, 0 `ha:` rows an hour).
