-- Studio's Talk lines go to the room of the client they are about, and nowhere else.
-- Before this, studio-notify posted every line (Listings, demos, email ideas) into one
-- hard-coded room: Centering YOU's. Now each row carries its room, resolved from the
-- item or ask it is about via approval_clients.talk_room. No client room = not posted.
alter table public.talk_outbox add column if not exists room text;

create or replace function public.talk_outbox_route()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_client uuid;
begin
  if new.room is not null then return new; end if;
  if new.payload ? 'item' then
    select client_id into v_client from approval_items where id = (new.payload->>'item')::uuid;
  elsif new.payload ? 'ask' then
    select client_id into v_client from client_asks where id = (new.payload->>'ask')::uuid;
  elsif new.payload ? 'client' then
    v_client := (new.payload->>'client')::uuid;
  end if;
  if v_client is not null then
    select nullif(trim(talk_room), '') into new.room from approval_clients where id = v_client;
  end if;
  return new;
exception when others then
  return new;  -- a bad payload never blocks the write; it just goes unrouted (unposted)
end $$;
drop trigger if exists trg_talk_outbox_route on public.talk_outbox;
create trigger trg_talk_outbox_route before insert on public.talk_outbox
  for each row execute function public.talk_outbox_route();

-- Lines with no client room are closed out, not posted anywhere.
update public.talk_outbox set sent_at = now(), error = 'no client room' where sent_at is null and room is null;

drop function if exists public.talk_outbox_take();
create or replace function public.talk_outbox_take()
returns table(kind text, line text, ids uuid[], room text)
language plpgsql security definer set search_path = public as $$
begin
  update public.talk_outbox set sent_at = now(), error = coalesce(error,'') || ' (gave up)'
   where sent_at is null and created_at < now() - interval '1 day';
  update public.talk_outbox set sent_at = now(), error = 'no client room'
   where sent_at is null and room is null;
  return query
    with g as (
      select t.room, t.kind, coalesce(t.dedupe, t.id::text) as k, count(*) as n,
             min(t.line) as one, min(t.many) as many, array_agg(t.id) as ids,
             min(t.created_at) as first, max(t.created_at) as last, bool_or(t.dedupe is not null) as folds
        from public.talk_outbox t where t.sent_at is null group by 1, 2, 3)
    select g.kind,
           case when g.n > 1 and g.many is not null then replace(g.many, '{n}', g.n::text) else g.one end,
           g.ids, g.room
      from g
     where not g.folds or g.last < now() - interval '2 minutes'
     order by g.first;
end $$;
revoke all on function public.talk_outbox_take() from public, anon, authenticated;
grant execute on function public.talk_outbox_take() to service_role;
