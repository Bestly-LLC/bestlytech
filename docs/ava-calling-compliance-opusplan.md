# Keeping Ava's own calls legal: opusplan (2026-10-04)

**Ask (Jared):** "make a plan so we don't get hit with these" — the same Do Not Call / robocall claims Ava is now collecting against spammers, aimed at us for calls Ava places.

*Not legal advice. Have a TCPA attorney review once before RoofGuard dials at volume (a one-hour review is cheap next to one $500-per-call claim).*

## TL;DR

- **The big risk is the AI voice.** Since the FCC's February 2024 ruling, an AI-generated voice counts as an "artificial voice" under the TCPA. Calling a **cell phone** or a **home line** with it needs the person's prior consent (written consent if it's a sales call). Each violating call can cost **$500 to $1,500**.
- **RoofGuard is mostly safe by design** if it **only calls business landlines** (B2B calls to business landlines are outside the artificial-voice rule and the National Do Not Call list, which protect consumers). The guard makes that a hard rule instead of a habit.
- **Personal Ava is low risk** because she calls people who gave Jared their number (friends, family, business contacts). The guard records that consent per contact.
- **Build a compliance gate** that every outbound call must pass, a **Compliance Officer** AI employee that watches it, and a **paper trail** that proves each call was allowed.

## The rules Ava must follow (both Avas)

| Rule | Why | Status today |
|---|---|---|
| No AI-voice calls to cell phones without consent | TCPA + FCC 2024 AI ruling | RoofGuard skips numbers marked mobile ✓ (line-type check); personal Ava: no consent check ✗ |
| No calls to residential lines for sales | TCPA artificial-voice rule | Not checked ✗ |
| Scrub the National Do Not Call Registry for anything that might be residential or mobile | TCPA § 227(c) | Not done ✗ |
| Honor "don't call me" immediately and forever | TCPA + internal-DNC rule | `rg_dnc` + in-call handling ✓ |
| Call only 8 AM to 9 PM in the *called person's* time zone | TCPA; some states are stricter | Calling hours + holidays exist for RoofGuard ✓, personal ✗ |
| Say who's calling and for which company, up front | TCPA identification rule | Openers do this ✓ |
| A real call-back number that reaches us | TCPA caller-ID rules | 544-0206 now answers ✓ |
| "Recorded line" notice | Two-party-consent states (CA, FL, WA, IL, PA, and more) | In every opener ✓ |
| Don't call the same business too often | Courtesy + state "harassment" rules | Max attempts exists ✓, no rolling cap ✗ |
| State mini-TCPA laws | Florida (FTSA), Oklahoma, Maryland, Washington and others add consent, hour and frequency rules | Not handled ✗ (Florida leads exist) |
| Keep proof for 4+ years | TCPA claims can be filed up to 4 years later | Call rows kept ✓, recordings live only at the voice platform ✗ |

## What to build

1. **Compliance gate** (`rg_call_allowed(lead)` / `ava_call_allowed(phone)`), checked in every outbound path (queue tick, dialer, demo, follow-ups, call-backs, voice test calls). It returns allowed or a plain reason, and the reason is logged.
   - **RoofGuard:** line type must be a verified *business landline or business VoIP*. Mobile, residential or unknown means skip, and unknown goes to a re-check. Not on the internal DNC. Not on the National DNC Registry when the line could be residential. Inside the lead's calling window, using **business hours 9 AM to 5 PM local**, weekdays, not holidays. Rolling cap: **at most 3 attempts per number per 30 days**. A state rules table applies stricter limits (Florida: at most 3 calls in 24 hours and 8 AM to 8 PM; and so on).
   - **Personal Ava:** the number must be a saved contact with a consent flag (`ava_contacts.consent`: "gave me their number" / "asked me to call"), or a one-off number Jared typed with the box "they expect this call" ticked. Calling hours 8 AM to 9 PM in their time zone, unless they're a trusted contact.
   - **Demo and test calls:** only to numbers the person entering them confirms are theirs or expect the call (an "I have permission to call this number" checkbox, logged).
2. **National DNC scrub:** register for the FTC's Do Not Call Registry access (free for up to 5 area codes; a small yearly fee beyond that) and refresh the list every 31 days, which is the legal maximum. The job runs on the Pi or Mac mini (token rule) and writes `dnc_registry(phone_hash)`. The gate checks it for any number that isn't a verified business landline.
3. **Line-type re-verification:** re-check line type at most 30 days before dialing (numbers get ported to mobile). This uses the existing `line_types` action, on a schedule.
4. **Consent records:** `ava_contacts.consent`, `consent_source` and `consent_at`. For RoofGuard there's a `consent` column for any lead that ever asks for a call-back (a call-back request is consent for that follow-up).
5. **Evidence locker (outbound):** copy every outbound call's recording to private storage (`ava-evidence`, the same bucket as the spam evidence) with the gate's decision attached, kept 4+ years.
6. **AI disclosure stays:** RoofGuard already says "AI assistant" when asked. Keep the "recorded line" opener. Several states are moving toward requiring AI disclosure at the start of a call, so the Compliance Officer flags new laws.
7. **Compliance Officer (new AI employee, team card via `team_onboard`):**
   - Daily: an audit of yesterday's calls (every call has a gate decision, none outside hours, none to mobile or residential, every opt-out honored within the call).
   - Monthly: the DNC refresh ran, line types are fresh, the state rules table is current (it reads FTC/FCC and state legislature feeds, with the Tech Scout's help).
   - Alerts: "Compliance Officer: …" on any gate bypass or audit failure. **Any failure pauses outbound calling** until Jared clears it (self-heal = stop, not retry).
   - Runs as plain scripts on the Pi or Mac mini; AI only to summarize law changes.
8. **UI (both pages, Apple HIG):** a "Compliance" chip in each top bar (green check + "All calls allowed today" / amber "1 blocked call: mobile number"); per call, the gate's decision in the call sheet; a Compliance tab with the audit, blocked attempts and the DNC refresh date.

## Order

1. Gate + logging + business-hours/rolling caps + mobile/residential block (biggest risk, no outside dependency).
2. Consent fields + personal Ava gate + "they expect this call" checkbox.
3. Evidence locker for outbound.
4. Compliance Officer audits + pause-on-failure + UI chip/tab.
5. National DNC registry access (needs Jared to register Bestly LLC with the FTC: a one-time form) + monthly scrub on the Pi.
6. State rules table + attorney review.

## What Jared does

- Register Bestly LLC for the National Do Not Call Registry (telemarketer access) when step 5 comes up. It's one online form with the business details.
- Book one TCPA attorney review before RoofGuard goes to volume.
