# Claims Closer v2: estimates, evidence, shop choice, booking (opusplan, 2026-10-06)

**Goal (Jared, verbatim intent):** "All I want to do is submit claim, then let it book, then go to the appointment."
After Jared files a Turo damage claim, Claims Closer (team slug `claims-closer`) handles everything: reads the
evidence, gets repair estimates, picks the best shop, uploads the estimate/invoice to Turo, works the guest and their
insurer, and when Jared says **"book it"**, books the repair (online or by having Ava call). If unsure, it asks Scout,
who alerts Jared. Jared's only taps: **file the claim**, **Book it**, **show up**.

**Autonomy (Jared's answer 2026-10-06): fully hands-off.** Guest messages, estimate requests to shops and the Turo
invoice go out on their own. Guards stay (review-leverage guard, money guard, Scout consult when unsure). The one
thing that waits for Jared is booking ("Book it" button), and anything that would spend his money.

## What exists today (v1, built 2026-10-04/05)
- Tables `claim_cases`, `claim_drafts`, `claim_events`; `claims_notify()` (alerts signed "Claims Closer").
- `bestly_mail` trigger opens cases from Turo claim mail; `turo_inbox` trigger wakes on guest replies.
- Edge fn `claims-closer` (free AI via `_shared/free-llm.ts`, `paid:"never"`), cron `claims-closer-tick` (2 min) ->
  `claims_tick()`; `agent_beat('claims-closer', ...)` every run; team card onboarded.
- Sending: Pi Turo reader 1.1.0 (`/opt/bestly/turo-reader/reader.py`, service `bestly-turo-reader`) claims approved
  drafts via `claims_send_claim` / `claims_send_done` (worker token = `tesla_worker_ok`) and POSTs
  `/api/v2/message/send` in its signed-in Chromium (CDP 127.0.0.1:9334). Approving pokes `turo_reader_state.poke_at`.
- `/admin/claims` page (`src/pages/admin/ClaimsCloser.tsx`): open cases, drafts, Won / Not followed through history.
- 13 past claims backfilled (migration 20261005170000) with `turo_claim_no`, `turo_incident_id`, `host_responsibility`.

## Turo endpoints (read from the Pi's signed-in Chromium; all `credentials:'include'`)
- `GET /api/claims/host/2907746` - every claim: `id` (incident id), `claimNumber`, `claimStatus`, `dashboardStatus`
  (e.g. "Send Willie an invoice"), `claimProgression`, `reservationId`, `paymentIssued`.
- `GET /api/v2/incidents/{incidentId}` - resolve-directly incidents: `hostDeductible` (Jared's damage responsibility),
  `guestOutOfPocketMax`, `maxAmountAllowedForResolveDirectlyInvoice`, `invoiceDetails`, deadlines.
- `GET /api/claims/{claimId}` - Turo-managed claims: `detailedClaimStates` (repair cost, payments).
- Damage report page `/us/en/resolutions/{reservationId}/damage-report`: guest response + Jared's report text; photos
  load via `/api/reservation/imageV2/thumbnail?uuid=<uuid>&width=210&height=210` (try larger width/height for full
  size). Find the JSON the page uses (watch `performance.getEntriesByType('resource')`, e.g.
  `/api/claims/static/fnol/context?reservationId=`); fall back to DOM text + image uuids.
- "Create invoice" on `/us/en/business/claims-dashboard/incident/{incidentId}`: endpoint unknown. Discover it by
  reading the page's JS / form (do NOT submit while exploring). It takes an amount (<= max allowed), a message and
  evidence (estimate document + photos).
- Willie case now: incident 653528, claim 1096164, `hostDeductible` $2,750, guest max $500, invoice max $500, deadline
  Oct 23 9:30 PM. Willie's response (Oct 5 6:04 AM): "Was parked in parking garage when got scraped", location
  "FIG at 7th Parking (ParkABM)". **Estimate due to guest Wed Oct 7 ~11:54 AM - phase 1-3 first.**

## Phases (build in this order; each phase ships on its own)

### 1. Evidence sync (Pi reader 1.2.0)
- Every 10 min (and on poke) for each open case with `turo_incident_id`: read claims summary + incident; store
  `turo_status`, `turo_next_action` (dashboardStatus), `turo_deadline`, `invoice_max` on `claim_cases`. A change in
  next action or a new guest response -> `claim_events` + `needs_work = true`.
- Damage report: guest answers + Jared's description into `claim_cases.guest_response jsonb` / `damage_report jsonb`;
  photos (before/after, uuid, step) downloaded and pushed to a new private bucket `claim-evidence` through a new edge fn
  `claims-evidence` (header `x-tesla-worker` token, same check as `turo-ingest`) -> table `claim_evidence`
  (case_id, uuid unique, kind before/after, storage_path, taken_at, width, height). Never re-download a known uuid.
- Backfill evidence for the open Willie case first.

### 2. Shops
- Table `claim_shops` (name, address, phone, email, website, booking_url, lat, lng, distance_mi, rating, rating_count,
  tesla_experience bool, photo_estimates bool, oem_capable bool, warranty text, notes, active). Home = 733 N Kings Rd,
  West Hollywood (34.0857, -118.3714). Seed (find emails/booking pages via web search; leave null if not public):
  - Pristine Collision Center, 919 N Fairfax Ave, West Hollywood, (323) 456-4551, 4.7 (168), lifetime paint warranty, ~0.6 mi
  - Pristine Collision Center Hollywood, 7318 Sunset Blvd, (323) 366-2610, 5.0 (50), Tesla reviews
  - Premium Collision Center, 7068 Lexington Ave, West Hollywood, (323) 464-2200, 4.8 (212)
  - Paulee Body Shop (Kenduco), 1115 S La Cienega Blvd, (310) 652-5373, 4.4 (150), Jared used them before (Gus)
  - Ace Tech Collision Center, 4334 W Pico Blvd, (323) 935-5000, 4.7 (432), many Tesla reviews
  - AGC Collision Center, 3424 Sunset Blvd, (323) 663-8076, 4.7 (261), EV-certified, Tesla reviews
  - CrashFix, 2222 S Sepulveda Blvd, (310) 731-9009, 5.0 (89), bumper repair specialists (repair vs replace)
  - Avio Coach Craft, 2245 Pontius Ave, Tesla Approved Body Shop (OEM path)
  - Tesla Collision North Hollywood, 13005 Sherman Way, (818) 299-9196 (OEM path, far)
- Rank: quality (rating x log(count), Tesla experience) first, then distance, then price once estimates exist.
  **OEM / Tesla-approved only when the repair is covered in full with $0 from Jared** (guest insurer or third party
  paying everything). Otherwise quality repair/refinish is fine.

### 3. Estimates (auto, no approval)
- Table `claim_estimates` (case_id, shop_id, channel email|call|web|walk_in, requested_at, status
  requested|received|declined|no_reply, amount, oem bool, repair_vs_replace text, line_items jsonb, doc_path,
  mail_id, notes, chosen bool, chosen_reason).
- When a case needs an estimate (no `estimate_amount` and Turo next action mentions invoice/estimate, or a guest
  insurer is in play): request photo estimates from the top 3 shops that accept them:
  - Email from jared@bestly.tech through the existing outbound mail path (find it: Pi mail bridge /
    `bestly_mail_queue` / `bestly_sent_mail`; it MUST carry Jared's "Bestly" signature). Body: car, damage description,
    photo links (signed URLs, 14 days) or attachments, ask for an itemized estimate (repair vs replace, OEM vs
    aftermarket), and earliest drop-off. Plain, short, from Jared.
  - No email on file -> Ava calls the shop to ask how to send photos for an estimate (see phase 6 for Ava).
- Parse replies from `bestly_mail` (match by shop email/domain or thread); amount + line items with free AI
  (`task:"extract"`, json). If the mail has an attachment, fetch it through the mail bridge if possible; else ask in the
  reply for the total in the email body.
- Follow up once after 24 h; Ava call after 48 h; mark `no_reply` after 72 h.
- If nothing usable 18 h before Turo's estimate deadline: `claims_ask` (phase 7).

### 4. Choose + upload to Turo (auto)
- Pick the best estimate: cheapest **quality** option within ~25% of the lowest, nearer wins ties; record
  `chosen_reason`. Spread > 2x or only one estimate -> still choose, but `claims_ask` FYI to Scout.
- Set `claim_cases.estimate_amount`, `chosen_shop_id`.
- Resolve-directly: Pi creates the Turo invoice: amount = min(estimate, `maxAmountAllowedForResolveDirectlyInvoice`),
  evidence = estimate doc (+ photos), message = short explanation. New RPC pair `claims_turo_claim/claims_turo_done`
  (worker token) like the send pair; queue table `claim_turo_actions` (kind create_invoice|mark_insurer|escalate,
  payload, status, attempts, result). Verify by re-reading the incident (`invoiceDetails` present).
- Then auto-message the guest (existing draft path, status set straight to `approved`): estimate total, the $500
  invoice in Turo, and the insurance route for the rest. Guards still apply.
- Escalation stays a Scout consult (only worth it when repair > `host_responsibility`).

### 5. Guest insurer + third parties
- When the guest sends insurer + policy (`claim_cases.insurer`): email the insurer's claims address (look it up) or
  Ava calls to open a third-party claim with the estimate + photos + Turo agreement clause 2.6; record claim no,
  adjuster. Queue `mark_insurer` in Turo ("Working with guest's insurer") so the 20-day cutoff is extended.
- Willie said the damage happened in a parking garage ("FIG at 7th Parking (ParkABM)"): raise a `claims_ask` to Jared:
  "Want me to file a damage claim with the garage operator too?" Do not contact the garage without a yes.

### 6. Booking (waits for "Book it")
- Claims page shows the chosen shop + estimate and a **Book it** button (only Jared action). RPC `claims_book(case_id)`.
- Find a slot: car must be free (no `turo_trips` overlapping drop-off..pickup; repair days = shop's estimate or 3 days),
  weekdays 8-10 AM drop-off preferred, next 10 days.
- Online booking (`booking_url`) via the Pi Chromium if the form is simple; otherwise **Ava calls** the shop:
  add a service-role path to `ava-assistant` `{action:"call", phone, name, purpose, first_line, context}` (today admin
  JWT only) and read the outcome from `ava_calls` (post-call webhook) with free-AI extract {booked, when, notes}.
- On booked: store `claim_cases.repair_booking jsonb` (shop, drop-off, est. pickup); block those days on Turo if an
  endpoint exists (else alert Jared to block); calendar event (Nextcloud CalDAV via existing path if any); reminders
  signed Claims Closer: day before 6 PM + morning of. Message the guest only if useful (no).
- Not booked after 2 call attempts -> `claims_ask`.

### 7. Scout consult
- Table `claim_questions` (case_id, question, options jsonb, answer, asked_at, answered_at). `claims_ask(case, q,
  options)` -> `claims_notify` warning push + `bestly_raise('claims.ask.<id>', ..., p_needs_jared => ...)` so Scout
  carries it; answers on the Claims page (buttons) or through Scout. Claims Closer pauses that branch until answered.

### 8. Watchdogs (Jared's rule: every build self-heals + Scout)
- `claims_tick` already beats. Add: evidence sync stale > 30 min while a case is open -> `bestly_raise('claims.sync')`
  and poke the Pi; Turo action stuck `sending` > 10 min -> failed + alert; estimate request with no reply 72 h ->
  next shop automatically; Ava call failure -> retry once then ask.
- Pi reader: any new Turo call wrapped so a failure never stops trip/inbox reading.

### 9. UI (`/admin/claims`, Apple HIG feel, numbers never wrap from units, no "..." truncation)
- Case card: Turo status + next action, deadlines, **Evidence** (photo grid before/after, guest's answer), **Estimates**
  (shop, distance, amount, OEM, status, chosen + why), **Book it** / booking status, **Questions from Claims Closer**
  (answer buttons), timeline. Drafts list becomes a read-only "Messages sent" log in hands-off mode.

### 10. Settings
- `claims_settings` (single row): `autonomy text default 'full'` ('full' | 'guest_approval'), `home_lat/lng`,
  `max_shop_miles default 15`, `shops_per_request default 3`. In `full`, `claims-closer` inserts guest drafts as
  `approved` directly (still through reviewGuard/moneyGuard) and no longer pushes "ready for your OK".

## Rules for the builder
- Repo `/home/claude/bestlytech` (Vite/React + Supabase project `rcqfqhguwpmaarseifqg`). Read `CLAUDE.md` first.
  Migrations append-only (new files only). Free AI only (`paid:"never"`). Secrets only in Vault.
- `apply_migration` via MCP sometimes comes back "cancelled". Do not loop on it: commit the SQL file, then apply it
  from the Mac mini with Desktop Commander: fresh `git clone --depth 1 https://github.com/Bestly-LLC/bestlytech`
  into a temp dir, then `/opt/homebrew/bin/supabase db query --linked --project-ref rcqfqhguwpmaarseifqg -f <file>`.
  Edge functions: `supabase functions deploy <name> --project-ref rcqfqhguwpmaarseifqg --no-verify-jwt --use-api`
  from that clone. Verify with `execute_sql` after.
- Pi: from the Mac mini, `ssh -o BatchMode=yes bestly-pi`; reader at `/opt/bestly/turo-reader/`; `sudo -n` works;
  back up before replacing (`reader.py.bak-<version>`), `sudo -n systemctl restart bestly-turo-reader`, then confirm
  `turo_reader_state.version` and `last_inbox_at` advance. Turo blocks automated browsers: only plain fetches inside the
  existing tab / new CDP tabs, slow cadence, close tabs you open.
- Every new automatic job: on the Team page via `team_onboard` (pulse names its cron jobs, `owns` alert prefixes).
- Commit + push to main after each phase. Write decisions to `bestly_private_memory` (area `turo`).
- **New RPCs the Pi calls with the publishable key** (e.g. `claims_turo_claim`, `claims_turo_done`, evidence RPCs) must be
  added to `security_public_rpcs` in the same migration, or Ares's Auto-Fixer locks them within an hour.
- **Notifications (autonomy rule 2026-10-06):** only security, money, a real person waiting, or something down an hour
  interrupts Jared. Use `claims_notify` (it goes through `notify_route`, which holds the rest for the 7 PM recap).
  Interrupt-worthy here: a `claims_ask` question, a booking confirmed (date/time), money landed, a deadline about to be
  missed. Routine progress (estimate requested, message sent) goes as `success`/info so it lands in the recap.
