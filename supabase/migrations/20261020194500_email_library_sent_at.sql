-- Email builder: exact sent time on each library email (2026-10-20).
--
-- The library showed "Sent to X · <time>" from updated_at, which moves on every later edit.
-- email-builder-send now stamps sent_at when Resend accepts the email, so "Send again"
-- moves it forward. The admin page strips sent_at on save, so only the send function writes it.
-- Old sent rows get their updated_at, the best time on record (builder sends were never logged:
-- the function wrote columns email_send_log does not have; fixed in the same commit).
-- Rollback: alter table public.email_library drop column sent_at;

alter table public.email_library add column if not exists sent_at timestamptz;

update public.email_library
   set sent_at = updated_at
 where status = 'sent' and sent_at is null;
