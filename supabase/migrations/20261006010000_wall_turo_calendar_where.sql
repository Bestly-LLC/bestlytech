-- 2026-10-05 (Jared): the wall's Turo calendar becomes an Apple-style month view (Sunday-first weeks) with two trip colors:
-- purple for LAX trips, teal (the home trip page's color) for trips picked up at home. Each booked day now carries
-- "where": "lax" | "home". A trip counts as LAX when Turo gives it an airport code or the pickup address is an airport.
-- The wall shows 5 full weeks starting this Sunday, so the function always returns at least 36 days (callers ask for 30;
-- the feed watchdog only checks for 30 or more).
create or replace function public.wall_turo_calendar(p_days int default 30)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with d as (
    select (now() at time zone 'America/Los_Angeles')::date + g as day
      from generate_series(0, greatest(36, least(coalesce(p_days, 30), 60)) - 1) g
  ), t as (
    select tr.starts_at at time zone 'America/Los_Angeles' as s, tr.ends_at at time zone 'America/Los_Angeles' as e,
           tr.guest_first, coalesce(v.display_name, 'Car') as car,
           (tr.airport_code is not null or coalesce(tr.pickup_address, '') ~* '(airport|\mLAX\M)') as lax
      from turo_trips tr left join turo_vehicle_state v on v.vin = tr.vin
     where tr.ends_at > now() - interval '1 day' and tr.ends_at > tr.starts_at
       and coalesce(tr.status, '') not ilike '%cancel%' and coalesce(tr.status, '') <> 'test'
  )
  select coalesce(jsonb_agg(x order by day), '[]'::jsonb) from (
    select d.day, jsonb_strip_nulls(jsonb_build_object(
             'date', to_char(d.day, 'YYYY-MM-DD'),
             'status', case when b.guest_first is not null or b.car is not null then 'booked' else 'open' end,
             'guest', coalesce(b.gs, b.guest_first), 'car', b.car, 'part', b.part, 'n', nullif(b.n, 1),
             'where', case when b.n is null then null when b.lax then 'lax' else 'home' end)) as x
      from d
      left join lateral (
        select min(t.guest_first) filter (where t.s::date = d.day) as gs, min(t.guest_first) as guest_first, min(t.car) as car, count(*) as n,
               coalesce(bool_or(t.lax) filter (where t.s::date = d.day), bool_or(t.lax)) as lax,
               case when count(*) > 1 then 'turn'
                    when bool_or(t.s::date = d.day) and bool_or(t.e::date = d.day) then 'single'
                    when bool_or(t.s::date = d.day) then 'start'
                    when bool_or(t.e::date = d.day) then 'end' else 'mid' end as part
          from t where t.s < (d.day + 1)::timestamp and t.e > d.day::timestamp
        having count(*) > 0) b on true
  ) q
$$;
revoke all on function public.wall_turo_calendar(int) from public, anon, authenticated;
