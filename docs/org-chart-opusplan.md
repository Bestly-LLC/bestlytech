# Opusplan: Bestly org chart — "Team" page in the admin

**Status:** PLAN, not built. Written 2026-10-03.
**Asked by Jared:** "an org chart of Bestly with me at the top and all my AI agents/bots under them, their role, what they do."
**Jared decided (2026-10-03):** everyone (~32 incl. paused/planned as open roles) · departments under him · **live status**, new bots appear on their own.

## TL;DR

- **New page `/admin/team`** (sidebar label **Team**, main group, after Partners). Jared on top, Scout as Chief of Staff, then 6 departments.
- **Every card is live:** green / yellow / red / grey dot, "Last ran 3:05 PM", one line of what it did, tap for details + jump to its own admin page.
- **One roster table** (`bestly_agents`) + **one heartbeat call** (`agent_beat`) any bot can make. Bots that already log somewhere (pi_jobs, mac_agents, cron, …) are read where they already log — no rewrites.
- **New bots show up by themselves** as "New hire — place me" cards (nightly discovery).
- **Self-healing watchdog wired to Scout:** a silent bot opens a `monitor_issues` row → Fix Ladder → Scout; it auto-closes when the bot comes back. The Pi watches the watcher.
- **Command Center stays simple:** no new tile. Red bots already reach Today via `monitor_issues`.

## House rules this must follow

- Apple HIG pass (grouped inset cards, system font, real dark mode tokens) — use the HIG/`ui-ux-pro-max` skill.
- 12-hour times everywhere ("3:05 PM", "Yesterday 11:40 PM"). US units.
- A number never wraps away from its unit (`&nbsp;` + `white-space: nowrap` on value+unit spans).
- Plain words for every role line — written for someone who has never heard of the bot.
- Read `bestly_memory` before starting; write `house/admin/org-chart` back when done. Secrets only in Vault (this feature needs none).

---

## 1. The chart (seed roster)

Status column = what the seed sets. `planned`/`paused` render as dashed "open role" cards.

### Top
| Slug | Name | Role | What it does | Runs on | Pulse source |
|---|---|---|---|---|---|
| `jared` | Jared Best | Founder & CEO | Runs Bestly. Approves anything that can't be undone. | — | none (human) |
| `scout` | Scout | Chief of Staff | The assistant in the admin corner. Finds problems, writes the fix, waits for your tap. Free AI first; paid only when the Paid AI switch is on. | Supabase (`admin-chat`) | last assistant row in `admin_chat_messages` |

### Scout's team (reports to `scout`)
| Slug | Name | Role | What it does | Runs on | Pulse |
|---|---|---|---|---|---|
| `scout-autopilot` | Scout Autopilot | Night shift | Works open incidents in the background; can't do anything risky without you. | Supabase | `pi_jobs.autopilot_loop` |
| `scout-daily` | Scout Daily | Planner | Picks Today's 3 and the wall's "one thing". | Supabase cron | `scout_daily_runs` |
| `hey-scout` | Hey Scout | Voice | Hears "Hey Scout" on the desk mic, answers on the HomePod. | Pi | `agent_beat` (Pi voice service) |
| `scout-notetaker` | Scout Notetaker | Note taker | Joins Talk calls, records, names who spoke, transcribes. | Mac mini (`tech.bestly.meetingrec-agent`) | `agent_beat` from agent.py |
| `clips-worker` | Clips Worker | Note taker's helper | Turns AirDropped/uploaded audio into transcripts. | Mac mini (`tech.bestly.clips`) | `agent_beat` from clips.py |
| `partner-scout` | Partner Scout | Eli's assistant | Scout inside the partner portal; Eli sees only Centering YOU. | Supabase | last partner chat row |
| `todo-checker` | To-do Checker | Closer | Checks if a to-do is really done; closes proven ones nightly at 10 PM. | Supabase (`todo-check`) | `cron.job_run_details` `todo-check-tick` |

### Ops & Security (head: `fix-ladder`, reports to `scout`)
| Slug | Name | Role | What it does | Runs on | Pulse |
|---|---|---|---|---|---|
| `fix-ladder` | Fix Ladder | Head of Ops | Every problem climbs: self-heal → free AI → Scout → you. Every 10 min. | Supabase cron | cron `fix-ladder` |
| `free-ai-fixer` | Free-AI Fixer | Mechanic | Writes cause + check + fix for each incident with a free local model. | Mac mini | newest `fix_ai_jobs.done_at` |
| `security-auditor` | Security Auditor | Security guard | Checks every live site and app at 1 AM, read-only. | Claude scheduled task | `security_audit_runs` |
| `studio-watch` | Studio Watch | Lookout | Pings Studio every 5 min. | Pi | `pi_jobs.studio_watch` |
| `db-watch` | Database Watch | Lookout | Spots database freezes. | Supabase + Pi | `db_watch_state` |
| `ai-watch` | AI Provider Watch | Lookout | Pauses a free AI provider that's failing; resumes it when healthy. | Supabase | `freellm_watch_state` |
| `mac-hands` | Mac Hands | Hands | Runs jobs you approved on the Mac. | Mac (`mac_agents`) | `mac_agents.last_seen_at` |
| `pi-runner` | Pi Job Runner | Hands | Runs the scheduled jobs on the Pi. | Pi | newest `pi_jobs.last_run_at` |

### Studio & Marketing (head: `spark`, reports to `jared`)
| Slug | Name | Role | What it does | Runs on | Pulse |
|---|---|---|---|---|---|
| `spark` | Spark | Head of Studio | The chat inside Studio; writes and edits posts. | Supabase (`studio-chat`) | last studio chat row |
| `studio-rerun` | Rewriter | Copywriter | Every 12 hours rewrites posts using your change notes. | Claude scheduled task | `agent_beat` (add to prompt) |
| `hoku-post-check` | HOKU Post Checker | Proofreader | 9:30 AM: makes sure today's HOKU post is queued and clean. | Pi | `pi_jobs.hoku_prepost` |
| `transcoder` | Transcoder | Video tech | Turns client recordings into videos that play anywhere. | Pi | `pi_jobs.transcode` |
| `cy-pipeline` | Cookie Yeti Pipeline | Content robot | Cookie Yeti AI content run. | Make.com | `agent_beat` if possible, else manual (grey) |
| `ask-builder` | Ask Builder | **Open role (paused)** | Would build Studio change requests on its own. | Pi | `pi_jobs.studio_ask` (disabled) |

### Turo (head: `turo-sender`, reports to `jared`)
| Slug | Name | Role | What it does | Runs on | Pulse |
|---|---|---|---|---|---|
| `turo-sender` | Link Sender | Head of Turo | Messages each new guest their trip link, every 3 min. | Mac mini (`tech.bestly.turo-sender`) | `turo_sender_settings.seen_at` + `last_error` |
| `lax-concierge` | LAX Concierge | Concierge | Guest pages, reminder email, parking pass. | Supabase cron | cron `lax-guest-tick` |
| `tesla-worker` | Key Keeper | Valet | Sends guest Tesla keys once the license + check-in are done. | Pi | `agent_beat` |
| `car-guard` | Car Guard | Security | "Car moved with no trip booked" alerts (skips when you're driving). | Supabase | `car_watch` newest row |
| `sweep-guard` | Sweep Guard | Parking | Street-sweeping warnings to the wall and HomePod. | Supabase cron + Pi | cron `bluesteel-sweep-tick` |

### Sales & Clients (reports to `jared`)
| Slug | Name | Role | What it does | Runs on | Pulse |
|---|---|---|---|---|---|
| `roofguard-outreach` | RoofGuard Outreach | Recruiter | Weekday emails asking roofing/building companies for an intro to Eli. | Claude scheduled task | `agent_beat` (add to prompt) |
| `roofguard-caller` | RoofGuard Caller | **Open role (planned)** | AI phone calls to leads, books meetings with Eli. | — | none |
| `skytouch-triage` | SkyTouch Triage | Front desk | Sends the first reply to new massage clients; everything else waits for you. **Private** — never shown to partners. | Claude scheduled task | `agent_beat` (add to prompt) |

### Mail Room (reports to `jared`)
| Slug | Name | Role | What it does | Runs on | Pulse |
|---|---|---|---|---|---|
| `mail-bridge` | Mail Bridge | Mail clerk | Pulls new mail into Bestly. | Pi | `pi_jobs.mail_bridge` |
| `sent-sync` | Sent Sync | Mail clerk | Files copies of sent mail. | Pi | `pi_jobs.sent_sync` |
| `partner-mail` | Partner Mail | Mail clerk | Partner inbox for the portal. | Pi | `pi_jobs.partner_mail` |

### Home & Wall (head: `home-hub`, reports to `jared`)
| Slug | Name | Role | What it does | Runs on | Pulse |
|---|---|---|---|---|---|
| `home-hub` | Home Hub Agent | Head of Home | Runs admin's home buttons on the Pi; diagnoses the network. | Pi | `home_hub_agent_state` |
| `wall` | Wall | Display | The projector wall: sky, cards, alerts, radio. | Pi (`server.py`) | `agent_beat` from server.py loop |
| `wall-watchdog` | Wall Watchdog | Lookout | Keeps the projector awake and unfrozen. | Pi (`watchdog.py`) | `agent_beat` |
| `home-narrator` | Home Narrator | Announcer | Home events → alerts (quiet when you're home). | Pi cron | `agent_beat` |
| `ha-todo-sync` | To-do Sync | Clerk | Keeps the Home Assistant "Bestly" list matched to Today. | Pi (systemd timer) | `agent_beat` |

> Before seeding, re-run discovery (§3) and reconcile: anything in pi_jobs/cron/home_hub_agent_state/mac_agents not in this list gets a row; anything here that no longer exists gets `status='retired'` (hidden by default).

---

## 2. Data model (one migration: `20261004000000_org_chart.sql`)

```sql
create table public.bestly_agents (
  slug          text primary key,
  name          text not null,
  role          text not null,            -- "Head of Ops", "Lookout"
  what_it_does  text not null,            -- one plain sentence
  dept          text not null,            -- top | scout | ops | studio | turo | sales | mail | home | unassigned
  reports_to    text references public.bestly_agents(slug),
  kind          text not null default 'agent',   -- human | agent | job | open_role
  status        text not null default 'active',  -- active | paused | planned | retired | new
  runs_on       text,                     -- pi | mac_mini | macbook | supabase | claude | external
  schedule      text,                     -- plain words: "every 10 min", "1 AM nightly"
  admin_url     text,                     -- jump target, e.g. /admin/security
  icon          text,                     -- lucide name; scout uses the binoculars mark
  pulse         jsonb,                    -- {"source":"pi_jobs","key":"studio_watch","max_gap_min":30,"critical":true}
  private       boolean not null default false,
  sort          int not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
alter table public.bestly_agents enable row level security;   -- no policies: RPCs only

create table public.agent_beats (           -- latest beat per bot (upsert), not a log
  slug text primary key references public.bestly_agents(slug) on delete cascade,
  at timestamptz not null default now(),
  ok boolean not null,
  summary text
);
alter table public.agent_beats enable row level security;
```

### RPCs
- **`agent_beat(p_slug text, p_ok boolean, p_summary text default null)`** — security definer; callable by service role **and** the Home Hub agent key path (same gate `wall_quick_set` uses) so Pi/Mac scripts can call it with the key they already hold. Unknown slug → inserts a `status='new'` row (that's how a brand-new bot introduces itself).
- **`admin_org_chart()`** — admin only (`has_role(admin)`). Returns every non-retired agent + computed: `health` (green/yellow/red/grey/paused), `last_seen_at`, `last_ok`, `last_summary`, `open_issue` (`monitor_issues` where `key = 'agent.silent.'||slug` or `area = slug`, status open), `minutes_since`.
  - Pulse resolver is one `case` on `pulse->>'source'`: `pi_jobs`, `mac_agents`, `home_hub_agent_state`, `security_audit_runs`, `scout_daily_runs`, `turo_sender_settings`, `fix_ai_jobs`, `car_watch`, `db_watch_state`, `freellm_watch_state`, `admin_chat_messages`, `cron` (`cron.job_run_details` by jobname, last `succeeded`), `beat` (`agent_beats`). Inspect each table's columns before writing the branch.
  - Health: **green** = seen within `max_gap_min` and last ok · **yellow** = seen but last run failed, or between 1× and 2× gap · **red** = older than 2× gap, or open `agent.silent` issue · **grey** = no pulse configured / no data yet · **paused** = status paused/planned.
- **`admin_agent_set(p_slug, p_patch jsonb)`** — admin only; edits name/role/what_it_does/dept/reports_to/status/admin_url/sort/private. Rejects cycles in `reports_to`.

### Discovery — `org_chart_discover()` (cron `org-chart-discover`, nightly 3:17 AM PT)
Reads `pi_jobs.job`, `cron.job.jobname`, `home_hub_agent_state.agent`, `mac_agents.name`. Anything not referenced by any `pulse` → insert `status='new'`, `dept='unassigned'`, `what_it_does` from the source's description if it has one. The page shows these as **"New hire — place me"**.

---

## 3. Watchdog (self-healing, connected to Scout) — required

1. **`org_chart_watch()`** — cron `org-chart-watch`, every 10 min at `:07`. For each active agent with a pulse:
   - red → upsert `monitor_issues` key `agent.silent.<slug>`, area `<slug>`, severity `high` if `pulse.critical` else `medium`, body in plain words ("Link Sender hasn't checked in since 2:40 PM — new guests won't get their link"), `claude_prompt` with where it runs + how to restart it. **Fix Ladder and Scout take it from there** — no new alert channel.
   - back to green → resolve the issue with `fix_note = 'came back on its own'`.
   - writes `org_chart_watch_state(checked_at, red_count)`.
2. **Self-heal playbook** entries in the Fix Ladder for the easy ones (auto rung): Pi job silent → `home_hub_commands` `systemd.restart` for that unit; Mac launchd silent → queue a pre-approved `launchctl kickstart -k` mac job. Only for units already on an allow-list; everything else climbs to Scout.
3. **Watching the watcher:** new Pi job `org_watch_ping` (pi_jobs, every 15 min, `max_gap_min` 45): if `org_chart_watch_state.checked_at` is older than 30 min, it calls `org_chart_watch()` itself (recovery) and pushes via `notify_route` + Scout. It gets its own card on the chart under Ops.
4. Mute guard: `status in ('paused','planned','retired')` never alerts. Dedupe through `monitor_issues` key; no push storms.

---

## 4. The page — `src/pages/admin/Team.tsx`

**Route:** `<Route path="team" element={<Team />} />` in `App.tsx`. **Sidebar:** `{ title: "Team", url: "/admin/team", icon: Network }` in the main group after Partners, with a red count badge = agents in red (new `countKey: "teamRed"`).

**Layout (desktop):**
- Summary strip: **"32 on the team · 29 working · 2 need you · 1 new hire · 2 open roles"**. Each phrase filters the chart.
- Tree: Jared card → Scout card → Scout's team row; beside it the department columns (Ops, Studio, Turo, Sales, Mail, Home), each headed by its head card. Thin connector lines (SVG, theme tokens). Horizontal scroll inside the chart only — never the page.
- **Phone:** stacked, one collapsible group per department; groups with a red bot open first.

**Card:** icon in a tinted circle (Scout = animated binoculars mark), **name**, role, one line of what it does, status dot + "Last ran 3:05 PM" / "Quiet since Yesterday 11:40 PM", runs-on chip (Pi / Mac mini / Cloud / Claude). Open roles = dashed outline, "Open role". New hires = yellow "Place me" chip.

**Tap a card → sheet:** what it does, schedule, where it runs, last summary, open issue (with the existing `FixLadder` component inline), buttons **Open its page** (`admin_url`), **Ask Scout about it** (opens Scout prefilled: "What's going on with <name>?"), **Edit** (inline fields → `admin_agent_set`), **Pause / Resume** (status only; does not stop the bot — label says so).

**Data:** `useQuery(['org-chart'], admin_org_chart)`, refetch every 60 s and on window focus; keep previous data while refetching (admin must never blank or lose place). Realtime not needed.

**Copy:** all role lines in plain words, no jargon ("Lookout", not "Synthetic monitor").

---

## 5. Scout knows the team (phase 3)
Add `org_chart` to Scout's (`admin-chat`) context: compact roster (slug, name, role, health, last_seen) so "who sends the Turo links?" or "is anything down?" answers from the chart. Read-only tool; edits still go through Jared's tap.

---

## 6. Build order (check each box with evidence)

1. ☐ Read `bestly_memory` (house/*), reconcile roster with live tables (§1 note).
2. ☐ Migration: tables, RPCs, seed, crons `org-chart-watch` + `org-chart-discover`. Regenerate `types.ts`.
3. ☐ Verify SQL: `select slug, health from admin_org_chart()` as admin — every pulse-backed bot non-grey; grey list = only `agent_beat` bots not wired yet.
4. ☐ Wire `agent_beat` into: Pi (voice, wall server, wall watchdog, home-narrator, ha-todo-sync, tesla worker), Mac (meetingrec agent, clips) — via `home_hub_commands`/`mac_jobs`, backups first; and append one line to the prompts of the Claude scheduled tasks (Rewriter, RoofGuard Outreach, SkyTouch Triage): call `agent_beat('<slug>', true, '<one-line result>')` at the end.
5. ☐ `Team.tsx` + route + sidebar + badge. HIG pass, dark mode, phone width (16 px gutters, no page scroll), number/unit nowrap, 12-hour times.
6. ☐ Pi job `org_watch_ping`; self-heal allow-list in Fix Ladder.
7. ☐ Fire drill: disable `pi_jobs.transcode` heartbeat for a cycle → card goes red within 10 min → `monitor_issues agent.silent.transcode` opens → re-enable → auto-resolves. Stop `org-chart-watch` cron → Pi ping restores it within 30 min.
8. ☐ Scout context (§5).
9. ☐ Push to `main`, confirm Vercel deploy, open `/admin/team` on phone + desktop, screenshot both.
10. ☐ Write `bestly_memory` `house/admin/org-chart` (what's live, how to add a bot: one `agent_beat` call).

## 7. Decisions still open (defaults used until Jared says otherwise)

| Question | Default |
|---|---|
| Should Eli / partners appear as people on the chart? | No — Jared is the only human. |
| Fun avatars for each bot (like Scout's binoculars)? | Lucide icons in tinted circles now; avatars later. |
| Page name | "Team" at `/admin/team`. |
| Show private bots (SkyTouch) | Yes in admin (Jared-only); never in the partner portal. |

## 8. Adding a new bot later (the whole recipe)
Have it call `agent_beat('<new-slug>', true, '<what it did>')` once. It appears as a "Place me" card; tap → set department and role. Done — the watchdog covers it from then on.
