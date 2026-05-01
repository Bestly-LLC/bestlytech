# RETIRED 2026-05-01

This Lovable project (Supabase ref `keowunrxpxlbgebujbao`) has been retired.

**Successor:** Supabase project `rcqfqhguwpmaarseifqg`, managed via the
[bestlytech](https://github.com/Bestly-LLC/bestlytech) repo and a Claude/Cowork agent.

## What was done on 2026-05-01

- All `pg_cron` jobs unscheduled (AI generation, system health, retries, maintenance,
  dismissal consensus, monthly reset, email queue dispatcher).
- All outbound edge functions replaced with kill-switch stubs that respond
  `200 {"status":"retired","forwarded_to":"rcqfqhguwpmaarseifqg"}`.
- No tables dropped, no data deleted, no secrets removed.

## Do not deploy changes here.

See `docs/agent-runbook.pdf` in the new repo for the current operating model.