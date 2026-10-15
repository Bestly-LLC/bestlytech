-- Studio: a post whose take was sent back is OFF the Queue until the new take is approved and cut (Jared, 2026-10-15).
-- "make it so the videos I sent back to her to rerecord are no longer in the queue since that logic no longer exists."
--
-- MECHANISM. approval_items gets parked_at / parked_reason / parked_upload (the sent-back take that parked it).
-- A parked post is not deleted, not killed, and its media and caption are untouched; it is just invisible to every
-- Queue / calendar / autopost / send-all / client-board reader, and the DB refuses to schedule or send it while parked.
--   PARK    studio_take_send_back, when the take being sent back is attached to a post that is not posted yet
--           (an ask made from a post, with a take that was never attached, leaves its source post alone).
--           Also clears the post's schedule and cancels a queued social_post, so nothing is left in the calendar.
--   UNPARK  (1) studio_take_edit_done on a NEWER approved take of the same ask (its cut landed),
--           (2) studio_ask_attach of a NEWER take to that post (attach refuses waiting / sent_back, so it is approved),
--           (3) studio_ask_close (the ask is dead, the post must not stay hidden forever),
--           (4) studio_post_put_back(token, item): Jared's manual "Put the post back" (the undo; there is no way to
--               re-approve a sent_back take, so this is how "undo before any new take" works).
--           Her merely uploading a new take (review_state 'waiting') never unparks.
-- Readers are patched in place with exact-once replaces (idempotent: a second run finds the new text and skips).
-- Backfill at the bottom parks every ask that is already in 'redo' with a post (CY28, CY29 on Centering YOU).

alter table public.approval_items
  add column if not exists parked_at timestamptz,
  add column if not exists parked_reason text,
  add column if not exists parked_upload uuid;

alter table public.approval_items drop constraint if exists approval_items_parked_ck;
alter table public.approval_items add constraint approval_items_parked_ck check (
  (parked_at is null and parked_reason is null and parked_upload is null)
  or (parked_at is not null and parked_reason is not null));

-- ---- helpers (internal: only other SECURITY DEFINER functions call them) -------------------------------------------
create or replace function public.studio_item_park(p_item uuid, p_upload uuid, p_reason text)
 returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  update public.approval_items
     set parked_at = now(), parked_reason = coalesce(nullif(p_reason, ''), 'take_sent_back'), parked_upload = p_upload,
         slot_reason = case when scheduled_at is not null or scheduled_for is not null
                            then 'Taken off the calendar: the take was sent back.' else slot_reason end,
         scheduled_at = null, scheduled_for = null, time_locked = false, posting_ready_at = null
   where id = p_item and posted_at is null and parked_at is null;
  get diagnostics n = row_count;
  if n = 1 then
    update public.social_posts set status = 'canceled' where approval_item_id = p_item and status = 'queued';
    insert into public.approval_item_events (item_id, kind, actor_kind, payload)
    values (p_item, 'edited', 'system', jsonb_build_object('what', 'parked', 'why', p_reason, 'upload', p_upload));
  end if;
  return n = 1;
end $function$;

create or replace function public.studio_item_unpark(p_item uuid, p_why text)
 returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare n int;
begin
  update public.approval_items set parked_at = null, parked_reason = null, parked_upload = null
   where id = p_item and parked_at is not null;
  get diagnostics n = row_count;
  if n = 1 then
    insert into public.approval_item_events (item_id, kind, actor_kind, payload)
    values (p_item, 'edited', 'system', jsonb_build_object('what', 'unparked', 'why', p_why));
  end if;
  return n = 1;
end $function$;

-- a newer take of the ask than the one that parked the post -> the post comes back
create or replace function public.studio_item_unpark_for_take(p_upload uuid)
 returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare u public.client_uploads%rowtype; v_item uuid; pu public.client_uploads%rowtype; v_parked uuid;
begin
  select * into u from public.client_uploads where id = p_upload and purpose = 'ask';
  if u.id is null then return false; end if;
  select item_id into v_item from public.client_asks where id = u.ask_id;
  if v_item is null then return false; end if;
  select parked_upload into v_parked from public.approval_items where id = v_item and parked_at is not null;
  if not found then return false; end if;
  if v_parked is not null then
    select * into pu from public.client_uploads where id = v_parked;
    if pu.id is not null and (u.id = pu.id or coalesce(u.take_no, 0) <= coalesce(pu.take_no, 0)) then return false; end if;
  end if;
  return public.studio_item_unpark(v_item, 'newer take approved and cut');
end $function$;

create or replace function public.studio_item_unpark_for_ask(p_ask uuid, p_why text)
 returns boolean language plpgsql security definer set search_path to 'public'
as $function$
declare v_item uuid;
begin
  select item_id into v_item from public.client_asks where id = p_ask;
  if v_item is null then return false; end if;
  if not exists (select 1 from public.approval_items i where i.id = v_item and i.parked_at is not null
                    and (i.parked_upload is null or i.parked_upload in (select id from public.client_uploads where ask_id = p_ask))) then
    return false; end if;
  return public.studio_item_unpark(v_item, p_why);
end $function$;

revoke all on function public.studio_item_park(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.studio_item_unpark(uuid, text) from public, anon, authenticated;
revoke all on function public.studio_item_unpark_for_take(uuid) from public, anon, authenticated;
revoke all on function public.studio_item_unpark_for_ask(uuid, text) from public, anon, authenticated;

-- Jared's manual undo, from the Asks note
create or replace function public.studio_post_put_back(p_token text, p_item uuid)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare s public.studio_caller;
begin
  s := public.studio_resolve_staff(p_token);
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if not s.can_promote then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if not public.staff_may_see_item(s.id, p_item) then return jsonb_build_object('ok', false, 'error', 'not_permitted'); end if;
  if not public.studio_item_unpark(p_item, 'put back by ' || s.name) then
    return jsonb_build_object('ok', true, 'already', true); end if;
  return jsonb_build_object('ok', true);
end $function$;
revoke all on function public.studio_post_put_back(text, uuid) from public;
grant execute on function public.studio_post_put_back(text, uuid) to anon, authenticated, service_role;
insert into public.security_public_rpcs (fn, why)
values ('studio_post_put_back', 'Studio (token-bound, staff session + can_promote checked inside): put a parked post (its take was sent back) back on the Queue.')
on conflict (fn) do nothing;

-- the database itself refuses to date or send a parked post (the readers below already skip it)
create or replace function public.trg_items_parked_guard()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  if new.parked_at is null then return new; end if;
  if new.stage = 'client' and old.stage is distinct from 'client' then
    raise exception 'this post is off the Queue until the new take is approved' using errcode = 'check_violation';
  end if;
  if (new.scheduled_at is not null or new.scheduled_for is not null)
     and (new.scheduled_at is distinct from old.scheduled_at or new.scheduled_for is distinct from old.scheduled_for) then
    raise exception 'this post is off the Queue until the new take is approved' using errcode = 'check_violation';
  end if;
  return new;
end $function$;
drop trigger if exists items_parked_guard on public.approval_items;
create trigger items_parked_guard before update on public.approval_items
  for each row when (new.parked_at is not null) execute function public.trg_items_parked_guard();

-- ---- exact-once patches on the existing functions ---------------------------------------------------------------------
do $mig$
declare
  t record; v_def text; v_n int;
begin
  for t in
    select * from (values
      -- staff Queue (full board, slim sync, change stamp) and its badge count
      ('public.studio_board(text,text)'::regprocedure, E'and it.status <> ''draft''\n  ) i;', E'and it.status <> ''draft''\n       and it.parked_at is null\n  ) i;'),
      ('public.studio_board_slim(text,text)'::regprocedure, E'and it.status <> ''draft'';\n\n  return jsonb_build_object(''ok'', true, ''slim'', true', E'and it.status <> ''draft'' and it.parked_at is null;\n\n  return jsonb_build_object(''ok'', true, ''slim'', true'),
      ('public.studio_board_stamp(text,text)'::regprocedure, E'and it.status <> ''draft'';\n  return jsonb_build_object(''ok'', true, ''stamp''', E'and it.status <> ''draft'' and it.parked_at is null;\n  return jsonb_build_object(''ok'', true, ''stamp'''),
      ('public.studio_seen_counts(text,text)'::regprocedure, 'where i.client_id = v_client and i.posted_at is null and coalesce(i.internal_status, ''pending'') <> ''killed''', 'where i.client_id = v_client and i.posted_at is null and i.parked_at is null and coalesce(i.internal_status, ''pending'') <> ''killed'''),
      -- calendar / autopost / autoslot / send-all
      ('public.studio_cal_ready(uuid)'::regprocedure, 'and coalesce(i.internal_status,'''') <> ''killed''', 'and coalesce(i.internal_status,'''') <> ''killed'' and i.parked_at is null'),
      ('public.studio_autopost_tick()'::regprocedure, E'where i.client_id = c.id and i.posted_at is null and not i.cal_hold\n         and i.scheduled_at is not null', E'where i.client_id = c.id and i.posted_at is null and i.parked_at is null and not i.cal_hold\n         and i.scheduled_at is not null'),
      ('public.studio_autoslot(uuid,boolean)'::regprocedure, 'where i.client_id = any(g) and i.posted_at is null and i.scheduled_at is null and not i.cal_hold', 'where i.client_id = any(g) and i.posted_at is null and i.parked_at is null and i.scheduled_at is null and not i.cal_hold'),
      ('public.studio_send_all(text,text,boolean)'::regprocedure, E'where i.client_id = v_client and i.stage = ''internal''\n     order by i.created_at', E'where i.client_id = v_client and i.stage = ''internal'' and i.parked_at is null\n     order by i.created_at'),
      ('public.studio_calendar(text,text,integer,date)'::regprocedure, 'where it.client_id = any(v_group) and it.status <> ''draft''', 'where it.client_id = any(v_group) and it.status <> ''draft'' and it.parked_at is null'),
      ('public.studio_calendar(text,text,integer,date)'::regprocedure, 'where it.client_id = v_client and it.status <> ''draft'' and it.scheduled_for is null', 'where it.client_id = v_client and it.status <> ''draft'' and it.parked_at is null and it.scheduled_for is null'),
      -- what the client and the calendar feed see
      ('public.approval_board(text)'::regprocedure, 'where it.client_id = v_client.id and it.status <> ''draft'' and not coalesce(v_gate, false)', 'where it.client_id = v_client.id and it.status <> ''draft'' and it.parked_at is null and not coalesce(v_gate, false)'),
      ('public.client_calendar(text,integer,date)'::regprocedure, 'where it.client_id = c.id and it.status <> ''draft''', 'where it.client_id = c.id and it.status <> ''draft'' and it.parked_at is null'),
      ('public.calendar_feed_read(text,integer,integer)'::regprocedure, 'where it.client_id = any(v_group) and it.status <> ''draft''', 'where it.client_id = any(v_group) and it.status <> ''draft'' and it.parked_at is null'),
      -- Asks: tell the app which post is parked
      ('public.studio_asks(text,text)'::regprocedure, '''item_title'', i.title, ''item_stage'', i.stage,', '''item_title'', i.title, ''item_stage'', i.stage, ''item_code'', i.code, ''item_parked_at'', i.parked_at,'),
      -- park / unpark call sites
      ('public.studio_take_send_back(text,uuid,text)'::regprocedure, 'update public.client_asks set status = ''redo'' where id = a.id;', E'update public.client_asks set status = ''redo'' where id = a.id;\n  -- the post this take is in comes off the Queue until a newer take is approved and cut\n  if a.item_id is not null and u.status = ''attached'' then perform public.studio_item_park(a.item_id, u.id, ''take_sent_back''); end if;'),
      ('public.studio_take_edit_done(uuid,uuid)'::regprocedure, E'get diagnostics n = row_count;\n  return jsonb_build_object(''ok'', n = 1);', E'get diagnostics n = row_count;\n  if n = 1 then perform public.studio_item_unpark_for_take(p_upload); end if;\n  return jsonb_build_object(''ok'', n = 1);'),
      ('public.studio_ask_attach(text,uuid,uuid)'::regprocedure, 'update public.client_asks set status = ''attached'', item_id = v_item where id = a.id;', E'update public.client_asks set status = ''attached'', item_id = v_item where id = a.id;\n  perform public.studio_item_unpark_for_take(u.id);'),
      ('public.studio_ask_close(text,uuid)'::regprocedure, 'update public.client_asks set status = ''closed'' where id = p_ask and status <> ''attached'';', E'if exists (select 1 from public.client_asks where id = p_ask and status <> ''attached'') then perform public.studio_item_unpark_for_ask(p_ask, ''ask closed''); end if;\n  update public.client_asks set status = ''closed'' where id = p_ask and status <> ''attached'';')
    ) as x(fn, old_txt, new_txt)
  loop
    v_def := pg_get_functiondef(t.fn);
    if position(t.new_txt in v_def) > 0 then continue; end if;          -- already patched
    v_n := (length(v_def) - length(replace(v_def, t.old_txt, ''))) / length(t.old_txt);
    if v_n <> 1 then raise exception 'patch % expected 1 match, got %: %', t.fn, v_n, left(t.old_txt, 80); end if;
    execute replace(v_def, t.old_txt, t.new_txt);
  end loop;
end $mig$;

-- ---- backfill: every ask already sent back (status redo) whose post is not posted yet --------------------------------
select public.studio_item_park(a.item_id,
         (select u.id from public.client_uploads u where u.ask_id = a.id and u.review_state = 'sent_back' and u.status = 'attached'
           order by u.take_no desc nulls last, u.created_at desc limit 1),
         'take_sent_back')
  from public.client_asks a
 where a.status = 'redo' and a.item_id is not null
   and exists (select 1 from public.client_uploads u where u.ask_id = a.id and u.review_state = 'sent_back' and u.status = 'attached');
