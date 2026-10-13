# Studio unique content: every video different, every video a reason to come back (2026-10-12)

Jared, 10:32 PM PT: "no duplicate-looking content, brand-consistent, but every piece unique, engaging, and it brings viewers back."
Owner: Spark (Montage). Everything below is internal; nothing was posted and nothing went to Elizabeth.

## Rules this plan obeys
- Least-informed-viewer copy (scene 1 says what the product is and who it is for), every video has music, every glow feathered, no "…", numbers keep their units,
  12-hour times, claim rules + chip validator + absolutes guard stay on for every new piece of text (series tag, Next tease, comment question, big word, steps, recap).
- No LTX b-roll, no new music generation, free AI first, ElevenLabs voice only (about 5 cents a video), existing narration reused when the spoken lines are unchanged.
- Alerts are Spark-signed, info, never pushed (`montage.variety`, `montage.series`; `notification_owners`).
- Migrations are append-only (four new files, `20261013060000` to `20261013060300`).

## What was wrong
Every Bestly Cloud video had the same shape: icon disc on top, one left-aligned headline, same closing card, same opening ("One box holds your files and tools. A private
cloud for small businesses ..."). Nothing remembered what the last video looked like, the music picker only avoided the last single track, and nothing gave a viewer a reason to
come back.

## Design

### 1. A look per video (variety engine, `tools/montage/variety.py`)
| Dimension | Options |
|---|---|
| Layout set | L1 to L6: the order in which five scene templates run (stack, center, split, stat, steps) |
| Hook style | question, bold count, the problem, an imagined story ("Picture ..."), myth versus fact |
| Accent colour | the brand's approved list per ground (`CFG["accents"]`; HOKU per theme) |
| Closing card | list (chips), claim (big title, compact chips), qa (the question and its answer, then the product) |
| Icon style | orbit, badge, rings |
| Music track | never one of the last 2 used for the brand (the last 1 if the brand reaches fewer than 3 tracks) |

`make_plan` draws 260 random looks, scores each by its minimum difference from the brand's last 8 filed videos (target 4 dimensions) and avoids the layouts and closing cards other
brands used last. The writer prompt gets a VARIETY block (hook rules, segment, which scene needs `big` or `items`, the comment question, the recap for a qa card).

### 2. The duplicate gate
A finished script passes only if (a) it differs from each of the last 8 filed videos on at least 3 look dimensions, and (b) its hook sentence is under 72% similar (larger of
character ratio and word overlap) to each of the last 20 openings. A miss re-rolls the look and the words, twice. Then `VarietyHold`: the job is held, re-tried every 30 minutes
with a fresh draw, stopped after 7 days, Spark alerts `montage.variety` (info, no push). The gate compares the hook sentence only, because every Cloud "say" carries the same
"what it is" sentence (the first live run showed that: 75% "same" on the shared sentence alone).

### 3. Come-back features
- **Numbered series.** `studio_series` per brand: Bestly Cloud "Tip n of 8", Bestly Agent "Episode n of 8", Bestly Studio, InventoryProof, Cookie Yeti "Lesson", HOKU "Moment". Small
  tag in the top corner of every scene, first line of the caption. A re-cut keeps its parent's number (`studio_series_take` is idempotent per job).
- **Named recurring segments.** `studio_segments` (3 per brand: Quick fix, Myth or fact, ...). Shown as the first kicker, rotated by least recently used; each segment lists the
  hook styles it works with.
- **"Next:" tease from a real queue.** `studio_series_topics` holds the planned next topics (about 43 seeded). The next one goes on the closing card, into the spoken last line
  ("Next: ... Follow for tip two.") and into the caption. Claim-checked first; Spark alerts `montage.series` when fewer than 2 are left.
- **One comment question** at the end of the caption (4 to 12 words, no digits, no "comment below"), claim-checked.
- Caption order: series line, body, tail, Next, question, hashtags last.

### 4. New rendering (`comp/brand/BrandShort.tsx`, `comp/hoku/HokuShort.tsx`)
Scene templates (stack is the old one), three icon styles, three closing cards, an accent override from `props.look`, the series tag, the Next pill and follow line, and 13 new icons
(camera, home, receipt, list, package, image, shield, cookie, toggle, clock, video, pencil, star). All props optional: old props draw as before; the self-heal fallback
(`_plain`) strips the new props if a render with them fails.

### 5. Data (Supabase, all RLS on, service role only)
`studio_series`, `studio_series_topics`, `studio_segments`, `studio_look_ledger` (fingerprint, opening, hook, segment, ep, state planned/held/filed/failed, superseded);
RPCs `studio_series_take/info/topic_set/next_brief`, `studio_look_record/set/state`; trigger `trg_look_filed` on `studio_video_jobs`; new `montage_music_pick` (avoids the last two,
lends a bed from the Bestly library to a brand with none) and `montage_music_borrow`. Legacy videos were backfilled into the ledger as `legacy` fingerprints so the gate has history from day one.
No emails or phones are stored (no `privacy_data_map` rows needed).

### 6. Centering YOU
No Montage brand: its videos are Elizabeth's recordings (cy-kit). `tools/montage/tests/cy_music_graphics.py` made a new internal draft that is a copy of CY29 (CY29 untouched) with a
music bed (borrowed from the Bestly library, ducked under her voice, swelling after the last word) and two feathered callout cards in the free band between the hook box and her head.

## Open items
- Centering YOU should get its own tracks and a real series once Jared picks the mood; today it borrows a Bestly bed.
- The keep-the-copy re-cut path restores the old words after the writer ran, so its recorded hook style is the plan's, not the restored copy's. It only matters for the gate's history.
- Topic queues need a refill every 6 to 8 videos per brand (Spark's `montage.series` alert says when).

## Result
(filled in after the 7 tests, below)
