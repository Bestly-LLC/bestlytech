-- Admin freshness (2026-09-29): base pieces for the freshness sweep.
-- Plan: docs/admin-freshness-2026-09-29-opusplan.md
create extension if not exists pg_trgm with schema extensions;

-- 'expired' = aged out by the freshness sweep (not done, not dismissed by Jared); can be put back like any status.
alter table public.scout_daily drop constraint if exists scout_daily_status_check;
alter table public.scout_daily add constraint scout_daily_status_check
  check (status = any (array['open','done','snoozed','dismissed','handed','expired']));

create table if not exists public.admin_freshness_runs (
  id bigserial primary key,
  at timestamptz not null default now(),
  stats jsonb not null default '{}'::jsonb
);
alter table public.admin_freshness_runs enable row level security;
drop policy if exists admin_freshness_runs_admin_read on public.admin_freshness_runs;
create policy admin_freshness_runs_admin_read on public.admin_freshness_runs
  for select using (public.has_role(auth.uid(), 'admin'::app_role));
