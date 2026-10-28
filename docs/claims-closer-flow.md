# Claims Closer: the whole case flow

Written 2026-10-28 (Wed, after 1:48 PM PT) on branch `claims-closer-autonomy-2026-10-28`. This is the state machine of one damage case from the first Turo email to the day it is closed, and the rules that hold in every state. If code and this page disagree, the code is wrong or this page is out of date: fix one of them the same day.

Team slug `claims-closer`. Code: `supabase/functions/claims-closer/` (edge function), migrations `20261028150000_claims_autonomy_core.sql` and `20261028150100_claims_autonomy_functions.sql`, Claims page `/admin/claims`.

## The rules that hold in every state

1. **Jared's answers are instructions, never outgoing text.** Anything he types or taps (a button, the "Note to Claims Closer" box) is read for what he meant (button value, then rules, then the free AI ladder: proceed, skip, wait, provide info, other). Claims Closer then writes its own message in its own words, or sends nothing. Nothing he types is forwarded or quoted to a shop, guest, insurer or Turo. "Skip" closes a shop thread with at most "Thanks, we're all set on this one." and never names Tesla, another shop or an amount. One answer applied to several open questions is one decision. A question older than 7 days whose world moved on is retired, not answered.
2. **One chokepoint: `canSend(case, channel, recipient)`** (`send.ts`). Shop email, shop follow-ups, the total-in-body ask, the garage email, the insurer email, Ava calls (shops and adjusters), guest messages and every Turo reader action pass through it. It re-reads the case from the database and fails closed. A send is allowed only when: the case exists and is open and not history; there is no `outbound_hold`; the return gate is open; the recipient is well formed; insurer channels have `insurer_contact_mode = 'full'`; and the text passes the review guard, the Turo-voice and plan guard, the money guard (only the dollar figures the caller allows) and the answer-overlap guard (no run of 4 words or 20 characters shared with anything Jared typed on that case). Text written because of an answer also may not name a competing source. Every decision, allowed or blocked, is a row in `claims_send_log`; blocked sends show on the Claims page under "Held back this week". Outside claims (Kemper) have no Turo case, so they skip the hold and the gate but keep the recipient, insurer-mode and text guards.
3. **The return gate** (`claims_gate(case)`): open only when the Turo reservation has ended AND Complete trip is done (tapped by Jared or by the automatic rule below) or a compliant message already went out, AND there is no hold. A lookup that fails counts as closed. Nothing goes to a guest on any channel during a live trip.
4. **Never says:** a deductible or plan cap (or any coverage figure), anything for Turo (its plans, policies, processes, payment options), anything about reviews, ratings or stars. The only dollar figure a message may carry is the repair estimate total.
5. **Never sends from Gmail.** Email goes from jared@bestly.tech with Jared's Bestly signature (copy to jared@bestly.tech). Calls go through Ava on a recorded line.
6. **Alerts are signed "Claims Closer".** Only the four kinds of news interrupt Jared (security nobody could fix, money, a real person waiting, something down an hour). Everything else is a silent bell and the 7 PM recap. Times anyone reads are 12-hour Pacific. Good news is sent as `success`.
7. **Free AI only.** `paid: "never"` on every model call; the ladder is `_shared/free-llm.ts`. If every model is down, steps that need judgment wait or ask; nothing is guessed.
8. **Blocked means stop on that item and say so.** A hold, a closed gate or a guard never gets worked around. The block is logged, and the case's owner (Jared) is told once a day while a deadline depends on it.

## Settings (Jared, 2026-10-28)

| Setting | Value | Meaning |
|---|---|---|
| `insurer_contact_mode` | `full` | Opens third-party claims with guest insurers, emails adjusters, has Ava call insurers, chases until paid. `draft_only` prepares and contacts no one. |
| `booking_mode` | `auto` | Starts the repair booking itself once the money is assured (never fronts the repair). `confirm` waits for the Book it tap. |
| `min_accept_pct` | `100` | An insurer offer below 100% of the chosen estimate always goes to Jared. No counter-offers, no partial acceptance. It may restate the full estimate amount in its first reply. |
| `auto_complete` | on | Taps Complete trip when the reservation has ended and Blue Steel is parked at home or the LAX garage. |
| `hold_autorelease` | on | Clears only the hold whose reason is exactly "a message reached the guest while the trip was still live", once the trip is over and complete. |
| `booking_buffer_hours` | 4 | Gap kept between a repair and any booked Turo trip. |
| `deadline_lead_hours` | 72 | How far ahead of a Turo window it acts. |

Changed on the Claims page ("What Claims Closer does on its own") through `claims_autonomy_set`, which is admin-only and bounded.

## State machine

Case `status` values: `open`, `waiting_return`, `waiting_guest`, `insurance`, `invoiced`, `escalated`, `paid`, `closed`. The states below are stages of the case; a case can sit in more than one track at once (for example estimates and the insurer track).

### 1. Intake (Turo mail -> case)

- **Trigger:** a Turo email that a claim started (`resolve directly process`, or a claim mail from claims.turo.com). `claims_mail_seen` runs on each mail through the Scout mail pipe.
- **Who acts:** the database trigger; no model.
- **Leaves the building:** nothing.
- **Jared sees:** a new case on `/admin/claims` and its event log.
- **Also here (every Turo mail, same function):** `invoice_sent` stores the invoice with its kind (damage or incidental) read from the mail; `invoice_paid` marks only the invoice it belongs to (by Turo's invoice id, then amount and kind, then the one unpaid invoice) and records which one; `recovered_amount` and the status move only for a damage invoice (an incidental invoice such as a Supercharging reimbursement is bookkept and the claim is untouched); `invoice_expired` and `invoice_declined` lapse the window and wake the case; a "N days left to resolve directly" reminder stores the window; a claims.turo.com mail with a claim number or incident id links the case (`claims_link_turo_ids`, never overwriting an id already on file).
- **Timeout:** none. **Escalation:** none.

### 2. Gate (nothing to the guest until the trip is over and complete)

- **State:** `waiting_return` while the gate is closed and a message is drafted.
- **Who acts:** `claims_gate`, `claims_gate_sweep`, `claims_guard_watch` (sets holds), and the automatic rules in `claims_autonomy_sweep`:
  1. `claims_auto_complete_trips`: the reservation end (`turo_trips.ends_at`) has passed, the car's reading is fresh (30 minutes), the car is parked (no open drive, gear P, no speed) at home (733 N Kings Rd, 250 m) or the LAX Park My Share garage (600 m), and it is not on another live trip. It then makes the same update the Complete trip button makes and records `host_completed_source = 'auto'` plus the evidence. If the location is unreadable, stale or elsewhere it does nothing and the 24-hour reminder to Jared stays. The manual button always works.
  2. `claims_hold_autorelease`: only the live-trip-message hold, only once the trip is over and complete. Dollar-figure, Turo-voice, review and "first message before Complete trip" holds, and any hold Jared sets himself, stay held; a still-held case gets one reminder after 24 hours with the reason.
- **Leaves the building:** nothing (a draft is written and held).
- **Jared sees:** "Marked the trip complete" and "Released the hold" as good news in the recap; the held draft; "Held back this week" on the Claims page.
- **Timeout:** 24 hours with no Complete trip -> the existing reminder; 48 hours with no forward progress anywhere -> the stuck alert (state 14).

### 3. Evidence

- **Who acts:** the Pi Turo reader and the guest page fill `claim_evidence` (before-trip and after-trip photos); Claims Closer reads them.
- **Leaves the building:** nothing. Photos are attached later to shop, insurer and Turo requests.
- **Jared sees:** the photos on the case card.
- **Timeout:** none.

### 4. Path choice

- **Who acts:** `choosePath` (`autonomy.ts`), run on every tick by `deadlineStep`.
- **What it weighs:** resolve directly (fast; capped by the guest's out-of-pocket maximum when Turo reports it, internal only), a Turo claim (Turo pays the estimate minus Jared's damage responsibility; needs the filing window open), the guest's insurer (the full estimate; slowest; needs insurer and policy on file). Most recovered wins; ties go to the faster route. When a Turo window closes within the lead time and the slower route has not paid, a Turo claim is also filed as protection.
- **Leaves the building:** nothing by itself.
- **Jared sees:** one event "Route: <route>. <why>" and a row in `claim_decisions`, written again only when the answer changes. Dollar figures in that note are internal.
- **Escalation:** every route closed -> one question (Absorb it and close / I will handle it).

### 5. Estimates (shops and Tesla)

- **State:** the estimate pipeline (`estimates.ts`) on a `resolve_directly` case.
- **Who acts:** Claims Closer. Photo-estimate requests by email to the best-ranked shops (jared@bestly.tech, photos attached); shops with no email get an Ava call. Replies are read with the free AI (a total must appear in the shop's own words). Tesla Service and the Tesla Collision Center are a first-class source: a Tesla email about an estimate, or a total Jared types, becomes a `claim_estimates` row (OEM; chosen only when it is the best option or a third party pays in full). A Tesla mail is attached to a case only when it names the VIN or reservation, or there is exactly one open case waiting for an estimate; with no readable total it asks Jared to type one and never guesses.
- **Self-answer first:** when a shop asks for the VIN, how it heard of Bestly ("Found you online"), more or better photos, or repeats a request, Claims Closer answers from the case record and sends the photos already on file. Only money decisions and booking confirmation go to Jared. Anything it cannot answer from the record (dirt versus damage, a deductible, a drop-off day) it leaves alone and does not turn into a question.
- **Leaves the building:** estimate requests, one follow-up at 24 hours, an Ava call at 48 hours, `no_reply` at 72 hours and the next shop is asked; a one-line reply from the record. All through `canSend`.
- **Jared sees:** quotes arriving, which one was chosen and why. A shop question that needs him shows three buttons (Answer it for me / Drop this shop / Wait) and a clearly labelled note box; the note is an instruction, not text to the shop.
- **Timeout:** the estimate must be shared with the guest within 3 days of Turo's request: 18 hours before it, with nothing usable, Jared is asked (keep waiting or walk it in).

### 6. Invoice or Turo claim

- **Resolve directly:** Claims Closer queues the Turo invoice (estimate summary PDF plus photos) as a `create_invoice` action; the Pi reader posts it. Window: 20 days from the trip end.
- **Turo claim:** a case on the Turo-managed path syncs from Turo (status, next action, deadline) and is linked by claim number and incident id. Turo pays the estimate minus Jared's damage responsibility.
- **Deadline engine** (`deadlineStep`, `claim_windows`): every Turo window is stored per case (estimate share, resolve directly, Turo claim filing, invoice expiry, Turo next action). Inside `deadline_lead_hours` of the resolve-directly end with nothing paid, or as soon as the invoice expires or is declined with the filing window still open, it queues a move to a Turo claim (`escalate`) and writes the paste-ready note for the Claims tab. The note carries the estimate and nothing else in dollars. If the hold or the gate blocks it, Jared is told once a day that a deadline depends on it. The Pi reader today performs only `create_invoice`, so an `escalate` action stays queued and the paste-ready note plus the alert are the working path until the reader learns the action.
- **Leaves the building:** the invoice message (guards apply), the escalation request to Turo.
- **Jared sees:** "Queued a move to a Turo claim" with the reason, or the blocked notice.
- **Escalation:** 24 hours before a Turo "next action" deadline -> alert.

### 7. Guest insurer track (`claim_insurer_track`)

States: `identified` -> `claim_opening` -> `claim_open` -> `estimate_sent` -> `awaiting_payment` -> `paid`; side states `denied` and `stalled`.

- **Trigger:** the guest (or the approved driver) gives an insurer and policy number. Nothing opens without the policy number.
- **Who acts:** Claims Closer, behind `insurer_contact_mode = 'full'`. It opens the third-party property-damage claim by email from jared@bestly.tech (estimate and photos attached) or, with only a phone number, by an Ava call that never agrees to terms or gives bank details. If it has no claims email or phone it asks Jared once; the address he types is used as an address only.
- **Leaves the building:** the opening email, the estimate email, replies that send documents the adjuster asked for (photos, estimate), the acceptance of an offer at or above `min_accept_pct`, chase emails or calls. Never a deductible, a plan cap, Turo's voice or reviews.

### 8. Adjuster back-and-forth

- **Who acts:** `readInsurerMail` reads each new mail from the adjuster's domain (or naming the claim number) once with the free AI; every value must appear in the mail itself (an invented claim number or amount is dropped).
- **What it does:** a claim number moves the track forward and is saved; a request for photos or the estimate is answered; a request for anything else (registration, ownership, W-9, statement, bank details) goes to Jared; a payment notice moves to `awaiting_payment` (good news); a denial moves to `denied` and asks Jared what to do (Turo window checked); an offer is compared with the chosen estimate.
- **Offers:** at or above 100% of the chosen estimate -> accepted in Claims Closer's words for exactly that amount. Below 100% -> nothing is sent; Jared gets one question with the percentage and three buttons (Accept the amount / Ask them to look again at the full estimate / I will handle it). "Ask them to look again" restates only the full estimate. There is no counter-offer and no partial acceptance.
- **Chasing:** chase emails (or calls) at 48, 72, 96, 120 and 168 hours after the last contact, at most 5. After the last one the track is `stalled` and Jared gets one decision alert (keep chasing by phone yourself, or move to a Turo claim if the window is open).
- **Outside claims** (`claim_outside_claims`, for example Kemper 26123598964): the same chase ladder after the reply deadline Jared set (Fri Oct 31, 2026). With no adjuster contact on file it tells Jared and repeats the supervisor line from his own note; it does not invent a contact.

### 9. Booking

- **Trigger:** a shop is chosen and the money is assured (`fundingAssured`: the damage invoice is paid, Turo approved the claim, the guest's insurer accepted, or Jared said fronting is fine). Jared's rule: do not front the repair.
- **Who acts:** `autoBookStep` (when `booking_mode = 'auto'`) starts the booking; `bookingStep` has Ava call the shop and offer drop-off times (8:30 AM Pacific weekdays from tomorrow) that clear every booked Turo trip by the buffer. The call summary is read with the free AI and a time counts only if Ava offered it.
- **Shops that cannot be booked by phone** (Tesla Service books in the Tesla app, or no phone number) -> one question to Jared (I will book it).
- **Leaves the building:** the booking call. Ava never agrees to pay or authorizes work.
- **Jared sees:** "Booked <shop>: drop off <12-hour Pacific>", the event on his calendar (`calendar_add` through Ava), and reminders the evening before and 2 hours before in 12-hour Pacific.
- **Timeout:** two failed calls -> a question with the shop's alternative times as buttons.

### 10. Repair day

- **Who acts:** Jared (takes the car in); Claims Closer reminds. **Leaves the building:** nothing. **Jared sees:** the day-before and 2-hours-before reminders.

### 11. Payment detection (`claims_payment_seen`)

- **Sources:** the Turo payout and the guest's paid damage invoice (Turo mail), an insurer check scanned by Hermes (matched on the insurer plus the claim number or the guest's last name), a Mercury deposit (the read-only settlement feed; matched to one open case only when the counterparty names the insurer and the claim number, last name or exact amount agree, or when it is Turo and the amount is exactly what Turo owes on a Turo-managed claim; ordinary trip payouts never match).
- **Who acts:** the database. **Leaves the building:** nothing. A payment is recorded once (duplicates ignored), added to `recovered_amount`, and the case closes when it covers the target (the whole estimate, or the estimate minus Jared's damage responsibility on a Turo-managed claim).
- **Jared sees:** good news in the recap. He is interrupted only for a decision (a partial offer, a denial).

### 12. Close

- **Paid in full** -> `paid`, `closed_at` set, the outcome sentence written, the insurer track `paid`. **Jared absorbs it** (every route closed) -> `closed`. **Anything stale** is retired.
- **Jared sees:** the case moves to "Won" or "Not followed through".

### 13. Questions (every state)

- A question to Jared is asked once per key per case. A decision question gets one nudge after 24 hours (signed Claims Closer) and goes to Scout after 48 hours (Scout may answer it with `claims_answer` using a button value; free text is a note and is never sent). A question older than 7 days whose estimate came in, whose shop thread closed, or whose resolve-directly window ended is retired with the reason shown. "Wait" asks again after 24 hours.

### 14. Watchdog and the stuck alert (every state)

- **Stuck alert:** a case with no forward progress for 48 hours (no new estimate, sent message, Turo change, state change, booking or payment; the clock is `last_progress_at`, kept by triggers) gets one alert, signed Claims Closer, saying what it is waiting on, then at most one every 48 hours.
- **Watchdog (`claims_watchdog`, inside `claims_watch`):** re-runs a stalled tick (up to 3 times an hour), re-syncs Turo links that are missing, and raises a Scout alert when it cannot fix either.
- **Guard watch (`claims_guard_watch`):** holds a case and alerts Jared when a message that already went out broke a rule.

## What can leave the building, by channel

| Channel | Who it goes to | Gated by | Words come from |
|---|---|---|---|
| `guest_message` | the guest, through the Turo thread | hold, gate, review, plan, money guards | the free AI, checked by the guards |
| `shop_email` | a body shop | hold, gate, recipient, guards, overlap | templates and the case record |
| `ava_call` | a shop | same | call script written by Claims Closer |
| `turo_action` | Turo (invoice, claim request) | same | the case record; only the estimate as a dollar figure |
| `insurer_email` | the guest's insurer | same plus `insurer_contact_mode = 'full'` | `insurer-text.ts` templates |
| `adjuster_call` | an insurer | same | call script written by Claims Closer |
| `garage_email` | the parking garage operator | same, and only after Jared says yes | template |

## Where to look

- Every send, allowed or blocked: `claims_send_log`; blocked ones also on the Claims page.
- Why a route was chosen: `claim_decisions`, and the "Route:" event on the case.
- What Jared decided and how it was read: `claim_decisions` rows of kind `answer`, with `words_sent: false`.
- How to turn a behavior off: Claims page, "What Claims Closer does on its own".
- Undo for the whole build: `supabase/undo/claims-closer-autonomy-2026-10-28.undo.sql`.
