-- Number matching for QR sign-ins: the new browser shows a 2-digit number, and a
-- scan-to-approve must type that number, so a forwarded link can't be approved blind.
alter table public.admin_device_logins add column if not exists match_num smallint;
