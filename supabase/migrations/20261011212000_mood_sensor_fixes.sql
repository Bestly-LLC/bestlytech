-- Mood sensor fixes (2026-10-11). Five false alarms on /admin/team, all sensor bugs, none a broken employee.
--
-- 1. In-flight cron runs counted as failures. team_pulses() took each cron job's newest cron.job_run_details row,
--    and the mood sweep fires on the same minute as ha-incident-live / car-protect / org-chart-watch, so the
--    newest row was the run still "running": ok = (status = 'succeeded') = false, empty return_message ->
--    "My last run didn't work: Last run failed: ". Now only finished runs are considered.
-- 2. pi_job_runs mostly holds FAILURES (only settle-actions logs successes), so "failed N of N runs" and the
--    "usual duration" were computed from failed runs only, and old failures that the job later recovered from
--    kept the mood red for 24 h. Failures now count only if no success came after them (pi_jobs.last_ok_at,
--    cron/beat: latest success), a recovered job is not sick/stressed, and recovered flapping on jobs that
--    log every run (>= 3 failures and >= 20%) still shows as stressed.
-- 3. "overworked: slower than usual" now needs a sample (>= 3 successful runs today vs >= 5 earlier) and only
--    averages SUCCESSFUL runs.
-- 4. "The Pi isn't answering" is only blamed when no enabled Pi job has checked in for 30 minutes.
-- 5. pi-model-prober was an auto-discovered duplicate card (team_discover, gap 90) for the daily pi job that the
--    onboarded Model Prober (slug model-prober, gap 1560) already owns. Retired, as with the plug-puller dupe.

-- ---------------------------------------------------------------- team_pulses: ignore in-flight cron runs
create or replace function public.team_pulses()
 returns table(slug text, last_at timestamp with time zone, last_ok boolean, summary text)
 language plpgsql
 security definer
 set search_path to 'public', 'cron'
as $function$
declare
  a record; p jsonb; v_cron jsonb; r record;
  v_at timestamptz; v_ok boolean; v_sum text;
begin
  select coalesce(jsonb_object_agg(j.jobname, jsonb_build_object('at', d.end_time, 'start', d.start_time, 'ok', d.status = 'succeeded',
           'msg', left(d.return_message, 160), 'active', j.active)), '{}')
    into v_cron
    from cron.job j
    left join lateral (select x.end_time, x.start_time, x.status, x.return_message
                    from (select distinct on (jobid) jobid, end_time, start_time, status, return_message
                            from cron.job_run_details
                           where start_time > now() - interval '3 days'
                             and status not in ('starting', 'running', 'sending', 'connecting')   -- a run still in flight is not a result
                           order by jobid, start_time desc) x where x.jobid = j.jobid) d on true;

  for a in select * from bestly_agents where status <> 'retired' and pulse is not null loop
    p := a.pulse; v_at := null; v_ok := null; v_sum := null;
    begin
      case p->>'src'
        when 'at' then
          execute format('select %I::timestamptz, (%s)::boolean, (%s)::text from %I where %s order by %I desc nulls last limit 1',
                         p->>'col', coalesce(p->>'ok', 'true'), coalesce(p->>'sum', 'null'), p->>'table',
                         coalesce(p->>'where', 'true'), p->>'col')
            into v_at, v_ok, v_sum;
        when 'pi_job' then
          select coalesce(j.last_run_at, j.last_ok_at), j.last_ok,
                 case when not j.enabled then 'Switched off on the Pi' else j.last_summary end
            into v_at, v_ok, v_sum
            from pi_jobs j where j.job = p->>'key';
        when 'pi_any' then
          select max(last_run_at), bool_and(coalesce(consecutive_failures, 0) = 0),
                 count(*) filter (where enabled) || ' jobs, ' || count(*) filter (where enabled and coalesce(consecutive_failures,0) > 0) || ' failing'
            into v_at, v_ok, v_sum from pi_jobs where enabled;
        when 'cron' then
          if v_cron ? (p->>'job') and not coalesce((v_cron->(p->>'job')->>'active')::boolean, true) then
            -- switched off on purpose: never "gone quiet"
            v_at := null; v_ok := null; v_sum := 'Switched off in the schedule';
          elsif not (v_cron ? (p->>'job')) then
            v_at := null; v_ok := false; v_sum := 'Its schedule entry is gone';
          else
            v_at := coalesce((v_cron->(p->>'job')->>'at')::timestamptz, (v_cron->(p->>'job')->>'start')::timestamptz);
            v_ok := (v_cron->(p->>'job')->>'ok')::boolean;
            v_sum := case when v_ok is false then 'Last run failed: ' || coalesce(v_cron->(p->>'job')->>'msg', '') end;
          end if;
        when 'cron_family' then
          select max(coalesce((e.value->>'at')::timestamptz, (e.value->>'start')::timestamptz)),
                 bool_and(coalesce((e.value->>'ok')::boolean, true)),
                 count(*) || ' checks, ' || count(*) filter (where (e.value->>'ok')::boolean is false) || ' failing'
            into v_at, v_ok, v_sum
            from jsonb_each(v_cron) e where e.key like (p->>'like') and coalesce((e.value->>'active')::boolean, true);
        when 'beat' then
          select b.at, b.ok, b.summary into v_at, v_ok, v_sum from agent_beats b where b.slug = a.slug;
        else null;
      end case;
    exception when others then
      v_at := null; v_ok := false; v_sum := 'Could not read its check-in: ' || left(sqlerrm, 120);
    end;
    if p->>'src' <> 'beat' then
      select b.at as bat, b.ok as bok, coalesce(b.summary, v_sum) as bsum into r from agent_beats b
       where b.slug = a.slug and (v_at is null or b.at > v_at);
      if found then v_at := r.bat; v_ok := r.bok; v_sum := r.bsum; end if;
    end if;
    slug := a.slug; last_at := v_at; last_ok := v_ok; summary := v_sum;
    return next;
  end loop;
end $function$;

-- ---------------------------------------------------------------- team_mood_compute: recovery-aware, sample-aware
create or replace function public.team_mood_compute()
 returns table(slug text, mood text, complaint text, cause text, stats jsonb)
 language plpgsql
 security definer
 set search_path to 'public', 'cron'
as $function$
#variable_conflict use_column
declare
  a record;
  runs24 int; fails_all int; fails_open int; runs7 int; ms24 numeric; ms7 numeric; n_ms24 int; n_ms7 int;
  lastfail text; consec int; first_at timestamptz; prior_days numeric;
  v_last_ok timestamptz; v_logs_all boolean; v_pi_quiet boolean; v_flap boolean;
  base numeric; silent boolean; v_mood text; v_comp text; v_cause text; v_phrase text; v_issue text; v_when text;
begin
  v_pi_quiet := not exists (select 1 from pi_jobs where enabled and last_run_at > now() - interval '30 minutes');

  for a in
    select x->>'slug' s, x->>'name' name, x->>'health' health, x->>'status' status, x->>'source' source,
           (x->>'last_at')::timestamptz last_at, (x->>'last_ok')::boolean last_ok, x->>'summary' summary,
           coalesce((x->>'on_demand')::boolean, false) on_demand, x->>'runs_on' runs_on, x->'issues' issues,
           b.pulse, b.created_at
      from jsonb_array_elements(admin_org_chart()->'agents') x
      join bestly_agents b on b.slug = x->>'slug'
     where x->>'kind' = 'agent' and x->>'status' in ('active','new')
  loop
    runs24 := 0; fails_all := 0; fails_open := 0; runs7 := 0; ms24 := null; ms7 := null; n_ms24 := 0; n_ms7 := 0;
    lastfail := null; consec := 0; first_at := null; v_last_ok := null; v_logs_all := true;

    if a.pulse->>'src' = 'cron' then
      select max(d.start_time) into v_last_ok
        from cron.job_run_details d join cron.job j using (jobid)
       where j.jobname = a.pulse->>'job' and d.status = 'succeeded' and d.start_time > now() - interval '7 days';
      select count(*) filter (where d.start_time > now() - interval '24 hours'),
             count(*) filter (where d.start_time > now() - interval '24 hours' and d.status not in ('succeeded','running','starting','sending','connecting')),
             count(*) filter (where d.start_time > now() - interval '24 hours' and d.status not in ('succeeded','running','starting','sending','connecting')
                                and d.start_time > coalesce(v_last_ok, '-infinity')),
             count(*),
             avg(extract(epoch from (d.end_time - d.start_time)) * 1000) filter (where d.status = 'succeeded' and d.start_time > now() - interval '24 hours' and d.end_time is not null),
             avg(extract(epoch from (d.end_time - d.start_time)) * 1000) filter (where d.status = 'succeeded' and d.end_time is not null and d.start_time <= now() - interval '24 hours'),
             count(*) filter (where d.status = 'succeeded' and d.start_time > now() - interval '24 hours' and d.end_time is not null),
             count(*) filter (where d.status = 'succeeded' and d.end_time is not null and d.start_time <= now() - interval '24 hours'),
             min(d.start_time)
        into runs24, fails_all, fails_open, runs7, ms24, ms7, n_ms24, n_ms7, first_at
        from cron.job_run_details d join cron.job j using (jobid)
       where j.jobname = a.pulse->>'job' and d.start_time > now() - interval '7 days';
      select left(d.return_message, 300) into lastfail
        from cron.job_run_details d join cron.job j using (jobid)
       where j.jobname = a.pulse->>'job' and d.status = 'failed' and d.start_time > now() - interval '24 hours'
         and d.start_time > coalesce(v_last_ok, '-infinity')
       order by d.start_time desc limit 1;
    elsif a.pulse->>'src' = 'pi_job' then
      -- pi_job_runs is mostly a failure log (only some jobs log successes), and pi_jobs.last_ok_at is the truth about recovery
      select j.last_ok_at into v_last_ok from pi_jobs j where j.job = a.pulse->>'key';
      select coalesce(bool_or(r.ok), false) into v_logs_all from pi_job_runs r
       where r.job = a.pulse->>'key' and r.ran_at > now() - interval '7 days';
      select count(*) filter (where r.ran_at > now() - interval '24 hours'
                                and (r.ok or v_logs_all or r.ran_at > coalesce(v_last_ok, '-infinity'))),
             count(*) filter (where r.ran_at > now() - interval '24 hours' and not coalesce(r.ok, true)
                                and (v_logs_all or r.ran_at > coalesce(v_last_ok, '-infinity'))),
             count(*) filter (where r.ran_at > now() - interval '24 hours' and not coalesce(r.ok, true)
                                and r.ran_at > coalesce(v_last_ok, '-infinity')),
             count(*) filter (where r.ok or v_logs_all or r.ran_at > coalesce(v_last_ok, '-infinity')),
             avg(r.duration_ms) filter (where r.ok and r.ran_at > now() - interval '24 hours'),
             avg(r.duration_ms) filter (where r.ok and r.ran_at <= now() - interval '24 hours'),
             count(*) filter (where r.ok and r.duration_ms is not null and r.ran_at > now() - interval '24 hours'),
             count(*) filter (where r.ok and r.duration_ms is not null and r.ran_at <= now() - interval '24 hours'),
             min(r.ran_at) filter (where r.ok or v_logs_all or r.ran_at > coalesce(v_last_ok, '-infinity'))
        into runs24, fails_all, fails_open, runs7, ms24, ms7, n_ms24, n_ms7, first_at
        from pi_job_runs r where r.job = a.pulse->>'key' and r.ran_at > now() - interval '7 days';
      select left(r.summary, 300) into lastfail from pi_job_runs r
       where r.job = a.pulse->>'key' and not coalesce(r.ok, true) and r.ran_at > now() - interval '24 hours'
         and r.ran_at > coalesce(v_last_ok, '-infinity')
       order by r.ran_at desc limit 1;
      select coalesce(j.consecutive_failures, 0) into consec from pi_jobs j where j.job = a.pulse->>'key';
    elsif a.pulse->>'src' = 'beat' then
      select max(l.at) into v_last_ok from agent_beat_log l
       where l.slug = a.s and l.ok is true and l.at > now() - interval '7 days';
      select count(*) filter (where l.at > now() - interval '24 hours'),
             count(*) filter (where l.at > now() - interval '24 hours' and l.ok is false),
             count(*) filter (where l.at > now() - interval '24 hours' and l.ok is false and l.at > coalesce(v_last_ok, '-infinity')),
             count(*), min(l.at)
        into runs24, fails_all, fails_open, runs7, first_at
        from agent_beat_log l where l.slug = a.s and l.at > now() - interval '7 days';
      select left(l.summary, 300) into lastfail from agent_beat_log l
       where l.slug = a.s and l.ok is false and l.at > now() - interval '24 hours' and l.at > coalesce(v_last_ok, '-infinity')
       order by l.at desc limit 1;
    end if;
    runs24 := coalesce(runs24, 0); fails_all := coalesce(fails_all, 0); fails_open := coalesce(fails_open, 0);
    runs7 := coalesce(runs7, 0); consec := coalesce(consec, 0); n_ms24 := coalesce(n_ms24, 0); n_ms7 := coalesce(n_ms7, 0);
    prior_days := extract(epoch from ((now() - interval '24 hours') - first_at)) / 86400.0;
    base := case when prior_days >= 1 and runs7 > runs24 then (runs7 - runs24) / prior_days end;
    -- one slow run is not a trend: need a sample on both sides, measured on successful runs only
    if n_ms24 < 3 or n_ms7 < 5 then ms24 := null; ms7 := null; end if;
    -- failures that were followed by a success are history, unless the job logs every run and fails a lot
    v_flap := fails_all >= 3 and fails_all * 5 >= runs24 and fails_all > fails_open;

    silent := a.health = 'red' and (a.last_at is null or a.last_at < now() - interval '30 minutes');
    v_issue := coalesce(a.issues->0->>'title', a.issues->>0);
    -- only blame the machine when the machine is really quiet: a Pi job that is late while other Pi jobs beat is its own problem
    v_cause := team_mood_cause(coalesce(lastfail, case when a.last_ok is false then a.summary end, v_issue, ''), a.runs_on,
                               silent and a.source in ('pi_job','pi_any','beat','at') and (a.runs_on is distinct from 'pi' or v_pi_quiet));
    v_phrase := nullif(team_union_info(coalesce(v_cause, '-'))->>'phrase', '');
    v_when := coalesce(to_char(a.last_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM "on" Mon FMDD'), 'ever');
    v_comp := null;

    if a.status not in ('active','new') or a.health in ('paused','planned') or coalesce(a.summary, '') ilike 'Switched off%' then
      v_mood := 'asleep';
    elsif a.source = 'none' or a.health = 'unknown' then
      v_mood := 'unknown';
    elsif a.health = 'red' or consec >= 3 or (fails_open >= 3 and fails_open * 2 >= runs24) then
      v_mood := 'sick';
      v_comp := case
        when silent then format('I haven''t been able to check in since %s.', v_when)
        when consec >= 3 then format('My last %s runs failed.', consec)
        when fails_open > 0 then format('I failed %s of my %s runs today.', fails_open, runs24)
        else 'I''m not doing well.' end || coalesce(' ' || v_phrase, '');
    elsif v_cause = 'limit'
       or (base is not null and base > 0 and runs24 >= 6 and runs24 >= 2.5 * base)
       or (ms24 is not null and ms7 is not null and ms7 > 0 and ms24 >= 30000 and ms24 >= 2 * ms7) then
      v_mood := 'overworked';
      v_comp := case
        when v_cause = 'limit' then 'The free AI keeps telling me to slow down (rate limit).'
        when base is not null and base > 0 and runs24 >= 2.5 * base then format('I ran %s times today, about %sx my usual.', runs24, round(runs24 / base, 1))
        else format('My runs take %s seconds now, about double my usual %s.', round(ms24 / 1000), round(ms7 / 1000)) end;
    elsif a.health = 'yellow' or fails_open >= 1 or v_flap or a.last_ok is false then
      v_mood := 'stressed';
      v_comp := case
        when fails_open >= 1 then format('%s of my runs failed today.', fails_open) || coalesce(' ' || v_phrase, '')
        when v_flap then format('%s of my %s runs failed today, but I''m working again.', fails_all, runs24)
        when v_issue is not null then 'Something I look after is broken: ' || left(v_issue, 120)
        when a.last_ok is false then 'My last run didn''t work' || coalesce(nullif(': ' || left(a.summary, 120), ': '), '.')
        else 'Something is off with my work.' end;
    elsif a.on_demand and coalesce(a.last_at, a.created_at) < now() - interval '14 days' then
      v_mood := 'bored';
      v_comp := format('Nobody has needed me in %s days.', extract(day from now() - coalesce(a.last_at, a.created_at))::int);
    else
      v_mood := 'happy';
    end if;

    slug := a.s; mood := v_mood; complaint := v_comp;
    cause := case when v_mood in ('sick','stressed','overworked') then v_cause end;
    stats := jsonb_strip_nulls(jsonb_build_object('runs_24h', runs24, 'fails_24h', fails_all, 'usual_per_day', round(base, 1),
               'ms_24h', round(ms24), 'ms_usual', round(ms7), 'fails_in_a_row', nullif(consec, 0)));
    return next;
  end loop;
end $function$;

-- ---------------------------------------------------------------- pi-model-prober: duplicate auto-discovered card
-- model-prober (onboarded 2026-10-07, gap 1560 = pi_jobs.max_gap_min) already owns pi_jobs.model_prober.
-- team_discover only creates a card when no agent holds the key, so retiring this one does not bring it back.
update bestly_agents
   set pulse = jsonb_set(pulse, '{gap}', '1560'),
       status = 'retired',
       updated_at = now()
 where slug = 'pi-model-prober' and status = 'new';
delete from team_mood_state where slug = 'pi-model-prober';
