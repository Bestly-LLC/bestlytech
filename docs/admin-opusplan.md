# /admin Command Center — Audit + Opusplan

**Date:** 2026-04-30
**Author:** Claude (Opus 4.7)
**Branch target:** `main` via short-lived `fix/admin-*` branches

---

## TL;DR — what's actually wrong

The dashboard *looks* healthy. It isn't. Three classes of problem stack on top of each other:

1. **Health-monitor lies.** SystemPulse reads four columns (`ai_pipeline_ok`, `reports_ok`, `patterns_ok`, `maintenance_ok`) that **don't exist in the schema**. The check-system-health v9 edge function never writes them. They render as undefined; the banner stays green because `is_down=false`.
2. **AI fixer isn't fixing anything.** Cron runs every 6h. In the past 7 days the only statuses recorded are `skipped_no_html` (17), `no_candidates` (11), `permanently_failed` (1). **Zero successes.** `pattern_fix_log` shows 59 entries, all `Cron heartbeat`. The pipeline is alive but inert.
3. **Down services aren't bestly.tech.** `cookieyeti.com` (TLS handshake stalls on DreamHost), `hoascope.com` (TCP timeout), `app.hoascope.com` (NXDOMAIN) are all third-party-hosted marketing/app sites — separate from the Supabase backend the extension uses. The admin should *show* this, but currently has no probe for external surfaces at all.

Plus a layer of cruft: 5 stale `.claude/worktrees/`, a `feature/admin-ui-overhaul` branch, and 5 `dist-v*/` directories sitting in the repo root.

---

## Live diagnostic snapshot (2026-05-01 00:15 UTC)

| Surface | State | Notes |
|---|---|---|
| `bestly.tech` | 200 | OK |
| `bestly.tech/admin` | 200 | OK |
| `cloud.bestly.tech` | 200 | OK (proxied via CF → 104.21.53.151) |
| `cookieyeti.com` | TLS hang | DNS → DreamHost 173.236.254.55, handshake never completes |
| `hoascope.com` | TCP timeout | DNS → Namecheap 162.255.119.152, server unresponsive |
| `app.hoascope.com` | NXDOMAIN | subdomain CNAME missing |
| `status.bestly.tech` | NXDOMAIN | no public status page exists |

| Cron job | Schedule | Last run | Last success | Fails 24h |
|---|---|---|---|---|
| ai-generate-patterns | every 6h :30 | 18:30 UTC | 18:30 | 0 |
| auto-retry-failed-patterns | 06,18 UTC | 18:00 | 18:00 | 0 |
| check-system-health | every 15min | 00:15 | 00:15 | 0 |
| pattern-maintenance | every 3h | 00:00 | 00:00 | 0 |
| reset-failed-domains | weekly Sun 05 | Apr 26 | Apr 26 | 0 |

**All 8 cron jobs are firing.** The schedule is healthy. The *outcomes* are not.

| AI generator outcomes (7d) | Count |
|---|---|
| skipped_no_html | 17 |
| no_candidates | 11 |
| permanently_failed | 1 |
| **success** | **0** |

| Missed-banner queue | Count |
|---|---|
| Unresolved | 4 |
| Untried | 0 |
| In-flight (attempts 1–4) | 3 |
| Permanently failed (≥5) | 1 |

`system_alert_state` columns: `id, is_down, down_systems, last_checked, last_alert_sent, updated_at, pending_systems, pending_match_count, last_alerted_systems, last_alert_at`. **No subsystem boolean columns.**

---

## Phase 0 — Stop the bleeding (≤ 4 hours, ship today)

Goal: dashboard tells the truth. Nothing new yet — just unbreak what lies.

| # | Fix | Files | Why |
|---|---|---|---|
| P0-1 | Make SystemPulse read what's actually in the schema | `src/components/admin/SystemPulse.tsx` | Drop the 4 fake `*_ok` dots. Replace with real metrics: AI generator (last success age), Cron heartbeat (last `pattern-maintenance`), Stripe webhook (last `subscriptions` row), Edge function errors (24h count from logs). |
| P0-2 | Fix ActionInbox email column names | `src/components/admin/ActionInbox.tsx:108–115,191–193` | Currently queries `sent_at`, `recipient`, `error` — schema has `created_at`, `recipient_email`, `error_message`. Query silently errors and "Email failed" alerts never fire. |
| P0-3 | Add a "0 successful AI generations in N days" alert | `src/components/admin/SmartAlerts.tsx` | The new failure mode the operator actually has. Threshold: if `success_count_7d == 0 AND attempts_7d > 0` → critical alert. |
| P0-4 | Health check: distinguish "ran" from "succeeded" | `supabase/functions/check-system-health/index.ts` | v9 uses `max(created_at)` which lights up on any insert (including failures). Switch the `ai_generator` heartbeat to `max(created_at) WHERE status='success'`. |
| P0-5 | External-service probe row in SystemPulse | new component or extend SystemPulse | Add 5 dots: `cookieyeti.com`, `hoascope.com`, `app.hoascope.com`, `cloud.bestly.tech`, Supabase API. Probed by a new `external-uptime-probe` edge function on `*/5 * * * *`. Writes to a new `external_health` table. |
| P0-6 | Fix double-counted state in AdminDashboard | `src/pages/admin/AdminDashboard.tsx:110–111` | `userCount` and `passKeyCount` are both populated from the same `passkey_credentials` count query — wrong. Either pull `auth.users` count for `userCount` or remove the panel. |

**Ship as one PR:** `fix/admin-honest-status`. ~250 LOC.

---

## Phase 1 — Fix the broken (1–2 days)

### 1.1 The CY pipeline isn't producing successes — investigate

The 17 `skipped_no_html` outcomes mean the AI generator can't reach the page HTML for the candidate domains. Two likely causes:

- **Bot-protected domains.** Cloudflare/Akamai 403'ing the headless fetch. Need a fallback: extension-side capture (already partially built — `report-missed-banner` accepts an HTML payload). Audit whether reporters are sending HTML and we're discarding it.
- **The 11 `no_candidates`** mean the candidate-selection RPC returned empty even though there are 4 unresolved reports. Check `get_top_domains` RPC and the candidate filter logic for `ai_attempts < 5`. Probably a stale cutoff after the 04-28 pipeline-repair migration.

**Action:** read 5 latest `skipped_no_html` rows, look at `metadata.url` and `metadata.error`. Then either (a) fix the fetcher (probably needs `User-Agent` + retry-with-Lovable-proxy fallback) or (b) require reporter-side HTML capture.

### 1.2 Domain-down monitoring → automated remediation

Once the external probe exists (P0-5), wire it to the SmartAlerts queue and to a Twilio SMS for *new* downs (using the same hysteresis logic the v9 health check already has). Then bind a "Restart" / "Re-deploy" button per service:

- `cookieyeti.com`, `hoascope.com` → DreamHost has no API for "restart" — but we can ssh and `service apache2 restart` via a Cloudflare Worker exposed via signed-URL.
- `cloud.bestly.tech` → Lovable webhook to redeploy.
- `app.hoascope.com` → fix the missing CNAME at the registrar; doc this in a runbook.

The button doesn't need to be magical. It just needs to (1) tell the operator what's wrong, (2) link to the runbook, (3) where possible, fire the fix.

### 1.3 Worktree + branch + dist cleanup

```bash
# remove abandoned worktrees
for w in clever-hellman thirsty-pare bold-dijkstra priceless-cerf determined-margulis; do
  git worktree remove .claude/worktrees/$w --force
done

# delete stale dist outputs
rm -rf dist-v4 dist-v5 dist-v6 dist-v7 dist-v8

# update .gitignore
echo 'dist-v*' >> .gitignore

# delete stale feature branch
git push origin --delete feature/admin-ui-overhaul
git branch -D feature/admin-ui-overhaul
```

Saves ~50MB and stops the noise.

### 1.4 Replace dead "AI Fixer" sub-panel labels with reality

`OperationsPanel` exposes "Run Maintenance Now" and similar buttons. After P0 the labels should say what they *actually* do today, not the aspirational version. Audit each button → match label to behavior → fix or hide.

---

## Phase 2 — Polish the UX (2–3 days)

### 2.1 Apply the v7/v8 indigo design language to the admin

The admin is currently dark slate / white-alpha. The marketing site just got the indigo + Newsreader treatment. Bring the admin in line:
- Swap the white-alpha card backgrounds for the same `--wow-ink` + `hsl(var(--wow-indigo) / 0.04)` mesh used on `/services`.
- StatCard accent colors → indigo variants for the brand surfaces, keep semantic green/amber/red for status.
- PageHeader uses `font-display` (Newsreader) for the page title.
- Sidebar gets an active-route accent line in indigo, not the current cyan.

### 2.2 ActionInbox → first-class, top of page

It's already at the top. Make it the **only** thing visible above the fold on first load. Everything else (CookieYeti, Revenue, Operations) collapses into tabs. The user opened the admin because something needed them — show them that, not 24 stat cards.

### 2.3 One unified "Run Now" tray

Right now operators run maintenance via OperationsPanel buttons that hit individual edge functions. Consolidate into a single tray: **AI Generate · Auto-Retry · Pattern Maintenance · Reset Failed · External Probe**. Each button shows last-run time, success/failure, and a one-click rerun. Link to the function logs.

### 2.4 Dashboard "freshness" indicator

Every panel shows when its data was last loaded. Right now there's no visual cue — operators don't know if numbers are stale. Add `Last refreshed 2m ago · Auto-refresh: 60s` per panel.

### 2.5 Mobile

`/admin` on mobile right now: most StatCard grids overflow; tables are pure desktop. Either ship a mobile-card view for every table or hide the heaviest panels behind a "Show all" button on `<sm`.

---

## Phase 3 — New capabilities (week+)

These are the things the user said they wanted ("we have down services… AI fixer not running") that the current UI can't even *express* yet, much less fix.

### 3.1 Real status page at `status.bestly.tech`

Public-facing, read-only, shows the last 90 days of uptime per service. Pulls from the new `external_health` table populated by P0-5's probe function. Renders as static HTML on Vercel.

### 3.2 Self-healing playbooks

Each "down" alert in SmartAlerts gets a "Try fix" button. Behind it: a list of `playbook_steps` (table) — declarative steps like `redeploy_lovable`, `restart_dreamhost`, `purge_cloudflare`. Operator clicks one, edge function runs it, alert auto-closes if probe goes green within 5 min.

### 3.3 Real "AI fixer" — auto-merge successful patterns

Today, even when AI generates a pattern, it lands as `confidence=0` and waits for review. Build a confidence-promotion rule: if a pattern hits N successful dismissals across M devices in P days, auto-promote `confidence` and mark `is_active=true`. Add a "Recently auto-promoted" panel to CYDashboard.

### 3.4 Operator notifications dashboard

SMS goes to a single number today. Add a per-channel preferences table: SMS · Email · Slack · iCloud Push (we have device tokens already). Per-severity routing: critical → SMS+push, urgent → email, info → in-app only.

### 3.5 Audit log

Every "Run Now", "Grant Access", pattern edit, etc. → row in `admin_audit_log` (operator, action, target, before/after, ts). Surface it under `/admin/audit`. Useful for "who toggled this?" and for the eventual SOC2-lite case.

---

## Risk + sequencing

| Risk | Likelihood | Mitigation |
|---|---|---|
| P0-4 health-check change masks a real outage during rollout | low | deploy with `--shadow` mode that logs new vs old result for 24h before swapping |
| External probe writes too often | low | rate-limit at function level (15 min minimum) |
| Worktree cleanup deletes uncommitted work | medium | `git worktree list` first, audit each, only remove ones with no unpushed commits |
| Indigo retheme breaks ActivityFeed contrast | low | run a snapshot test against the current dark-mode admin before/after |

**Ship order:** P0 today (one PR) → P1 this week (3 PRs: pipeline fix, external probe, cleanup) → P2 next week → P3 incrementally as separate features.

---

## Open questions for the operator

1. The 4 unresolved missed-banner reports — want me to look at the actual domains and try them manually to figure out why the AI is skipping?
2. For external probes — OK to pay for a Better Stack/UptimeRobot tier and read its API, or build the probe from scratch in an edge function?
3. DreamHost migration — both `cookieyeti.com` and `hoascope.com` are dead on it right now. Worth moving to Vercel/Cloudflare Pages and retiring DreamHost entirely?
4. Should the new external-probe SMS go to the same `+1 (213) 927-9363` Twilio number, or a separate "infra" channel?
