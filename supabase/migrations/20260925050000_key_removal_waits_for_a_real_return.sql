-- A key must not expire on the clock. It must expire on the car being back.
--
-- tesla_keys_tick removed the key at done_by (reservation end plus remove_after), and had a second
-- branch that removed it six hours BEFORE the reservation ended if Turo said the guest had checked
-- out. Neither asks where the car is. A guest who has not extended in Turo and is still driving —
-- or who has stopped at a Supercharger and stepped out — loses their key while standing next to a
-- locked car they can no longer open. That is the worst failure this system can produce.
--
-- The key now expires only after the car is genuinely back: at the return spot, locked, nothing
-- standing open, on a fresh reading — then held for a settle window (10 minutes by default).

alter table public.tesla_key_settings
  add column if not exists settle_minutes int not null default 10;
comment on column public.tesla_key_settings.settle_minutes is
  'How long the car must sit back, locked and shut before a guest key is taken away.';

alter table public.lax_guest_links
  add column if not exists settled_at timestamptz;
comment on column public.lax_guest_links.settled_at is
  'When the car was last seen home, locked and fully shut. Cleared the moment that stops being true, so the settle window restarts.';

-- Unknown is not the same as open: no window sensor in the feed must not hold a key forever, but a
-- boot we can see standing open must.
create or replace function public.car_return_state()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v turo_vehicle_state; fs tesla_fleet_settings; d_km float8; spot text;
        v_trunk boolean; v_frunk boolean; v_win boolean; v_open text[] := '{}'; v_fresh boolean;
begin
  select * into fs from tesla_fleet_settings where id = 1;
  select * into v from turo_vehicle_state where vin = fs.vin;
  if v.vin is null or v.latitude is null then
    return jsonb_build_object('known', false, 'why', 'no reading from the car');
  end if;

  v_fresh := v.observed_at > now() - interval '30 minutes';

  d_km := sqrt(power((v.latitude - 34.084241) * 111.0, 2) + power((v.longitude + 118.371793) * 111.0 * cos(radians(34.084241)), 2));
  if d_km < 0.35 then spot := 'home'; end if;
  if spot is null then
    d_km := sqrt(power((v.latitude - 33.9472637) * 111.0, 2) + power((v.longitude + 118.3826063) * 111.0 * cos(radians(33.9472637)), 2));
    if d_km < 0.35 then spot := 'lax'; end if;
  end if;

  v_trunk := (v.raw #>> '{fleet_api,doors,rear_trunk_open}')::boolean;
  v_frunk := (v.raw #>> '{fleet_api,doors,front_trunk_open}')::boolean;
  v_win   := car_windows_open();

  if coalesce(v_trunk, false) then v_open := v_open || 'the boot'; end if;
  if coalesce(v_frunk, false) then v_open := v_open || 'the frunk'; end if;
  if coalesce(v_win,   false) then v_open := v_open || 'a window'; end if;
  if v.locked is false then v_open := v_open || 'the doors (unlocked)'; end if;

  return jsonb_build_object(
    'known', true, 'at', v.observed_at, 'fresh', v_fresh, 'spot', spot, 'locked', v.locked,
    'trunk_open', v_trunk, 'frunk_open', v_frunk, 'windows_open', v_win, 'open', to_jsonb(v_open),
    'settled', (v_fresh and spot is not null and coalesce(v.locked, false) and array_length(v_open, 1) is null));
end $$;

create or replace function public.trip_return_detect()
returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare r record; st jsonb; n int := 0;
begin
  st := public.car_return_state();
  if not (st->>'known')::boolean then return 0; end if;

  for r in select l.reservation_id, l.returned_at, l.settled_at, t.ends_at
             from lax_guest_links l join turo_trips t using (reservation_id)
            where now() between t.ends_at - interval '6 hours' and t.ends_at + interval '7 days'
  loop
    if (st->>'settled')::boolean then
      if r.returned_at is null then
        update lax_guest_links set returned_at = least(now(), (st->>'at')::timestamptz)
         where reservation_id = r.reservation_id;
        n := n + 1;
      end if;
      if r.settled_at is null then
        update lax_guest_links set settled_at = least(now(), (st->>'at')::timestamptz)
         where reservation_id = r.reservation_id;
      end if;
    elsif r.settled_at is not null then
      update lax_guest_links set settled_at = null where reservation_id = r.reservation_id;
    end if;
  end loop;
  return n;
end $function$;

create or replace function public.key_removal_ready(p_res bigint)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare l lax_guest_links; t turo_trips; st jsonb; mins int; waited numeric;
begin
  select * into t from turo_trips where reservation_id = p_res;
  select * into l from lax_guest_links where reservation_id = p_res;
  select settle_minutes into mins from tesla_key_settings where id = 1;
  mins := coalesce(mins, 10);
  st := public.car_return_state();

  if t.reservation_id is null then return jsonb_build_object('ready', false, 'why', 'no trip'); end if;
  if l.settled_at is null then
    return jsonb_build_object('ready', false, 'state', st,
      'why', case
        when not (st->>'known')::boolean then 'the car has not reported in'
        when not (st->>'fresh')::boolean then 'the last reading from the car is over half an hour old'
        when st->>'spot' is null then 'the car is not back at the pickup spot'
        when jsonb_array_length(coalesce(st->'open','[]'::jsonb)) > 0
          then 'still open: ' || (select string_agg(x #>> '{}', ', ') from jsonb_array_elements(st->'open') x)
        else 'waiting for a clean reading' end);
  end if;

  waited := extract(epoch from now() - l.settled_at) / 60;
  if waited < mins then
    return jsonb_build_object('ready', false, 'state', st, 'settled_at', l.settled_at,
      'why', format('back and shut %s min ago; waiting %s', round(waited), mins));
  end if;

  return jsonb_build_object('ready', true, 'state', st, 'settled_at', l.settled_at,
    'why', format('back at the %s spot, locked and shut for %s min', coalesce(st->>'spot','return'), round(waited)));
end $$;

grant execute on function public.car_return_state(), public.key_removal_ready(bigint) to authenticated;

-- Surgical: the removal trigger inside tesla_keys_tick becomes "the reservation is over AND the
-- car is actually back and shut". The six-hours-early branch is gone — Turo marking a guest
-- checked out says nothing about where the car is.
do $$
declare src text; needle text; repl text;
begin
  src := pg_get_functiondef('public.tesla_keys_tick'::regproc);
  needle := 'if now() >= done_by or (coalesce(r.checked_out, false) and now() >= r.ends_at - interval ''6 hours'') then';
  repl   := 'if (now() >= done_by or coalesce(r.checked_out, false))'
         || ' and (public.key_removal_ready(r.reservation_id)->>''ready'')::boolean then';
  if position(needle in src) = 0 then
    if position('key_removal_ready' in src) > 0 then return; end if;   -- already patched
    raise exception 'tesla_keys_tick no longer contains the expected removal condition; refusing to patch blind';
  end if;
  execute replace(src, needle, repl);
end $$;
