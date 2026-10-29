# Tinker's Automation Fixer (2026-10-29)

Jared: "we've added some stuff, and it's messed up some things I don't want." Example: he walked into the bathroom at 6 AM, the lights came on dimmed as normal, then slowly ramped to 100%.
The Automation Maker (`/admin/home-hub/automations`) now has three tabs: **Make** (unchanged), **My automations** and **Fix a problem**.

## What it does

1. **Fix a problem.** Jared types what went wrong. Tinker works out the devices and the time (words first, a free model only for what the words leave open), asks the Pi for the evidence, reads it, tells the story in plain words with 12-hour times, names the one thing that causes it, and proposes a fix with a plain before/after and the exact change collapsed below.
2. **One tap applies it.** Apply needs Jared's signed-in session (never the service role). Every apply has an Undo. Tinker never deletes an automation: the only "remove" is `turn_off`, and the preview says so in bold ("This turns it off. It is not deleted.").
3. **My automations.** Every automation and script (editor-made and package-based) with a plain line of what it does, last run, an on/off switch, and a "Fix this" button that opens Fix a problem pre-filled. The plain lines are built from the config by code (`describeConfig` in `supabase/functions/ha-fixer/lib.ts`), no AI, so 130 items cost nothing.
4. **Not sure?** `confidence: low` (or no culprit, or no safe change) lands as status `diagnosed`: the story, a plain "Tinker is not sure enough to change anything", and a **Hand to the Code Worker** button (`code_jobs`, writes `docs/ha-fixes/<date>-<id>.md`, never touches Home Assistant).

## Moving parts

| Piece | Where |
|---|---|
| Tables | `ha_fixes` (one row per question), `ha_inventory` (one row, the list). Migrations `20261029134419`..`20261029134700`. Admin-only RLS + explicit `GRANT ... TO authenticated`, realtime on. |
| Edge function | `supabase/functions/ha-fixer/` (`index.ts`, pure helpers in `lib.ts` + `lib.test.ts`). Ops: `diagnose revise apply undo discard handoff inventory toggle`, service-only `continue watch`. |
| Trigger | `ha_fixer_on_command` on `home_hub_commands`: when the Pi answers a `requested_by='ha-fixer'` command it moves the row forward and wakes `ha-fixer` (`continue`). Apply/undo results are recorded by the trigger itself (SQL), so a dead edge function cannot lose them. |
| Cron | `ha-fixer-watch` every 5 minutes (stuck gathering/applying, analyses waiting on a free model, warm list, Code Worker hand-backs, agent update resumed). On Tinker's pulse as `also`. |
| Watchdog | `tinker_page_check()` covers all four tables (`ha_automations`, `ha_entity_catalog`, `ha_fixes`, `ha_inventory`). |
| Pi agent | `home-hub-agent` **1.6.2**: `homeassistant.inventory | evidence | item_edit | package_patch | package_restore`. Source of the block: `scripts/home-hub-agent/patches/fixer_1_6_2_block.py` (annotated) and `.min.py` (what ships); tests: `scripts/home-hub-agent/tests/test_fixer_1_6_2.py`. Allowlist validators: `supabase/functions/home-hub-agent/index.ts`. |
| UI | `src/pages/admin/HomeHubAutomations.tsx` (tabs) + `src/components/admin/homeHub/fixer/`. |

## Evidence (what the Pi reads, read-only)

`evidence {entity_ids, start, end, focus?}` returns the device state and area, the logbook rows (who started each change: `context_*`), the history of each device (brightness %, kelvin), every automation/script/scene that mentions the devices (or their area or device id, or a group that lists them) with its config or package block and a fingerprint, which of them ran in the window (`last_triggered`), run traces over the HA WebSocket (`trace/list`, `trace/get`: why it started, which service it called with what data), scripts those automations call, and the package files involved.
Result size is capped (420 KB; the server accepts 512 KB) by dropping the least useful parts first.

## Writes (all guarded)

- `item_edit {domain, id, config, expect_hash}`: UI-made automations/scripts/scenes through HA's config API. Refuses if the config changed since Tinker read it (canonical-JSON hash, computed only on the Pi). Backs the old config up to `bestly_backups/config/`. Returns `prev_config`, which is the undo.
- `package_patch {name, expect_sha256, edits[{old,new}]}`: package YAML edited as text so comments, `!secret` and `!include` survive. Each `old` must appear exactly once; the file fingerprint must match; the whole file is backed up to `bestly_backups/packages/` with a timestamp; `check_config` runs; a bad config puts the old text back; only the touched sections are reloaded. Keys that cannot reload (for example `adaptive_lighting`) come back as `restart_needed` and Jared is told plainly (Tinker never restarts Home Assistant).
- `package_restore {name, backup, expect_sha256, reload_keys}`: the undo for a patch (refuses if the file changed again after the fix, unless forced).
- Same deny rules as the Maker, but a fix may only not ADD them: `!secret`, `shell_command`, `command_line`, `rest_command`, `python_script`, `pyscript`, `hassio.`, `homeassistant.stop/restart`, `recorder.purge` (an existing one in a file stays untouched).

## Free AI only

Every call is `llm({ paid: "never", privacy: "private" })`. One small call picks devices/time only when the words did not (about 500 tokens); one call writes the story (`judge`); one writes the fix (`code`). Each prompt stays under the 7,000-token rungs. No free model free: the row waits (`wait_tries`/`retry_at`), the watch re-runs it, at 30 minutes Scout's out-of-room path names a provider to connect (recap, signed Tinker), at about 5 hours it stops with nothing spent.

## Deploying the agent with no SSH

`agent.update {version, sha256}` fetches the release source from `home_hub_agent_releases`, verifies sha256, `compile()`s it, keeps `agent.py.prev`, restarts; `launch.sh` rolls back after 3 failed starts. Release 1.6.2 is built in SQL from the live 1.6.1 row (`scripts/home-hub-agent/patches/fixer_1_6_2_release.sql`, regenerate with `build_fixer_release.py`). If the page says "Home Hub needs an update", Tinker queues the `agent.update` himself and starts the waiting question again when the version arrives.

## Known limits

- The fix can rewrite one automation/script (or one settings section of a package file) at a time. Integration settings kept in a UI config entry (for example Adaptive Lighting set up from Settings) are not reachable: Tinker explains and says so.
- Package sections other than automation/script are only offered as a suspect when the file already held a referrer (the file text is in the evidence).
- Run traces need the Home Assistant WebSocket; if it is not reachable the story rests on the logbook and history and says so.

## Undo of this build

`select cron.unschedule('ha-fixer-watch'); drop trigger ha_fixer_on_command on public.home_hub_commands; drop table public.ha_fixes, public.ha_inventory;` and re-apply `20261029062402_tinker_page_check.sql`. Agent: queue `agent.update` to 1.6.1.
