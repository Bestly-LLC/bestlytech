-- Admin "Add a trip": when the Turo feed hasn't synced a fresh booking yet, the host pastes the booking
-- message on /admin/turo/lax-pass and gets the guest link immediately. The real feed (turo-ingest)
-- upserts over this row later, so nothing is lost. Times come in as LA wall-clock text (no client tz math).
create or replace function public.lax_guest_add_trip(
  p_reservation bigint, p_first text, p_phone text, p_start_local text, p_end_local text,
  p_lax boolean default false, p_earnings numeric default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v record; s timestamptz; e timestamptz; tok text;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  if p_reservation is null or p_reservation < 1000000 then raise exception 'That trip number doesn''t look right.'; end if;
  s := (p_start_local::timestamp) at time zone 'America/Los_Angeles';
  e := (p_end_local::timestamp) at time zone 'America/Los_Angeles';
  if e <= s then raise exception 'Return is before pickup.'; end if;
  select vehicle_id, vin into v from turo_trips order by starts_at desc limit 1;
  if v.vehicle_id is null then raise exception 'No vehicle on file to copy.'; end if;
  insert into turo_trips (reservation_id, vehicle_id, vin, guest_first, guest_phone, starts_at, ends_at, local_start, local_end,
      time_zone, pickup_address, pickup_city, airport_code, earnings, miles_unlimited, status, in_progress, raw)
    values (p_reservation, v.vehicle_id, v.vin, nullif(btrim(p_first),''), nullif(btrim(p_phone),''), s, e,
      to_char(s at time zone 'America/Los_Angeles','YYYY-MM-DD HH24:MI'), to_char(e at time zone 'America/Los_Angeles','YYYY-MM-DD HH24:MI'),
      'America/Los_Angeles', case when p_lax then 'Los Angeles, CA' else 'Los Angeles, CA 90069' end, 'Los Angeles',
      case when p_lax then 'LAX' end, p_earnings, true, 'BOOKED', false, '{"manual":true}'::jsonb)
    on conflict (reservation_id) do nothing;
  insert into lax_guest_links (reservation_id) values (p_reservation) on conflict do nothing;
  select token into tok from lax_guest_links where reservation_id = p_reservation;
  return jsonb_build_object('reservation_id', p_reservation, 'token', tok);
end $$;
revoke all on function public.lax_guest_add_trip(bigint,text,text,text,text,boolean,numeric) from public, anon;
grant execute on function public.lax_guest_add_trip(bigint,text,text,text,text,boolean,numeric) to authenticated;
