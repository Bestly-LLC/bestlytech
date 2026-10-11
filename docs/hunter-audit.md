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
