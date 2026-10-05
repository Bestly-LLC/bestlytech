-- 2026-10-04 Team moods + unions/strikes (Jared: "like a Tamagotchi for my team... practical things: failing, workload too
-- heavy... ultimately they could get together, unionize and strike").
-- "Usual" = per-day rate over the history that actually exists before today (cron keeps ~2 days), at least one full day.
-- Every mood is a real signal, computed in SQL every 10 minutes (no AI, free):
--   asleep     paused / switched off / not built yet
--   sick       red (silent past 2x its gap), 3+ failures in a row, or half its runs failed today (3+)
--   overworked free-AI rate limits, 2.5x its usual runs today, or runs taking 2x as long as usual (30s+)
--   stressed   yellow (a problem it watches is open), any failure today, or its last run didn't work
--   bored      on-demand and nobody used it in 14 days (fed to the weekly reorg review)
--   happy      everything else; unknown when it can't report in
-- Each unhappy bot gets a first-person complaint from its own logs. Cause comes from the failure text (rate limit, login,
-- network, timeout) or from silence on a machine (the Pi, the Mac mini, the MacBook).
-- Union & strike: 3+ unhappy bots with the same cause form a union and strike: ONE problem (team.strike.<cause>) with the
-- demand (the actual fix) instead of a "gone quiet" alert per bot; team_watch stays quiet for strikers. When fewer than 2
-- are still unhappy for that cause, the strike ends and Scout says they're back to work.
-- History: cron.job_run_details and pi_job_runs already keep runs; bots that check in themselves now get agent_beat_log.

-- ------------------------------------------------------------------ check-in history for self-reporting bots
create table if not exists public.agent_beat_log (
  id      bigint generated always as identity primary key,
  slug    text not null,
  at      timestamptz not null default now(),
  ok      boolean,
  summary text
);
create index if not exists agent_beat_log_slug_at_idx on public.agent_beat_log (slug, at desc);
alter table public.agent_beat_log enable row level security;
revoke all on public.agent_beat_log from anon, authenticated;

create or replace function public.agent_beats_log() returns trigger
language plpgsql security definer set search_path to 'public' as $$
begin
  insert into agent_beat_log (slug, at, ok, summary) values (new.slug, coalesce(new.at, now()), new.ok, left(new.summary, 300));
  return new;
end $$;
create or replace trigger agent_beats_log after insert or update on public.agent_beats
  for each row execute function public.agent_beats_log();

-- ------------------------------------------------------------------ state
create table if not exists public.team_strikes (
  id         uuid primary key default gen_random_uuid(),
  cause      text not null,
  union_name text not null,
  demand     text not null,
  sign       text not null,
  members    text[] not null default '{}',
  peak       int not null default 0,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);
create unique index if not exists team_strikes_open_cause on public.team_strikes (cause) where ended_at is null;
alter table public.team_strikes enable row level security;
revoke all on public.team_strikes from anon, authenticated;

create table if not exists public.team_mood_state (
  slug       text primary key references public.bestly_agents(slug) on delete cascade,
  mood       text not null,
  complaint  text,
  cause      text,
  stats      jsonb,
  on_strike  uuid,
  updated_at timestamptz not null default now()
);
alter table public.team_mood_state enable row level security;
revoke all on public.team_mood_state from anon, authenticated;

-- ------------------------------------------------------------------ cause, union, demand
create or replace function public.team_mood_cause(p_text text, p_runs_on text, p_silent boolean) returns text
language sql immutable as $$
  select case
    when p_silent and p_runs_on in ('pi','mac_mini','macbook') then 'machine:' || p_runs_on
    when coalesce(p_text, '') ~* 'rate.?limit|\m429\M|quota|too many requests|neurons|daily limit' then 'limit'
    when coalesce(p_text, '') ~* '\m40[13]\M|unauthori[sz]ed|forbidden|expired|invalid (api )?key|signed out|sign.?in|log ?in required' then 'auth'
    when coalesce(p_text, '') ~* 'enotfound|econnrefused|econnreset|network|dns|unreachable|could not resolve|fetch failed|socket' then 'network'
    when coalesce(p_text, '') ~* 'timeout|timed out|deadline|took too long|etimedout' then 'timeout'
  end
$$;

create or replace function public.team_union_info(p_cause text) returns jsonb
language sql immutable as $$
  select case p_cause
    when 'machine:pi'       then '{"union":"Pi Workers Local 1","demand":"Bring the Pi back online. We can''t work without it.","sign":"PI DOWN","phrase":"The Pi isn''t answering."}'
    when 'machine:mac_mini' then '{"union":"Mac Mini Workers Local 2","demand":"Wake the Mac mini up and get its worker running.","sign":"WAKE MAC","phrase":"The Mac mini isn''t answering."}'
    when 'machine:macbook'  then '{"union":"MacBook Workers Local 3","demand":"Open the MacBook and get the Claude app running.","sign":"OPEN MAC","phrase":"Your MacBook isn''t answering."}'
    when 'limit'            then '{"union":"Free AI Laborers United","demand":"More free AI room: spread our runs out or wait for the reset.","sign":"MORE AI","phrase":"The free AI hit its limit."}'
    when 'auth'             then '{"union":"Locked Out Workers Guild","demand":"Fix the expired login so we can get back in.","sign":"LET US IN","phrase":"A login expired."}'
    when 'network'          then '{"union":"Disconnected Workers Union","demand":"Restore the connection we keep losing.","sign":"CONNECT US","phrase":"I can''t reach the service I need."}'
    when 'timeout'          then '{"union":"Overtime Workers Union","demand":"Our jobs keep timing out. Lighten the load or give us more time.","sign":"MORE TIME","phrase":"My jobs keep timing out."}'
    else '{"union":"Crew Union","demand":"Something keeps breaking our work.","sign":"FIX IT","phrase":""}'
  end::jsonb
$$;

-- ------------------------------------------------------------------ the moods
create or replace function public.team_mood_compute()
returns table (slug text, mood text, complaint text, cause text, stats jsonb)
language plpgsql security definer set search_path to 'public', 'cron' as $$
#variable_conflict use_column
declare
  a record;
  runs24 int; fails24 int; runs7 int; ms24 numeric; ms7 numeric; lastfail text; consec int; first_at timestamptz; prior_days numeric;
  base numeric; silent boolean; v_mood text; v_comp text; v_cause text; v_phrase text; v_issue text; v_when text;
begin
  for a in
    select x->>'slug' s, x->>'name' name, x->>'health' health, x->>'status' status, x->>'source' source,
           (x->>'last_at')::timestamptz last_at, (x->>'last_ok')::boolean last_ok, x->>'summary' summary,
           coalesce((x->>'on_demand')::boolean, false) on_demand, x->>'runs_on' runs_on, x->'issues' issues,
           b.pulse, b.created_at
      from jsonb_array_elements(admin_org_chart()->'agents') x
      join bestly_agents b on b.slug = x->>'slug'
     where x->>'kind' = 'agent' and x->>'status' in ('active','new')
  loop
    runs24 := 0; fails24 := 0; runs7 := 0; ms24 := null; ms7 := null; lastfail := null; consec := 0; first_at := null;

    if a.pulse->>'src' = 'cron' then
      select count(*) filter (where d.start_time > now() - interval '24 hours'),
             count(*) filter (where d.start_time > now() - interval '24 hours' and d.status not in ('succeeded','running','starting')),
             count(*),
             avg(extract(epoch from (d.end_time - d.start_time)) * 1000) filter (where d.start_time > now() - interval '24 hours' and d.end_time is not null),
             avg(extract(epoch from (d.end_time - d.start_time)) * 1000) filter (where d.end_time is not null and d.start_time <= now() - interval '24 hours'),
             min(d.start_time)
        into runs24, fails24, runs7, ms24, ms7, first_at
        from cron.job_run_details d join cron.job j using (jobid)
       where j.jobname = a.pulse->>'job' and d.start_time > now() - interval '7 days';
      select left(d.return_message, 300) into lastfail
        from cron.job_run_details d join cron.job j using (jobid)
       where j.jobname = a.pulse->>'job' and d.status = 'failed' and d.start_time > now() - interval '24 hours'
       order by d.start_time desc limit 1;
    elsif a.pulse->>'src' = 'pi_job' then
      select count(*) filter (where r.ran_at > now() - interval '24 hours'),
             count(*) filter (where r.ran_at > now() - interval '24 hours' and not coalesce(r.ok, true)),
             count(*),
             avg(r.duration_ms) filter (where r.ran_at > now() - interval '24 hours'),
             avg(r.duration_ms) filter (where r.ran_at <= now() - interval '24 hours'),
             min(r.ran_at)
        into runs24, fails24, runs7, ms24, ms7, first_at
        from pi_job_runs r where r.job = a.pulse->>'key' and r.ran_at > now() - interval '7 days';
      select left(r.summary, 300) into lastfail from pi_job_runs r
       where r.job = a.pulse->>'key' and not coalesce(r.ok, true) and r.ran_at > now() - interval '24 hours'
       order by r.ran_at desc limit 1;
      select coalesce(j.consecutive_failures, 0) into consec from pi_jobs j where j.job = a.pulse->>'key';
    elsif a.pulse->>'src' = 'beat' then
      select count(*) filter (where l.at > now() - interval '24 hours'),
             count(*) filter (where l.at > now() - interval '24 hours' and l.ok is false),
             count(*), min(l.at)
        into runs24, fails24, runs7, first_at
        from agent_beat_log l where l.slug = a.s and l.at > now() - interval '7 days';
      select left(l.summary, 300) into lastfail from agent_beat_log l
       where l.slug = a.s and l.ok is false and l.at > now() - interval '24 hours' order by l.at desc limit 1;
    end if;
    runs24 := coalesce(runs24, 0); fails24 := coalesce(fails24, 0); runs7 := coalesce(runs7, 0); consec := coalesce(consec, 0);
    -- "usual" = runs per day before today, over the history that actually exists (cron keeps ~2 days); needs a full prior day
    prior_days := extract(epoch from ((now() - interval '24 hours') - first_at)) / 86400.0;
    base := case when prior_days >= 1 and runs7 > runs24 then (runs7 - runs24) / prior_days end;

    silent := a.health = 'red' and (a.last_at is null or a.last_at < now() - interval '30 minutes');
    v_issue := coalesce(a.issues->0->>'title', a.issues->>0);
    -- cause from its latest failure, else its failing summary, else the open problem it watches
    v_cause := team_mood_cause(coalesce(lastfail, case when a.last_ok is false then a.summary end, v_issue, ''), a.runs_on,
                               silent and a.source in ('pi_job','pi_any','beat','at'));
    v_phrase := nullif(team_union_info(coalesce(v_cause, '-'))->>'phrase', '');
    v_when := coalesce(to_char(a.last_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM "on" Mon FMDD'), 'ever');
    v_comp := null;

    if a.status not in ('active','new') or a.health in ('paused','planned') or coalesce(a.summary, '') ilike 'Switched off%' then
      v_mood := 'asleep';
    elsif a.source = 'none' or a.health = 'unknown' then
      v_mood := 'unknown';
    elsif a.health = 'red' or consec >= 3 or (fails24 >= 3 and fails24 * 2 >= runs24) then
      v_mood := 'sick';
      v_comp := case
        when silent then format('I haven''t been able to check in since %s.', v_when)
        when consec >= 3 then format('My last %s runs failed.', consec)
        when fails24 > 0 then format('I failed %s of my %s runs today.', fails24, runs24)
        else 'I''m not doing well.' end || coalesce(' ' || v_phrase, '');
    elsif v_cause = 'limit'
       or (base is not null and base > 0 and runs24 >= 6 and runs24 >= 2.5 * base)
       or (ms24 is not null and ms7 is not null and ms7 > 0 and ms24 >= 30000 and ms24 >= 2 * ms7) then
      v_mood := 'overworked';
      v_comp := case
        when v_cause = 'limit' then 'The free AI keeps telling me to slow down (rate limit).'
        when base is not null and base > 0 and runs24 >= 2.5 * base then format('I ran %s times today, about %sx my usual.', runs24, round(runs24 / base, 1))
        else format('My runs take %s seconds now, about double my usual %s.', round(ms24 / 1000), round(ms7 / 1000)) end;
    elsif a.health = 'yellow' or fails24 >= 1 or a.last_ok is false then
      v_mood := 'stressed';
      v_comp := case
        when fails24 >= 1 then format('%s of my runs failed today.', fails24) || coalesce(' ' || v_phrase, '')
        when v_issue is not null then 'Something I look after is broken: ' || left(v_issue, 120)
        when a.last_ok is false then 'My last run didn''t work' || coalesce(': ' || left(a.summary, 120), '.')
        else 'Something is off with my work.' end;
    elsif a.on_demand and coalesce(a.last_at, a.created_at) < now() - interval '14 days' then
      v_mood := 'bored';
      v_comp := format('Nobody has needed me in %s days.', extract(day from now() - coalesce(a.last_at, a.created_at))::int);
    else
      v_mood := 'happy';
    end if;

    slug := a.s; mood := v_mood; complaint := v_comp;
    cause := case when v_mood in ('sick','stressed','overworked') then v_cause end;
    stats := jsonb_strip_nulls(jsonb_build_object('runs_24h', runs24, 'fails_24h', fails24, 'usual_per_day', round(base, 1),
               'ms_24h', round(ms24), 'ms_usual', round(ms7), 'fails_in_a_row', nullif(consec, 0)));
    return next;
  end loop;
end $$;
revoke all on function public.team_mood_compute() from public, anon, authenticated;

-- ------------------------------------------------------------------ keep 14 days of check-in history
create or replace function public.agent_beat_log_prune() returns void
language sql security definer set search_path to 'public' as $$
  delete from agent_beat_log where at < now() - interval '14 days';
$$;
revoke all on function public.agent_beat_log_prune() from public, anon, authenticated;

-- ------------------------------------------------------------------ the sweep (every 10 minutes, before team_watch)
create or replace function public.team_mood_sweep() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare g record; s team_strikes; v_info jsonb; v_started int := 0; v_ended int := 0; v_names text;
begin
  insert into team_mood_state as m (slug, mood, complaint, cause, stats, updated_at)
  select c.slug, c.mood, c.complaint, c.cause, c.stats, now() from team_mood_compute() c
  on conflict (slug) do update set mood = excluded.mood, complaint = excluded.complaint, cause = excluded.cause,
                                   stats = excluded.stats, updated_at = now();
  -- bots that left (retired/paused) keep their last row; every reader joins active bots, so it never shows

  -- unions: 3+ unhappy bots with the same cause
  for g in select m.cause, array_agg(m.slug order by m.slug) members, count(*)::int n
             from team_mood_state m join bestly_agents b on b.slug = m.slug and b.status in ('active','new')
            where m.mood in ('sick','stressed','overworked') and m.cause is not null
            group by m.cause having count(*) >= 3 loop
    select * into s from team_strikes where cause = g.cause and ended_at is null;
    if s.id is null then
      v_info := team_union_info(g.cause);
      insert into team_strikes (cause, union_name, demand, sign, members, peak)
      values (g.cause, v_info->>'union', v_info->>'demand', v_info->>'sign', g.members, g.n) returning * into s;
      select string_agg(name, ', ' order by name) into v_names from bestly_agents where slug = any(g.members);
      perform bestly_raise('team.strike.' || replace(g.cause, ':', '.'), 'problem', 'warning',
        s.union_name || ' is on strike',
        format('%s bots stopped working for the same reason: %s. Their demand: %s', g.n, v_names, s.demand),
        'team', null, false);
      v_started := v_started + 1;
    else
      update team_strikes set members = g.members, peak = greatest(peak, g.n) where id = s.id;
    end if;
  end loop;

  -- back to work: fewer than 2 still unhappy for that cause
  for s in select * from team_strikes where ended_at is null loop
    if (select count(*) from team_mood_state m join bestly_agents b on b.slug = m.slug and b.status in ('active','new')
         where m.cause = s.cause and m.mood in ('sick','stressed','overworked')) < 2 then
      update team_strikes set ended_at = now() where id = s.id;
      perform bestly_raise('team.strike.' || replace(s.cause, ':', '.'), 'resolved', 'info', s.union_name || ' is back to work');
      perform scout_notify(p_title => 'Strike over: ' || s.union_name || ' is back to work',
        p_body => 'Their demand was met (' || s.demand || ') and the crew is working again.',
        p_severity => 'info', p_push => false, p_url => '/admin/team', p_dedupe => 'strike-over-' || s.id);
      v_ended := v_ended + 1;
    end if;
  end loop;

  with w as (select m.slug, (select st.id from team_strikes st where st.ended_at is null and m.slug = any(st.members) limit 1) sid
               from team_mood_state m)
  update team_mood_state m set on_strike = w.sid from w where w.slug = m.slug and m.on_strike is distinct from w.sid;
  perform agent_beat_log_prune();
  return jsonb_build_object('strikes_started', v_started, 'strikes_ended', v_ended);
end $$;
revoke all on function public.team_mood_sweep() from public, anon, authenticated;

-- ------------------------------------------------------------------ what the Team page reads
create or replace function public.admin_team_moods() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  return jsonb_build_object(
    'moods', (select coalesce(jsonb_object_agg(slug, jsonb_build_object('mood', mood, 'complaint', complaint, 'cause', cause,
                 'stats', stats, 'on_strike', on_strike)), '{}')
                  from team_mood_state m where exists (select 1 from bestly_agents b where b.slug = m.slug and b.status in ('active','new'))),
    'strikes', (select coalesce(jsonb_agg(to_jsonb(s) order by s.started_at desc), '[]') from team_strikes s
                 where s.ended_at is null or s.ended_at > now() - interval '2 hours'),
    'updated_at', (select max(updated_at) from team_mood_state));
end $$;
revoke all on function public.admin_team_moods() from public, anon;
grant execute on function public.admin_team_moods() to authenticated, service_role;

-- ------------------------------------------------------------------ team_watch: one strike alert instead of one per striker
create or replace function public.team_watch() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  a record; v_red int := 0; v_raised int := 0; v_resolved int := 0; v_when text; v_key text; v_striking boolean;
begin
  for a in
    select b.*, p.last_at, p.last_ok, p.summary, team_health(b.status, b.pulse, p.last_at, p.last_ok) h
      from bestly_agents b left join team_pulses() p on p.slug = b.slug
     where b.status in ('active','new') and coalesce((b.pulse->>'alert')::boolean, false)
  loop
    v_key := 'team.silent.' || a.slug;
    v_striking := exists (select 1 from team_strikes s where s.ended_at is null and a.slug = any(s.members));
    if a.h = 'red' and not v_striking then
      v_red := v_red + 1;
      v_when := coalesce(to_char(a.last_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM "on" Mon FMDD'), 'never');
      perform bestly_raise(v_key, 'problem', 'warning',
        a.name || ' has gone quiet',
        format('%s (%s) last checked in at %s. It should check in about every %s minutes. It runs on %s%s.%s',
               a.name, a.what_it_does, v_when, coalesce(a.pulse->>'gap', '60'), coalesce(a.runs_on, 'unknown'),
               coalesce(' (' || a.schedule || ')', ''),
               coalesce(E'\nLast thing it said: ' || a.summary, '')),
        'team', null, false);
      v_raised := v_raised + 1;
    elsif (a.h in ('green','yellow') or v_striking) and exists (select 1 from monitor_issues where key = v_key and status = 'open') then
      perform bestly_raise(v_key, 'resolved', 'info',
        case when v_striking then a.name || ' is on strike (covered by the strike alert)' else a.name || ' is checking in again' end);
      v_resolved := v_resolved + 1;
    end if;
  end loop;

  for a in select b.slug, b.name from bestly_agents b
            where b.status in ('paused','planned','retired')
              and exists (select 1 from monitor_issues m where m.key = 'team.silent.' || b.slug and m.status = 'open') loop
    perform bestly_raise('team.silent.' || a.slug, 'resolved', 'info', a.name || ' is paused');
  end loop;

  update team_watch_state set checked_at = now(), red = v_red, raised = v_raised, resolved = v_resolved, error = null where id = 1;
  return jsonb_build_object('red', v_red, 'raised', v_raised, 'resolved', v_resolved);
end $$;
revoke all on function public.team_watch() from public, anon, authenticated;

-- ------------------------------------------------------------------ the reorg review sees who is bored or struggling
create or replace function public.reorg_context() returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  return hr_context() || jsonb_build_object(
    'protected', '["scout","improver","hr","fix-ladder","team-watch","team-watch-ping"]'::jsonb,
    'moods', (select coalesce(jsonb_agg(jsonb_build_object('bot', slug, 'mood', mood, 'complaint', complaint)), '[]')
                from team_mood_state m where mood in ('bored','sick','overworked')
                 and exists (select 1 from bestly_agents b where b.slug = m.slug and b.status in ('active','new'))),
    'past_reorgs', (select coalesce(jsonb_agg(jsonb_build_object('bot', r.slug, 'kind', r.kind, 'status', r.status)), '[]')
                      from (select slug, kind, status from team_reorgs order by created_at desc limit 40) r));
end $$;
revoke all on function public.reorg_context() from public, anon, authenticated;
grant execute on function public.reorg_context() to service_role;

-- moods first, so team_watch knows who is on strike
select cron.schedule('org-chart-watch', '7-59/10 * * * *',
  $$select public.team_mood_sweep(); select public.team_watch(); select public.team_welcome_sweep(); select public.hire_training_sweep();$$);
