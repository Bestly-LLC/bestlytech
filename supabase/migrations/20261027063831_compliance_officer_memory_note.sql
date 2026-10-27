-- Memory note for Vera's Compliance Officer build (applied through the Supabase MCP on 2026-10-26; this file matches it).
insert into public.bestly_memory (area, key, title, body, kind, tags, source, pinned, active, written_by)
select 'team', 'team/vera-compliance-officer-2026-10-26', 'Vera is now the Compliance Officer (built 2026-10-26)',
$b$Jared asked for a free AI employee that keeps every platform, app, website and product within the law, and chose to expand Vera (the Privacy Clerk, slug privacy-clerk). Planned by Opus from the Oct 26 legal-compliance audit, built by Sonnet. Full write-up: docs/compliance-officer-opusplan.md.

What runs: compliance_daily on the Pi at 6:20 AM PT (about 72 checks: rendered live pages for promises and banned claims, third-party hosts and cookies, privacy-policy parity, ElevenLabs agent settings for Maya/Leo/Reese/Ava, read-only data rules, the deadline reminders) and compliance_weekly Mondays 6:40 AM PT (domain expiry, App Store version change, and a law watch over 19 regulator/platform pages judged by the free FreeLLM ladder). No paid AI, no new Worker routes.

Where: tables compliance_findings (125 rows: every FAIL/PARTIAL audit row plus VX-01, the public GitHub repo), compliance_checks (83), compliance_runs, compliance_deadlines (29), law_watch_sources (19), law_watch_items, compliance_context. Admin page: Admin, Security, Compliance tab. Pi code: scripts/pi-compliance/ in the repo, installed in /opt/bestly/cron/jobs and /opt/bestly/cron. Team card: Vera, Compliance Officer, reports to Ares (security-auditor); tools Privacy Desk and Law Watch.

Alerts: signed Vera, prefix compliance. (owner privacy-clerk), via notify_route. Only a certain payment due within 7 days interrupts; everything else waits for the 7 PM recap. A newly failing check raises once, then at 3, 6 and 9 days, never nightly. Uncertain deadlines (Statement of Information Oct 31, CDTFA Nov 2) go to the recap.

Off switch: touch /opt/bestly/cron/state/compliance.OFF (both jobs) or compliance_daily.OFF / compliance_weekly.OFF. Undo: remove the two crontab lines (backup /home/pi/crontab.before-compliance-2026-10-26); nothing is deleted. Findings in the areas other agents were fixing (Leo greeting, marketing-claim pages, bestly.tech/privacy, Minute News jobs) start as watching and close themselves after 3 clean days.

Lessons: the Pi's IPv6 route to Cloudflare black-holes, so compliance_common prefers IPv4; a slow Pi can return a half-drawn single-page app, so the browser helper waits for the text to settle and a thin page is re-rendered before a check is called failed.$b$,
'note', array['team','compliance','vera'], 'claude-code', false, true, 'Sonnet'
where not exists (select 1 from public.bestly_memory where area='team' and key='team/vera-compliance-officer-2026-10-26');
