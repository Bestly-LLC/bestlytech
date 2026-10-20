-- Every Turo trip gets its /g/ check-in page the moment it's saved, so the
-- pickup Live Activity always opens License / Check-in, never the trip page.
-- Undo:
--   drop trigger turo_trips_gate_row on public.turo_trips;
--   drop function public.turo_trips_gate_row();

create or replace function public.turo_trips_gate_row()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare ks tesla_key_settings; fs tesla_fleet_settings;
begin
  if new.ends_at <= now() or coalesce(new.status, '') ~* 'cancel'
     or not tesla_key_kind_ok(new.airport_code, new.starts_at) then return new; end if;
  select * into ks from tesla_key_settings where id = 1;
  select * into fs from tesla_fleet_settings where id = 1;
  if ks.enabled is not true or fs.connected_at is null or fs.vin is null then return new; end if;
  if new.vin is not null and new.vin <> fs.vin then return new; end if;
  insert into tesla_guest_keys (reservation_id) values (new.reservation_id) on conflict do nothing;
  return new;
exception when others then
  raise warning 'turo_trips_gate_row: %', sqlerrm;
  return new;
end $$;
revoke all on function public.turo_trips_gate_row() from public, anon, authenticated;
drop trigger if exists turo_trips_gate_row on public.turo_trips;
create trigger turo_trips_gate_row
  after insert or update of starts_at, ends_at, airport_code, status, vin on public.turo_trips
  for each row execute function public.turo_trips_gate_row();
