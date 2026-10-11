-- 2026-10-11 Studio notification digests, part 3: the hold triggers (applied LAST, after the digest builders exist).
-- Jared: Studio exists to avoid email back-and-forth, so condense. One email a day per client (only when
-- something waits on her), one digest a day per staff member, one Talk roll-up an hour in the team room.
--
-- How: nothing is deleted and no trigger that WRITES a notification is edited. Two new BEFORE INSERT
-- triggers (they sort last by name) park per-item rows instead of letting the drain send them:
--   notify_outbox: audience client/staff with an address -> hold_until = 'infinity', payload.digest = true,
--                  sent_at stays null. notify_outbox_take already skips hold_until > now().
--   talk_outbox:   audience team, kind 'review' -> payload.rollup = true; talk_outbox_take skips them.
-- Part 2 (studio_digest_* functions) composes ONE row from the parked ones and marks them done.
-- Undo: see bestly_memory studio/notification-digests (drop the two triggers; parked rows are releasable).

-- ---------------------------------------------------------------- hold: notify_outbox
create or replace function public.trg_notify_digest_hold()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.sent_at is null
     and new.to_email is not null
     and new.audience in ('client', 'staff')
     and new.kind not in ('staff_digest', 'client_digest')
     and coalesce((select enabled from public.studio_digest_settings where id), true)
  then
    new.hold_until := 'infinity';
    new.payload := coalesce(new.payload, '{}'::jsonb) || jsonb_build_object('digest', true);
  end if;
  return new;
end $function$;

create or replace trigger zz_notify_digest_hold before insert on public.notify_outbox
  for each row execute function public.trg_notify_digest_hold();

-- the drain: parked rows must not be marked "seen in the app" and thrown away (the digest says what happened
-- even if you were in Studio); everything else in this function is unchanged.
create or replace function public.notify_outbox_take(p_limit integer default 20)
 returns setof notify_outbox
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare g record; v_n int; v_body text; v_clients text;
begin
  -- 1. anything the person has already dealt with in the app is noise
  update public.notify_outbox o
     set sent_at = now(), error = 'seen in the app'
   where o.sent_at is null and o.staff_id is not null and o.kind <> 'decision'
     and o.hold_until is distinct from 'infinity'
     and exists (select 1 from public.staff_sessions s
                  where s.staff_id = o.staff_id and s.last_seen_at > o.created_at);

  -- 2. client nudges for asks that have since been answered
  update public.notify_outbox o
     set sent_at = now(), error = 'already handled'
   where o.sent_at is null and o.kind = 'client_ask'
     and exists (select 1 from public.client_asks a
                  where a.id = (o.payload->>'ask')::uuid and a.status not in ('open','received'));

  -- 3. decisions that are due fold into one email per producer: the first row
  --    carries the whole list, the rest are marked folded
  for g in select dedupe, staff_id, min(id::text) as keep, count(*) as n
             from public.notify_outbox
            where sent_at is null and kind = 'decision' and dedupe like 'digest:%'
              and hold_until <= now()
            group by dedupe, staff_id having count(*) > 0
  loop
    select string_agg(body, E'\n' order by created_at), string_agg(distinct payload->>'client', ', ')
      into v_body, v_clients
      from public.notify_outbox where sent_at is null and dedupe = g.dedupe and staff_id = g.staff_id;
    update public.notify_outbox
       set subject = case when g.n = 1 then v_clients || ' decided on a post' else g.n || ' decisions from ' || v_clients end,
           body = v_body || E'\n\nEverything is in the queue.'
     where id::text = g.keep;
    update public.notify_outbox set sent_at = now(), error = 'folded into digest'
     where sent_at is null and dedupe = g.dedupe and staff_id = g.staff_id and id::text <> g.keep;
  end loop;

  return query
    update public.notify_outbox o set attempts = attempts + 1
     where o.id in (select id from public.notify_outbox
                     where sent_at is null and to_email is not null and attempts < 5
                       and (hold_until is null or hold_until <= now())
                     order by created_at limit p_limit for update skip locked)
    returning o.*;
end $function$;

-- ---------------------------------------------------------------- hold: talk_outbox (team room roll-up)
create or replace function public.trg_talk_rollup_hold()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.sent_at is null
     and new.kind = 'review' and new.audience = 'team'
     and not (coalesce(new.payload, '{}'::jsonb) ? 'rollup_post')
     and coalesce((select enabled from public.studio_digest_settings where id), true)
  then
    new.payload := coalesce(new.payload, '{}'::jsonb) || jsonb_build_object('rollup', true);
  end if;
  return new;
end $function$;

create or replace trigger zz_talk_rollup_hold before insert on public.talk_outbox
  for each row execute function public.trg_talk_rollup_hold();

create or replace function public.talk_outbox_take()
 returns table(kind text, line text, ids uuid[], room text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
#variable_conflict use_column
begin
  update public.talk_outbox o set sent_at = now(), error = coalesce(o.error,'') || ' (gave up)'
   where o.sent_at is null and o.created_at < now() - interval '1 day';
  update public.talk_outbox o set sent_at = now(), error = 'no client room'
   where o.sent_at is null and o.room is null;
  return query
    with g as (
      select t.room as g_room, t.kind as g_kind, coalesce(t.dedupe, t.id::text) as k, count(*) as n,
             min(t.line) as one, min(t.many) as many, array_agg(t.id) as g_ids,
             min(t.created_at) as first, max(t.created_at) as last, bool_or(t.dedupe is not null) as folds
        from public.talk_outbox t
       where t.sent_at is null
         and not (coalesce(t.payload, '{}'::jsonb) ? 'rollup')   -- parked for the hourly roll-up
       group by 1, 2, 3)
    select g.g_kind,
           case when g.n > 1 and g.many is not null then replace(g.many, '{n}', g.n::text) else g.one end,
           g.g_ids, g.g_room
      from g
     where not g.folds or g.last < now() - interval '2 minutes'
     order by g.first;
end $function$;

revoke all on function public.trg_notify_digest_hold() from public, anon, authenticated;
revoke all on function public.trg_talk_rollup_hold() from public, anon, authenticated;

-- two kinds that trg_mail_to_ask / client_brief_send already insert but notify_kinds never listed: their inserts
-- sit inside "exception when others then null", so the receipts were silently failing. Now that the hold trigger
-- parks every per-item row, listing them means the receipts land in the digests (the decision: "we got your idea"
-- folds into her morning email; the staff receipt folds into the evening digest) instead of going out one by one.
insert into public.notify_kinds (kind, what) values
  ('ask_received', 'A mailed-in idea was turned into an ask (receipt; folded into the daily digest)'),
  ('client_brief', 'A client sent a brief or idea from her board (folded into the daily digest)')
on conflict (kind) do nothing;
