-- Meeting recorder on the Mac mini, driven from Scout.
-- The browser never writes these tables directly: the meeting-recorder edge
-- function does, after checking either the admin JWT or the agent key.
-- (Applied to the live project 2026-09-21 via the Supabase MCP.)

create table if not exists public.meeting_recorder_state (
  id            int primary key default 1 check (id = 1),
  key_sha256    text,
  last_seen_at  timestamptz,
  version       text,
  status        text not null default 'offline',   -- offline | idle | recording | transcribing | error
  current_name  text,
  roster        text[] not null default '{}',
  started_at    timestamptz,
  stage         text,
  known_voices  text[] not null default '{}',
  info          jsonb not null default '{}'::jsonb,
  updated_at    timestamptz not null default now()
);
insert into public.meeting_recorder_state (id) values (1) on conflict do nothing;

create table if not exists public.meeting_recorder_commands (
  id            uuid primary key default gen_random_uuid(),
  action        text not null check (action in ('start','stop')),
  payload       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending' check (status in ('pending','claimed','done','failed','expired')),
  requested_by  text not null default 'admin',
  result        jsonb,
  error         text,
  created_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  completed_at  timestamptz
);
create index if not exists meeting_recorder_commands_pending on public.meeting_recorder_commands (created_at) where status = 'pending';

create table if not exists public.meeting_recordings (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  started_at    timestamptz,
  stopped_at    timestamptz,
  roster        text[] not null default '{}',
  speakers      jsonb not null default '{}'::jsonb,
  transcript    text,
  line_count    int,
  source        text not null default 'mac-mini',
  debriefed_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists meeting_recordings_recent on public.meeting_recordings (started_at desc);

alter table public.meeting_recorder_state    enable row level security;
alter table public.meeting_recorder_commands enable row level security;
alter table public.meeting_recordings        enable row level security;

create policy "Admins read recorder state"    on public.meeting_recorder_state    for select to authenticated using (has_role(auth.uid(), 'admin'::app_role));
create policy "Admins read recorder commands" on public.meeting_recorder_commands for select to authenticated using (has_role(auth.uid(), 'admin'::app_role));
create policy "Admins read recordings"        on public.meeting_recordings        for select to authenticated using (has_role(auth.uid(), 'admin'::app_role));

-- The key hash is the agent's credential; admins get the view without it.
create or replace view public.meeting_recorder_status
with (security_invoker = true) as
select status, current_name, roster, started_at, stage, known_voices, last_seen_at, version, info,
       round(extract(epoch from (now() - last_seen_at)))::int as seconds_since
from public.meeting_recorder_state where id = 1;

revoke all on public.meeting_recorder_state from anon, authenticated;
grant select (status, current_name, roster, started_at, stage, known_voices, last_seen_at, version, info, updated_at, id)
  on public.meeting_recorder_state to authenticated;
grant select on public.meeting_recorder_status to authenticated;
grant select on public.meeting_recorder_commands, public.meeting_recordings to authenticated;
