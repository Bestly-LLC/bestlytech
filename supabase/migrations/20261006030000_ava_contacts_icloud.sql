-- Jared's iCloud address book syncs into ava_contacts so Ava knows who is calling (his ask, 2026-10-05).
-- Personal Ava only. RoofGuard's rg_leads are untouched.
--
-- Columns:
--   source        'manual' for the rows Jared wrote by hand (Mom, Eli). The sync NEVER overwrites those: their
--                 relationship and notes are read into her prompt and he tuned them.
--   apple_uid     the vCard UID, so a renamed contact updates instead of doubling up.
--   synced_at     last time iCloud confirmed this row. A row that stops appearing is kept, not deleted.
--   inner_circle  warm, no gatekeeping, urgent by default (the prompt reads this). Opt-in per person: importing a
--                 thousand contacts must not make a thousand people inner circle.
alter table public.ava_contacts
  add column if not exists source       text        not null default 'manual' check (source in ('manual', 'icloud')),
  add column if not exists apple_uid    text,
  add column if not exists synced_at    timestamptz,
  add column if not exists inner_circle boolean     not null default false;

create index if not exists ava_contacts_source on public.ava_contacts (source);
create index if not exists ava_contacts_inner  on public.ava_contacts (inner_circle) where inner_circle;

-- Mom is the first inner-circle contact (he picked Mom and his sister; his sister is not saved yet).
update public.ava_contacts set inner_circle = true where name = 'Mom';

comment on column public.ava_contacts.source is 'manual = Jared wrote it, icloud = synced. The sync only ever edits icloud rows.';
comment on column public.ava_contacts.inner_circle is 'Close family: Ava is warm, skips the gatekeeping, and marks their messages urgent by default.';
