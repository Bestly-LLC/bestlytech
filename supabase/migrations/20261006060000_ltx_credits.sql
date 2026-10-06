-- AWS credit watchdog for the LTX Box (2026-10-05, Jared: "find out when that date is so we can use up all the credits
-- before then and have a watchdog"). Account opened 2026-03-27 03:44 UTC (root credential report); Free Tier credits
-- expire 12 months later. Lambda bestly-ltx-dispatch reports the balance hourly (ltx_report 'credits').
-- Applied in pieces through execute_sql; this file is the record.
alter table public.ltx_box add column if not exists credits_expire_at timestamptz default '2027-03-27 03:44:21+00';
alter table public.ltx_jobs add column if not exists cold boolean;
-- functions as applied: ltx_credit_state(), ltx_credit_watch(p_nudge), ltx_render_s(int), ltx_quote(int) (v3: fitted
-- render time + wake), ltx_today() (adds "Credit $X left, expires <date>"), ltx_claim() (sets cold).
-- Alerts (owned by LTX Box): ltx:credits-stale (no report 6 h), ltx:credits-low (< $15), ltx:credits-runout (runs out
-- before expiry), ltx:credits-expiring (last 30 days, > $5 would go unused). Weekly Monday 9 AM nudge in the bell when
-- more than $5 is on pace to expire unused, with videos-per-week needed to use it all.
select cron.schedule('ltx-credit-watch', '20 * * * *',
  $c$select public.ltx_credit_watch(extract(hour from now() at time zone 'America/Los_Angeles') = 9)$c$);
