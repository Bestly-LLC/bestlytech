# Opusplan: review her takes before anything gets made

Written 2026-10-15 (Opus) for a Sonnet agent. Owner: Spark.

Jared, 2026-10-15: "give me the ability to send videos back to her from the ask section ... with a note ...
We review the video she recorded based on the script it was attached to. We approve it for production ... or we send
it back to her to re-record with different notes attached ... make sure that her board represents this cleanly ...
Any videos sent in from her should no longer automatically just edit and produce. We need to approve them."

## The flow after this ships

```
She records -> take lands (transcoded) -> WAITING FOR REVIEW (staff Asks, "In from them")
   |-- Approve   -> AI editor (Spark recut kit) cuts it -> lands in Drafts -> normal post flow (she hears then)
   '-- Send back -> note goes to her -> her board: "Record again" at the top + daily digest
                    -> she records Take 2 on the SAME ask -> WAITING FOR REVIEW again
```

## Decisions Jared made (2026-10-15, do not re-ask)
| # | Question | Answer |
|---|---|---|
| 1 | What auto-edits today | Auto-cut / captions run on arrival (Spark recut kit, see below) |
| 2 | Where the buttons live | Staff Studio, Asks section, on the take, next to the player |
| 3 | Which note goes to her | The review thread `client_ask_reviews` (history of every round) |
| 4 | What Approve does | Queues it for the AI editor; the produced cut lands in Drafts |
| 5 | Re-record shape | SAME ask reopens; the new upload is Take 2; history kept |
| 6 | How she hears | Top of her board + her daily digest email. No instant email, no Talk line |
| 7 | Her sent-back card | Our note big and plain, her last take (playable), the script again, ONE "Record again" button |
| 8 | Approve, from her side | Nothing until the draft is ready (no tick, no email) |
| 9 | Scope | Every client recording (purpose 'ask'). House brands / Montage untouched |
| 10 | Clips already in flight | Let them finish. Only uploads after launch need approval |

## What we know before starting (checked live 2026-10-15)
- Her recording: TUS to bucket `client-media` -> `client-media` edge fn `done` -> `client_upload_done()` sets the
  upload `ready` and the ask `open -> received`. Trigger `notify_upload` on `client_uploads` pings staff
  ("Open it in Studio > Asks ... under 'In from them'"). External transcode worker -> `client_media_finish()` sets
  `transcoded`.
- `studio_ask_attach(p_token, p_upload, p_item)` (staff, `can_promote`) needs `transcoded`, makes/updates an
  `approval_items` row (stage 'internal', status 'pending'), sets the upload and the ask to `attached`.
- **The "AI editor" is Spark's recut kit, running on the Mac mini** (`~/Bestly/tools/recut-kit`; kit files are
  mirrored in Storage bucket `handoff`, listed in `studio_tool_manifest`, checked daily by `studio_recut_check`).
  Its cuts come back as `client_uploads` rows with `purpose='asset', asset_kind='render'`, plus a version note.
  **What starts it is not in this repo or in a DB trigger.** Find it before you build the gate (step 1).
- `client_asks.status` values seen: `draft`, `open`, `received`, `attached`, `closed`. `client_asks_board` (her board)
  hides `closed`/`draft` and sorts `open` first. `studio_asks` (staff) already returns `reviews` from
  `client_ask_reviews` and calls them "staff-only". So nothing in that table reaches her today.
- Her board and the staff Studio are ONE app served from `studio_builds` (see `docs/studio-one-ui-opusplan.md`).
  Ship only by the protocol in bestly_memory (`ship/protocol` / `studio/protocol`): new row from the live base,
  preview, verify, flip. Patch tooling is in `tools/studio-one-ui-guard/app-patch/` and `tools/studio-mobile-qa/`.
- Live function bodies are the source of truth. Read them with `pg_get_functiondef` before changing any of them,
  and put the full new body in a migration (migrations are append-only).

## Steps

### 1. Find what starts the recut kit (do this first)
- Look in bestly_memory (area 'studio', keys about recut / spark / handoff), `pi_jobs`, `bestly_agents`, and on
  the Mac mini (crontab, launchd, `~/Bestly/tools/recut-kit`). Find what makes it pick up a client take.
  It could be a poll on `client_uploads` status `transcoded`, a Talk or notify line, or a Claude routine.
- Write down what you find in the build note. Then put the gate where it picks up work: it must only take
  uploads whose `review_state = 'approved'`. The DB function in step 3 is the single place it asks.
- If the picker is a Claude scheduled task, flag it to Jared under the "save tokens, run it local" rule. Do not
  rebuild it.

### 2. Schema (one migration, `<ts>_studio_take_review.sql`)
- `client_uploads`: add these columns:
  - `review_state text`, with a check: null | 'waiting' | 'approved' | 'sent_back' | 'legacy'
  - `reviewed_at timestamptz`
  - `reviewed_by uuid` (references `approval_staff`)
  - `take_no int`
- Backfill, per Q10 (let in-flight work finish). Every existing `purpose='ask'` upload gets
  `review_state = 'legacy'` and `take_no` = its row number for the ask, ordered by `created_at`.
- `client_asks.status`: allow a new value, `'redo'`. If a check constraint or `trg_ask_rules` lists the values,
  extend that.
- `client_ask_reviews`:
  - Add `to_client boolean not null default false` and `upload_id uuid` (the take the note is about).
  - Add `'approved'` and `'rerecord'` to any decision check.
  - Rows with `to_client = true` are the only ones she can ever see.
- `notify_kinds`: add kind `client_redo` (audience client, folded into the daily digest like `client_ask`).
- Also extend `notify_outbox_take` so a `client_redo` row is kept while the ask is `redo`, and dropped otherwise.
- No new emails or phones are stored, so `privacy_data_map` needs no rows. No new anon RPC: her board reads
  through the existing `client_asks_board`, so `security_public_rpcs` is unchanged.

### 3. Functions (same migration, full bodies)
- **`client_upload_done`**. For purpose 'ask':
  - Set `review_state='waiting'` and `take_no` = the next number for the ask.
  - Move the ask `open|redo -> received` (today it only moves from `open`).
  - Clear `received_at` and stamp it fresh.
- **`trg_notify_upload`**. Change the staff line to say it needs review: '... sent Take N for "<title>". Review it
  in Studio > Asks.' Keep the same kind, link and throttle.
- **`studio_take_approve(p_token text, p_upload uuid)`**: staff, `can_promote`, `staff_may_see`. It does this:
  - Requires `transcoded` and `review_state='waiting'`. A second call returns `{ok:true, already:'approved'}`.
  - Sets the upload to `approved` and stamps `reviewed_*`.
  - Sets the ask's `internal_status='approved'` and keeps status `received`, so she sees nothing new (Q8).
  - Inserts `client_ask_reviews` (decision 'approved', `to_client=false`, `upload_id`).
  - Writes a Talk/staff line only if the existing staff notes do. No client notify.
- **`studio_take_send_back(p_token text, p_upload uuid, p_note text)`**: same guards. `p_note` is required,
  trimmed, at least 3 characters and at most 2000. It does this:
  - Sets the upload to `sent_back` and stamps `reviewed_*`.
  - Sets the ask to `status='redo'`.
  - Inserts `client_ask_reviews` (decision 'rerecord', `to_client=true`, `note`, `upload_id`).
  - Inserts `notify_outbox` (audience client, kind `client_redo`, idempotency key `client_redo-<upload_id>`).
  - Does NOT mirror the note to `clip_note` (Q3 chose the thread).
- **`studio_takes_for_edit()`**: returns uploads with `review_state='approved'` that have no render made from them
  yet. This is the ONLY queue the recut kit reads (step 1). If the kit needs a "picked up" mark, add
  `edit_claimed_at` and a claim function in the same style as `montage_claim`.
- **`studio_ask_attach`**: refuse `review_state in ('waiting','sent_back')` with `error:'not_approved'`.
  'approved' and 'legacy' pass, which keeps Q10.
- **`client_asks_board`** (her board). It does this:
  - Includes `status 'redo'` and sorts it first, ahead of `open`.
  - For each ask adds `redo` = `{note, at, take_no, last_take:{url: transcoded_url, poster: poster_url,
    duration_s}}`, built from the newest `to_client` 'rerecord' review and its upload. That is null unless
    status is `redo`.
  - Adds `takes` (count).
  - Never returns reviews where `to_client=false`.
- **`studio_asks`** (staff): adds `review_state`, `take_no`, `reviewed_at`, `reviewed_by` name to each upload, plus
  the `to_client` flag on each review. On the staff side, also add a count of takes waiting to `studio_seen_counts`
  (or whatever feeds the Asks badge).
- **The digest builder (`studio_digest_compose_client`)**: render `client_redo` as a task block. Headline
  "Record again: <ask title>", our note as the body, and one button to her board at the ask. Use the v7 task-block
  shape in `supabase/functions/studio-notify/index.ts`. Redeploy `studio-notify` only if its code changes.
- Regenerate `src/integrations/supabase/types.ts` after the migration.

### 4. Staff UI (Studio app, Asks > "In from them")
- Each take card shows these things:
  - The player (`transcoded_url`), "Take N" and its length.
  - The script, collapsed and one tap open, so we review against it.
  - The thread of past rounds.
- Two actions on a `waiting` take:
  - **Approve**, primary. It confirms in place: "Approved. Spark is cutting it; it will show up in Drafts."
  - **Send back**, secondary. It opens a note box (required) labelled "What should she change?" with a
    "Send to her" button. After sending: "Sent back. She'll see it at the top of her board and in tomorrow's email."
- State pills: Waiting for review / Approved, being cut / Sent back, waiting on Take N+1 / Legacy (no pill).
- Before a take is approved, the old "Attach to post" button is hidden, so it can't be used to skip the gate.

### 5. Her board (client view). The whole point: easy to read, one clear action
- A sent-back ask moves to the very top, under a small heading "Needs a re-record". Shown in this order:
  1. Our note, large and plain (the first thing she reads). A soft label: "Notes from the team".
  2. Her last take, playable inline (poster first, tap to play), labelled "Your last take".
  3. The script again (the same block the open ask shows).
  4. One button: **Record again**. It opens the existing record/upload for that ask.
- After she uploads, the card goes back to the normal "We got it" state. She sees nothing more until the draft
  reaches her (Q8).
- No count badges and no history list on her side, just the latest note. Copy follows the house rules: no emoji,
  plain words, and a sentence that fits on one line never splits (`<Lines>` pattern in the app's own way).
- Phone-first check at 375 px wide. Nothing is cut off with "...", and the button is reachable with a thumb.

### 6. Design pass
Load the `apple-design` skill, build, then do a second pass with `ui-ux-pro-max` (CLAUDE.md rule). The admin is
dark; her board keeps its current look.

### 7. Verify on the preview build (before the flip)
Use the sandbox client (`bestly-test` or `demo-two`, never Centering YOU's real asks). Go through every case:
1. Upload a take, as the client. Expect: the ask is `received`, the upload is `waiting`, the staff ping says
   "Review it", and the recut kit does NOT pick it up (`studio_takes_for_edit` is empty).
2. Send it back with a note. Expect: her board shows "Needs a re-record" on top with the note, the playable
   take, the script and one button; a `notify_outbox` `client_redo` row is held for the digest; she never
   sees staff-only notes.
3. Record Take 2. Expect: `take_no=2`, `waiting`, and the card is out of the redo section.
4. Approve. Expect: it appears in `studio_takes_for_edit`; her board shows nothing new; attach works.
5. Approve twice, and send back an approved take. Both should be clean refusals, not errors.
6. Check the Q10 data: an old `legacy` take still attaches as before.
7. Playwright screenshots of the staff take card and her board, at desktop and at 375 px. Zero console errors.
Then flip, confirm exactly one live `studio_builds` row, and smoke-test live with the sandbox client.

### 8. Ship and record
- Commit the migration, types, plan, patch script and any edge fn change to `main`, then push (CLAUDE.md:
  commit and push without asking). Edge functions deploy via Supabase MCP.
- Build note in bestly_memory, area 'studio', key `studio/take-review-2026-10-15`. Include:
  - What starts the recut kit, and where the gate is.
  - The new states.
  - Rollback: flip the previous `studio_builds` row back; the SQL gate can be opened by setting pending uploads
    to 'legacy'.
- No new cron or bot, so no team card. If step 1 adds a claim loop on the Mac mini, then it does need one: run
  `team_onboard` for it under Spark.
- Report back to Jared in under 10 lines: what changed, and the one thing (if any) only he can do.

## Out of scope
Timestamped notes on the video, partial approval of multi-part takes, a per-client toggle, and changes to
Montage / house brands.
