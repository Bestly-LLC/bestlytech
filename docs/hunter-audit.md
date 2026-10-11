# Hunter Phase 0 audit: everything that touches `rg_leads` (2026-10-11)

Scope: find every job, function and agent that reads or writes RoofGuard's lead store before Hunter exists, so Phase 3 can
take over the right pieces and Phase 1 does not duplicate anything. Read-only audit; nothing was changed.

## State of the store

`rg_leads`: 1,164 rows, all `call_status = not_called`. Phone finder: 282 landline, 456 voip, 28 mobile, 18 unknown,
126 found-but-unverified, 254 not found. Internal opt-outs: `rg_dnc` (1 row). No National Do Not Call Registry scrub exists.

## Jobs that touch `rg_leads` (pg_cron, `cron.job`)

| Job (cron name) | Schedule | What it does | Owner (team card) | Hunter Phase 3 |
|---|---|---|---|---|
| `roofguard-enrich` | every 5 min, only when a lead is `pending`/`error` | Edge fn `roofguard-enrich` (batch of 24): Wikidata, then the company website, then web search for the main phone; scores each number; writes `phone`, `phone_source`, `phone_confidence`, `enrich_status`. Claims rows with `rg_claim_batch` (skip locked). `line_type` stays `unverified`. | `roofguard-finder` (Phone Finder, reports to Reese) | **Take over the capability, not the rows.** Hunter's website reader and phone match overlap with it. In Phase 3 Reese's finder is called through the adapter; the code is not merged. |
| `roofguard-watch` | `3-59/10 * * * *` | `rg_watch()`: resets stuck `working` rows, re-kicks a stalled finder, raises/clears `roofguard.enrich` | Reese | Stays with Reese. |
| `roofguard-watch-calls` | `7-59/10 * * * *` | `rg_watch_calls()`: call health, stuck dialing rows | Reese | Stays. |
| `roofguard-dial` | every 5 min, only when `rg_settings.calling_enabled` | Edge fn `roofguard-caller` `tick`: `rg_next_call_batch()` picks leads (line type, DNC, window, attempts, gap, caps, holidays all live in that one SQL function), re-checks `rg_dnc` just before submit, places the call | Reese | **Take over the queueing half only**: Hunter fills the queue, Reese's dialer keeps dialing. Adapter is the only writer to `rg_leads`. |
| `roofguard-followups` | every 5 min | `rg_followups_tick()`: follow-up calls/texts for leads that asked for a call-back | Reese | Stays. |
| `roofguard-pace` | `5 13 * * 1-5` (6:05 AM PT) | `rg_apply_pace()`: sets the day's dial pace from the weekly goal | Reese | Stays. |
| `roofguard-daily-report` | `20 0 * * 2-6` | `rg_daily_report()` | Reese | Stays. |
| `roofguard-weekly-review`, `roofguard-review` | Fri 4:50 PM PT, Mon 6:20 AM PT | Scorecard and Reese's performance review, read `rg_calls` joined to `rg_leads` | Reese / coach | Stays. |
| `rg-voicemail-guard` | `11 15 * * *` | `rg_voicemail_guard()` | Reese | Stays. |

Not cron but on demand: `roofguard-caller` action `line_types` (admin button) runs the **Telnyx number lookup**
(`GET /v2/number_lookup/{e164}?type=carrier`, key `telnyx_api_key` via `rg_secret()`), maps carrier type to
landline / voip / mobile / unknown, writes `line_type` + `line_type_checked_at`. `rg_kick()` is the "Find now" button.
Other readers (no writes): `partner-google` (booking), `ava-assistant/contacts.ts` (personal Ava never touches `rg_leads`),
`/admin/roofguard` (RoofGuard.tsx). The `RoofGuard Outreach` card (`roofguard-outreach`, runs on Claude weekdays 9 AM)
works the email-partner list and does not use the table.

## Pi, Mac mini and schedulers

- **The Pi** runs `/opt/bestly/cron` jobs (copies in `tools/pi-cron`, `tools/settlement-finder`, `tools/plug-puller`): a crontab line
  runs `run.sh <job>`, which reports a heartbeat to `pi_jobs` / `pi_job_runs` through `pi_job_report`. Pi jobs authenticate
  with the house db-watchdog token on the Pi's disk. **No Pi job touches `rg_leads`.** The free-AI ladder on the Pi is
  `/opt/bestly/cron/freellm.py` (FreeLLM, then Gemini, Groq, Cloudflare).
- **The Mac mini** runs `mac_jobs` / `mac_commands` (Sweep, Voice Coach, Notetaker). Nothing there touches `rg_leads`.
- Reachability from the build session: the Pi and the Mac mini are not reachable from this cloud sandbox (no ssh key, no
  tailnet, the Pi token lives on the Pi). So Hunter's workers are an edge function plus pg_cron, which is the fallback the
  brief allows. Still zero Claude tokens at runtime. They can move to the Pi later without a schema change.

## Reusable pieces found

- **Telnyx line-type lookup**: `supabase/functions/roofguard-caller/index.ts` `lineTypes()` and its `MAP`; key via `rg_secret('telnyx_api_key')`. Hunter reuses the call shape and the map (not the function, so RoofGuard stays separable).
- **Free AI ladder**: `supabase/functions/_shared/free-llm.ts` `llm({task, system, user, json, job, ...})` (edge) and `tools/pi-cron/freellm.py` (Pi). Hunter uses the edge one with `paid: 'never'`.
- **Team cards**: `team_onboard(jsonb)`; Maya and Reese both report to `jared` in dept `sales`; their pulse is `{"src":"at","table":"ava_line_health","where":"source = '...'", "also":[cron names]}`.
- **Alerts**: `bestly_raise(key, kind, severity, title, body, area, ...)`, owner resolved by key prefix through `notification_owners`.
- **Opt-outs**: `rg_dnc` (Reese's internal list, written on "don't call me"). Hunter reads it and keeps its own shared list `hunter_optouts`.

## What Hunter takes over in Phase 3 (not now)

1. **Feeding Reese's queue.** Hunter becomes the source of new `rg_leads` rows and of "who is next", through one adapter
   function; RoofGuard's tables stay untouched until then and stay sellable.
2. **The phone finder** (`roofguard-enrich`) stays as is; Hunter's reader can call it for Reese's campaigns.
3. **Opt-outs.** Reese's `rg_dnc` writes also land in `hunter_optouts` (Phase 3 wiring), so one "stop calling me" covers both callers.
4. Everything else on the table above stays with Reese.

## Compliance gaps found

- No National Do Not Call Registry scrub exists (`docs/ava-calling-compliance-opusplan.md` step 5, needs Jared's FTC registration). Hunter marks every lead `dnc_checked = false` and queues landlines only; B2B landlines sit outside the registry, but a sole proprietor's landline can be a home line.
- 456 of 1,164 RoofGuard numbers came back `voip`. RoofGuard's dialer accepts voip; the Hunter brief only lets landline through, so expect a lower yield (open decision for Jared).

## Phase 1.5: Jev scoring and the priority hand-off (2026-10-11)

Every lead a caller may dial now carries odds, so the queue is ordered by "most likely to reach the person who decides", not
only by fit. No Claude tokens: the scorer is an edge function (`hunter-score`) on pg_cron.

**Tables.** `hunter_lead_scores` (one row per owner + lead id: `p_reach_dm`, `outcome_probs`, `dm_role`, `best_window`, `p_fit`,
`priority = p_reach_dm * p_fit`, one-line `reason`, the `inputs` the scorer was shown, `scorer` jev or free_ai) and
`hunter_call_outcomes` (what really happened per call, for calibration; filled in Phase 4). Rows hold a lead id and numbers only,
never a phone, email or name, so RoofGuard stays separable and `privacy_data_map` needs no row. Admin-read RLS, explicit grants.

**Scorer.** `hunter-score` ops `run` (nightly, 1 to 5:50 AM PT every 10 minutes), `backfill`, `test`. Jev is used when the Vault
secret `jev_api_key` exists, otherwise the free AI ladder (`free-llm` run op, privacy private, paid never) is asked the same four
questions and the answer is validated and clamped to the same shape (`scorer = free_ai`). A lead whose Jev call fails falls back to
free AI on its own; Jev is parked for the run after a 401/402/403 or four failures with no success. Per-night caps live in
`hunter_settings` (`score_cap_jev` 500, `score_cap_free` 150). A score is refreshed after 7 days. Scoring never blocks the night.

**Priority hand-off.** `hunter_handoff()` now orders each campaign's pick by `priority desc nulls last`, then `fit_score desc`,
then created_at, so an unscored lead sorts last and the fit order is the fallback.

**Reese (read only).** `hunter_reese_priority()` returns `(lead_id, priority, best_window, reason)` for fresh scores of callable
`rg_leads`, using the same eligibility as `rg_next_call_batch` (phone present, line type landline or voip, not dnc, not in `rg_dnc`,
call_status not booked / not_interested / do_not_call / wrong_number / in_progress). Worker-only (service role). **`roofguard-dial`
and `rg_next_call_batch` are untouched**: wiring Reese to read this is Phase 3.

**Jev (TypeSafe AI) System One, confirmed from docs.typesafe.ai:** `POST https://api.typesafe.ai/v1/systemone`, header
`Authorization: Bearer <key>`, body `{state, model: "jev-latest", questions: {id: {type: "choice" | "score" | "noul", instructions,
criteria?}}}`; answers come back as `{type, choice | score | noul, probabilities, confidence}` plus `usage {input_tokens, output_tokens}`.
Pricing is $0.042 per million input tokens, output free. **Not confirmed** (docs silent): rate limits, the error body shape, and any
calibration guarantee, so the adapter treats any unexpected shape as a failure and falls back to free AI.

**Watchdog.** `hunter-run` op `watch` also judges scoring: lead scoring failed 2 nights runs one pass, then alerts
"Hunter: scoring failed 2 nights"; a saved Jev key failing 2 nights gets one test call, then "Hunter: Jev is failing, using free AI
estimates" (scoring continues on free AI). The team card hunter and the tool card hunter-scorer are in
`20261011050300_hunter_score_cron_and_team_card.sql`.

**Screens.** `/admin/leads/hunter` (Hunter, with the Jev card: status, write-only key field into Vault via `hunter_jev_key_put`,
on/off, caps, "Score one lead") and `/admin/leads/hunter/scores` (the score screen). `/admin/hunter` and `/admin/hunter/scores`
redirect.

**Open.** The Jev key has to be pasted by Jared on the Jev card. `hunter_call_outcomes` stays empty until Phase 4. The free AI is about
10 seconds a lead, so a first backfill is slow (it is rate-limited, not stuck). No National Do Not Call scrub yet (unchanged).
