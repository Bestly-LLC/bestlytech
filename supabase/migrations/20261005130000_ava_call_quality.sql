-- Call Quality: the missing third watcher for both Avas (Jared, 2026-10-05: "the partner-portal demo call was super choppy,
-- voice not clear. Do we need a tool or employee to watch this?").
-- Already watching: Reply guard (what she SAYS: code leaks) and Line Check (is the line UP).
-- Not watching until now: how a call SOUNDS. This is that, as plain SQL on the call transcript. No AI, no Claude, no cost.
--   slow_reply       2+ replies took over 3 s to start, or any over 6 s
--   chopped          she was cut off in 3+ of her turns after the opener (and 35%+ of them): bad timing or a bad line
--   off_chain_model  the call ran on a model that isn't in llm_fallbacks (the 2026-10-04 gemini-2.5-flash-lite mess)
--   caller_complaint the person on the phone said she was breaking up / robotic / choppy / echoing
-- Every call gets a row with the voice it ran on, so voices can be compared by data (ava_voice_quality view), not by ear.
-- A flagged call tells Scout; a daily digest says how she sounded yesterday and doubles as the card's heartbeat.

create table if not exists public.ava_call_quality (
  call_id uuid primary key,
  source text not null check (source in ('ava', 'roofguard')),
  call_no bigint,
  voice_id text,
  llm text,
  agent_turns int not null default 0,
  avg_gap numeric,            -- seconds from the person going quiet to her first sound
  max_gap numeric,
  slow_n int not null default 0,
  cut_off_n int not null default 0,
  flags text[] not null default '{}',
  score int not null default 100,
  complaint text,             -- what the caller said, when they complained
  created_at timestamptz not null default now()
);
alter table public.ava_call_quality enable row level security;
create policy "admin ava_call_quality" on public.ava_call_quality for all using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));
grant select on public.ava_call_quality to authenticated;

-- 1. the scan: pure, one row per transcript
create or replace function public.ava_call_quality_scan(p_transcript jsonb, p_chain text[])
 returns table(agent_turns int, avg_gap numeric, max_gap numeric, slow_n int, cut_off_n int, llm text, flags text[], complaint text)
 language plpgsql immutable set search_path to 'public'
as $function$
declare
  v_agent int; v_avg numeric; v_max numeric; v_slow int; v_cut int; v_after int; v_llm text; v_off boolean; v_complaint text;
  v_flags text[] := '{}';
begin
  with t as (
    select ord, e->>'role' role, coalesce(e->>'message', '') msg,
           (e->>'interrupted')::boolean intr, e->>'producing_llm' pl,
           (e#>>'{conversation_turn_metrics,metrics,convai_ttf_audio_since_silence,elapsed_time}')::numeric gap
      from jsonb_array_elements(coalesce(p_transcript, '[]'::jsonb)) with ordinality x(e, ord)
  ), a as (select t.*, row_number() over (order by ord) - 1 as idx from t where role = 'agent' and msg <> '')
  -- idx 0 is her opener: a voicemail greeting talking over it is not a sound problem, so it is left out of every measure
  select count(*)::int,
         avg(gap) filter (where idx > 0 and gap is not null),
         max(gap) filter (where idx > 0),
         (count(*) filter (where idx > 0 and gap > 3))::int,
         (count(*) filter (where idx > 0 and coalesce(intr, false)))::int,
         (count(*) filter (where idx > 0))::int,
         (select a2.pl from a a2 where a2.pl is not null group by a2.pl order by count(*) desc limit 1),
         coalesce(bool_or(pl is not null and p_chain is not null and cardinality(p_chain) > 0 and not (pl = any(p_chain))), false)
    into v_agent, v_avg, v_max, v_slow, v_cut, v_after, v_llm, v_off
    from a;

  select left(msg, 160) into v_complaint from (
    select coalesce(e->>'message', '') msg from jsonb_array_elements(coalesce(p_transcript, '[]'::jsonb)) e where e->>'role' = 'user') u
   where msg ~* '(breaking up|cutting out|cut out|in and out|can''?t hear (you|her)|hard to (hear|understand) (you|her)|you sound (robotic|weird|funny|like a robot)|robotic|choppy|static|bad (line|connection)|\mecho\M)'
   limit 1;

  if coalesce(v_agent, 0) >= 3 then
    if coalesce(v_slow, 0) >= 2 or coalesce(v_max, 0) > 6 then v_flags := v_flags || 'slow_reply'; end if;
    if coalesce(v_cut, 0) >= 3 and v_cut::numeric >= 0.35 * greatest(v_after, 1) then v_flags := v_flags || 'chopped'; end if;
  end if;
  if coalesce(v_off, false) then v_flags := v_flags || 'off_chain_model'; end if;
  if v_complaint is not null then v_flags := v_flags || 'caller_complaint'; end if;

  agent_turns := coalesce(v_agent, 0); avg_gap := round(v_avg, 2); max_gap := round(v_max, 2);
  slow_n := coalesce(v_slow, 0); cut_off_n := coalesce(v_cut, 0); llm := v_llm; flags := v_flags; complaint := v_complaint;
  return next;
end $function$;

-- 2. log + tell Scout
create or replace function public.ava_call_quality_log(p_source text, p_call_id uuid, p_call_no bigint, p_transcript jsonb, p_voice text, p_alert boolean default true)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
declare s record; v_chain text[]; v_score int; v_new boolean; v_url text; v_who text; v_why text;
begin
  if p_source = 'roofguard' then select llm_fallbacks into v_chain from rg_settings where id;
  else select llm_fallbacks into v_chain from ava_settings limit 1; end if;
  select * into s from ava_call_quality_scan(p_transcript, v_chain);
  if coalesce(s.agent_turns, 0) = 0 then return; end if;

  v_score := greatest(0, 100
    - case when 'slow_reply' = any(s.flags) then 25 else 0 end
    - case when 'chopped' = any(s.flags) then 25 else 0 end
    - case when 'off_chain_model' = any(s.flags) then 30 else 0 end
    - case when 'caller_complaint' = any(s.flags) then 40 else 0 end);

  insert into ava_call_quality (call_id, source, call_no, voice_id, llm, agent_turns, avg_gap, max_gap, slow_n, cut_off_n, flags, score, complaint)
  values (p_call_id, p_source, p_call_no, p_voice, s.llm, s.agent_turns, s.avg_gap, s.max_gap, s.slow_n, s.cut_off_n, s.flags, v_score, s.complaint)
  on conflict (call_id) do update set llm = excluded.llm, agent_turns = excluded.agent_turns, avg_gap = excluded.avg_gap, max_gap = excluded.max_gap,
    slow_n = excluded.slow_n, cut_off_n = excluded.cut_off_n, flags = excluded.flags, score = excluded.score, complaint = excluded.complaint,
    voice_id = coalesce(ava_call_quality.voice_id, excluded.voice_id)
  returning (xmax = 0) into v_new;

  if p_alert and cardinality(s.flags) > 0 and v_new then
    v_who := case when p_source = 'roofguard' then 'RoofGuard Ava' else 'Ava' end;
    v_url := case when p_source = 'roofguard' then 'https://bestly.tech/admin/roofguard' else 'https://bestly.tech/admin/ava' end;
    v_why := concat_ws(', ',
      case when 'slow_reply' = any(s.flags) then 'slow to answer (worst ' || coalesce(s.max_gap::text, '?') || 's)' end,
      case when 'chopped' = any(s.flags) then 'cut off ' || s.cut_off_n || ' times' end,
      case when 'off_chain_model' = any(s.flags) then 'ran on an unapproved model (' || coalesce(s.llm, '?') || ')' end,
      case when 'caller_complaint' = any(s.flags) then 'caller said: "' || s.complaint || '"' end);
    perform scout_notify(v_who || ' sounded off on call #' || coalesce(p_call_no::text, '?'), v_why || '. Score ' || v_score || '/100.',
      case when 'caller_complaint' = any(s.flags) or 'off_chain_model' = any(s.flags) then 'high' else 'medium' end,
      'caller_complaint' = any(s.flags), v_url, 'ava-quality-' || p_call_id::text);
  end if;
exception when others then
  raise warning 'ava_call_quality_log failed: %', sqlerrm;   -- watching must never break call logging
end $function$;

-- 3. run it whenever a transcript lands (alongside the reply guard)
create or replace function public.rg_calls_quality_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.transcript is not null and new.moved_to_ava_at is null and (tg_op = 'INSERT' or old.transcript is distinct from new.transcript) then
    perform ava_call_quality_log('roofguard', new.id, new.call_no, new.transcript, (select voice_id from rg_settings where id));
  end if;
  return new;
end $function$;

create or replace function public.ava_calls_quality_trg() returns trigger language plpgsql security definer set search_path to 'public'
as $function$
begin
  if new.transcript is not null and (tg_op = 'INSERT' or old.transcript is distinct from new.transcript) then
    -- ava_calls.voice holds a label ('ava' = her usual voice, 'jared' = the clone), not a voice id
    perform ava_call_quality_log('ava', new.id, new.call_no, new.transcript,
      case when coalesce(new.voice, 'ava') = 'ava' then (select voice_id from ava_settings limit 1) else new.voice end);
  end if;
  return new;
end $function$;

create trigger rg_calls_quality after insert or update of transcript on public.rg_calls
  for each row execute function public.rg_calls_quality_trg();
create trigger ava_calls_quality after insert or update of transcript on public.ava_calls
  for each row execute function public.ava_calls_quality_trg();

-- 4. history: score what already happened (no alerts, voice unknown for old calls)
select public.ava_call_quality_log('roofguard', c.id, c.call_no, c.transcript, null, false)
  from public.rg_calls c where c.transcript is not null and c.moved_to_ava_at is null;
select public.ava_call_quality_log('ava', c.id, c.call_no, c.transcript, c.voice, false)
  from public.ava_calls c where c.transcript is not null;
-- backfilled rows: the voice that was live when the call was placed, from the voice switcher's history
-- (calls before the switcher existed stay unknown)
update public.ava_call_quality q set voice_id = (select h.voice_id from public.ava_voice_history h join public.rg_calls c on c.id = q.call_id
    where h.source = 'rg' and h.used_at <= c.queued_at order by h.used_at desc limit 1) where q.source = 'roofguard' and q.voice_id is null;
update public.ava_call_quality q set voice_id = (select h.voice_id from public.ava_voice_history h join public.ava_calls c on c.id = q.call_id
    where h.source = 'ava' and h.used_at <= c.created_at order by h.used_at desc limit 1) where q.source = 'ava' and q.voice_id in ('ava');

-- 5. voices compared by data
create or replace view public.ava_voice_quality with (security_invoker = true) as
  select source, voice_id, count(*) calls, round(avg(score)) avg_score, round(avg(avg_gap), 2) avg_gap,
         count(*) filter (where cardinality(flags) > 0) flagged, max(created_at) last_call
    from public.ava_call_quality where voice_id is not null group by source, voice_id;
grant select on public.ava_voice_quality to authenticated;

-- 6. daily digest (also the card's heartbeat): how did she sound in the last 24 hours
create or replace function public.ava_call_quality_digest() returns void language plpgsql security definer set search_path to 'public'
as $function$
declare r record;
begin
  for r in select source, count(*) n, round(avg(score)) sc, count(*) filter (where cardinality(flags) > 0) bad, max(max_gap) worst
             from ava_call_quality where created_at > now() - interval '24 hours' group by source loop
    perform scout_notify((case when r.source = 'roofguard' then 'RoofGuard Ava' else 'Ava' end) || ' sound check: ' || r.sc || '/100',
      r.n || ' call' || case when r.n = 1 then '' else 's' end || ' in 24 hours, ' || r.bad || ' flagged, slowest reply ' || coalesce(r.worst::text, '?') || 's.',
      case when r.bad > 0 then 'medium' else 'info' end, false,
      case when r.source = 'roofguard' then 'https://bestly.tech/admin/roofguard' else 'https://bestly.tech/admin/ava' end,
      'ava-quality-digest-' || r.source || '-' || to_char(now(), 'YYYYMMDD'));
  end loop;
end $function$;
select cron.schedule('ava-call-quality-digest', '7 13 * * *', $$select public.ava_call_quality_digest()$$);

-- 7. team card: a tool of RoofGuard Ava (CLAUDE.md: every bot gets a card the day it goes live)
select public.team_onboard($j$[
 {"slug":"ava-call-quality","name":"Sound Check","role":"Call sound watcher","tool_of":"roofguard-caller","runs_on":"cloud","icon":"audio-lines",
  "schedule":"after every call, plus a daily summary at 7 AM",
  "what_it_does":"After every call on both Avas, scores how it sounded: slow replies, being cut off, the wrong model, or the caller saying she was breaking up. Tells Scout when a call sounded off and keeps a score per voice.",
  "pulse":{"src":"cron","job":"ava-call-quality-digest","gap":1500},
  "owns":["ava-quality"]}
]$j$::jsonb);
