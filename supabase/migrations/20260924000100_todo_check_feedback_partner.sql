-- Partners (Eli) can thumbs-up / thumbs-down / put back checks on their OWN call to-dos, so Scout learns
-- from their corrections too. Same body as before otherwise.
create or replace function public.todo_check_feedback(p_check uuid, p_kind text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.todo_checks;
  t public.scout_daily;
  reopened boolean := false;
  me text := partner_roster_name();
begin
  if p_kind not in ('up', 'down', 'undo') then raise exception 'kind must be up, down or undo'; end if;
  select * into c from todo_checks where id = p_check;
  if c.id is null then raise exception 'no such check'; end if;
  select * into t from scout_daily where id = c.todo_id;
  if auth.role() <> 'service_role' and not has_role(auth.uid(), 'admin')
     and not (me is not null and t.kind = 'call' and lower(t.action->>'owner') = lower(me)) then
    raise exception 'not allowed';
  end if;
  update todo_checks set feedback = p_kind, feedback_note = nullif(left(trim(coalesce(p_note, '')), 500), ''), feedback_at = now(),
         learned = case when p_kind = 'up' then learned else false end
   where id = p_check returning * into c;
  if p_kind in ('down', 'undo') then
    if t.status = 'done' and (c.auto_closed or (t.action->'auto_closed'->>'check_id') = c.id::text or p_kind = 'undo') then
      update scout_daily set status = 'open', done_at = null, action = action - 'auto_closed' where id = t.id;
      reopened := true;
    end if;
    if c.auto_closed then
      update todo_check_settings set threshold = least(0.98, threshold + 0.02), updated_at = now(),
             note = 'raised after a put-back on ' || to_char(now() at time zone 'America/Los_Angeles', 'Mon DD HH12:MI AM') where id = 1;
    end if;
    update scout_lessons set losses = losses + 1, updated_at = now() where id = any(c.lessons_used);
    perform invoke_edge_function('todo-check', jsonb_build_object('op', 'learn', 'check_id', c.id), 60000);
  else
    update scout_lessons set wins = wins + 1, updated_at = now() where id = any(c.lessons_used);
  end if;
  update scout_daily set action = jsonb_set(action, '{check,feedback}', to_jsonb(p_kind))
   where id = c.todo_id and (action->'check'->>'id') = c.id::text;
  perform todo_check_tune();
  return jsonb_build_object('ok', true, 'reopened', reopened);
end $$;
