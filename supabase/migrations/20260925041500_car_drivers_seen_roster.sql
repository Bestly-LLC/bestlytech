-- Dylan Hunt has had a mobile key to the car since this trip started, and nothing recorded it.
--
-- Not because the data was missing: key_check runs every five minutes and returns the car's full
-- driver list — {"drivers":[{"id":...,"name":"GianPaula Hulten"},{"id":...,"name":"Dylan Hunt"}]} —
-- and demo_key_apply reads only `new_drivers`, the diff against the demo baseline, then drops the
-- rest. The one fact that answers "who could have been driving" was arriving 288 times a day and
-- being discarded, while trip_drive_attribution reported every drive as booking-only.
--
-- This keeps the roster: who is on the car, from when, until when.

create table if not exists public.car_drivers_seen (
  share_user_id  text primary key,
  name           text,
  first_seen     timestamptz not null,
  last_seen      timestamptz not null,
  gone_at        timestamptz,
  reservation_id bigint,
  source         text not null default 'key_check'
);
comment on table public.car_drivers_seen is
  'Every Tesla account that has held a key to the car, and the window it held it. Built from the driver list the car reports, not from our own invite flow — so a key granted by any route still lands here.';

create table if not exists public.car_host_drivers (
  share_user_id text primary key,
  name          text,
  note          text
);
comment on table public.car_host_drivers is
  'Share accounts that are Jared''s own. Never counted as a guest driver.';
insert into public.car_host_drivers (share_user_id, name, note)
values ('2534032695282569', 'Jared Best', 'seen as a demo-key share driver')
on conflict (share_user_id) do nothing;

create or replace function public.car_drivers_sync(p_drivers jsonb, p_at timestamptz default now())
returns int language plpgsql security definer set search_path to 'public'
as $$
declare v_ids text[]; v_n int;
begin
  if p_drivers is null or jsonb_typeof(p_drivers) <> 'array' then return 0; end if;
  select coalesce(array_agg(d->>'id'), '{}') into v_ids from jsonb_array_elements(p_drivers) d;

  insert into public.car_drivers_seen (share_user_id, name, first_seen, last_seen, reservation_id)
  select d->>'id', d->>'name', p_at, p_at,
         (select t.reservation_id from public.turo_trips t
           where p_at between t.starts_at - interval '12 hours' and t.ends_at + interval '12 hours'
             and coalesce(t.status,'') not in ('test','CANCELLED','CANCELED')
           order by t.starts_at desc limit 1)
    from jsonb_array_elements(p_drivers) d
  on conflict (share_user_id) do update
     set last_seen = greatest(public.car_drivers_seen.last_seen, excluded.last_seen),
         name      = coalesce(excluded.name, public.car_drivers_seen.name),
         gone_at   = null;
  get diagnostics v_n = row_count;

  update public.car_drivers_seen
     set gone_at = p_at
   where gone_at is null and not (share_user_id = any (v_ids)) and last_seen < p_at;

  return v_n;
end $$;

create or replace function public.car_drivers_from_command()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.status = 'done' and new.result ? 'drivers' then
    perform public.car_drivers_sync(new.result->'drivers', coalesce(new.done_at, new.created_at, now()));
  end if;
  return new;
end $$;

drop trigger if exists trg_car_drivers_from_command on public.tesla_fleet_commands;
create trigger trg_car_drivers_from_command
  after insert or update on public.tesla_fleet_commands
  for each row execute function public.car_drivers_from_command();

-- Rebuild from every key_check already answered, so the window is real history.
with polls as (
  select coalesce(done_at, created_at) at, result->'drivers' drivers
    from public.tesla_fleet_commands
   where status = 'done' and result ? 'drivers'
), seen as (
  select d->>'id' id, max(d->>'name') name, min(p.at) first_seen, max(p.at) last_seen
    from polls p, jsonb_array_elements(p.drivers) d
   group by 1
)
insert into public.car_drivers_seen (share_user_id, name, first_seen, last_seen, reservation_id, source)
select s.id, s.name, s.first_seen, s.last_seen,
       (select t.reservation_id from public.turo_trips t
         where s.first_seen between t.starts_at - interval '12 hours' and t.ends_at + interval '12 hours'
           and coalesce(t.status,'') not in ('test','CANCELLED','CANCELED')
         order by t.starts_at desc limit 1),
       'backfill'
  from seen s
on conflict (share_user_id) do update
   set first_seen = least(public.car_drivers_seen.first_seen, excluded.first_seen),
       last_seen  = greatest(public.car_drivers_seen.last_seen, excluded.last_seen),
       name       = coalesce(public.car_drivers_seen.name, excluded.name),
       reservation_id = coalesce(public.car_drivers_seen.reservation_id, excluded.reservation_id);

-- Attribution prefers the car's own roster: a key granted by any route counts, with Tesla's name.
create or replace function public.trip_drive_attribution(p_res bigint)
returns table (
  drive_id text, started_at timestamptz, ended_at timestamptz, miles numeric, max_mph numeric,
  from_name text, to_name text, basis text, driver_name text
) language sql stable security definer set search_path to 'public' as $$
  select d.id, d.started_at, d.ended_at, d.miles, d.max_mph, d.from_name, d.to_name,
    case
      when h.name is not null then 'key'
      when k.accepted_at is not null
       and d.started_at >= k.accepted_at
       and d.started_at <= coalesce(k.removed_at, now()) then 'key'
      when d.reservation_id is not null then 'booking'
      else 'none'
    end as basis,
    coalesce(h.name, k.driver_name) as driver_name
  from public.car_drives d
  left join public.tesla_guest_keys k on k.reservation_id = d.reservation_id
  left join lateral (
    select string_agg(s.name, ' and ' order by s.first_seen) name
      from public.car_drivers_seen s
     where d.started_at >= s.first_seen
       and d.started_at <= coalesce(s.gone_at, now())
       and s.share_user_id not in (select share_user_id from public.car_host_drivers)
  ) h on true
  where d.reservation_id = p_res
  order by d.started_at desc;
$$;
