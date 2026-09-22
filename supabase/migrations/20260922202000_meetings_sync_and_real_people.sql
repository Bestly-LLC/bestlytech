-- 1. Who was on a call = who was actually heard, not who the recorder was told to expect.
--    The roster is only a hint for naming voices; a guest who never joined was being listed
--    (Eli was "on" the 21 Sep 8pm call he never joined, so it showed in his portal).
create or replace function public.meeting_people(p_roster text[], p_transcript text, p_speakers jsonb default null)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct x), '{}') from (
    -- voices the recorder matched (a pair it could not split, "eli/cooper", counts for both)
    select lower(trim(trailing '?' from n)) x
      from jsonb_array_elements(coalesce(p_speakers->'voices', '[]'::jsonb)) v,
           regexp_split_to_table(coalesce(v->>'name', ''), '/') n
     where coalesce((v->>'minutes')::numeric, 1) > 0.2
    union all
    -- names that speak at least 3 lines in the transcript
    select x from (
      select lower(trim(trailing '?' from n)) x
        from regexp_matches(coalesce(p_transcript, ''), '^\[[0-9:]+\] ([A-Za-z/?]+): ', 'gm') m,
             regexp_split_to_table(m[1], '/') n
    ) s group by x having count(*) >= 3
  ) t where x not in ('jared', '', 'unknown', 'guest', 'speaker');
$$;

create or replace function public.trg_meeting_people()
returns trigger language plpgsql as $$
begin
  new.people := public.meeting_people(new.roster, new.transcript, new.speakers);
  return new;
end $$;
drop trigger if exists meeting_people on public.meeting_recordings;
create trigger meeting_people before insert or update of roster, transcript, speakers on public.meeting_recordings
  for each row execute function public.trg_meeting_people();

update public.meeting_recordings set people = public.meeting_people(roster, transcript, speakers);

-- 2. Deleting a call in /admin/meetings deletes it everywhere: the archive files (meetings-archive),
--    the database row the partner portal reads, and the to-dos made from it. A tombstone stops the
--    Mac sync from bringing it back.
create table if not exists public.meeting_deleted (
  name text primary key,
  deleted_at timestamptz not null default now()
);
alter table public.meeting_deleted enable row level security;

create or replace function public.meeting_skip_deleted()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.meeting_deleted d where d.name = new.name) then return null; end if;
  return new;
end $$;
drop trigger if exists meeting_skip_deleted on public.meeting_recordings;
create trigger meeting_skip_deleted before insert on public.meeting_recordings
  for each row execute function public.meeting_skip_deleted();

create or replace function public.admin_meeting_forget(p_name text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_tasks int;
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  insert into meeting_deleted (name) values (p_name) on conflict (name) do update set deleted_at = now();
  select array_agg(id) into v_ids from meeting_recordings where name = p_name;
  delete from scout_daily where kind = 'call' and (action->>'meeting_id') = any (select unnest(coalesce(v_ids, '{}'))::text);
  get diagnostics v_tasks = row_count;
  delete from meeting_recordings where name = p_name;
  return jsonb_build_object('ok', true, 'recordings', coalesce(array_length(v_ids, 1), 0), 'todos', v_tasks);
end $$;

create or replace function public.admin_meeting_rename(p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update meeting_recordings set name = p_new where name = p_old;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_meeting_forget(text), public.admin_meeting_rename(text, text) from public, anon;
grant execute on function public.admin_meeting_forget(text), public.admin_meeting_rename(text, text) to authenticated;
