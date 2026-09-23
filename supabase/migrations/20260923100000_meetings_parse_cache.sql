-- The meetings list took ~15 seconds, which read as "all my past meetings are gone"
-- because the page sat on its loading screen that whole time.
--
-- Nothing was wrong with the archive: listing it downloaded and parsed EVERY transcript
-- from Nextcloud on every load - 11 meetings at ~85KB each, about a megabyte of text,
-- just to show a list of dates and speaker chips. That cost grows with every meeting.
--
-- A transcript never changes once written, so parsing it twice is waste. This caches the
-- parsed result per file, keyed by name and size: same name and size means the same bytes.
-- Measured: 14.5s -> 7.9s. The rest is the eleven WebDAV PROPFINDs (one per day folder),
-- which a Depth:infinity listing would collapse into one.
create table if not exists public.meetings_parse_cache (
  file_name  text primary key,
  size_bytes bigint not null,
  parsed     jsonb  not null,
  cached_at  timestamptz not null default now()
);

comment on table public.meetings_parse_cache is
  'Parsed transcript metadata for meetings-archive, keyed by Nextcloud file name. size_bytes is the validity check: a transcript that changed length is re-parsed. Safe to truncate - it rebuilds on the next list.';

alter table public.meetings_parse_cache enable row level security;
-- Written and read only by the edge function on the service role; no browser access.
revoke all on public.meetings_parse_cache from anon, authenticated;
