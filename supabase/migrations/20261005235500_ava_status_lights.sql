-- Status lights for both Ava pages (/admin/ava and /admin/roofguard): one cheap admin-only SQL call, polled every 60 seconds.
--   ava_status_lights('ava' | 'roofguard') -> jsonb [{ key, label, state, word?, detail, checked_at, items? }]
--   state: ok | warn | down | off. word (optional) overrides the status word ("Paused", "Not set up", "Over cap").
-- Reads only: ava_line_health, ava_settings / rg_settings, ava_spend_calc, the coach tables, ava_brief_log, bestly_agents (team cards:
-- each card's pulse names its cron jobs in "job" / "also") and cron.job / cron.job_run_details. Nothing is written, no edge function is called.
-- Background jobs = every cron job named on this Ava's team cards (personal: ava, ava-*; RoofGuard: roofguard-*, rg-*).
-- A job is late when its last run is older than its schedule allows (3x the interval plus 5 min for every-N-minutes jobs, 26 h daily,
-- 100 h weekday-only, 8 days weekly); twice that is down. Jobs that have no run on record yet and run daily or slower are not counted late.

create or replace function public.ava_lights_clock(p_ts timestamptz)
returns text language sql immutable set search_path = public as $$
  select replace(to_char(p_ts at time zone 'America/Los_Angeles', 'FMHH12:MI AM'), ' ', chr(160))
$$;

create or replace function public.ava_lights_when(p_ts timestamptz)
returns text language sql stable set search_path = public as $$
  select case when (p_ts at time zone 'America/Los_Angeles')::date = (now() at time zone 'America/Los_Angeles')::date
              then public.ava_lights_clock(p_ts)
              else replace(to_char(p_ts at time zone 'America/Los_Angeles', 'FMMon FMDD'), ' ', chr(160)) || ', ' || public.ava_lights_clock(p_ts) end
$$;

create or replace function public.ava_light(p_key text, p_label text, p_state text, p_detail text, p_checked timestamptz,
                                            p_word text default null, p_items jsonb default null)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object('key', p_key, 'label', p_label, 'state', p_state, 'word', p_word, 'detail', p_detail,
                                              'checked_at', p_checked, 'items', p_items))
$$;

create or replace function public.ava_status_lights(p_source text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_personal boolean := (p_source = 'ava');
  v_out jsonb := '[]'::jsonb;
  v_pt_day date := (now() at time zone 'America/Los_Angeles')::date;
  lh ava_line_health; sp jsonb;
  v_agent text; v_phone text; v_from text; v_log jsonb; v_setup_at timestamptz; v_cap numeric;
  r record; v_items jsonb; v_names text[]; v_n int; v_down int; v_warn int; v_pend int; v_newest timestamptz;
  v_sch text; v_m text; v_h text; v_dow text; v_allowed numeric; v_age numeric; v_jstate text; v_jdetail text;
  v_waiting int; v_last_done timestamptz; v_n7 int; v_behind boolean; v_ai_bad boolean;
  av ava_settings; rs rg_settings; cal jsonb; prov text; ck jsonb; v_bad text[]; v_stale text[]; v_miss text[]; v_cal_checked timestamptz; v_provs int;
  v_last_fwd timestamptz; bl ava_brief_log; v_min int;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_source not in ('ava', 'roofguard') then raise exception 'source must be ava or roofguard'; end if;

  -- 1. phone line: the watchdog's row (ava_line_health), stale after 35 minutes (it runs every 10)
  select * into lh from ava_line_health where source = p_source;
  if not found then
    v_out := v_out || ava_light('line', 'Phone line', 'off', 'No line check on record yet.', now(), 'Not checked');
  elsif not lh.ok then
    v_out := v_out || ava_light('line', 'Phone line', 'down',
      'Not answering. ' || coalesce((select string_agg(x, '; ') from jsonb_array_elements_text(coalesce(lh.problems, '[]'::jsonb)) x), 'The line check found a problem.'),
      lh.checked_at);
  elsif lh.checked_at < now() - interval '35 minutes' then
    v_out := v_out || ava_light('line', 'Phone line', 'warn', 'The line check is overdue. It normally runs every 10 minutes.', lh.checked_at);
  else
    v_out := v_out || ava_light('line', 'Phone line', 'ok', 'Answering calls.', lh.checked_at);
  end if;

  -- 2. voice agent: agent_id and phone_number_id present
  if v_personal then
    select agent_id, phone_number_id, from_number, setup_log, daily_spend_cap into v_agent, v_phone, v_from, v_log, v_cap from ava_settings where id;
  else
    select agent_id, phone_number_id, from_number, setup_log, daily_spend_cap into v_agent, v_phone, v_from, v_log, v_cap from rg_settings where id;
  end if;
  begin v_setup_at := (v_log -> -1 ->> 'at')::timestamptz; exception when others then v_setup_at := null; end;
  if coalesce(v_agent, '') <> '' and coalesce(v_phone, '') <> '' then
    v_out := v_out || ava_light('agent', 'Voice agent', 'ok',
      'Set up' || case when coalesce(v_from, '') <> '' then ', calling from ' ||
          regexp_replace(regexp_replace(v_from, '^\+1(\d{3})(\d{3})(\d{4})$', '(\1)' || chr(160) || '\2-\3'), '\s', chr(160)) else '' end || '.'
        || case when v_setup_at is not null then ' Last setup ' || ava_lights_when(v_setup_at) || '.' else '' end,
      coalesce(v_setup_at, now()));
  else
    v_out := v_out || ava_light('agent', 'Voice agent', 'off', 'Not set up yet. Use Set up in Settings.', now(), 'Not set up');
  end if;

  -- 3. background jobs: every cron job named on this Ava's team cards, one light with the late ones listed
  v_items := '[]'::jsonb; v_names := '{}'; v_n := 0; v_down := 0; v_warn := 0; v_pend := 0; v_newest := null;
  for r in
    select distinct x.j as job
      from bestly_agents a
      cross join lateral (
        select a.pulse ->> 'job' as j
        union all
        select jsonb_array_elements_text(case when jsonb_typeof(a.pulse -> 'also') = 'array' then a.pulse -> 'also' else '[]'::jsonb end)
      ) x
     where a.status = 'active' and x.j is not null
       and ((v_personal and (a.slug = 'ava' or a.slug like 'ava-%')) or (not v_personal and (a.slug like 'roofguard-%' or a.slug like 'rg-%')))
       and not (v_personal and x.j = 'ava-morning-brief')   -- has its own light below
     order by 1
  loop
    v_n := v_n + 1;
    declare c record; begin
      select j.schedule, j.active, d.status as last_status, d.start_time as last_start into c
        from cron.job j left join lateral (select status, start_time from cron.job_run_details dd where dd.jobid = j.jobid order by start_time desc limit 1) d on true
       where j.jobname = r.job limit 1;
      v_jstate := 'ok'; v_jdetail := null;
      if c.schedule is null then
        v_jstate := 'warn'; v_jdetail := 'is on the team card but has no schedule';
      else
        v_m := split_part(c.schedule, ' ', 1); v_h := split_part(c.schedule, ' ', 2); v_dow := split_part(c.schedule, ' ', 5);
        if v_dow <> '*' then v_allowed := case when v_dow ~ '[-,]' then 100 * 60 else 192 * 60 end;
        elsif v_h ~ '[-,/]' then v_allowed := null;                     -- runs only inside a window of hours: judged by its last status only
        elsif v_h <> '*' then v_allowed := 26 * 60;
        elsif v_m ~ '/' then v_allowed := 3 * split_part(v_m, '/', 2)::int + 5;
        else v_allowed := 65; end if;
        if not coalesce(c.active, false) then v_jstate := 'warn'; v_jdetail := 'is switched off';
        elsif c.last_start is null then
          if v_allowed is not null and v_allowed <= 65 then v_jstate := 'warn'; v_jdetail := 'has no run on record';
          else v_pend := v_pend + 1; end if;
        else
          v_newest := greatest(coalesce(v_newest, c.last_start), c.last_start);
          v_age := extract(epoch from now() - c.last_start) / 60;
          if c.last_status = 'failed' then v_jstate := 'down'; v_jdetail := 'failed its last run at ' || ava_lights_when(c.last_start);
          elsif v_allowed is not null and v_age > 2 * v_allowed then v_jstate := 'down'; v_jdetail := 'has not run since ' || ava_lights_when(c.last_start);
          elsif v_allowed is not null and v_age > v_allowed then v_jstate := 'warn'; v_jdetail := 'is late, last ran ' || ava_lights_when(c.last_start); end if;
        end if;
      end if;
    end;
    if v_jstate = 'down' then v_down := v_down + 1; elsif v_jstate = 'warn' then v_warn := v_warn + 1; end if;
    if v_jstate <> 'ok' then
      v_names := v_names || r.job;
      v_items := v_items || jsonb_build_object('name', r.job, 'state', v_jstate, 'detail', r.job || ' ' || v_jdetail);
    end if;
  end loop;
  if v_n = 0 then
    v_out := v_out || ava_light('jobs', 'Background jobs', 'off', 'No scheduled jobs are listed on her team card.', now());
  elsif v_down + v_warn > 0 then
    v_out := v_out || ava_light('jobs', 'Background jobs', case when v_down > 0 then 'down' else 'warn' end,
      (v_down + v_warn) || ' of ' || v_n || ' jobs ' || case when v_down + v_warn = 1 then 'needs' else 'need' end || ' a look: ' || array_to_string(v_names, ', ') || '.',
      coalesce(v_newest, now()), null, v_items);
  else
    v_out := v_out || ava_light('jobs', 'Background jobs', 'ok',
      'All ' || v_n || ' jobs ran on time.' || case when v_pend > 0 then ' ' || v_pend || ' still waiting on a first run.' else '' end,
      coalesce(v_newest, now()));
  end if;

  -- 4. coach: the same watch numbers admin_coach_manage returns
  if v_personal then
    select count(*) into v_waiting from ava_calls c where c.transcript is not null and jsonb_array_length(c.transcript) > 2 and coalesce(c.duration_sec, 0) >= 10
       and c.deleted_at is null and coalesce(c.ended_at, c.created_at) between now() - interval '3 days' and now() - interval '30 minutes'
       and not exists (select 1 from ava_call_reviews rv where rv.call_id = c.id and rv.status <> 'failed');
    select max(updated_at) into v_last_done from ava_call_reviews where status = 'done';
    select count(*) into v_n7 from ava_call_reviews where status = 'done' and created_at > now() - interval '7 days';
    select exists (select 1 from ava_call_reviews where status = 'failed' and updated_at > now() - interval '1 hour' and error ilike 'free AI%')
       and not exists (select 1 from ava_call_reviews where status = 'done' and updated_at > now() - interval '1 hour') into v_ai_bad;
    select exists (select 1 from monitor_issues where key = 'ava.coach' and status = 'open') into v_behind;
  else
    select count(*) into v_waiting from rg_calls c where c.transcript is not null and jsonb_array_length(c.transcript) > 2 and coalesce(c.duration_sec, 0) >= 10
       and c.deleted_at is null and coalesce(c.ended_at, c.updated_at) between now() - interval '3 days' and now() - interval '30 minutes'
       and not exists (select 1 from rg_call_reviews rv where rv.call_id = c.id and rv.status <> 'failed');
    select max(updated_at) into v_last_done from rg_call_reviews where status = 'done';
    select count(*) into v_n7 from rg_call_reviews where status = 'done' and created_at > now() - interval '7 days';
    select exists (select 1 from rg_call_reviews where status = 'failed' and updated_at > now() - interval '1 hour' and error ilike 'free AI%')
       and not exists (select 1 from rg_call_reviews where status = 'done' and updated_at > now() - interval '1 hour') into v_ai_bad;
    select exists (select 1 from monitor_issues where key = 'rg.coach' and status = 'open') into v_behind;
  end if;
  if coalesce(v_behind, false) then
    v_out := v_out || ava_light('coach', 'Coach', 'warn', 'Call reviews are running behind. ' || v_waiting || ' ' || case when v_waiting = 1 then 'call is' else 'calls are' end || ' waiting.', coalesce(v_last_done, now()));
  elsif coalesce(v_ai_bad, false) then
    v_out := v_out || ava_light('coach', 'Coach', 'warn', 'The free AI that reviews calls is failing. Reviews wait until it recovers.', coalesce(v_last_done, now()));
  else
    v_out := v_out || ava_light('coach', 'Coach', 'ok',
      case when v_last_done is null then 'No calls reviewed yet.' else 'Reviewed ' || v_n7 || ' ' || case when v_n7 = 1 then 'call' else 'calls' end || ' this week. Last review ' || ava_lights_when(v_last_done) || '.' end
        || case when v_waiting > 0 then ' ' || v_waiting || ' waiting.' else '' end,
      coalesce(v_last_done, now()));
  end if;

  -- 5. spend: over the daily cap pauses outgoing calls (incoming are always answered)
  sp := ava_spend_calc(p_source);
  if (sp ->> 'over')::boolean then
    v_out := v_out || ava_light('spend', 'Spend', 'warn',
      'Outgoing calls paused. $' || to_char((sp ->> 'today')::numeric, 'FM999990.00') || ' spent of the $' || to_char((sp ->> 'cap')::numeric, 'FM999990.00') || ' daily cap. Incoming calls still answered.', now(), 'Over cap');
  else
    v_out := v_out || ava_light('spend', 'Spend', 'ok',
      'Today $' || to_char((sp ->> 'today')::numeric, 'FM999990.00') || ' of the $' || to_char((sp ->> 'cap')::numeric, 'FM999990.00') || ' daily cap.', now());
  end if;

  if v_personal then
    select * into av from ava_settings where id;

    -- 6. calendars: stored health of each calendar provider she reads (checked hourly by the watchdog)
    cal := coalesce(av.calendars, '{}'::jsonb);
    v_bad := '{}'; v_stale := '{}'; v_miss := '{}'; v_provs := 0; v_cal_checked := null;
    for prov in select distinct split_part(x, '|', 1) from jsonb_array_elements_text(coalesce(cal -> 'selected', '[]'::jsonb)) x loop
      v_provs := v_provs + 1;
      ck := cal -> 'checked' -> prov;
      if ck is null then v_miss := v_miss || (case prov when 'icloud' then 'iCloud' when 'nextcloud' then 'Nextcloud' else initcap(prov) end);
      else
        begin v_cal_checked := least(coalesce(v_cal_checked, (ck ->> 'at')::timestamptz), (ck ->> 'at')::timestamptz); exception when others then null; end;
        if coalesce((ck ->> 'ok')::boolean, false) is not true then v_bad := v_bad || (case prov when 'icloud' then 'iCloud' when 'nextcloud' then 'Nextcloud' else initcap(prov) end || ' (' || coalesce(ck ->> 'error', 'login failed') || ')');
        elsif (ck ->> 'at')::timestamptz < now() - interval '3 hours' then v_stale := v_stale || (case prov when 'icloud' then 'iCloud' when 'nextcloud' then 'Nextcloud' else initcap(prov) end);
        end if;
      end if;
    end loop;
    if v_provs = 0 then
      v_out := v_out || ava_light('calendars', 'Calendars', 'off', 'No calendars selected, so she cannot check or book your time.', now(), 'Not set up');
    elsif array_length(v_bad, 1) > 0 then
      v_out := v_out || ava_light('calendars', 'Calendars', 'down', 'Cannot read ' || array_to_string(v_bad, '; ') || '.', coalesce(v_cal_checked, now()));
    elsif array_length(v_stale, 1) > 0 or array_length(v_miss, 1) > 0 then
      v_out := v_out || ava_light('calendars', 'Calendars', 'warn',
        case when array_length(v_stale, 1) > 0 then 'The hourly check is overdue for ' || array_to_string(v_stale, ' and ') || '. ' else '' end
        || case when array_length(v_miss, 1) > 0 then array_to_string(v_miss, ' and ') || ' saved but not checked yet.' else '' end, coalesce(v_cal_checked, now()));
    else
      v_out := v_out || ava_light('calendars', 'Calendars', 'ok', 'Reading ' || v_provs || ' ' || case when v_provs = 1 then 'calendar account' else 'calendar accounts' end || '.', coalesce(v_cal_checked, now()));
    end if;

    -- 7. cell forwarding
    select max(created_at) into v_last_fwd from ava_calls where forwarded and deleted_at is null;
    if not coalesce(av.forward_enabled, false) then
      v_out := v_out || ava_light('cell', 'Cell forwarding', 'off', 'Off. Calls you miss on your cell do not go to Ava.', now(), 'Off');
    elsif av.jared_voice_paused_at is not null and av.forward_voice = 'jared' then
      v_out := v_out || ava_light('cell', 'Cell forwarding', 'warn', 'On, but your voice is paused, so Ava answers in her own voice.', coalesce(v_last_fwd, now()));
    else
      v_out := v_out || ava_light('cell', 'Cell forwarding', 'ok',
        'On.' || case when v_last_fwd is not null then ' Last forwarded call ' || ava_lights_when(v_last_fwd) || '.' else ' No forwarded call yet.' end, coalesce(v_last_fwd, now()));
    end if;

    -- 8. morning brief
    v_min := extract(hour from (now() at time zone 'America/Los_Angeles'))::int * 60 + extract(minute from (now() at time zone 'America/Los_Angeles'))::int;
    select * into bl from ava_brief_log where day = v_pt_day;
    if not coalesce(av.brief_enabled, true) then
      v_out := v_out || ava_light('brief', 'Morning brief', 'off', 'Off. Turn it on in Settings.', now(), 'Off');
    elsif bl.day is not null and bl.status = 'sent' then
      v_out := v_out || ava_light('brief', 'Morning brief', 'ok', 'Sent today at ' || ava_lights_clock(bl.at) || '.', bl.at);
    elsif bl.day is not null and bl.status = 'skipped' then
      v_out := v_out || ava_light('brief', 'Morning brief', 'ok', 'Nothing to say today, so no push went out.', bl.at);
    elsif bl.day is not null and bl.status = 'failed' then
      v_out := v_out || ava_light('brief', 'Morning brief', 'down', 'Today''s brief failed. ' || coalesce(bl.note, ''), bl.at);
    elsif v_min > coalesce(av.brief_minute, 480) + 15 then
      v_out := v_out || ava_light('brief', 'Morning brief', 'warn', 'Due at ' || ava_lights_clock(date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles' + make_interval(mins => coalesce(av.brief_minute, 480))) || ' and nothing is logged yet.', now());
    else
      v_out := v_out || ava_light('brief', 'Morning brief', 'ok', 'Next one at ' || ava_lights_clock(date_trunc('day', now() at time zone 'America/Los_Angeles') at time zone 'America/Los_Angeles' + make_interval(mins => coalesce(av.brief_minute, 480))) || ' Pacific.', now());
    end if;
  else
    -- RoofGuard only: calling on or paused. Paused is gray, not a fault: the pilot waits on purpose.
    select * into rs from rg_settings where id;
    if coalesce(rs.calling_enabled, false) then
      v_out := v_out || ava_light('calling', 'Calling', 'ok', 'On. Weekdays in business hours, up to ' || rs.daily_cap || ' calls a day.', coalesce(rs.updated_at, now()), 'On');
    else
      v_out := v_out || ava_light('calling', 'Calling', 'off', 'Paused on purpose. Start the pilot in Setup when you are ready.', coalesce(rs.updated_at, now()), 'Paused');
    end if;
  end if;

  return v_out;
end $$;

revoke all on function public.ava_status_lights(text) from public, anon;
grant execute on function public.ava_status_lights(text) to authenticated, service_role;
