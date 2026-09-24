-- Key switch watchdog (2026-09-24): applied live via MCP as migration "keyswitch_watchdog".
-- Every hour (cron keyswitch-watchdog, :17) keyswitch_watchdog() proves the NEW API keys work end to end:
--   calendar-ics (reads SUPABASE_SECRET_KEYS) with a bad feed key -> 404
--   send-transactional-email (verify_jwt=true) with the sb_secret on apikey only -> 400
--   REST with the sb_secret -> 200
-- Results are judged on the next run; any miss -> scout_notify (push) with the fix.
-- Source of truth is the live function; see pg_get_functiondef('public.keyswitch_watchdog'::regproc).
create table if not exists public.keyswitch_probes (
  id bigserial primary key, created_at timestamptz default now(), probe text not null,
  request_id bigint not null, expect int not null, got int, ok boolean, checked_at timestamptz);
alter table public.keyswitch_probes enable row level security;
