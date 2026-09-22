-- Scout works for Jared every day: Today's 3 (9am), drafted replies (6am),
-- call commitments -> Deck cards (when a transcript lands), and a 6pm wrap.
-- Everything Scout prepares is one row here; the /admin home page renders it.

create table if not exists public.scout_daily (
  id uuid primary key default gen_random_uuid(),
  day date not null default (now() at time zone 'America/Los_Angeles')::date,
  kind text not null check (kind in ('pick', 'draft', 'call', 'wrap')),
  slot text check (slot in ('decision', 'quick', 'focus')),
  title text not null,
  why text,
  body text,
  url text,
  action jsonb not null default '{}'::jsonb,
  source_key text not null,
  status text not null default 'open' check (status in ('open', 'done', 'snoozed', 'dismissed', 'handed')),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  unique (day, kind, source_key)
);
create index if not exists scout_daily_day_idx on public.scout_daily (day desc, kind);
create index if not exists scout_daily_open_idx on public.scout_daily (kind, status) where status = 'open';

alter table public.scout_daily enable row level security;
drop policy if exists scout_daily_admin_read on public.scout_daily;
create policy scout_daily_admin_read on public.scout_daily for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- One run per day per job (morning / drafts / wrap), so the hourly tick is idempotent.
create table if not exists public.scout_daily_runs (
  day date not null,
  job text not null,
  ran_at timestamptz not null default now(),
  result jsonb,
  primary key (day, job)
);
alter table public.scout_daily_runs enable row level security;
drop policy if exists scout_daily_runs_admin_read on public.scout_daily_runs;
create policy scout_daily_runs_admin_read on public.scout_daily_runs for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Calls: remember when commitments were pulled out, and keep the short summary.
alter table public.meeting_recordings add column if not exists tasks_at timestamptz;
alter table public.meeting_recordings add column if not exists summary jsonb;

-- The browser changes a row's status only through this.
create or replace function public.scout_daily_set(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.scout_daily;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_status not in ('open', 'done', 'snoozed', 'dismissed', 'handed') then raise exception 'bad status'; end if;
  update public.scout_daily
     set status = p_status, done_at = case when p_status = 'open' then null else now() end
   where id = p_id returning * into r;
  if r.id is null then raise exception 'not found'; end if;
  -- Snoozed picks come back tomorrow as open picks.
  if p_status = 'snoozed' and r.kind = 'pick' then
    insert into public.scout_daily (day, kind, slot, title, why, body, url, action, source_key)
    values (r.day + 1, r.kind, r.slot, r.title, r.why, r.body, r.url, r.action || jsonb_build_object('snoozed_from', r.day), r.source_key)
    on conflict (day, kind, source_key) do nothing;
  end if;
  return to_jsonb(r);
end $$;
revoke all on function public.scout_daily_set(uuid, text) from public, anon;
grant execute on function public.scout_daily_set(uuid, text) to authenticated;

-- A finished transcript kicks off the call -> Deck cards job.
create or replace function public.trg_meeting_tasks()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tasks_at is null and length(coalesce(new.transcript, '')) > 400
     and (tg_op = 'INSERT' or coalesce(old.transcript, '') is distinct from coalesce(new.transcript, '')) then
    perform public.invoke_edge_function('scout-daily', jsonb_build_object('op', 'call', 'id', new.id), 150000);
  end if;
  return new;
end $$;
drop trigger if exists meeting_tasks on public.meeting_recordings;
create trigger meeting_tasks after insert or update of transcript on public.meeting_recordings
  for each row execute function public.trg_meeting_tasks();

-- Hourly tick; the function decides by Los Angeles local time (6 drafts, 9 picks, 18 wrap),
-- so daylight saving needs no cron edits. It replaces the old 9am digest.
do $$ begin
  perform cron.unschedule('scout-digest');
exception when others then null; end $$;
do $$ begin
  perform cron.unschedule('scout-daily-tick');
exception when others then null; end $$;
select cron.schedule('scout-daily-tick', '2 * * * *',
  $$select public.invoke_edge_function('scout-daily', '{"op":"tick"}'::jsonb, 150000)$$);
