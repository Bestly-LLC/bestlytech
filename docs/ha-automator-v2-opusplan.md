# Tinker (Automation Maker) v2 — opusplan

Opus planned 2026-10-28 11:40 PM. Sonnet executes. v1 contract: `docs/ha-automator-opusplan.md`.

## What broke

`/admin/home-hub/automations` showed "Could not load your automations. permission denied for table ha_automations" from the day it shipped.

- **Cause.** `postgres`'s default privileges in `public` no longer grant new tables to `authenticated` (hardened on purpose). The 2026-10-21 `ha_automator` migration wrote admin-only RLS policies but no `GRANT`, so Postgres refused before RLS ran.
- **Why nobody saw it.** Tinker's watch runs as `service_role`, so it beat "ok" every 5 minutes while the page was dead for 8 days. Only 2 smoke-test rows exist; Jared has never been able to use it.
- **Fixed by Opus (done, verified).** Migration `ha_automator_authenticated_grants`: `grant select, insert, update, delete on ha_automations, ha_entity_catalog to authenticated`. Admin JWT reads rows; a non-admin JWT reads 0. Logged in `security_autofix_log` (`grant_gap:ha_automations`) with undo.
- **Same hole elsewhere.** 41 tables have an `authenticated` policy and no grant. 29 are plain `has_role(admin)`; 12 use `team_is_admin()` / `privacy_is_admin()` / other. Not touched here: Jared decides (see "Open").

## Build list (Sonnet)

**B1. Tinker checks his own page, and heals it.**
- New `public.tinker_page_check()` (security definer, admin or service_role only). Checks `has_table_privilege('authenticated', …)` for select/insert/update/delete on `ha_automations` and `ha_entity_catalog`, and that the `*_admin_all` policies still exist.
- Grant missing but policy present: re-run the exact fixed grant for those two tables only, log to `security_autofix_log` (action `grant_gap`, with undo), `tinker_notify` as `success`.
- Policy missing: never grant. `tinker_notify` as a security problem (this is one of the 4 kinds that may interrupt).
- Call it from the `watch` op; the beat summary says "page check ok" or what it healed.
- If the auto-heal is refused by a safety check, ship detect + alert only and say so in the memory note.

**B2. The page never shows raw Postgres text.**
- On a load error, call `tinker_page_check` once, reload once, and only then show a plain message: "Tinker can't open your list right now. He's been told and is on it."
- Keep the existing "not set up yet" branch. Apple design skill, then UI UX Pro Max pass. House copy rule (`<Lines>`), 12-hour times, no truncation.

**B3. Never "try again in a few minutes".**
- Jared's rule (2026-10-28): never tell him to wait or retry; switch providers and keep going.
- When every free model is out, leave the row `drafting` with a note ("Waiting on a free model. Tinker finishes on his own."), and have `watch` re-run waiting drafts each tick, up to 6 tries (~30 minutes).
- After that, use Scout's existing out-of-room path (find it: `llm_providers.outage_note`, `scout_free_fallback` migration 20261029010434) to switch or suggest a new provider. Still `paid: "never"`.
- Same for every other "Try again" string in `ha-automator/index.ts` and the page that is about AI capacity.

**B4. Warm catalog.** In `watch`, queue a Pi `catalog` command when `ha_entity_catalog.captured_at` is older than 6 hours (no AI, Hestia does the work). The first draft stops waiting up to 25 seconds.

**B5. Drop the GitHub raw-import shim.** The live `ha-automator` (v2) imports pinned source from raw.githubusercontent. If the repo goes private (Ares has flagged it public), Tinker dies silently. Deploy the full source with `deploy_edge_function` instead.

**B6. Stop the next one (detection only).**
- Add an Ares nightly check `policy_without_grant`: a `security_findings` row per public table that has an `authenticated` policy and lacks the matching grant. Detection only, no auto-grant.
- Add a CLAUDE.md rule under "rules of the road": every new table read by a signed-in page needs an explicit `GRANT … TO authenticated`; default privileges no longer give it.

**B7. Verify and ship.**
- As an admin JWT: page query works. As a random JWT: 0 rows.
- `watch` once: beat says page check ok.
- One real `generate` of a harmless request (preview only, nothing installed), then `discard` it.
- `npx tsc --noEmit -p tsconfig.app.json`, `npm run build`, commit, `git pull --rebase origin main`, push.
- Update Tinker's team card pulse if a new job was added. Update `bestly_memory` `house/build/tinker-automation-maker-2026-10-20`.

## Out of scope

Installing or changing anything in Home Assistant. Tinker's Pi agent (1.6.1 is live on Hestia). Paid AI.

## Open (Jared's call)

Restore the grant on the 29 other admin-only tables that have the same hole (some admin pages are likely half-broken the same way).
