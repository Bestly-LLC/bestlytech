-- link_sent, key_resend and agent rows are things the host or the system did to the trip. They
-- were counting as guest activity, which is how a trip nobody had opened could still look visited.
update public.lax_guest_events
   set actor = 'host'
 where device is null and kind in ('link_sent','key_resend','agent') and actor <> 'host';

-- Who was driving.
--
-- car_drives and car_trail carry a reservation number and nothing else: attribution has been "a
-- trip was booked at that time", which proves the car was out during someone's booking and not who
-- was at the wheel. tesla_guest_keys is better evidence and was already being collected — a named
-- Tesla account accepted a digital key at a timestamp and lost it at another. A drive inside that
-- window has a named person holding a live key to this car.
create or replace function public.trip_drive_attribution(p_res bigint)
returns table (
  drive_id text, started_at timestamptz, ended_at timestamptz, miles numeric, max_mph numeric,
  from_name text, to_name text, basis text, driver_name text
) language sql stable security definer set search_path to 'public' as $$
  select d.id, d.started_at, d.ended_at, d.miles, d.max_mph, d.from_name, d.to_name,
    case
      when k.accepted_at is not null
       and d.started_at >= k.accepted_at
       and d.started_at <= coalesce(k.removed_at, now()) then 'key'
      when d.reservation_id is not null then 'booking'
      else 'none'
    end as basis,
    k.driver_name
  from public.car_drives d
  left join public.tesla_guest_keys k on k.reservation_id = d.reservation_id
  where d.reservation_id = p_res
  order by d.started_at desc;
$$;

comment on function public.trip_drive_attribution(bigint) is
  'Drives on a trip with how strongly each is attributed: key = a named Tesla account held a live digital key across the drive; booking = only that a trip was active; none = neither.';

-- The counted version of a trip's page activity. Use this rather than counting rows, so the actor
-- rules can never be skipped by accident.
create or replace function public.lax_guest_activity(p_res bigint)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'views',      count(*) filter (where kind = 'view' and actor = 'guest'),
    'first_seen', min(at)  filter (where actor = 'guest' and device is not null),
    'last_seen',  max(at)  filter (where actor = 'guest' and device is not null),
    'devices',    coalesce((select array_agg(distinct device) from public.lax_guest_events
                             where reservation_id = p_res and actor = 'guest' and device is not null), '{}'),
    'asks',       count(*) filter (where kind = 'ask' and actor = 'guest'),
    'unsure',     count(*) filter (where actor = 'unsure'),
    'host',       count(*) filter (where actor = 'host' and device is not null),
    'recent',     coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'at', at, 'detail', detail, 'actor', actor)
                                             order by at desc)
                              from (select kind, at, detail, actor from public.lax_guest_events
                                     where reservation_id = p_res and device is not null and actor <> 'host'
                                     order by at desc limit 12) r), '[]'::jsonb)
  )
  from public.lax_guest_events where reservation_id = p_res;
$$;

grant execute on function public.lax_guest_activity(bigint), public.trip_drive_attribution(bigint) to authenticated;
