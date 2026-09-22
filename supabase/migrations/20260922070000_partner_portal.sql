-- Partner portal (/partner): Eli sees the calls he was on, the to-dos from them
-- (his and Jared's), and a read-only pipeline. Nothing else in the admin.
-- (app_role 'partner' was added in 20260922065900_app_role_partner.sql.)

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users (id) on delete set null,
  name text not null,
  email text not null unique,
  roster_name text not null unique,        -- the name the call recorder uses, e.g. 'eli'
  created_at timestamptz not null default now(),
  link_sent_at timestamptz
);
alter table public.partners enable row level security;
drop policy if exists partners_read on public.partners;
create policy partners_read on public.partners for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

insert into public.partners (name, email, roster_name)
values ('Eli', 'eli.cooper@bdcuniversal.com', 'eli')
on conflict (email) do nothing;

-- Who was on a call: the roster the recorder was given, plus any name with at
-- least 3 voice-confirmed lines (names ending in ? are guesses and don't count).
create or replace function public.meeting_people(p_roster text[], p_transcript text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct x), '{}') from (
    select lower(r) x from unnest(coalesce(p_roster, '{}')) r
    union all
    select x from (
      select lower(m[1]) x from regexp_matches(coalesce(p_transcript, ''), '^\[[0-9:]+\] ([A-Za-z]+): ', 'gm') m
    ) s group by x having count(*) >= 3
  ) t where x <> 'jared' and x <> '';
$$;

alter table public.meeting_recordings add column if not exists people text[] not null default '{}';
create or replace function public.trg_meeting_people()
returns trigger language plpgsql as $$
begin
  new.people := public.meeting_people(new.roster, new.transcript);
  return new;
end $$;
drop trigger if exists meeting_people on public.meeting_recordings;
create trigger meeting_people before insert or update of roster, transcript on public.meeting_recordings
  for each row execute function public.trg_meeting_people();
update public.meeting_recordings set people = public.meeting_people(roster, transcript);

create or replace function public.partner_roster_name()
returns text language sql stable security definer set search_path = public as $$
  select roster_name from public.partners where user_id = auth.uid() limit 1;
$$;

drop policy if exists partner_read_recordings on public.meeting_recordings;
create policy partner_read_recordings on public.meeting_recordings for select to authenticated
  using (public.partner_roster_name() = any (people));

drop policy if exists partner_read_call_items on public.scout_daily;
create policy partner_read_call_items on public.scout_daily for select to authenticated
  using (kind = 'call' and exists (
    select 1 from public.meeting_recordings m
     where m.id::text = scout_daily.action->>'meeting_id'
       and public.partner_roster_name() = any (m.people)));

-- Tick off a to-do from a call: a partner only their own, the admin any.
create or replace function public.partner_task_set(p_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.scout_daily; me text := public.partner_roster_name();
begin
  if p_status not in ('open', 'done') then raise exception 'bad status'; end if;
  select * into r from public.scout_daily where id = p_id and kind = 'call';
  if r.id is null then raise exception 'not found'; end if;
  if not public.has_role(auth.uid(), 'admin') and (me is null or lower(r.action->>'owner') <> me) then
    raise exception 'only your own to-dos';
  end if;
  update public.scout_daily set status = p_status, done_at = case when p_status = 'done' then now() end
   where id = p_id returning * into r;
  return to_jsonb(r);
end $$;
revoke all on function public.partner_task_set(uuid, text) from public, anon;
grant execute on function public.partner_task_set(uuid, text) to authenticated;

-- Read-only pipeline: names and stages only. No money, emails or phone numbers.
create or replace function public.partner_pipeline()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if public.partner_roster_name() is null and not public.has_role(auth.uid(), 'admin') then
    raise exception 'partners only';
  end if;
  return jsonb_build_object(
    'deals', coalesce((select jsonb_agg(jsonb_build_object(
        'company', company_name, 'stage', current_stage, 'since', coalesce(stage_changed_at, created_at),
        'users', target_user_count, 'go_live', go_live_at) order by current_stage desc, stage_changed_at)
      from public.cloud_deals where current_stage between 3 and 8), '[]'::jsonb),
    'leads', coalesce((select jsonb_agg(jsonb_build_object(
        'company', coalesce(nullif(company_name, ''), 'Unnamed'), 'status', status, 'since', created_at,
        'size', user_count_band, 'pain', primary_pain) order by created_at desc)
      from public.cloud_leads where coalesce(status, 'new') not in ('lost', 'won', 'closed', 'spam', 'converted', 'archived')), '[]'::jsonb)
  );
end $$;
revoke all on function public.partner_pipeline() from public, anon;
grant execute on function public.partner_pipeline() to authenticated;
