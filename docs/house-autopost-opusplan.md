# House autopost: approved videos post themselves, for every Bestly product

Owner: Spark. Requested by Jared, 12:49 AM PT, October 14, 2026.

> "Any of the approved videos should be auto-posted, for all my products. Set it up just like Elizabeth (Centering YOU): virtually mirror it. Smart posting based on holidays, the context of the content, and relevance to anything coming up soon."

## Decisions (Jared)

- Approved means Jared tapped Approve in Studio for the current content_version. Nothing posts before that.
- This supersedes the 2026-10-04 rule that InventoryProof, Cookie Yeti and HOKU post directly with no review.
- Weekly caps, per posting account, weeks run Sunday to Saturday:
  - @bestly_llc: 7 a week, shared by bestly-cloud, bestly-studio and bestly-agent.
  - InventoryProof: 7 a week.
  - HOKU: 4 a week.
  - Cookie Yeti: 5 a week.
- Instagram only today. Other platforms come next week, so a platform is a setting (`social_brand_settings.platforms`), not a rewrite.

## Plan

1. Inventory every old direct-post path and switch it to file a Draft for review. Do not delete jobs. Update team cards and pulses.
2. Make the cap per posting account, not per client.
3. Calendar autopost for every house brand, like Centering YOU, with the slot reason on each card.
4. Studio UI parity. "Post to @handle" stays as a manual Post now.
5. Safety: dry-run the first 14 days before enabling. Earliest auto-post is 9:00 AM PT, October 14.
6. Leave the yuvj420p items alone (re-encoding resets approvals).
7. Watchdog: a failed post raises a Spark alert with Retry. An empty approved runway for the next 3 days raises a Spark info alert.
8. Verify with a dry-run table, Studio calendar screenshots at 390 and 1440 per brand, combined weekly counts for @bestly_llc, and the iPhone feed.
9. Migrations append-only, applied and committed.
10. Memory: `studio/house-autopost-2026-10-14`, a line on `studio/content-calendar-plan-2026-10-13`, and the supersession recorded.

### Refinements made while building

- Legacy posts that have no approval item still count against the weekly cap and the one-post-a-day rule (migration 090800).
- A dated Schedule checks the cap and the pause days on the server, so the sheet and the time box cannot exceed them.
- `items_week_cap` moves overflow to the next free day. It does not refuse.
- House events (Cybersecurity Awareness Month, Thanksgiving) appear on the calendar as dates, de-duplicated, and as feed entries.
- The old Pipeline card is shown only for legacy posts that still need watching.

## Result

### Old direct-post paths and what they do now

| Path | Before | Now |
|---|---|---|
| `social_bank_tick` / social-render (Cookie Yeti, InventoryProof) | rendered and queued posts daily | `enabled=false`, job kept |
| Pi `hoku_maker`, `brand_maker` | inserted queued `social_posts` | the insert gate files them to Drafts for review (cap 3 pending per client) |
| Pi `bestly_social` daily and Tuesday carousel, via `bestly-ig-poster` post and `bestly-fb-photo` | posted straight to Instagram | return held and file a Studio draft |
| `bestly-ig-poster` queue | accepted any queued row | insert gate; the drain `claim_next_social_post` claims a house post only if it is linked to a cleared item |

### Caps and mechanics

- Per posting account: @bestly_llc 7 (shared by three clients), InventoryProof 7, HOKU 4, Cookie Yeti 5.
- Pipeline, same as Centering YOU: `calendar_autopost`, `studio_autoslot`, `studio_autopost_tick` (every 5 minutes), `studio_calendar_watch`, `items_week_cap`, drain `bestly-ig-poster`.
- Alerts are signed Spark and never push: `studio:content-calendar`, `studio:autopost`, `studio.house-runway`.

### First 14 days (America/Los_Angeles)

Only these 8 items are approved; the rest are Drafts. No duplicates against posted media.

| Date | Time | Item | Brand | Reason |
|---|---|---|---|---|
| Wed Oct 14 | 9:00 AM | CK03 | Cookie Yeti | Cybersecurity Awareness Month |
| Wed Oct 14 | 10:30 AM | BC05 | @bestly_llc | Cybersecurity Awareness Month, "password" |
| Wed Oct 14 | 1:00 PM | I03 | InventoryProof | Fire season, "claim" |
| Thu Oct 15 | 10:30 AM | BA01 | @bestly_llc | |
| Thu Oct 15 | 11:00 AM | H04 | HOKU | Wednesday skipped: legacy Oct 13 post |
| Fri Oct 16 | 10:30 AM | BA02 | @bestly_llc | |
| Sun Oct 18 | 10:00 AM | I04 | InventoryProof | |
| Mon Oct 19 | 11:00 AM | H05 | HOKU | |

### @bestly_llc weekly counts, next 4 weeks

- Real state: week of Oct 11 has 3 of 7, then 0, 0, 0.
- Simulation with the whole backlog approved: 4, 7, 1, 0. The cap holds.

### Studio build

- Live: `27d1f5a0-50fa-4104-bfd1-8962cf338626`, base `0ea84dc8-16bd-4a23-a4a4-f493549e7e02`. Rollback: flip back to `0ea84dc8`.
- House brands get the Calendar tab, the Centering YOU panel, slot reasons, Ready and Scheduled lanes, Post now (preview then confirm), Retry and Take it back.
- Verified with Playwright screenshots at 390 and 1440 for bestly-cloud, bestly-studio, bestly-agent, cookie-yeti, hoku and inventoryproof (`/tmp/claude-0/sp/autopost/final/`), a rolled-back failure-alert test, a rolled-back cap simulation, and the ICS feed output (platform letters such as [I]).

### Migrations

`20261014090000` through `20261014090900` (`house_autopost_*`): accounts, cap_guard, settings_calendar, planner, gate, old_paths, tick, watch, legacy_count, ui. Edge functions: `bestly-ig-poster` v18, `bestly-fb-photo` v9. New anon-callable RPCs (`studio_clients`, `studio_calendar`, `studio_item_schedule`) are on `security_public_rpcs`.

### Open

- Pi copies of `bestly_social.py`, `hoku_maker.py` and `brand_maker.py` need a sync from `scripts/pi-wave-b`. Until then the insert gate still files their output to Drafts.
- yuvj420p items (CK03, H04, H05, I03, I04) were not re-encoded. The poster pipeline accepts them and Instagram transcodes. Chromium and iPhone Safari cannot play them in Studio.
- The first auto-posts fire at 9:00 AM PT, October 14. Watch the first one.
- Historical HOKU and InventoryProof legacy posts are not drawn on the calendar. They still count toward the caps.
- `src/integrations/supabase/types.ts` not regenerated; the React app does not call these RPCs.
- Orphaned Studio files in storage: `app/index.e60dfed5b9.html`, `app/index.c62b27fff9.html`.
- BC06 was a test item and is killed.
