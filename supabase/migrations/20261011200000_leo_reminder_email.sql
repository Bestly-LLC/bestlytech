-- Leo can collect a guest's email by voice and send the pickup reminder (Jared, 2026-10-11).
-- trip-voice ?tool=reminder_email {action: set | send_now | status} saves the email through lax_guest_set_email
-- (same rules as the trip page: 6 changes, reminder time, no ended trips) and sends through the existing senders
-- (wallet-pass remind_due for LAX, trip-remind for home). This table is the audit + rate limit: max 2 send_now per trip
-- per rolling 24 hours. It holds NO email addresses (only the trip token, what Leo did, and the call id).
create table if not exists public.leo_reminder_log (
  id bigserial primary key,
  token text not null,
  action text not null,
  conversation_id text,
  at timestamptz not null default now()
);
create index if not exists leo_reminder_log_token_at on public.leo_reminder_log (token, action, at desc);
alter table public.leo_reminder_log enable row level security;
revoke all on public.leo_reminder_log from anon, authenticated;
grant all on public.leo_reminder_log to service_role;
grant usage, select on sequence public.leo_reminder_log_id_seq to service_role;
