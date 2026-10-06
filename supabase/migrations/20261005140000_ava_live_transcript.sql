-- Live transcript, recorded by a cron job instead of by Ava (Jared, 2026-10-05:
-- "I still want that... a cron job or something else manages it so it doesn't provide any lag to her on a call").
--
-- Why there is no lag: nothing here sits in Ava's audio path. Her calls run PSTN -> Telnyx -> ElevenLabs and this never
-- touches that. A watcher reads the voice platform's own record of the conversation from the outside and writes each new
-- line into our tables. If the watcher stalls or is deleted, her calls carry on exactly the same.
--
--   ava_live_watch   one row per call we are following, plus the poll stats
--   ava_live_turns   the words, one row per spoken turn, append-only (Realtime pushes these to the admin page)
--   ava_live_tick()  the cheap gate: when no call is up, this does nothing but one index lookup, so the idle cost is ~0
--                    (10 seconds, not 5: the schedule itself is logged by the database, and a 5-second job writes
--                     17k log rows a day and competes for background workers with the 164 jobs already here)
--
-- Open question this answers in data: on the Creator plan the platform's live-monitoring websocket is Enterprise-gated,
-- so polling is the only road, and the docs never say whether polling returns partial turns mid-call.
-- ava_live_watch.mid_call_partial records the truth on the next real call. If it comes back false, we need ElevenLabs to
-- turn on the realtime-monitoring flag; the transcript still lands the moment each call ends either way.

create table if not exists public.ava_live_watch (
  conversation_id   text primary key,
  source            text not null check (source in ('ava', 'roofguard')),
  call_id           uuid,
  phone             text,
  direction         text,
  status            text,
  duration_sec      int,
  polls             int not null default 0,
  turns_seen        int not null default 0,
  mid_call_partial  boolean,         -- true = the platform gave us words WHILE the call was still live
  first_turn_seen_at timestamptz,
  last_poll_at      timestamptz,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz
);
create index if not exists ava_live_watch_open on public.ava_live_watch (started_at desc) where ended_at is null;

create table if not exists public.ava_live_turns (
  conversation_id text not null,
  seq             int  not null,
  source          text not null,
  role            text not null check (role in ('agent', 'user')),
  text            text not null,
  at_secs         int,
  interrupted     boolean not null default false,
  first_seen_at   timestamptz not null default now(),
  primary key (conversation_id, seq)
);
create index if not exists ava_live_turns_recent on public.ava_live_turns (first_seen_at desc);

alter table public.ava_live_watch enable row level security;
alter table public.ava_live_turns enable row level security;
create policy "admin ava_live_watch" on public.ava_live_watch for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
create policy "admin ava_live_turns" on public.ava_live_turns for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
grant select on public.ava_live_watch, public.ava_live_turns to authenticated;

-- the admin page subscribes to the words instead of polling the voice platform from the browser
do $$ begin
  alter publication supabase_realtime add table public.ava_live_turns;
exception when duplicate_object then null; when undefined_object then null; end $$;

-- ------------------------------------------------------------------ register a call the moment it is placed
-- Outbound and demo calls get a watch with no polling needed to find them. Inbound is found by the discover pass.
create or replace function public.ava_live_register(p_source text, p_conversation_id text, p_call_id uuid, p_phone text, p_direction text default 'outbound')
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_conversation_id is null or p_conversation_id = '' then return; end if;
  insert into ava_live_watch (conversation_id, source, call_id, phone, direction, status)
  values (p_conversation_id, p_source, p_call_id, p_phone, coalesce(p_direction, 'outbound'), 'initiated')
  on conflict (conversation_id) do update set call_id = coalesce(excluded.call_id, ava_live_watch.call_id),
    phone = coalesce(excluded.phone, ava_live_watch.phone);
exception when others then
  raise warning 'ava_live_register failed: %', sqlerrm;   -- watching must never break a call
end $function$;

create or replace function public.rg_calls_live_register_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.conversation_id is not null and (tg_op = 'INSERT' or old.conversation_id is distinct from new.conversation_id) then
    perform ava_live_register('roofguard', new.conversation_id, new.id, new.to_number, coalesce(new.direction, 'outbound'));
  end if;
  return new;
end $function$;
create trigger rg_calls_live_register after insert or update of conversation_id on public.rg_calls
  for each row execute function public.rg_calls_live_register_trg();

create or replace function public.ava_calls_live_register_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.conversation_id is not null and (tg_op = 'INSERT' or old.conversation_id is distinct from new.conversation_id) then
    perform ava_live_register('ava', new.conversation_id, new.id, new.phone, coalesce(new.direction, 'inbound'));
  end if;
  return new;
end $function$;
create trigger ava_calls_live_register after insert or update of conversation_id on public.ava_calls
  for each row execute function public.ava_calls_live_register_trg();

-- ------------------------------------------------------------------ the gate: costs nothing when no one is on the phone
create or replace function public.ava_live_tick() returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_open int;
begin
  select count(*) into v_open from ava_live_watch where ended_at is null and started_at > now() - interval '15 minutes';
  if v_open = 0 then return; end if;          -- idle: one index lookup, no edge function, no API call, no cost
  perform invoke_edge_function('ava-live-watch', '{"action":"tick"}'::jsonb, 15000);
end $function$;

-- stop following a call that nothing closed (a crash mid-call), so the fast lane can go quiet again
create or replace function public.ava_live_sweep() returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  update ava_live_watch set ended_at = now(), status = coalesce(status, 'abandoned')
   where ended_at is null and started_at < now() - interval '15 minutes';
  -- NOTE (2026-10-05): the 30-day cleanup of ava_live_turns lives in the ava-live-watch edge function's discover pass
  -- instead of here, and the cron.job_run_details trim was dropped: the session that applied this could not run DELETE
  -- statements. Watch cron.job_run_details for growth from the 10-second tick; Supabase trims it on its own, but if it
  -- does grow, add a nightly trim rather than putting it back in this minute-by-minute job.
  perform invoke_edge_function('ava-live-watch', '{"action":"discover"}'::jsonb, 20000);
end $function$;

-- fast lane: every 10 seconds, but only does work while a call is actually up
select cron.schedule('ava-live-tick', '10 seconds', $$select public.ava_live_tick()$$);
-- slow lane: finds a call ringing in, and closes anything left open. Once a minute, not every 30 seconds: an incoming
-- call has no row of its own until it ends, so this is the only way to spot one, and a minute's wait to START showing
-- an incoming call is fine when the call itself runs for minutes. Outbound calls never wait: their trigger registers them.
select cron.schedule('ava-live-sweep', '* * * * *', $$select public.ava_live_sweep()$$);

-- ------------------------------------------------------------------ watchdog (Jared's standing rule: everything gets one)
create or replace function public.ava_live_health() returns void language plpgsql security definer set search_path to 'public'
as $function$
declare v_calls int; v_withwords int; v_partial int; v_stuck int;
begin
  select count(*), count(*) filter (where turns_seen > 0), count(*) filter (where mid_call_partial)
    into v_calls, v_withwords, v_partial
    from ava_live_watch where started_at > now() - interval '24 hours' and ended_at is not null;

  select count(*) into v_stuck from ava_live_watch
   where ended_at is null and started_at < now() - interval '15 minutes';
  if v_stuck > 0 then
    perform scout_notify('Live Desk: ' || v_stuck || ' call watch stuck open',
      'Cleared them. If this repeats, the live transcript poller needs a look.', 'medium', false,
      'https://bestly.tech/admin/roofguard', 'ava-live-stuck-' || to_char(now(), 'YYYYMMDDHH24'));
  end if;

  -- the finding Jared is waiting on, reported once a day until it is settled
  if v_calls >= 1 and v_partial = 0 and v_withwords > 0 then
    perform scout_notify('Live Desk: words only arrive after the call ends',
      v_calls || ' calls in 24 hours, all transcripts landed at hang-up, none mid-call. The voice platform''s live feed is ' ||
      'Enterprise-gated on our plan: ask ElevenLabs support to switch on the realtime-monitoring flag for the workspace.',
      'medium', false, 'https://bestly.tech/admin/roofguard', 'ava-live-nopartial-' || to_char(now(), 'YYYYMMDD'));
  elsif v_partial > 0 then
    perform scout_notify('Live Desk: live words are working',
      v_partial || ' of ' || v_calls || ' calls showed the transcript while the call was still going.',
      'info', false, 'https://bestly.tech/admin/roofguard', 'ava-live-partial-ok-' || to_char(now(), 'YYYYMMDD'));
  end if;
end $function$;
select cron.schedule('ava-live-health', '23 14 * * *', $$select public.ava_live_health()$$);

-- ------------------------------------------------------------------ team card (CLAUDE.md: a card the day it goes live)
select public.team_onboard($j$[
 {"slug":"ava-live-desk","name":"Live Desk","role":"Live call transcript","tool_of":"roofguard-caller","runs_on":"cloud","icon":"captions",
  "schedule":"every 10 seconds while a call is up",
  "what_it_does":"Writes down what is said on a call while it is happening, for both Avas, by reading the voice platform from the outside. Never sits in Ava's audio path, so it cannot slow her replies. Goes quiet and costs nothing when nobody is on the phone.",
  "pulse":{"src":"cron","job":"ava-live-tick","also":["ava-live-sweep","ava-live-health"],"gap":5},
  "owns":["ava-live"]}
]$j$::jsonb);
