-- Call to-dos can be handed to the right person with one tap (or by asking Scout).
-- Transcripts of one-mic meetings can put a line on the wrong speaker, and the to-do lands on
-- the wrong list: two of Jared's landed on Eli's on 2026-09-23 and nothing could move them.
-- todo_set_owner fixes the owner on the scout_daily row and asks scout-daily to rename the Deck
-- card ("Eli: ..." -> "Jared: ..."). Admin only; Scout calls it with the service role.
create or replace function public.todo_set_owner(p_id uuid, p_owner text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_owner text := initcap(trim(regexp_replace(coalesce(p_owner, ''), '[^A-Za-z .''-]', '', 'g')));
  r public.scout_daily;
begin
  if auth.role() <> 'service_role' and not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if v_owner = '' or length(v_owner) > 40 then raise exception 'owner must be a first name'; end if;
  update scout_daily
     set action = jsonb_set(coalesce(action, '{}'::jsonb), '{owner}', to_jsonb(v_owner)),
         why = regexp_replace(coalesce(why, ''), '^[^·]*', v_owner || ' ')
   where id = p_id and kind = 'call'
   returning * into r;
  if r.id is null then raise exception 'no call to-do with that id'; end if;
  if (r.action->>'deck_card') is not null then
    perform invoke_edge_function('scout-daily', jsonb_build_object('op', 'todo_owner', 'id', r.id), 20000);
  end if;
  return jsonb_build_object('ok', true, 'id', r.id, 'title', r.title, 'owner', v_owner);
end $$;
revoke all on function public.todo_set_owner(uuid, text) from public, anon;
grant execute on function public.todo_set_owner(uuid, text) to authenticated, service_role;
