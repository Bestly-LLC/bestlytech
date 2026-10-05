-- 2026-10-05 Coach manager UI (Jared: "why is there no UI for the coach ... to delete rules or edit them or do anything
-- administrative towards the rules"). Adds the admin RPCs the new Coach section on /admin/ava and /admin/roofguard needs.
-- Everything is admin-only (team_is_admin(), the same gate as admin_playbook_set). Existing Coach functions are kept as they
-- are, except two tiny changes so the two new Coach settings actually work:
--   coach_propose        rg: a small rule starts testing on its own only while rg_settings.coach_auto_test is on
--                        ava: a coach rule needs Jared's tap only while ava_settings.coach_needs_approval is on
--   rg_playbook_decide   the "waiting small rule starts testing when a slot opens" step follows coach_auto_test too, and a test
--                        only counts calls from its started_at on (so editing a testing rule can restart it at zero)
-- Both default to the old behavior (on). Nothing here places calls or touches prompts, voices or the RoofGuard pilot.

alter table public.rg_settings  add column if not exists coach_auto_test boolean not null default true;
alter table public.ava_settings add column if not exists coach_needs_approval boolean not null default true;

-- ------------------------------------------------------------------ create or edit a rule
-- Returns {ok:true, row, restarted} or {ok:false, refused:'<reason>'} (the hard-rule guard, length, or a duplicate).
--   new rule  -> origin 'jared'. Personal Ava: live right away. RoofGuard: small = testing now, big = live (the UI confirms first).
--   edit      -> re-runs playbook_guard. Editing the wording of a RoofGuard rule that is testing restarts its test:
--                started_at = now (the counts only look at calls from then on, so they start at 0); the old counts are kept in result.previous.
create or replace function public.admin_playbook_upsert(p_source text, p_id uuid, p_rule text, p_why text, p_kind text, p_size text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_rule text := regexp_replace(trim(coalesce(p_rule, '')), '\s+', ' ', 'g');
  v_why text := left(nullif(trim(coalesce(p_why, '')), ''), 500);
  v_kind text := case when p_kind in ('comeback','wording','pacing','close','flow') then p_kind else 'other' end;
  v_size text := case when p_size = 'big' then 'big' else 'small' end;
  v_bad text; v_dup text; v_id uuid; v_status text; v_restart boolean := false; v_old record; v_prev jsonb; v_row jsonb;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_source not in ('roofguard', 'ava') then raise exception 'source must be roofguard or ava'; end if;
  if length(v_rule) > 240 then return jsonb_build_object('ok', false, 'refused', 'too long (240 characters at most)'); end if;
  v_bad := playbook_guard(v_rule);
  if v_bad is not null then return jsonb_build_object('ok', false, 'refused', v_bad); end if;

  -- the same idea already in play (not itself)
  if p_source = 'roofguard' then
    select rule into v_dup from rg_playbook where status in ('proposed','testing','live') and id is distinct from p_id and text_overlap(rule, v_rule) >= 0.8 limit 1;
  else
    select rule into v_dup from ava_playbook where status in ('proposed','live') and id is distinct from p_id and text_overlap(rule, v_rule) >= 0.8 limit 1;
  end if;
  if v_dup is not null then return jsonb_build_object('ok', false, 'refused', 'she already has a rule like this: "' || left(v_dup, 80) || '"'); end if;

  if p_id is null then
    if p_source = 'roofguard' then
      v_status := case when v_size = 'small' then 'testing' else 'live' end;
      insert into rg_playbook (rule, why, kind, size, status, origin, started_at, decided_at)
      values (v_rule, v_why, v_kind, v_size, v_status, 'jared', case when v_status = 'testing' then now() end, case when v_status = 'live' then now() end)
      returning id into v_id;
      select to_jsonb(p) into v_row from rg_playbook p where p.id = v_id;
    else
      insert into ava_playbook (rule, why, kind, size, status, origin, decided_at)
      values (v_rule, v_why, v_kind, v_size, 'live', 'jared', now())
      returning id into v_id;
      select to_jsonb(p) into v_row from ava_playbook p where p.id = v_id;
    end if;
    return jsonb_build_object('ok', true, 'row', v_row, 'restarted', false);
  end if;

  if p_source = 'roofguard' then
    select * into v_old from rg_playbook where id = p_id for update;
    if v_old.id is null then return jsonb_build_object('ok', false, 'refused', 'that rule is gone'); end if;
    if v_old.status = 'testing' and v_old.rule is distinct from v_rule then
      v_restart := true;
      select jsonb_build_object('calls_with', count(*) filter (where (c.playbook_arms->>p_id::text)::boolean),
                                'calls_without', count(*) filter (where not (c.playbook_arms->>p_id::text)::boolean)) into v_prev
        from rg_calls c
       where c.playbook_arms ? p_id::text and not coalesce(c.is_test, false) and coalesce(c.outcome, '') not in ('no_answer', 'voicemail_left', '')
         and coalesce(c.ended_at, c.queued_at, c.updated_at) >= coalesce(v_old.started_at, v_old.created_at);
    end if;
    update rg_playbook set rule = v_rule, why = v_why, kind = v_kind, size = v_size, updated_at = now(),
           started_at = case when v_restart then now() else started_at end,
           result = case when v_restart then jsonb_build_object('restarted_at', now(), 'previous', v_prev) else result end
     where id = p_id;
    select to_jsonb(p) into v_row from rg_playbook p where p.id = p_id;
  else
    select * into v_old from ava_playbook where id = p_id for update;
    if v_old.id is null then return jsonb_build_object('ok', false, 'refused', 'that rule is gone'); end if;
    update ava_playbook set rule = v_rule, why = v_why, kind = v_kind, size = v_size, updated_at = now() where id = p_id;
    select to_jsonb(p) into v_row from ava_playbook p where p.id = p_id;
  end if;
  return jsonb_build_object('ok', true, 'row', v_row, 'restarted', v_restart);
end $$;
revoke all on function public.admin_playbook_upsert(text, uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_playbook_upsert(text, uuid, text, text, text, text) to authenticated, service_role;

-- ------------------------------------------------------------------ remove a rule for good
-- The rule goes, and any Reply guard issue that pointed at it goes back to "needs you". (Old call records keep their
-- arm flags; nothing reads a flag whose rule is gone.)
create or replace function public.admin_playbook_delete(p_source text, p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v_n int := 0;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_source not in ('roofguard', 'ava') then raise exception 'source must be roofguard or ava'; end if;
  update ava_reply_incidents set playbook_id = null, action_at = now(),
         action_state = case when action_state in ('coach_testing', 'coach_learned') then 'needs_you' else action_state end
   where source = p_source and playbook_id = p_id;
  if p_source = 'roofguard' then
    delete from rg_playbook where id = p_id;
  else
    delete from ava_playbook where id = p_id;
  end if;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_n > 0);
end $$;
revoke all on function public.admin_playbook_delete(text, uuid) from public, anon;
grant execute on function public.admin_playbook_delete(text, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ what the Coach section reads (on top of admin_coach)
-- every rule (admin_coach hides old declined ones), the two Coach settings, the Coach's own health (what coach_watch checks),
-- and when the weekly pass last ran.
create or replace function public.admin_coach_manage(p_source text) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
declare v_rules jsonb; v_set jsonb; v_waiting int; v_last_done timestamptz; v_issue boolean; v_week timestamptz; v_n7 int; v_ai_bad boolean;
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_source not in ('roofguard', 'ava') then raise exception 'source must be roofguard or ava'; end if;
  begin
    select max(d.start_time) into v_week from cron.job_run_details d join cron.job j on j.jobid = d.jobid
     where j.jobname = 'ava-coach-weekly' and d.status = 'succeeded';
  exception when others then v_week := null;
  end;

  if p_source = 'roofguard' then
    select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object(
             'calls_used', (select count(*) from rg_calls c where c.deleted_at is null and not coalesce(c.is_test, false) and c.ended_at is not null
                 and (((c.playbook_arms->>p.id::text)::boolean is true and (p.status <> 'testing' or c.ended_at >= coalesce(p.started_at, p.created_at)))
                      or (p.status = 'live' and not (c.playbook_arms ? p.id::text) and c.ended_at >= coalesce(p.decided_at, p.created_at)))),
             'test', case when p.status = 'testing' then (
               select jsonb_build_object(
                 'with',    jsonb_build_object('n', count(*) filter (where t.arm), 'booked', count(*) filter (where t.arm and t.outcome = 'booked'),
                                               'kept', count(*) filter (where t.arm and t.kept)),
                 'without', jsonb_build_object('n', count(*) filter (where not t.arm), 'booked', count(*) filter (where not t.arm and t.outcome = 'booked'),
                                               'kept', count(*) filter (where not t.arm and t.kept)))
                 from (select (c.playbook_arms->>p.id::text)::boolean arm, c.outcome, coalesce(c.kept_talking, false) kept
                         from rg_calls c
                        where c.playbook_arms ? p.id::text and not coalesce(c.is_test, false) and coalesce(c.direction, 'outbound') = 'outbound'
                          and coalesce(c.outcome, '') not in ('no_answer', 'voicemail_left', '')
                          and coalesce(c.ended_at, c.queued_at, c.updated_at) >= coalesce(p.started_at, p.created_at)) t) end
           ) order by p.created_at desc), '[]') into v_rules from rg_playbook p;
    select jsonb_build_object('auto_test', coalesce(coach_auto_test, true)) into v_set from rg_settings where id;
    select count(*) into v_waiting from rg_calls c where c.transcript is not null and jsonb_array_length(c.transcript) > 2 and coalesce(c.duration_sec, 0) >= 10
       and c.deleted_at is null and coalesce(c.ended_at, c.updated_at) between now() - interval '3 days' and now() - interval '30 minutes'
       and not exists (select 1 from rg_call_reviews r where r.call_id = c.id and r.status <> 'failed');
    select max(updated_at) into v_last_done from rg_call_reviews where status = 'done';
    select count(*) into v_n7 from rg_call_reviews where status = 'done' and created_at > now() - interval '7 days';
    select exists (select 1 from rg_call_reviews where status = 'failed' and updated_at > now() - interval '1 hour' and error ilike 'free AI%') and
           not exists (select 1 from rg_call_reviews where status = 'done' and updated_at > now() - interval '1 hour') into v_ai_bad;
    select exists (select 1 from monitor_issues where key = 'rg.coach' and status = 'open') into v_issue;
  else
    select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('calls_used',
             (select count(*) from ava_calls c where c.deleted_at is null and p.status = 'live'
                 and coalesce(c.ended_at, c.created_at) >= coalesce(p.decided_at, p.created_at))
           ) order by p.created_at desc), '[]') into v_rules from ava_playbook p;
    select jsonb_build_object('needs_approval', coalesce(coach_needs_approval, true)) into v_set from ava_settings where id;
    select count(*) into v_waiting from ava_calls c where c.transcript is not null and jsonb_array_length(c.transcript) > 2 and coalesce(c.duration_sec, 0) >= 10
       and c.deleted_at is null and coalesce(c.ended_at, c.created_at) between now() - interval '3 days' and now() - interval '30 minutes'
       and not exists (select 1 from ava_call_reviews r where r.call_id = c.id and r.status <> 'failed');
    select max(updated_at) into v_last_done from ava_call_reviews where status = 'done';
    select count(*) into v_n7 from ava_call_reviews where status = 'done' and created_at > now() - interval '7 days';
    select exists (select 1 from ava_call_reviews where status = 'failed' and updated_at > now() - interval '1 hour' and error ilike 'free AI%') and
           not exists (select 1 from ava_call_reviews where status = 'done' and updated_at > now() - interval '1 hour') into v_ai_bad;
    select exists (select 1 from monitor_issues where key = 'ava.coach' and status = 'open') into v_issue;
  end if;
  return jsonb_build_object('playbook', v_rules, 'settings', coalesce(v_set, '{}'::jsonb), 'last_weekly', v_week, 'reviewed_7d', v_n7,
    'watch', jsonb_build_object('waiting', v_waiting, 'behind', coalesce(v_issue, false), 'last_review_at', v_last_done),
    'ai_ok', not coalesce(v_ai_bad, false));
end $$;
revoke all on function public.admin_coach_manage(text) from public, anon;
grant execute on function public.admin_coach_manage(text) to authenticated, service_role;

-- ------------------------------------------------------------------ the calls that used a rule
-- RoofGuard: calls on the "with the rule" arm while it was testing, plus every real call after it went live.
-- Personal Ava: every call since it went live.
create or replace function public.admin_playbook_calls(p_source text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_source = 'roofguard' then
    return (select coalesce(jsonb_agg(x order by x.at desc), '[]') from (
      select c.id call_id, c.call_no, c.ended_at at, l.company who, c.lead_id, c.direction, c.outcome, r.overall,
             case when (c.playbook_arms->>p_id::text)::boolean is true then 'testing' else 'live' end phase
        from rg_playbook p join rg_calls c on c.deleted_at is null and not coalesce(c.is_test, false) and c.ended_at is not null
         and (((c.playbook_arms->>p.id::text)::boolean is true and (p.status <> 'testing' or c.ended_at >= coalesce(p.started_at, p.created_at)))
              or (p.status = 'live' and not (c.playbook_arms ? p.id::text) and c.ended_at >= coalesce(p.decided_at, p.created_at)))
        left join rg_leads l on l.id = c.lead_id
        left join rg_call_reviews r on r.call_id = c.id and r.status = 'done'
       where p.id = p_id order by c.ended_at desc limit 40) x);
  end if;
  return (select coalesce(jsonb_agg(x order by x.at desc), '[]') from (
    select c.id call_id, c.call_no, coalesce(c.ended_at, c.created_at) at, coalesce(c.caller_name, c.purpose) who, null::uuid lead_id,
           c.direction, null::text outcome, r.overall, 'live' phase
      from ava_playbook p join ava_calls c on c.deleted_at is null and p.status = 'live' and coalesce(c.ended_at, c.created_at) >= coalesce(p.decided_at, p.created_at)
      left join ava_call_reviews r on r.call_id = c.id and r.status = 'done'
     where p.id = p_id order by coalesce(c.ended_at, c.created_at) desc limit 40) x);
end $$;
revoke all on function public.admin_playbook_calls(text, uuid) from public, anon;
grant execute on function public.admin_playbook_calls(text, uuid) to authenticated, service_role;

-- ------------------------------------------------------------------ the reviews feed (call date + lead, which admin_coach.reviews lacks)
create or replace function public.admin_coach_feed(p_source text, p_limit int default 25) returns jsonb
language plpgsql stable security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_source = 'roofguard' then
    return (select coalesce(jsonb_agg(x order by x.at desc), '[]') from (
      select r.call_id, r.call_no, coalesce(c.ended_at, r.created_at) at, l.company who, c.lead_id, c.direction, c.outcome, r.scores, r.objections,
             r.went_well, r.work_on, r.rule_flags, r.overall, r.confidence
        from rg_call_reviews r join rg_calls c on c.id = r.call_id left join rg_leads l on l.id = c.lead_id
       where r.status = 'done' and c.deleted_at is null and not coalesce(c.is_test, false)
       order by coalesce(c.ended_at, r.created_at) desc limit least(coalesce(p_limit, 25), 60)) x);
  end if;
  return (select coalesce(jsonb_agg(x order by x.at desc), '[]') from (
    select r.call_id, r.call_no, coalesce(c.ended_at, c.created_at) at, coalesce(c.caller_name, c.purpose) who, null::uuid lead_id, c.direction,
           null::text outcome, r.scores, '{}'::text[] objections, r.went_well, r.work_on, r.rule_flags, r.overall, null::numeric confidence
      from ava_call_reviews r join ava_calls c on c.id = r.call_id
     where r.status = 'done' and c.deleted_at is null
     order by coalesce(c.ended_at, c.created_at) desc limit least(coalesce(p_limit, 25), 60)) x);
end $$;
revoke all on function public.admin_coach_feed(text, int) from public, anon;
grant execute on function public.admin_coach_feed(text, int) to authenticated, service_role;

-- ------------------------------------------------------------------ the two Coach settings
-- roofguard: auto-test small rules (rg_settings.coach_auto_test). ava: personal rules need approval (ava_settings.coach_needs_approval).
create or replace function public.admin_coach_setting_set(p_source text, p_on boolean) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not team_is_admin() then raise exception 'not allowed'; end if;
  if p_source = 'roofguard' then
    update rg_settings set coach_auto_test = coalesce(p_on, true) where id;
  elsif p_source = 'ava' then
    update ava_settings set coach_needs_approval = coalesce(p_on, true) where id;
  else
    raise exception 'source must be roofguard or ava';
  end if;
  return jsonb_build_object('ok', true, 'on', coalesce(p_on, true));
end $$;
revoke all on function public.admin_coach_setting_set(text, boolean) from public, anon;
grant execute on function public.admin_coach_setting_set(text, boolean) to authenticated, service_role;

-- ------------------------------------------------------------------ wiring the settings into the Coach (two small changes)
create or replace function public.coach_propose(p_source text, p_rules jsonb) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare r jsonb; v_bad text; v_kept int := 0; v_rejected jsonb := '[]'; v_testing int; v_status text; v_tbl text;
begin
  v_tbl := case when p_source = 'roofguard' then 'rg_playbook' else 'ava_playbook' end;
  for r in select * from jsonb_array_elements(coalesce(p_rules, '[]')) limit 3 loop
    v_bad := playbook_guard(r->>'rule');
    if v_bad is not null then v_rejected := v_rejected || jsonb_build_object('rule', r->>'rule', 'why', v_bad); continue; end if;
    -- same idea already in play
    if p_source = 'roofguard' then
      continue when exists (select 1 from rg_playbook p where p.status in ('proposed','testing','live') and text_overlap(p.rule, r->>'rule') >= 0.6);
      select count(*) into v_testing from rg_playbook where status = 'testing';
      v_status := case when coalesce(r->>'size', 'small') = 'small' and v_testing < 2
                        and coalesce((select coach_auto_test from rg_settings where id), true) then 'testing' else 'proposed' end;
      insert into rg_playbook (rule, why, kind, size, status, started_at)
      values (trim(r->>'rule'), left(r->>'why', 500),
              case when r->>'kind' in ('comeback','wording','pacing','close','flow') then r->>'kind' else 'other' end,
              case when r->>'size' = 'big' then 'big' else 'small' end, v_status, case when v_status = 'testing' then now() end);
    else
      continue when exists (select 1 from ava_playbook p where p.status in ('proposed','live') and text_overlap(p.rule, r->>'rule') >= 0.6);
      v_status := case when coalesce((select coach_needs_approval from ava_settings where id), true) then 'proposed' else 'live' end;
      insert into ava_playbook (rule, why, kind, size, status, decided_at)
      values (trim(r->>'rule'), left(r->>'why', 500),
              case when r->>'kind' in ('comeback','wording','pacing','close','flow') then r->>'kind' else 'other' end,
              case when r->>'size' = 'big' then 'big' else 'small' end, v_status, case when v_status = 'live' then now() end);
    end if;
    v_kept := v_kept + 1;
  end loop;
  return jsonb_build_object('kept', v_kept, 'rejected', v_rejected);
end $$;
revoke all on function public.coach_propose(text, jsonb) from public, anon, authenticated;
grant execute on function public.coach_propose(text, jsonb) to service_role;

create or replace function public.rg_playbook_decide() returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare p record; s record; v_done int := 0; v_verdict text; v_owner text := 'RoofGuard Ava';
begin
  for p in select * from rg_playbook where status = 'testing' loop
    select count(*) filter (where (c.playbook_arms->>p.id::text)::boolean) n_on,
           count(*) filter (where not (c.playbook_arms->>p.id::text)::boolean) n_off,
           coalesce(3 * avg((c.outcome = 'booked')::int) filter (where (c.playbook_arms->>p.id::text)::boolean), 0)
             + coalesce(avg(coalesce(c.kept_talking, false)::int) filter (where (c.playbook_arms->>p.id::text)::boolean), 0)
             + 0.1 * coalesce(avg(r.overall) filter (where (c.playbook_arms->>p.id::text)::boolean), 0) s_on,
           coalesce(3 * avg((c.outcome = 'booked')::int) filter (where not (c.playbook_arms->>p.id::text)::boolean), 0)
             + coalesce(avg(coalesce(c.kept_talking, false)::int) filter (where not (c.playbook_arms->>p.id::text)::boolean), 0)
             + 0.1 * coalesce(avg(r.overall) filter (where not (c.playbook_arms->>p.id::text)::boolean), 0) s_off
      into s
      from rg_calls c left join rg_call_reviews r on r.call_id = c.id and r.status = 'done'
     where c.playbook_arms ? p.id::text and not coalesce(c.is_test, false) and coalesce(c.direction, 'outbound') = 'outbound'
       and coalesce(c.outcome, '') not in ('no_answer', 'voicemail_left', '')
       and coalesce(c.ended_at, c.queued_at, c.updated_at) >= coalesce(p.started_at, p.created_at);
    v_verdict := case
      when s.n_on >= 40 and s.n_off >= 40 then case when s.s_on >= s.s_off then 'live' else 'rolled_back' end
      when s.n_on >= 20 and s.n_off >= 20 and s.s_off > 0 and s.s_on < 0.5 * s.s_off then 'rolled_back'
      when p.started_at < now() - interval '21 days' then case when s.n_on >= 15 and s.n_off >= 15 and s.s_on >= s.s_off then 'live' else 'rolled_back' end
    end;
    continue when v_verdict is null;
    update rg_playbook set status = v_verdict, decided_at = now(), updated_at = now(),
           result = jsonb_build_object('calls_with', s.n_on, 'calls_without', s.n_off, 'score_with', round(s.s_on, 3), 'score_without', round(s.s_off, 3))
     where id = p.id;
    perform scout_notify(p_title => v_owner || ': ' || case when v_verdict = 'live' then 'a new move worked, keeping it' else 'a new move didn''t help, rolled it back' end,
      p_body => '"' || p.rule || '" ' || format('(%s calls with it, %s without).', s.n_on, s.n_off),
      p_severity => 'info', p_push => false, p_url => '/admin/roofguard#scorecard', p_dedupe => 'rg-playbook-' || p.id || '-' || v_verdict);
    v_done := v_done + 1;
  end loop;
  -- a waiting small change starts testing when a slot opens (only while auto-test is on)
  update rg_playbook set status = 'testing', started_at = now(), updated_at = now()
   where coalesce((select coach_auto_test from rg_settings where id), true)
     and id in (select id from rg_playbook where status = 'proposed' and size = 'small' and origin = 'coach'
                 order by created_at limit greatest(0, 2 - (select count(*) from rg_playbook where status = 'testing')));
  return jsonb_build_object('decided', v_done);
end $$;
revoke all on function public.rg_playbook_decide() from public, anon, authenticated;
