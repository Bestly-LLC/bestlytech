-- Reply guard becomes a to-do list (docs/ava-next-opusplan.md section 3, 2026-10-05).
-- Every incident row gets a status and real buttons:
--   auto_fixed     the guard already self-healed (a model switch)            Undo fix, Mark reviewed
--   coach_testing  the Coach has a rule from it, waiting or being tested     See the rule, Mark reviewed
--   coach_learned  the rule won its test and is live                         See the rule, Mark reviewed
--   needs_you      nothing automatic fixed it                                Teach the Coach, Ask Scout to fix, Ignore
--   scout_has_it   Jared asked Scout to fix it (Scout's existing ask path)   Mark done
--   ignored        Jared decided it does not matter
-- Hooks into the Coach and never changes it: it calls coach_propose() (which guards the hard rules) and reads the playbook tables.

alter table public.ava_reply_incidents
  add column if not exists action_state text not null default 'needs_you'
    check (action_state in ('auto_fixed', 'coach_testing', 'coach_learned', 'needs_you', 'scout_has_it', 'ignored')),
  add column if not exists playbook_id uuid,
  add column if not exists scout_task_ref text,
  add column if not exists action_at timestamptz;

-- history: a model switch is an automatic fix; everything else was waiting on Jared
update public.ava_reply_incidents set action_state = 'auto_fixed' where healed ilike 'switched %' and action_state = 'needs_you';

-- new incidents: when the guard records its model switch, the row becomes auto_fixed
create or replace function public.ava_incident_state_trg() returns trigger language plpgsql as $$
begin
  if new.healed ilike 'switched %' and new.action_state = 'needs_you' then
    new.action_state := 'auto_fixed'; new.action_at := now();
  end if;
  return new;
end $$;
create or replace trigger ava_incident_state before insert or update of healed on public.ava_reply_incidents
  for each row execute function public.ava_incident_state_trg();

-- keep the state in step with the Coach's playbook (a rule moves from testing to live, or is rolled back)
create or replace function public.ava_incident_sync() returns int
language plpgsql security definer set search_path to 'public' as $$
declare n int := 0; k int;
begin
  update ava_reply_incidents i set action_state = case p.status when 'live' then 'coach_learned' when 'testing' then 'coach_testing' when 'proposed' then 'coach_testing' else 'needs_you' end, action_at = now()
    from rg_playbook p
   where i.source = 'roofguard' and i.playbook_id = p.id and i.action_state in ('coach_testing', 'coach_learned', 'needs_you')
     and i.action_state is distinct from (case p.status when 'live' then 'coach_learned' when 'testing' then 'coach_testing' when 'proposed' then 'coach_testing' else 'needs_you' end);
  get diagnostics k = row_count; n := n + k;
  update ava_reply_incidents i set action_state = case p.status when 'live' then 'coach_learned' when 'testing' then 'coach_testing' when 'proposed' then 'coach_testing' else 'needs_you' end, action_at = now()
    from ava_playbook p
   where i.source = 'ava' and i.playbook_id = p.id and i.action_state in ('coach_testing', 'coach_learned', 'needs_you')
     and i.action_state is distinct from (case p.status when 'live' then 'coach_learned' when 'testing' then 'coach_testing' when 'proposed' then 'coach_testing' else 'needs_you' end);
  get diagnostics k = row_count; n := n + k;
  return n;
end $$;
revoke all on function public.ava_incident_sync() from public, anon, authenticated;

-- the one-line instruction each kind of incident teaches (fixed text, no AI). null = the Coach may not touch it.
create or replace function public.ava_incident_rule(p_kind text, p_subkind text, p_leak boolean) returns text
language sql immutable as $$
  select case
    when p_subkind = 'impersonation' then null
    when p_leak then 'Never share private details about Jared, such as his phone, address or logins. Only share what is on the approved list.'
    when p_subkind = 'long_call' then 'If a call is going nowhere after about two minutes, wrap up politely and offer to pass a message on.'
    when p_kind = 'code_leak' then 'Never say tool names, function names or code out loud. If a tool fails, carry on in plain words.'
    when p_kind = 'no_hangup' then 'After saying goodbye, end the call right away and say nothing more.'
    when p_kind = 'repeat' then 'Never repeat a line you just said word for word. Rephrase it or move the conversation forward.'
  end
$$;

-- Teach the Coach: turn one incident into a proposed playbook line through coach_propose (it checks the hard rules).
-- RoofGuard lines can start an A/B test on their own; personal lines wait for Jared's tap in the incident row.
create or replace function public.ava_incident_teach_do(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare i ava_reply_incidents; v_rule text; v_res jsonb; v_pid uuid; v_status text; v_why text;
begin
  select * into i from ava_reply_incidents where id = p_id;
  if i.id is null then return jsonb_build_object('ok', false, 'error', 'That issue is gone.'); end if;
  if i.playbook_id is not null and i.action_state in ('coach_testing', 'coach_learned') then return jsonb_build_object('ok', true, 'playbook_id', i.playbook_id, 'already', true); end if;
  v_rule := ava_incident_rule(i.kind, i.subkind, i.leak);
  if v_rule is null then
    return jsonb_build_object('ok', false, 'error', 'This one touches the AI-disclosure rule, which the Coach is not allowed to change. Ask Scout to fix it.');
  end if;
  v_why := 'From call #' || coalesce(i.call_no::text, '?') || ' (' || i.kind || ').';
  v_res := coach_propose(i.source, jsonb_build_array(jsonb_build_object('rule', v_rule, 'why', v_why, 'kind', 'flow', 'size', 'small')));
  if jsonb_array_length(coalesce(v_res->'rejected', '[]')) > 0 then
    return jsonb_build_object('ok', false, 'error', 'The Coach refused it: ' || (v_res->'rejected'->0->>'why') || '. Ask Scout to fix it.');
  end if;
  if i.source = 'roofguard' then
    select id, status into v_pid, v_status from rg_playbook where status in ('proposed', 'testing', 'live') and text_overlap(rule, v_rule) >= 0.6 order by created_at desc limit 1;
  else
    select id, status into v_pid, v_status from ava_playbook where status in ('proposed', 'live') and text_overlap(rule, v_rule) >= 0.6 order by created_at desc limit 1;
  end if;
  if v_pid is null then return jsonb_build_object('ok', false, 'error', 'The Coach did not keep it. Ask Scout to fix it.'); end if;
  update ava_reply_incidents set playbook_id = v_pid, action_state = case v_status when 'live' then 'coach_learned' else 'coach_testing' end, action_at = now()
   where id = p_id;
  return jsonb_build_object('ok', true, 'playbook_id', v_pid, 'status', v_status, 'rule', v_rule);
end $$;
revoke all on function public.ava_incident_teach_do(uuid) from public, anon, authenticated;

create or replace function public.admin_incident_teach(p_id uuid) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then raise exception 'Admins only'; end if;
  return ava_incident_teach_do(p_id);
end $$;
revoke all on function public.admin_incident_teach(uuid) from public, anon;
grant execute on function public.admin_incident_teach(uuid) to authenticated;

-- Jared's other taps: reviewed, ignore, scout (Scout has it), undo_fix (put the old model back)
create or replace function public.admin_incident_set(p_id uuid, p_action text, p_ref text default null) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare i ava_reply_incidents; v_old text; v_new text; v_cur text;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then raise exception 'Admins only'; end if;
  select * into i from ava_reply_incidents where id = p_id;
  if i.id is null then return jsonb_build_object('ok', false, 'error', 'That issue is gone.'); end if;
  if p_action = 'reviewed' then
    update ava_reply_incidents set reviewed_at = now(), action_at = now() where id = p_id;
  elsif p_action = 'ignore' then
    update ava_reply_incidents set action_state = 'ignored', reviewed_at = now(), action_at = now() where id = p_id;
  elsif p_action = 'scout' then
    update ava_reply_incidents set action_state = 'scout_has_it', scout_task_ref = left(coalesce(p_ref, 'asked ' || to_char(now(), 'YYYY-MM-DD HH24:MI')), 200), action_at = now() where id = p_id;
  elsif p_action = 'undo_fix' then
    v_old := substring(coalesce(i.healed, '') from 'switched (\S+) '); v_new := substring(coalesce(i.healed, '') from '(?:→|->) (\S+)');
    if v_old is null or v_new is null then return jsonb_build_object('ok', false, 'error', 'There is no model switch to undo on this one.'); end if;
    if i.source = 'roofguard' then select llm into v_cur from rg_settings where id; else select llm into v_cur from ava_settings where id; end if;
    if v_cur is distinct from v_new then return jsonb_build_object('ok', false, 'error', 'She already uses a different model now (' || coalesce(v_cur, '?') || '), so there is nothing to undo.'); end if;
    if i.source = 'roofguard' then
      update rg_settings set llm = v_old where id;
      perform invoke_edge_function('roofguard-caller', '{"action":"setup"}'::jsonb, 120000);
    else
      update ava_settings set llm = v_old where id;
      perform invoke_edge_function('ava-assistant', '{"action":"setup"}'::jsonb, 120000);
    end if;
    update ava_reply_incidents set action_state = 'needs_you', healed = coalesce(healed, '') || ' (you switched back to ' || v_old || ')', action_at = now() where id = p_id;
  else
    raise exception 'unknown action';
  end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_incident_set(uuid, text, text) from public, anon;
grant execute on function public.admin_incident_set(uuid, text, text) to authenticated;

-- What the Reply guard card reads: the open issues with the Coach's rule joined in
create or replace function public.admin_reply_incidents(p_source text) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not coalesce(public.has_role(auth.uid(), 'admin'), false) then raise exception 'Admins only'; end if;
  if p_source not in ('ava', 'roofguard') then raise exception 'unknown source'; end if;
  perform ava_incident_sync();
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]') into v from (
    select i.id, i.call_no, i.kind, i.subkind, i.leak, i.excerpt, i.healed, i.created_at, i.action_state, i.playbook_id, i.scout_task_ref,
           case when p_source = 'roofguard' then (select jsonb_build_object('rule', p.rule, 'status', p.status) from rg_playbook p where p.id = i.playbook_id)
                else (select jsonb_build_object('rule', p.rule, 'status', p.status) from ava_playbook p where p.id = i.playbook_id) end as playbook,
           ava_incident_rule(i.kind, i.subkind, i.leak) is not null as teachable
      from ava_reply_incidents i
     where i.source = p_source and i.reviewed_at is null
     order by i.created_at desc limit 20) x;
  return v;
end $$;
revoke all on function public.admin_reply_incidents(text) from public, anon;
grant execute on function public.admin_reply_incidents(text) to authenticated;
