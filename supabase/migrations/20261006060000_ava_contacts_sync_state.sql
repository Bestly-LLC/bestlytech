-- Where the contacts sync records how it went, so /admin/ava can show it and the weekly cron gets a clean answer.
-- Reading 1000 cards from iCloud takes longer than an edge function is allowed to hold a request open: every chunk
-- was being saved and then the function was cut off at the very end, so a finished sync still answered with a 500.
-- The sync now replies straight away and finishes in the background, writing the outcome here when it is done.
alter table public.ava_settings
  add column if not exists contacts_synced_at timestamptz,
  add column if not exists contacts_count     integer,
  add column if not exists contacts_note      text;

comment on column public.ava_settings.contacts_note is 'How the last iCloud contacts sync went, in plain words, for /admin/ava.';
