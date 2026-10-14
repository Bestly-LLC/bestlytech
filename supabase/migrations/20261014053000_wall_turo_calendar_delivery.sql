-- 2026-10-13 (Jared): the wall's Turo calendar gets a third trip color. Until now each booked day carried
-- "where": "lax" | "home" only, so a custom-address delivery (Marcus, res 62275681, 6135 Eleanor Ave) was painted
-- as a home pickup. The day's place now comes from trip_place(reservation_id) -- the same function the trip pages,
-- the delivery nav and the Live Activities use -- so it returns "lax" | "home" | "delivery".
-- When two trips share a day (a turn), the trip that STARTS that day wins, then the earlier start.
-- The wall paints delivery days cream beige and adds a Delivery swatch to the key.
create or replace function public.wall_turo_calendar(p_days int default 30)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with d as (
    select (now() at time zone 'America/Los_Angeles')::date + g as day
      from generate_series(0, greatest(36, least(coalesce(p_days, 30), 60)) - 1) g
  ), t as (
    select tr.starts_at at time zone 'America/Los_Angeles' as s, tr.ends_at at time zone 'America/Los_Angeles' as e,
           tr.guest_first, coalesce(v.display_name, 'Car') as car,
           case when tr.airport_code is not null or coalesce(tr.pickup_address, '') ~* '(airport|\mLAX\M)'
                then 'lax' else public.trip_place(tr.reservation_id) end as place
      from turo_trips tr left join turo_vehicle_state v on v.vin = tr.vin
     where tr.ends_at > now() - interval '1 day' and tr.ends_at > tr.starts_at
       and coalesce(tr.status, '') not ilike '%cancel%' and coalesce(tr.status, '') <> 'test'
  )
  select coalesce(jsonb_agg(x order by day), '[]'::jsonb) from (
    select d.day, jsonb_strip_nulls(jsonb_build_object(
             'date', to_char(d.day, 'YYYY-MM-DD'),
             'status', case when b.guest_first is not null or b.car is not null then 'booked' else 'open' end,
             'guest', coalesce(b.gs, b.guest_first), 'car', b.car, 'part', b.part, 'n', nullif(b.n, 1),
             'where', b.place)) as x
      from d
      left join lateral (
        select min(t.guest_first) filter (where t.s::date = d.day) as gs, min(t.guest_first) as guest_first, min(t.car) as car, count(*) as n,
               (array_agg(t.place order by (t.s::date = d.day) desc, t.s))[1] as place,
               case when count(*) > 1 then 'turn'
                    when bool_or(t.s::date = d.day) and bool_or(t.e::date = d.day) then 'single'
                    when bool_or(t.s::date = d.day) then 'start'
                    when bool_or(t.e::date = d.day) then 'end' else 'mid' end as part
          from t where t.s < (d.day + 1)::timestamp and t.e > d.day::timestamp
        having count(*) > 0) b on true
  ) q
$$;
revoke all on function public.wall_turo_calendar(int) from public, anon, authenticated;
