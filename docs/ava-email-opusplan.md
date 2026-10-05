# Ava sends the RoofGuard info herself — opusplan (2026-10-04)

**Owner:** Jared · **Drafted:** 2026-10-04 · **Status:** proposed · **Planned by Opus, built by Sonnet**

**Ask (Jared):** when someone on a RoofGuard call says "send me something to look over," Ava should email it to them **right then, on the call** — not a to-do for later. She should have her own address, `ava@bestly.tech`, and it has to be **free**.

---

## TL;DR

- **`ava@bestly.tech` is free, today.** Resend already has `bestly.tech` verified, and every ESP lets you send from any address on a verified domain at no extra cost. No new mailbox, no new account, no new domain.
- **"Free" only covers sending.** A real *mailbox* at `ava@` costs money on PrivateEmail. A **forwarding alias** (`ava@` → Eli and Jared) is free at the domain host, and that's all we need so replies don't vanish.
- **One blocker found in the code:** the email dispatcher **hardcodes `from: "Cookie Yeti <noreply@bestly.tech>"`** and throws away the `from` the queue gives it (`process-email-queue/index.ts`). So Ava literally cannot send as herself until that's fixed. **This is also a live bug** — every Bestly In-House Cloud email going out right now is signed "Cookie Yeti."
- **How she sends mid-call:** an ElevenLabs **server tool** (a webhook she can call during the conversation). She captures the address, spells it back, calls the tool, and the tool answers her in time to say "sent." No tools are attached to the agent today — this is the main build.
- **Volume is not a problem.** Resend free is 100/day. Her dial target is 60/day and only a fraction ask for info.
- **The real work is not the plumbing — it's the guardrails.** An AI that emails strangers on request is an abuse vector and a CAN-SPAM surface. Section 3 is the part not to skip.

---

## 0. What's actually in the code (checked, not assumed)

| Thing | Where | State |
|---|---|---|
| Email provider | `process-email-queue/index.ts` | **Resend.** `bestly.tech` verified 2026-05-05 (comment in file). |
| Send entry point | `send-transactional-email/index.ts` | Renders a React Email template, enqueues to `transactional_emails`. Has suppression list + unsubscribe tokens already. |
| From address | `send-transactional-email` → queue payload `from: "bestlytech <noreply@bestly.tech>"` | **Discarded.** Dispatcher overrides with `"Cookie Yeti <noreply@bestly.tech>"`. |
| Templates | `_shared/transactional-email-templates/` + `registry.ts` | 7 templates. Pattern is clean and easy to extend. |
| Unsubscribe / suppression | `handle-email-unsubscribe`, `handle-email-suppression`, `suppressed_emails` | Already built. **Reuse it — don't build a second path.** |
| Agent tools | `roofguard-caller/index.ts` `agentBody` | Only `built_in_tools` (`end_call`, `voicemail_detection`). **No server tools.** |
| Email capture on calls | `rg_calls.meeting_email`, prompt says "Get an email; spell the email back" | Exists for bookings. Reusable habit. |
| Post-call webhook | `?hook=elevenlabs`, HMAC-signed | Working. Good model to copy for the new endpoint. |

---

## 1. The address: is it free?

| Want | Cost | How |
|---|---|---|
| **Send** as `ava@bestly.tech` | **$0** | Already possible. Resend allows any local-part on a verified domain. Nothing to buy or configure. |
| **Receive** replies at `ava@` | **$0** | Free forwarding alias `ava@bestly.tech` → Jared + Eli at the domain host. |
| A real mailbox at `ava@` | **Costs money** | PrivateEmail charges per mailbox. **Not needed. Skip it.** |
| A RoofGuard-branded domain | **Costs money + risk** | New domain = new verification + a cold sending reputation. **Don't.** |

**Deliverability note:** a new local-part on an already-warmed domain needs no warm-up. `ava@` inherits `bestly.tech`'s existing SPF/DKIM/DMARC. This is the low-risk path.

**Recommendation:** `Ava at RoofGuard <ava@bestly.tech>`, with `reply_to` pointing at Eli.

**Honest flag:** RoofGuard is **Legacy Building Maintenance Company's** program; Bestly/Eli is an independent referral partner. An email about RoofGuard arriving from `@bestly.tech` will read as a mismatch to a careful recipient. The body must state the relationship plainly in the first two lines. If LBMC would rather it come from their domain, that's a different (paid, slower) project — decide before Phase 2.

---

## 2. How Ava sends it *during* the call

ElevenLabs **server tools**: the agent calls an HTTPS endpoint mid-conversation and gets a result back in time to speak it.

```
Caller: "Can you send me something to look at?"
Ava:    "Of course — what's the best email?"
Caller: "dana.cole@riversidemed.org"
Ava:    "Let me read that back: d-a-n-a dot c-o-l-e at riversidemed.org?"
Caller: "That's right."
          → tool: send_roofguard_info { email, first_name, company, call_id }
          → returns within ~1s: { ok: true }
Ava:    "Sent — it's from ava@bestly.tech, should be there in a minute."
```

**Build it as its own edge function, not another action on `roofguard-caller`.**
`roofguard-caller/index.ts` is already ~97 KB. A separate `roofguard-send-info/` keeps the blast radius small and lets it be rate-limited and audited on its own.

**Auth:** `verify_jwt = false` (ElevenLabs calls it directly), with a shared secret in Vault passed as a request header — the same pattern the post-call webhook already uses. **Never** leave this endpoint open.

**Latency matters.** Enqueueing and returning immediately keeps Ava's reply fast; the queue sends a second later. Returning `ok` before the mail is truly accepted is the right trade here — but see the bounce handling in Phase 5, because "sent" must not become a lie.

---

## 3. Guardrails — the part not to skip

An AI that emails anyone it's told to is a spam cannon with a friendly voice. Every one of these is required, not optional.

| Risk | Guard |
|---|---|
| Ava talked into mailing a third party ("send it to my ex") | Only ever send to an address **captured and spelled back on this call**. One recipient. No CC, no attachments the caller names, no custom body text from the caller — **ever**. |
| Used as a relay to send arbitrary content | The body is a **fixed template**. The caller controls only the address and their first name. Nothing the caller says reaches the email body. |
| Repeat sends / harassment | **One send per call.** Hard cap per lead per 30 days. Daily cap across the whole program, well under Resend's 100/day. |
| Emailing someone who opted out | Check `suppressed_emails` **and** the lead's DNC/do-not-email state before sending. Silent refusal + Ava says "I'll have Eli follow up instead." |
| CAN-SPAM | Reuse the existing unsubscribe token path. Accurate From and Subject. Physical postal address in the footer. |
| Proving consent later | Write `info_email_to`, `info_email_at`, `info_email_consent_call_id` to `rg_calls`. The recording and transcript are the consent record. Keep them. |
| Typo'd address → bounce | Spell-back is required in the prompt. Bounces go to Scout (Phase 5). |
| Bad actor finds the endpoint | Vault shared secret, per-call-id validation, rate limit by IP and by call. |

**The one that matters most:** the call is recorded and the caller asked for the email. That makes this solicited, which is the defensible position. It stops being defensible the moment Ava sends to someone who didn't ask. Everything above protects that line.

---

## 4. Build phases

### Phase 1 — Unblock the From address *(small, high value, fixes a live bug)*
- `process-email-queue/index.ts`: use `msg.from` from the queue payload; keep `"Cookie Yeti <noreply@bestly.tech>"` only as the fallback when the payload has none.
- `send-transactional-email/index.ts`: let a template declare its own `from` and `replyTo` in `TemplateEntry`; fall back to the current default.
- **Verify the Cookie Yeti emails still say Cookie Yeti** — don't fix Ava and break Cookie Yeti.
- Side win: the four `cloud-*` templates can finally send as Bestly instead of Cookie Yeti. Worth doing in the same pass.

### Phase 2 — The email itself
- New template `_shared/transactional-email-templates/roofguard-info.tsx`, registered in `registry.ts` as `roofguard-info`.
- `from: "Ava at RoofGuard <ava@bestly.tech>"`, `replyTo:` Eli.
- Content, in Bestly's plain-spoken voice, written for someone who has never heard of this:
  1. One line on why they're getting it ("You asked on our call just now.")
  2. Who's who: RoofGuard is a commercial roof maintenance program from Legacy Building Maintenance Company; Eli Cooper runs it; Bestly is the referral partner sending this.
  3. The warranty gap, in two sentences.
  4. One predictable monthly line instead of a capital roof project.
  5. What happens next: a 20-minute call with Eli, no obligation. Eli's email and number.
  6. Footer: postal address + unsubscribe.
- **No attachment.** A PDF from an unknown sender to a facilities director is a spam-filter magnet and often unopened on a phone. Link to a page instead.
- **Content gap to close first:** there is no RoofGuard one-pager or landing page in this repo. Either the email carries the whole story (recommended for v1) or someone writes the page it links to. Decide before building.
- No emoji (customer-facing rule).

### Phase 3 — The send endpoint
- New `supabase/functions/roofguard-send-info/index.ts`, `verify_jwt = false`, Vault-secret header check.
- Input: `{ call_id, email, first_name?, company? }`.
- Order of operations: validate secret → validate email shape → load `rg_calls` row (must exist, must be recent/live) → suppression + DNC check → per-call and per-lead and per-day caps → `send-transactional-email` with `roofguard-info` → stamp consent columns on `rg_calls` → return.
- Return Ava a short, speakable result: `sent` / `bad_address` / `already_sent` / `cant_send`. Never return a stack trace to a voice agent.
- Migration: add `info_email_to`, `info_email_at`, `info_email_consent_call_id`, `info_email_status` to `rg_calls` (**new migration file — never edit a committed one**).

### Phase 4 — Give Ava the tool
- In `setup()` (`roofguard-caller/index.ts`): create-or-find the workspace server tool `send_roofguard_info` by name (same find-by-name-then-save idempotency the Telnyx/webhook steps already use, so re-running setup never duplicates), then attach it to the agent.
- **Verify the exact request shape against the live ElevenLabs API before writing it** — tool config has moved between workspace-level tools and inline agent tools. Don't write it from memory.
- Prompt additions (`PROMPT`, and the inbound/callback prompts if it should work there too):
  - Offer the email **only** when they ask for information, or when they're hesitant and want to look before committing. Never as a substitute for asking for the meeting.
  - Capture the address, spell it back, confirm, then send.
  - After sending, say it's from `ava@bestly.tech` so it isn't mistaken for spam, then return to asking for the meeting.
  - If the tool fails: "I'll have Eli send that over." Never invent a confirmation.
- Decide: outbound only, or inbound/callback too? **Recommend outbound first**, widen once it's proven.

### Phase 5 — Watchdog + visibility *(Jared's standing rules)*
- **Watchdog** (`health` action, every 10 min, no AI): tool exists, is attached to the agent, endpoint answers. Broken → re-run setup, then push Scout.
- **Scout alerts signed by Ava** (notification rule: every alert is an employee's responsibility): send failures, bounce spikes, cap hit.
- **Bounces:** Resend's free webhooks already cover `bounced`/`complained`. Route them in, stamp `info_email_status`, and tell Scout — so a bad address doesn't silently look like a successful send.
- **UI:** show "Info emailed to dana@… at 2:14 PM" on the call row in `/admin/roofguard`, and in Eli's portal demo sheet beside the new cost line.
- **Team card:** update Ava's `/admin/team` card — add the tool to `tool_of` and the new alert prefix to `owns`. The Roster Scanner flags anything unowned.
- **Token rule:** all of this runs on Supabase edge + Resend. No Claude in the loop. Compliant.

### Phase 6 — Test before it meets a stranger
1. Demo call to Jared's own number; ask for info; confirm it arrives, headers say `ava@bestly.tech`, reply goes to Eli.
2. Deliberately spell a bad address → confirm the bounce reaches Scout.
3. Ask twice on one call → second is refused.
4. Try a suppressed address → refused, and Ava doesn't claim she sent it.
5. Hit the endpoint without the secret → 401.
6. Reply to the email → confirm the alias actually lands in a human's inbox.
7. Confirm a Cookie Yeti email still sends correctly after the Phase 1 change.

---

## 5. Decisions for Jared before Sonnet starts

1. **Sender identity:** `ava@bestly.tech` (free, today) — or ask LBMC for a RoofGuard-domain address (slower, costs money, better optics)?
2. **Where do replies go:** Eli only, or Eli + Jared?
3. **Postal address in the footer:** Bestly's business address, or LBMC's? (Bestly is the sender, so Bestly's is the safe default.)
4. **Email content:** does the whole story live in the email (v1, recommended), or do we write a RoofGuard page for it to link to?
5. **Scope:** outbound calls only to start, or inbound and callbacks too?
6. **Fix the Cookie Yeti From bug for the cloud emails in the same pass?** (Recommend yes — it's the same two files.)

---

## 6. What could go wrong

- **The From fix breaks existing mail.** It touches the path every Bestly email uses. Fallback-first, and test a Cookie Yeti send before shipping.
- **ElevenLabs tool API has moved.** Verify against the live API; don't code from memory.
- **Tool latency stalls the call.** If the endpoint is slow, Ava goes quiet mid-sentence. Enqueue and return fast; keep the work after the response.
- **It gets used as a crutch.** If Ava offers email every time someone hesitates, booked meetings drop and the scorecard tells you. Watch `booked` for two weeks after launch — the email is meant to *support* the ask, not replace it.
- **Resend free tier shares the 100/day with the cloud funnel.** Low risk at current volume, but the cap is shared. Alert before it bites.
