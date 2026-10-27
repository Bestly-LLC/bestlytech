# Vera, the Compliance Officer — what was built (2026-10-26)

Jared asked for an AI employee, free to run, that keeps every Bestly platform, app, website and product within the law. He chose to expand Vera (the Privacy Clerk, slug `privacy-clerk`). Built from the Oct 26 legal-compliance audit (`websites`, `apps-products`, `agents-data`, `company-filings`, `verification`). Vera is not a lawyer: she checks, tracks and reminds. Items marked "lawyer" in the findings need one.

## What she does

- **Daily at about 6:20 AM PT** (`compliance_daily`, Pi cron): runs every daily check, free, no AI. Live pages are read through the Pi's Chrome (single-page apps render, a plain 200 proves nothing).
- **Mondays at about 6:40 AM PT** (`compliance_weekly`): weekly checks (domain expiry, App Store version changes), then the law watch. A free AI (the FreeLLM ladder) reads what changed on 19 regulator and platform pages (FTC, FCC, CPPA, CDTFA, FTB, California SOS, FinCEN, Apple, Chrome Web Store, FDA, India DPDP, Tesla) and says in plain words what it means for Bestly, using the business text in `compliance_context`.
- **Deadlines**: `compliance_deadlines` (filings, renewals, rule dates). Reminders at 30, 7 and 1 days.
- **Findings**: `compliance_findings` holds every FAIL or PARTIAL row from the audit. The areas other agents are fixing right now start as `watching`; when every check on one has passed for 3 days in a row, Vera marks it fixed. A fixed one whose check fails again reopens.

## Where things are

| What | Where |
|---|---|
| Tables | `compliance_findings`, `compliance_checks`, `compliance_runs`, `compliance_deadlines`, `law_watch_sources`, `law_watch_items`, `compliance_context` (admin read through `privacy_is_admin()`; written only by service-role functions; no personal data) |
| Functions | `compliance_check_report`, `compliance_law_report`, `compliance_deadline_tick`, `compliance_alert`, `compliance_run_sql` (read-only), `admin_compliance_overview` (the only one the admin page can call) |
| Migrations | `20261027054240_compliance_officer.sql` (data, functions), `20261027055945_compliance_officer_team.sql` (team card, tools, clerk-tick check) |
| Pi code | `scripts/pi-compliance/` in this repo, installed at `/opt/bestly/cron/jobs/compliance_{common,daily,weekly}.py` and `/opt/bestly/cron/compliance_browser.py`; `compliance_seed.py` + `seed.json` load the first rows |
| Admin page | Admin, Security, **Compliance** tab (`src/pages/admin/ComplianceTab.tsx`): open findings worst first, what is due soon, checks failing now, law changes, last run |
| Team | Vera's card is "Compliance Officer" (reports to Ares / security-auditor); tools "Privacy Desk" (the 10-minute data-request clerk) and "Law Watch". Team Watch raises "gone quiet" through the Fix Ladder; `pi_jobs_watch` pings Scout if a job misses its slot |
| Logs | `/home/pi/scripts/cron-logs/compliance_daily.log`, `compliance_weekly.log`; state in `/opt/bestly/cron/state/compliance*/` |

## Check kinds

`http_contains` and `http_absent` (rendered page text: a promise must be present, a banned claim must be absent, JS bundles searched for strings), `http_status`, `policy_fresh` (a "Last updated" date no older than a year), `page_hosts` (third-party hosts, cookies and storage a page sets before any consent click), `sql_zero` and `sql_true` (read-only queries through `compliance_run_sql`: for example no row older than its retention window), `elevenlabs` (Maya, Leo, Reese, Ava say they are AI and that calls are recorded; retention 1 to 90 days), `listing` (App Store version change), `domain_expiry` (RDAP), `deadline` (sends the due reminders).

Not automated, on purpose: USPTO trademark status and Chrome Web Store listing text (no stable free API; the law watch covers the rule pages), 10DLC / Telnyx registration state, Supabase Management API key checks, axe accessibility scans, and the dmca.copyright.gov agent directory (it blocks automated reads). They stay in the findings list as lawyer or Jared items.

## Alerts

All signed "Vera:", prefix `compliance.` (owned by `privacy-clerk` in `notification_owners`), sent through `notify_route`. Only the four interrupt kinds interrupt. A certain payment due within 7 days counts as money and interrupts; every other alert is held for the 7 PM recap. A check that newly fails raises once, then again at 3, 6 and 9 days, then stays quiet: no nightly nagging. A check that cannot run (page down, API error) is not a failure; three in a row raises one "could not run" note. Accepted-risk findings are recorded and never raised. `compliance_alert` scrubs wording that would trip the interrupt classifier so a routine note cannot interrupt by accident.

## Off switch

`touch /opt/bestly/cron/state/compliance.OFF` stops both jobs (or `compliance_daily.OFF`, `compliance_weekly.OFF` for one). `rm` the file to resume. To disable a single check: `update compliance_checks set active = false where id = '...'`. To disable a law source: `update law_watch_sources set active = false where id = '...'`.

## Undo

Remove the two crontab lines (the pre-change backup is `/home/pi/crontab.before-compliance-2026-10-26`) and `touch` the OFF file. Vera's card can be set back with `team_onboard` (her earlier role, pulse and schedule are saved in `bestly_agents.profile.before_roles`; her old pulse was `{"src":"at","table":"privacy_clerk_state","col":"last_tick_at","gap":30}`). Nothing is deleted by any of this; the tables can stay as history.

## Cost

Zero. No paid AI call anywhere in the jobs: checks are plain code, the law watch uses the FreeLLM ladder, ElevenLabs is read through the existing Vault key (read-only GETs), and no new Cloudflare Worker route was added.
