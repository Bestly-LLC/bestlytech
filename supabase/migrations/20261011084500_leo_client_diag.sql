-- What Leo's widget hit on a real device (CSP blocks, widget error text), written by trip-voice op "diag".
-- Exists because host devices are never tracked as guests, so the iPhone failure left no trace (2026-10-11).
create table if not exists public.leo_client_diag (
  id bigserial primary key,
  at timestamptz not null default now(),
  token text,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  ua text
);
alter table public.leo_client_diag enable row level security;
revoke all on public.leo_client_diag from anon, authenticated;
create index if not exists leo_client_diag_at on public.leo_client_diag (at desc);
select cron.schedule('leo-client-diag-trim', '11 4 * * *', $c$delete from public.leo_client_diag where at < now() - interval '7 days'$c$);
