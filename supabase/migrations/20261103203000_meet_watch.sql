-- Scout Notetaker joins Google Meet calls (2026-11-03). Already applied to the live project via SQL; this file records it.
-- DOWN (undo):
--   delete from pi_jobs where job = 'meet_watch';
--   update bestly_agents set what_it_does = 'Joins your Talk calls, records them, names who spoke, and writes the transcript.', schedule = 'always on' where slug = 'scout-notetaker';
--   drop table if exists meet_watch;
create table if not exists public.meet_watch (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  meet_code text not null,
  meet_url text not null,
  title text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  organizer text,
  guests text[] not null default '{}',
  source text not null default 'mail',
  source_mail_id uuid,
  google_event_id text,
  status text not null default 'scheduled',
  skip boolean not null default false,
  client_slug text,
  recording_name text,
  recording_id uuid,
  attempts int not null default 0,
  joined_at timestamptz,
  left_at timestamptz,
  last_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meet_watch_starts_idx on public.meet_watch (starts_at);
alter table public.meet_watch enable row level security;
create policy meet_watch_admin_read on public.meet_watch for select using (public.has_role(auth.uid(), 'admin'));
create or replace function public.meet_watch_touch() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger meet_watch_touch before update on public.meet_watch for each row execute function public.meet_watch_touch();
insert into public.pi_jobs (job, description, max_gap_min, enabled) values ('meet_watch', 'Scout Notetaker Google Meet watcher on the Mac mini (meetwatch.py)', 10, true) on conflict (job) do nothing;
update public.bestly_agents set what_it_does = 'Joins your Talk calls and your Google Meet calls (as a visible guest named Scout Notetaker (recording)), records them, names who spoke, and writes the transcript. Meet watcher: meetwatch.py on the Mac mini, table meet_watch, alerts recorder.meet.*.', schedule = 'always on (Talk: auto-record rooms; Meet: watches invites every 5 min, joins 1 min before start)' where slug = 'scout-notetaker';
