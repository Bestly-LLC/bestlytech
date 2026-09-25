-- 2026-09-24 (applied live as scout_file_delivery_watch): scout_file_watchdog() also checks DELIVERY. A file
-- uploaded 3+ min ago whose name never appears in one of Jared's chat messages counts as undelivered; 2+ in
-- 2 hours raises ai.scoutfile.lost ("Scout files: attachments aren't reaching Scout"). Cron now every 10 min.
-- Full function body lives in the database (public.scout_file_watchdog).
select 1;
