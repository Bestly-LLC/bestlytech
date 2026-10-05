# Ava books real meetings, and the number earns trust — opusplan (2026-10-05)

**Owner:** Jared · **Drafted:** 2026-10-05 · **Status:** proposed · **Planned by Opus**

**Ask (Jared, 2026-10-05):**
1. Let Eli connect his Google account to the partner portal so **Ava can book Google Meet meetings for him**.
2. Make it so that if someone Googles the RoofGuard number, they find out who is calling and that it is legitimate.
3. Also do the Apple/Google call-screening fix (`docs/ava-screening-opusplan.md`).

---

## TL;DR

- **Ava does not book anything today.** She collects `meeting_times` as free text ("Tuesday afternoon works") plus an email, writes it to `rg_calls`, and that is the end of it. Nobody is invited, no calendar event exists, no Meet link exists, and Eli finds out by reading the scorecard. Every "booked" meeting in the funnel is really a *note that someone agreed to meet*.
- **That is the real bug, and it is worse than it looks.** The gap between "she said yes on the phone" and "it is on Eli's calendar" is where cold-call meetings die. Fixing it is likely worth more than any script change.
- **Three things have to be true before Ava can book:** Eli's calendar has to be reachable (OAuth), Ava has to capture a *concrete* time rather than a phrase, and something has to create the event. All three are missing.
- **On the number:** you cannot talk carriers out of a spam label, but you can do the three things that actually move it — a page that owns the number in search, a free registration that reaches the three analytics databases behind most carrier labels, and a CNAM entry. All free or near-free.
- **Jared has to do one thing himself:** create the Google Cloud OAuth client. Nothing else in Part 1 can be built until that exists.

---

# Part 1 — Eli connects Google, Ava books the meeting

## 1.1 What exists now

| Piece | State |
|---|---|
| `meeting_times` on `rg_calls` | Free text, in the prospect's words, time zone optional. Not a timestamp. |
| `meeting_email` | Captured, confirmed on the call. Good — this becomes the invitee. |
| Outcome `booked` | Set when they agree. Means "agreed", not "scheduled". |
| Eli's calendar | Not connected to anything. |
| Partner portal (`/partner`) | Eli signs in, sees Ava's calls and scorecard. No settings area for connecting anything. |

## 1.2 The shape of the fix

```
Ava captures a real start time  ->  post-call webhook  ->  Google Calendar event
   (new data-collection field)       (already runs)         on Eli's calendar,
                                                            Meet link, prospect invited
```

**Book after the call, not during it.** Creating the event mid-call means an API round trip while someone waits on the line, and a failure there costs the meeting. The post-call webhook already fires with the full transcript and is the natural place.

## 1.3 Capture a real time, not a phrase

New data-collection fields on the agent (`DATA_COLLECTION` in `roofguard-caller/index.ts`):

- `meeting_start_iso` — the agreed start as a full ISO 8601 timestamp **with offset**, resolved from the lead's time zone (`rg_leads.timezone` is already there and already in the prompt).
- `meeting_duration_min` — default 30 unless they asked for something else.

Keep `meeting_times` as-is. It stays the human record and the fallback when she could not pin a time down.

**Prompt change:** she must confirm one specific time out loud before ending — "so that's Tuesday the 14th at 2pm your time, I'll send the invite to <email>" — rather than accepting "afternoons are good". This is a small script change with an outsized effect: a vague time is an unbookable meeting.

## 1.4 Connecting Eli's Google

- **Google Cloud project** with the Calendar API enabled and an OAuth 2.0 **Web** client.
  - Scopes: `calendar.events` (create the event) and `calendar.freebusy` *(Part 1.6; include it now so Eli only consents once)*.
  - Authorized redirect URI: the edge function callback, `https://<project>.supabase.co/functions/v1/partner-google?cb=1`.
  - Consent screen: **External**, publishing status **In production**. Left in Testing, refresh tokens expire after 7 days and the booking silently dies every week.
- **New edge function `partner-google`** — three jobs: start the OAuth flow, take the callback and exchange the code, and refresh the access token when it expires.
- **Token storage:** the refresh token is a secret, so it goes in **Supabase Vault**, per the house rule. A new `partner_google` table holds only the non-secret parts: partner id, Google account email, calendar id, connected_at, last_error, and the Vault secret's name.
- **Portal UI:** a "Connect Google Calendar" card in `/partner` — connect, show which account is linked, disconnect. One button, and it says in plain words what Ava will do with it: *"Ava will put meetings she books straight on this calendar, with a Meet link, and invite the other person."*

## 1.5 Creating the event

On a `booked` call with a usable `meeting_start_iso`:

- Create the event on Eli's primary calendar with `conferenceDataVersion=1` and a `hangoutsMeet` request so Google issues the Meet link.
- Attendees: the prospect's `meeting_email`, plus Eli. `sendUpdates=all` so the prospect gets the invite immediately — **this is the part that makes the meeting real**.
- Title and description carry the company, the decision maker's name and title, and a short summary of the call, so Eli walks in knowing something.
- Write `calendar_event_id` and `meet_url` back to `rg_calls` (new migration — never edit a committed one).
- **If it fails, say so loudly.** Scout alert signed by Ava, and the meeting shows on the scorecard as "agreed, not scheduled" so it cannot quietly rot.

## 1.6 The better version, once 1.5 works

Read Eli's free/busy before Ava proposes times, so she offers slots he actually has instead of asking open-endedly. Fewer reschedules, and it makes her sound like someone with access to his diary — because she has it. Worth doing, but only after the plain path is solid.

## 1.7 Decisions for Jared

1. **Whose Google account?** Eli's own (`eli.cooper@bdcuniversal.com`) is the obvious one, but his calendar may be managed by BDC Universal's Workspace admin, who can block third-party OAuth apps. Worth asking him before you build.
2. **Does Eli want Ava writing to his real calendar at all**, or a separate "RoofGuard" calendar he subscribes to? Separate is safer for a first run.
3. **Who hosts the Meet?** The event is on Eli's calendar, so the link is his. Fine unless Bill wants to join.

---

# Part 2 — Make the number findable and legitimate

The number is the RoofGuard line shown in `/admin/roofguard`. Nothing on the public internet currently explains who is calling from it, so a prospect who looks it up finds either nothing or a crowd-sourced "spam?" page.

Three things actually move this. Do them in this order.

## 2.1 A page that owns the number in search *(biggest win, fully in our control)*

A public page on bestly.tech whose single job is to answer "who just called me from this number".

- The number appears in the page **title, the H1, and the URL slug**, in both common formats (`(816) 544-0206` and `816-544-0206`). An exact phone number is a rare search string with almost no competition, so an honest page ranks for it quickly.
- Content, in plain language for someone who is mildly annoyed:
  - Who called: Bestly LLC places these calls for the **RoofGuard** commercial roof maintenance program by Legacy Building Maintenance Company.
  - Why: to reach whoever looks after the roof, and offer a short call with Eli Cooper, who runs the program.
  - **That the caller is an AI assistant named Ava.** Say it. People who look a number up are suspicious by default, and getting caught not saying it is far more expensive than saying it.
  - What we do not do: no payments, no personal information, nothing about insurance.
  - A **"don't call me again"** form that writes straight to `rg_dnc`. This is the single most useful thing on the page — it converts an angry Googler into a suppressed record instead of a carrier complaint.
- `Organization` + `ContactPoint` structured data so the number is machine-readable.
- Linked from the RoofGuard pages, and the short link read out in voicemails, per the short-link rule.

## 2.2 Free Caller Registry *(free, reaches the three databases behind most labels)*

`freecallerregistry.com` is one form that submits to **First Orion, Hiya and TNS** — the analytics providers behind the caller-ID and spam labels on T-Mobile, AT&T and Verizon handsets. Register the number with the business name, address and the reason for the calls. Free, takes minutes, and is the only lever that reaches carrier labelling directly.

## 2.3 CNAM, and keeping the label clean

- Set the **CNAM** entry on the number in Telnyx so landlines and some carriers show a name rather than a bare number. Limited reach these days, cheap, still worth it.
- **Branded calling / Rich Call Data** (logo and reason on the screen) exists through Telnyx partners. Paid. Revisit once Ava has proven she books meetings — not before.
- **Behaviour matters more than registration.** Spam labels are driven by short calls, low answer rates and complaints. Honouring do-not-call instantly, keeping the attempt cap, and not re-dialling dead numbers protects the number better than any registry.

## 2.4 Not doing

- A Google Business Profile for the number. It belongs to a program we recruit for rather than a storefront we run, and a mismatched profile is worse than none.

---

# Part 3 — The screening fix

`docs/ava-screening-opusplan.md` stands. One thing is now **verified** rather than assumed:

> **ElevenLabs does not support `turn` in `conversation_config_override`.** The documented override surface is prompt, first message, language, voice, LLM, tools, knowledge base, text-only, stability, speed, similarity boost and ASR keywords — turn settings are not among them.

So the plan's option 1 is out, and its **Decision 1 is live**: the filler ("Yeah…", "Mm, right…") cannot be turned off for screeners only. It is on for every call or off for every call. Transcribed into a screening card, that filler is the most robotic artifact in the whole flow.

**Recommendation:** drop the soft-timeout filler on the RoofGuard agent, keep `turn_eagerness: "eager"` and `speculative_turn: true`. She stays fast; she just stops saying "Yeah…" into a machine. Reversible in one line if the calls get worse.

Everything else in that plan is unblocked: the four scripts, the `screened` outcome, the detection-phrase table, counting screened calls as their own funnel step, and the weekly proposal pass.

---

## Build order across all three parts

| # | Step | Blocked by |
|---|---|---|
| 1 | Screening: drop filler, add the four scripts, add `screened` outcome + migration | Jared's yes on the filler |
| 2 | Number page + do-not-call form, live on bestly.tech | nothing |
| 3 | Free Caller Registry + Telnyx CNAM | nothing — forms Jared submits |
| 4 | `meeting_start_iso` capture + "confirm one specific time" script change | nothing; useful on its own |
| 5 | Google Cloud OAuth client | **Jared only** |
| 6 | `partner-google` edge function + Vault token storage + portal connect card | step 5 |
| 7 | Create the event with a Meet link, write back, alert on failure | step 6 |
| 8 | Free/busy so Ava offers Eli's real openings | step 7 |

Steps 2 and 4 need nothing from anyone and should start first.
