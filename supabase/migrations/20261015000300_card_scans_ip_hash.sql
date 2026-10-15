-- STEP 1 of 2 for closing the card_scan_log anon-writer finding. ADDITIVE ONLY: safe to apply at any time, changes no behaviour.
-- Apply this BEFORE deploying the card-scan edge function (the function writes this column). See 20261015000400 for step 2.
--
-- card_scans.ip_hash: peppered SHA-256 (first 32 hex chars) of the caller's IP, written by the card-scan edge function and
-- used ONLY for its per-IP rate limit (6 new rows / 10 min). The function nulls it again after an hour (opportunistic sweep,
-- about 1 in 20 writes), so it is not a lasting record of who scanned. No emails or phones, so no privacy_data_map row is
-- needed. card_scans_admin() lists columns explicitly, so this column is never shown in the admin.
-- The device_id index serves the function's 30-minute dedupe and per-device cap lookups.
--
-- UNDO:  drop index if exists public.card_scans_ip_recent, public.card_scans_device_recent;
--        alter table public.card_scans drop column if exists ip_hash;   (only after step 2 is undone and the function is gone)

alter table public.card_scans add column if not exists ip_hash text;
create index if not exists card_scans_ip_recent on public.card_scans (ip_hash, scanned_at desc) where ip_hash is not null;
create index if not exists card_scans_device_recent on public.card_scans (device_id, scanned_at desc) where device_id is not null;
