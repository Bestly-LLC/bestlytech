-- Lane M (2026-10-18): a recorded call knows which Talk room and which client it belongs to. Additive: two nullable columns and
-- one BEFORE trigger. The Mac mini agent (scripts/meetingrec/agent.py 1.10) sends the room with each ingest; the trigger turns it
-- into the client in the same insert, so scout-daily's 'call' step (fired by that insert) already sees client_slug.
-- Rollback: drop trigger meeting_client on public.meeting_recordings; drop function public.trg_meeting_client();
-- (the two columns can stay; nothing else reads them yet).
alter table public.meeting_recordings add column if not exists room text;
alter table public.meeting_recordings add column if not exists client_slug text;

create or replace function public.trg_meeting_client() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.client_slug is null and new.room is not null then
    select c.slug into new.client_slug
      from public.approval_clients c
     where c.talk_room = new.room
     order by c.created_at
     limit 1;
  end if;
  return new;
end $$;

create trigger meeting_client
  before insert or update of room, client_slug on public.meeting_recordings
  for each row execute function public.trg_meeting_client();
