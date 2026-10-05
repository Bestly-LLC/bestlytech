# Ava follow-up texts: opusplan (2026-10-05)

**Ask (Jared):** Ava should be able to send a short, sweet follow-up text after a call, with one goal: get a call back or a time with Eli. Include a link with the RoofGuard information. Planned by Opus, built by Sonnet. **Planning only. Nothing is built or sent yet.**

## TL;DR

- **Who texts:** RoofGuard Ava, from the RoofGuard line (816) 544-0206. Personal Ava can reuse the same parts later.
- **Who gets a text (recommended):** only people who **said yes on the call** to "mind if I text you a quick link?" This is the safe lane for the law and for carrier approval. Voicemail-only follow-ups are a separate decision (see Decision).
- **The text:** under 160 characters, plain, no emoji, says it is Ava, RoofGuard's AI assistant, has a short link, and ends "Reply STOP to opt out."
- **The link:** `bestly.tech/r/abc1234`, one per lead. It opens a one-screen plain-language RoofGuard page with a "Pick a time with Eli" button. (`/t/` is already taken by Lax guest links.)
- **Zero AI cost:** fixed templates, A/B tested like the openers. No model writes the text in v1.
- **Long pole:** US carriers require the number to be registered for business texting (10DLC, or a verified toll-free number). That takes days to weeks, so it starts first.
- **Ships dark:** `text_enabled` is off, test mode texts only Jared's cell, then a 10-a-day cap when it goes live.

---

## Decision (Jared, one question)

**Who gets texted?**

| Option | What it means | Risk |
|---|---|---|
| **A. Said yes on a live call (recommended)** | Ava asks "mind if I text you the link?" and only texts on a yes | Lowest. Matches how carriers vet the campaign |
| B. Also after voicemails | Texts people who never spoke to us | Cold texting to cell phones: higher legal risk (TCPA) and carriers may reject or filter the campaign. Needs a lawyer's OK first |

Not legal advice. Texts to cell phones fall under stricter rules than calls, even for businesses, so B should be checked with counsel before it is turned on.

---

## Phase 0: get the number approved (starts now, mostly waiting)

| Step | Who | Notes |
|---|---|---|
| Telnyx messaging profile "RoofGuard texts" on (816) 544-0206, webhook URLs set | Claude (API key already in Vault) | Number is voice-only today |
| 10DLC brand + campaign registration, **or** toll-free verification | Jared confirms business details in the Telnyx portal, Claude pre-writes everything | Needs: opt-in description ("they said yes on the call"), 3 sample messages, STOP/HELP text, privacy policy link. Small one-time and monthly fees: confirm in the Telnyx portal |
| Webhook signature public key into Vault (`telnyx_public_key`) | Claude | Inbound and delivery webhooks are rejected unless signed by Telnyx |

---

## Phase 1: schema and sender (dark)

New, additive. **`roofguard-caller` is not edited** (the live copy differs from the repo; diff it first with `get_edge_function` if a change turns out to be needed).

- **`rg_texts`:** `id, lead_id, call_id, direction, kind, template_key, to_number, body, segments, status (queued, sent, delivered, failed, blocked, received), error, telnyx_id, cost, is_test, created_at`.
- **`rg_text_templates`:** `key, kind, body, active, sent, replied, booked` (same A/B shape as `rg_openers`).
- **`rg_links`:** `code (7 chars), lead_id, clicks, first_click_at, last_click_at`.
- **`rg_settings` adds:** `text_enabled` (default **false**), `text_daily_cap` (default 10), `cost_sms_each`.
- **Edge function `roofguard-texter`** (new): `send`, `?hook=inbound`, `?hook=status`. Admin or service key for send. Webhooks verify the Telnyx signature. Secrets from Vault.
- RLS: admin only; Eli's portal gets a read-only view later.

### Send rules (all checked in code, in this order)

1. `text_enabled` is on (test mode: only to the test phone, tagged `is_test`).
2. Not in `rg_dnc`, lead not `dnc`, outcome not `do_not_call`, `not_interested` or `wrong_number`.
3. **Consent:** the call recorded `text_ok = true`.
4. **Mobile only:** `rg_leads.line_type` is mobile (already checked per lead). Landline, VoIP or unknown are skipped. A number the person gave on the call is validated first.
5. **Inside the calling window** in the lead's own time zone (same hours and holiday list as the dialer). A text that misses it waits for the next morning.
6. **Frequency:** at most 1 text after a call and 1 nudge 2 business days later if no reply. Never more than 2 per lead per 14 days.
7. Daily cap and spend gate (shares `daily_spend_cap`).
8. Body is 1 segment (GSM characters only: no curly quotes, no emoji) or the send is refused.

---

## Phase 2: consent on the call, and the queue

- **Prompt addition** (RoofGuard Ava): after a real conversation, "Mind if I text you a quick link with the details?" Confirm it is a mobile and read the number back if it is different. **Never** say she will text unless they said yes.
- **Post-call data** gains `text_ok` (boolean) and `text_number` (string). Added by an additive PATCH of the agent's data collection from the new function, not by editing the live caller.
- **Trigger** on `rg_calls` (same pattern as the Reply guard and Sound Check): when a transcript lands with `text_ok`, insert a queued `rg_texts` row and call `roofguard-texter` for it.
- **Cron `roofguard-text-queue`** every 5 minutes: drains anything queued (window waits, retries), and queues the 2-business-day nudge. Safety net if the trigger call fails.

### Templates (v1, each tested against the others)

| Kind | Example (under 160 characters) |
|---|---|
| `after_chat` | Hi Bill, it's Ava, RoofGuard's AI assistant. Thanks for the chat. What we do, in one minute: bestly.tech/r/k3p9x2m Want 20 min with Eli? Reply STOP to opt out. |
| `after_chat` (B) | Bill, Ava here (RoofGuard's AI assistant). Here's the quick version of what we do: bestly.tech/r/k3p9x2m Easiest next step is a 20-min call with Eli. Reply STOP to opt out. |
| `nudge` | Hi Bill, Ava from RoofGuard again. Still happy to set up 20 min with Eli: bestly.tech/r/k3p9x2m Reply STOP to opt out. |
| `booked_confirm` | Confirmed: Eli will call Thu at 2:00 PM. Reply here to change it. Reply STOP to opt out. |

Times in 12-hour format. First name only when we actually have it, otherwise "Hi,". The final wording goes past Eli before launch.

---

## Phase 3: the link page

- **Route `/r/:code`** (public, mobile first, Apple HIG): one screen written for the least-informed reader. What RoofGuard does, why it matters, who it is for, in plain words, using the caller's approved pitch. No jargon, no price.
- **Buttons:** **Pick a time with Eli** (two time options and an email, saved as a follow-up and sent to Scout), **Call us** (`tel:` the RoofGuard line), **Stop texts**.
- **Click tracking:** a click is a warm signal. Scout push signed by Text Desk: "Bill at Riverside opened the RoofGuard page."
- Copy promises a *confirmation*, not a callback time (Eli's callback routing is still on hold per the inbound plan).

---

## Phase 4: replies, STOP and the UI

- **Inbound webhook rules (no AI):**
  - STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT: insert into `rg_dnc` (reason "texted STOP"), set lead `dnc`. That also blocks future **calls**.
  - HELP: fixed help message with the RoofGuard line.
  - YES, SURE, OK, a time or a day: create an `rg_followups` item and push Jared.
  - Anything else: lands in Messages, push Jared.
- **UI on /admin/roofguard:** the call sheet shows the text thread next to the transcript; Setup gets a **Follow-up texts** switch, daily cap and the template list with sent, replied and booked counts. Shared component, so /admin/ava can mount it later. Built to Apple HIG; numbers never split from their units.
- **Eli's portal:** recent texts, read-only.

---

## Watchdog and team (required)

- **Team card "Text Desk"**, a tool of RoofGuard Ava. Heartbeat is the `roofguard-text-queue` cron. Owns alert prefix `rg-text`. Every alert is signed by Text Desk.
- **Self-heal, reported to Scout:**
  - 5 failures or blocks in a row: texting pauses itself (`text_enabled` off) and Scout pushes.
  - Delivery failure rate over 20% in a day: Scout alert.
  - Queue item stuck over 30 minutes: retried once, then alert.
  - Campaign rejected or number flagged: pause and alert.
- **Sound Check style daily line:** "Texts yesterday: 6 sent, 5 delivered, 2 replies, 1 time booked."
- Runs entirely in the database and one edge function. No Claude, no paid AI, no Pi needed.

---

## Rollout

1. Phase 0 (registration) runs in the background while 1 to 4 are built.
2. Test mode: texts go only to Jared's cell, from real calls to his own number.
3. Go live at **10 a day**, option A only, for one week. Check delivery, replies, STOPs.
4. Raise the cap. Then decide on B with counsel's answer.

## Later (not v1)

- Reply assistant: a free model on the Pi drafts a reply, Jared taps to send.
- Personal Ava texts ("I missed your call, here's what I can do") using the same `roofguard-texter` parts, with its own number setting.
- The Coach reads template stats and promotes winners, like the openers.

## Not doing

- No texts to anyone who said "do not call", "not interested" or "wrong number".
- No texts to landlines, and none outside the calling window.
- No AI-written text bodies in v1.
- No link longer than `bestly.tech/r/` plus 7 characters.
