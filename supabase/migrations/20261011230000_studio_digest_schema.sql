-- 2026-10-11 Studio notification digests, part 1: settings, log, kinds.
-- Jared: Studio exists to avoid email back-and-forth, so condense. One email a day per client (only when
-- something waits on her), one digest a day per staff member, one Talk roll-up an hour in the team room.
--
-- How: nothing is deleted and no trigger that WRITES a notification is edited. Two new BEFORE INSERT
-- triggers (they sort last by name) park per-item rows instead of letting the drain send them:
--   notify_outbox: audience client/staff with an address -> hold_until = 'infinity', payload.digest = true,
--                  sent_at stays null. notify_outbox_take already skips hold_until > now().
--   talk_outbox:   audience team, kind 'review' -> payload.rollup = true; talk_outbox_take skips them.
-- Part 2 (20261011231000, studio_digest_* functions) composes ONE row from the parked ones and marks them done.
-- Undo: see bestly_memory studio/notification-digests (drop the two triggers; parked rows are releasable).

-- ---------------------------------------------------------------- settings + log
create table if not exists public.studio_digest_settings (
  id                  boolean primary key default true check (id),
  enabled             boolean not null default true,
  staff_tz            text    not null default 'America/Los_Angeles',
  staff_time          time    not null default '18:45',
  client_default_tz   text    not null default 'America/Los_Angeles',
  client_time         time    not null default '08:45',
  client_window_hours integer not null default 5,     -- retry window after the target time
  client_repeat_days  integer not null default 3,     -- still-waiting-but-nothing-new reminder gap
  talk_from_hour      integer not null default 7,     -- team-room roll-up posts between these local hours
  talk_to_hour        integer not null default 22,
  updated_at          timestamptz not null default now()
);
insert into public.studio_digest_settings (id) values (true) on conflict do nothing;
alter table public.studio_digest_settings enable row level security;
revoke all on public.studio_digest_settings from anon, authenticated;

create table if not exists public.studio_digest_log (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('staff','client')),
  subject_id uuid not null,
  day        date not null,                 -- the recipient's local date
  status     text not null,                 -- sent | skipped | error | baseline
  detail     text,
  held       integer not null default 0,    -- parked rows folded into this one
  outbox_id  uuid,
  retries    integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at    timestamptz,
  unique (kind, subject_id, day)
);
alter table public.studio_digest_log enable row level security;
revoke all on public.studio_digest_log from anon, authenticated;

-- a client's own timezone; null = the default in studio_digest_settings (no tz was stored anywhere before)
alter table public.approval_clients add column if not exists tz text;

-- the two new kinds the outbox may carry
insert into public.notify_kinds (kind, what) values
  ('staff_digest',  'The one daily Studio digest email a producer gets'),
  ('client_digest', 'The one daily email a client gets, only when something is waiting on her')
on conflict (kind) do nothing;

-- digests are never "errors" (the subject-word guess in notify_is_error must not catch them)
create or replace function public.notify_is_error(o notify_outbox)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  select case
    when o.kind in ('decision','recording','client_ask','client_posts','signoff','todo_handoff','preview',
                    'staff_digest','client_digest') then false
    when o.kind in ('drift','mail_gap') then true
    when o.kind = 'engine' then
      coalesce(o.subject,'') ~* '(nothing_fits|error|fail)'
      or coalesce((o.payload->>'status') ~ '^[0-9]+$' and (o.payload->>'status')::int >= 400, false)
    else coalesce(o.subject,'') ~* '\m(error|errored|failed|failing|broken|not serving|not responding|stuck|crash(ed)?)\M'
  end;
$function$;

