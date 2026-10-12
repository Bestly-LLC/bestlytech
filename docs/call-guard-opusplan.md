# Call Guard: the safety layer for AI outbound calls

Planned with Opus 2026-10-12, built with Sonnet. Jared: "yes make the safety layer" (after the AI-agent legal review, bestly_memory `legal/ai-agent-disclosures-2026-10-11`). Not legal advice; a TCPA lawyer signs off before calling_enabled is turned on.

## Why

The FCC (Feb 2024) treats AI voices as "artificial voice" under the TCPA: calls to cell phones need prior express consent (written, for sales). Fines are $500 to $1,500 per call. Business landlines are the safe lane. So every AI outbound call (Reese now, Maya later) must pass one gate.

## What already exists (keep it, don't rebuild)

- Reese: `rg_settings.calling_enabled` (false), `rg_next_call_batch()` (line_type in landline/voip, DNC via `rg_leads.dnc` + `rg_dnc`, weekdays 9 AM-5 PM lead-local, `rg_holidays`, max 3 attempts, 2 business-day gap, daily cap 20), re-check of `rg_dnc` before submit, opt-outs saved to `rg_dnc` on calls.
- Maya: `maya_leads` (phone_source, line_type, line_type_checked_at, dnc), `hunter_optouts`, Hunter's Telnyx line-type lookups (hunter-run). No Maya dialer yet.
- Telnyx number lookup `GET /v2/number_lookup/{phone}?type=carrier` is already used by hunter-run and roofguard-caller.

## Decisions (Jared)

- Mobile, unknown and unverified lines: never dialed (unless the person gave written consent, below).
- VoIP: only when the number is the business's own published line: `phone_source` in `website`, `osm`, `directory`, `sec`, `wikidata`. Not `search` or empty. (Jared 2026-10-12: "only if listed as the business line".)
- Line type older than 90 days is stale: not dialed until re-checked (numbers get ported to cell phones).
- Calling hours stay business hours: weekdays 9 AM to 5 PM in the business's own time zone, no holidays.
- AI disclosure up front only in `AI_DISCLOSE_STATES` (Maine for now), otherwise whenever asked. Recording disclosed in the opener ("on a recorded line").
- Opt-outs are honored immediately and forever, per seller (RoofGuard and Bestly are separate sellers).

## Build

1. **Migration** `20261012...._call_guard.sql` (append-only):
   - `call_line_ok(p_line_type text, p_phone_source text, p_checked_at timestamptz) returns text`: null when OK, else a short reason (`mobile`, `unverified`, `unknown`, `voip-not-business-listed`, `line-check-stale`).
   - `call_consents` (phone, seller `bestly|roofguard`, source, consent_text, captured_at, form/ticket id, revoked_at). RLS on, service role only. `privacy_data_map` row for `call_consents.phone` (action `delete`). A consent row (not revoked) lets a number through `call_line_ok` (mobile included) but never through DNC.
   - `call_gate(p_seller text, p_phone text, p_line_type text, p_phone_source text, p_checked_at timestamptz, p_timezone text) returns text`: reason or null. Checks consent/line, seller DNC (`rg_dnc` + `rg_leads.dnc` for roofguard; `hunter_optouts` + `maya_leads.dnc` for bestly), weekday + 9-5 window + `rg_holidays` in p_timezone.
   - Rewrite `rg_next_call_batch()` to use `call_line_ok` (keep every other existing rule and the return shape identical).
   - `maya_call_settings` (single row, `calling_enabled` false, same caps as rg_settings) and `maya_next_call_batch(p_limit)` over `maya_leads` using `call_gate` + caps. Unused until a Maya dialer exists, but it is the only allowed source for one.
   - `call_guard_report()` admin-guarded RPC: counts per seller of callable vs skipped by reason, for the admin cards.
   - `call_gate_selftest() returns jsonb`: asserts on synthetic inputs (no real rows): mobile blocked, unverified blocked, stale blocked, search-sourced VoIP blocked, website VoIP allowed, landline allowed, DNC blocked, Saturday blocked, 8 PM blocked, consent lets a mobile through, consent does not beat DNC. Returns `{ok, failures[]}`.
   - Team card via `team_onboard`: slug `call-guard`, name "Call Guard", title "Call Compliance", reports_to `security-auditor`, pulse names its nightly job.
   - pg_cron nightly (about 2:10 AM PT, minute not :00): runs `call_gate_selftest()`, and if not ok `bestly_raise('call-guard.selftest', ...)` signed by Call Guard ("Call Guard: my safety checks failed, outbound calling is blocked until fixed") AND sets both `rg_settings.calling_enabled` and `maya_call_settings.calling_enabled` to false (self-heal = fail closed). Ok = resolved.
2. **Stale line re-check**: extend the existing lookup paths (hunter-run for maya_leads, roofguard-caller's lookup for rg_leads; find them, don't duplicate) so call-eligible leads with `line_type_checked_at` older than 90 days get re-looked-up before the gate would need them. If that needs an edge function deploy, deploy only after diffing the deployed source against the repo (same safe-deploy rule as before: if deployed differs from repo, stop and report).
3. **Consent capture on forms**: `/contact` and `/get-started` get a short line above Send (not a pre-ticked box): "By sending, you agree Bestly may call or text you about your request, including with an AI assistant. Consent isn't required to buy anything." submit-contact and submit-cloud-lead write a `call_consents` row (seller `bestly`, source `contact_form` / `get_started`, the exact text) when a phone number is given.
4. **Admin cards**: a small "Call safety" card on the RoofGuard calling admin page and on /admin/maya: callable now, skipped by reason (plain words: "cell phones", "not checked yet", "internet lines not listed by the business", "checked too long ago", "asked not to be called"), last self-test time and result. Uses `call_guard_report()`.
5. **CLAUDE.md rule** (rules of the road): "Every AI outbound call comes from a `*_next_call_batch()` that uses `call_gate()`; never dial a number any other way. Mobile numbers only with a `call_consents` row."

## Verify

Apply migration; run `select call_gate_selftest()` (ok true); compare `rg_next_call_batch` eligible counts before/after (expect search/empty-source VoIP and stale lines to drop out); tsc, build, eslint; headless screenshot of both admin cards; never set calling_enabled true; never place a call.
