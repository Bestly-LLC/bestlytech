# Automation Maker (Tinker) — Opus plan, Sonnet executes

Jared, 2026-10-20 9:36 PM: "an AI automation maker in my Bestly admin… free… I tell it what I want and it builds
the automation in Home Assistant, and if it can't, it creates a prompt to hand over."

Decisions he made (AskUserQuestion, 2026-10-20):
- **Go-live:** preview, then one tap. Plain-English summary + YAML first; nothing touches Home Assistant until he taps Install. Every install keeps an undo.
- **Fallback:** straight to Scout's Code Worker (a `code_jobs` row), free models first, paid only if his Paid AI switch is on (the worker already obeys that).
- **Owner:** a new AI employee. Name **Tinker**, title **Home Automation Engineer**, slug `tinker`, dept `home`, reports to `home-hub`. Every alert is signed Tinker.
- **Input:** typed in the admin.

Free only: every model call is `llm({..., paid: "never", privacy: "private"})` from `_shared/free-llm.ts`.

## How it works

```
Admin page  ──generate──▶  ha-automator edge fn ──llm (free ladder)──▶ draft (preview)
   │                         │  entity catalog = ha_entity_catalog (refreshed by homeassistant.catalog)
   │ Install (tap)           ▼
   └──────────────▶ home_hub_commands (homeassistant.automation_put | package_put)
                              │ Pi agent 1.6.1 → HA REST config API / packages dir + check_config
                              ▼
                     trigger ha_automator_on_command → row installed / failed (+ undo data)
can't build → status handoff → code_jobs row (Code Worker writes home-assistant/packages/bestly_auto_<slug>.yaml)
           → watchdog sees the job done → pulls the file → preview again → one tap installs it with package_put
```

Three tiers, cheapest first:
1. **automation** — one HA automation through HA's config API (`/api/config/automation/config/<id>`). Shows in the HA UI, editable there.
2. **package** — YAML with helpers/templates/scripts + automations, written to `packages/bestly_auto_<slug>.yaml`, guarded by HA `check_config` (bad file is removed, nothing reloads).
3. **cannot** — needs a new integration, hardware not in HA, a login, HACS, or code → handoff prompt → Code Worker.

## Contract (frozen; both lanes build to this)

### Pi agent 1.6.1 (Opus lane, in place patch on bestly-pi; additive)
New `homeassistant.*` actions, all routed through `do_ha_automator(ha, action, payload)`:

| action | payload | result |
|---|---|---|
| `catalog` | `{}` | `{entities: [[entity_id, name, state, area], …], services: {domain: [service,…]}, ha_version}` |
| `automation_get` | `{id}` | `{id, config \| null}` |
| `automation_put` | `{id, config}` | `{id, entity_id, state, prev_config \| null}` (HA validates; a 400 fails the command with HA's words) |
| `automation_delete` | `{id}` | `{id, deleted: true, prev_config}` |
| `package_get` | `{name}` | `{name, yaml \| null}` |
| `package_put` | `{name, yaml}` | `{name, prev_yaml \| null, check: "valid", reloaded: [...]}`; invalid → file restored/removed, command fails with check_config errors |
| `package_delete` | `{name}` | `{name, deleted: true, prev_yaml}` |

Rules enforced on the Pi AND in the `home-hub-agent` edge allowlist:
- `id` matches `^bestly_[a-z0-9_]{3,60}$`; `name` matches `^bestly_auto_[a-z0-9_]{3,50}$`. Tinker can never touch anything it did not make.
- Package top-level keys allowed: automation, script, scene, template, input_boolean, input_number, input_select, input_text, input_datetime, input_button, timer, counter, schedule, group. Anything else is refused.
- Refused anywhere in a config/package: `!secret`, `shell_command`, `command_line`, `rest_command`, `python_script`, `pyscript`, `hassio.`, `homeassistant.stop`, `homeassistant.restart`, `recorder.purge`.
- `package_put` max 40,000 characters.

### Database (Sonnet lane A) — migration `20261021050000_ha_automator.sql`
`public.ha_automations`:
`id uuid pk default gen_random_uuid(), created_at, updated_at, request text not null, feedback text, kind text ('automation'|'package'|'cannot'),
status text not null default 'drafting' check in ('drafting','preview','installing','installed','failed','handoff','undoing','undone','discarded'),
ha_id text, package_name text, entity_id text, title text, summary jsonb (array of plain sentences: When / Only if / Then),
assumptions jsonb, risky boolean default false, risk_reason text, config jsonb, package_yaml text, yaml text (display),
prev_config jsonb, prev_yaml text, enabled boolean default true, model text, provider text, tried jsonb, error text,
handoff_prompt text, code_job_id uuid, command_id uuid, attempts int default 0, requested_by uuid default auth.uid(),
installed_at, undone_at`.
RLS on, admin read/write only (copy the policy pattern `home_hub_commands` uses). Realtime publication on (the page listens).
`public.ha_entity_catalog (id boolean pk default true check (id), captured_at timestamptz, data jsonb)`.
Trigger `ha_automator_on_command` AFTER UPDATE on `home_hub_commands` when `requested_by = 'ha-automator'` and status became done/failed:
finds the row by `payload->>'automator_id'`, sets installed (entity_id, prev_config/prev_yaml, installed_at) / undone / failed (+ error), and for
`catalog` results upserts `ha_entity_catalog`. Signed notifications only on failures nobody could fix (autonomy rules: failures as `warning`, info held).
Team card via `team_onboard` (title Home Automation Engineer, reports_to home-hub, runs_on supabase, admin_url `/admin/home-hub/automations`,
pulse names cron `ha-automator-watch`, owns `tinker.`, tools: Pi agent, free AI ladder, Code Worker).
pg_cron `ha-automator-watch` every 5 min → `ha-automator` op `watch` (service role).

### Edge function `ha-automator` (Sonnet lane A), verify_jwt true, admin-only except `watch` (service role)
POST JSON `{op, ...}`; every op returns `{ok, row?}` or `{ok:false, error}` with plain-words errors.
- `generate {request}` → insert row (drafting) → ensure catalog < 30 min old (else queue `homeassistant.catalog` with requested_by `ha-automator`, wait ≤ 25 s, else use the stale one and say so in assumptions) → prompt → `llm({task:"code", json:true, paid:"never", privacy:"private", job:"ha-automator", fn:"ha-automator", ref:id, validate})` → validate (below), up to 2 repair rounds feeding the errors back → `preview` or `handoff`.
- `revise {id, feedback}` → same pipeline with the previous draft + feedback.
- `install {id}` → queue `automation_put` / `package_put` (payload carries `automator_id`), status installing.
- `undo {id}` → if prev_config/prev_yaml exists, put it back; else delete. status undoing → trigger sets undone.
- `toggle {id, enabled}` → `toggle_automation` on `entity_id`.
- `discard {id}` → discarded.
- `handoff {id}` → (also automatic) build `handoff_prompt`, insert `code_jobs {repo:'Bestly-LLC/bestlytech', goal}`; goal asks for exactly one file `home-assistant/packages/<package_name>.yaml` obeying the package rules.
- `watch` (cron): installing/undoing older than 10 min → re-queue once, then failed + Tinker alert; handoff rows whose code_job is done → fetch the file from `raw.githubusercontent.com/Bestly-LLC/bestlytech/<sha or main>/…`, validate, kind package, status preview (good news to the recap as `success`); failed code_job → keep handoff, keep the Copy button; agent older than 1.6.1 → one Tinker warning; write `agent_beats` for tinker every run.

Validation (edge, before anything is shown): JSON shape; `ha_id`/`package_name` patterns; every `entity_id` in config/YAML exists in the catalog (unknown → repair round, then assumptions); service domains exist in catalog.services; the denylist above; `risky = true` for lock.*, alarm_control_panel.*, cover.* garage/door, climate outside 60–85 °F, anything that runs at night and makes sound. YAML for display via `jsr:@std/yaml` stringify.

House rules the system prompt carries (Jared's): presence/bed/motion/desk/kitchen automations get condition `input_boolean.sexy_time` is `off`; desk and kitchen automations must not fire while `binary_sensor.bed_withings_sleep_in_bed` is `on` (use "not on", it reads unknown after restarts); the Sofa lamp always turns on together with its sister lamp; keep the TV backlight strip off when the wall projector is showing; phone notifications go through the existing `notify.mobile_app_*` service; times in messages are 12-hour (3:05 PM); units °F, ft, mph; `mode` single unless the request implies restart/queued; ids `bestly_<short_slug>`; alias in plain words; description starts "Made by Tinker from: <request>".

### Admin page (Sonnet lane B) — `/admin/home-hub/automations`, title **Automation Maker**
`src/pages/admin/HomeHubAutomations.tsx`, route in `src/App.tsx`, sidebar item under Home Hub (`AdminSidebar.tsx`) and title in `AdminLayout.tsx`. Reads/writes only through `ha-automator` (supabase.functions.invoke) and reads `ha_automations` (realtime + 4 s poll while anything is drafting/installing/undoing).
- Top: one large text box "What should happen?" with 3 example chips from his real home (e.g. "When I get out of bed after 7 AM, turn on the kitchen lights", "If the Dyson air quality is bad, turn it on", "Turn the TV strip off when the projector comes on"), button **Make it**. While drafting: Tinker's working line rotating through real steps (Reading your home, Writing it, Checking it).
- Card per row (newest first): title, status pill, the summary sentences (When / Only if / Then), assumptions, a risky banner when risky, disclosure "Show the YAML" (monospace, copy button).
  Buttons by status — preview: **Install** (primary), Change it (inline feedback box → revise), Discard. installed: On/Off switch, **Undo**. failed: the error in plain words + Try again. handoff: "Sent to the Code Worker" + **Copy prompt**. undone/discarded: muted, collapsible.
- Apple design skill first, then UI UX Pro Max. Admin is dark. House rules: sentences never split (`<Lines>`), never truncate with "…", a number never wraps from its unit (`whitespace-nowrap`), 12-hour times, feathered (soft-edged) animations, works on iPhone 16 Pro Max width. No emoji.

## Undo
Automation: `automation_put` with prev_config, or `automation_delete`. Package: `package_put` with prev_yaml, or `package_delete`.
Agent patch: `/opt/bestly/home-hub-agent/agent.py.bak_automator_<stamp>`; restore + `systemctl restart bestly-home-hub-agent`.
Edge allowlist: redeploy `home-hub-agent` v17 source. DB: drop the two tables, trigger, cron and the team card.
