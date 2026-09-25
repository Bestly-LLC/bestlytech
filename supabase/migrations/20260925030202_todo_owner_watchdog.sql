-- The trigger is the whole defence, and a dropped trigger fails silently: to-dos just start
-- landing under invented names again. This notices, fixes what it finds, and says so.
create or replace function public.todo_owner_watchdog()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_bad int; v_names text; v_trigger boolean;
begin
  select exists (
    select 1 from pg_trigger
     where tgrelid = 'public.scout_daily'::regclass
       and tgname = 'trg_scout_daily_owner_norm' and not tgisinternal
  ) into v_trigger;

  select count(*), string_agg(distinct action->>'owner', ', ')
    into v_bad, v_names
    from public.scout_daily
   where kind = 'call'
     and coalesce(action->>'owner', '') is distinct from public.todo_owner_norm(action->>'owner');

  if v_bad > 0 then
    update public.scout_daily
       set action = action || jsonb_build_object('owner', public.todo_owner_norm(action->>'owner'))
     where kind = 'call'
       and coalesce(action->>'owner', '') is distinct from public.todo_owner_norm(action->>'owner');
  end if;

  if not v_trigger then
    perform public.bestly_raise('todo.ownertrigger', 'problem', 'warning',
      'To-dos: the owner check is gone',
      'trg_scout_daily_owner_norm is missing from scout_daily, so a call to-do can be filed under any name the transcript produces. Re-apply the todo_owner_roster migration.',
      'ops');
  elsif v_bad > 0 then
    perform public.bestly_raise('todo.ownertrigger', 'problem', 'warning',
      'To-dos: fixed an owner that was not a person',
      format('%s call to-do(s) were filed under %s and have been moved to the right list. If that name is a real person, add them: insert into todo_people(name).', v_bad, coalesce(v_names, '?')),
      'ops', null, true);
  else
    perform public.bestly_raise('todo.ownertrigger', 'resolved', 'info', null);
  end if;

  return jsonb_build_object('ok', true, 'trigger', v_trigger, 'repaired', v_bad);
end $$;

select cron.schedule('todo-owner-watchdog', '37 * * * *', $$select public.todo_owner_watchdog()$$);
