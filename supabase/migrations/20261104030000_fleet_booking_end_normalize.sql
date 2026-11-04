-- Pi Job Runner stuck 4 days (2026-11-03): stella_queue crashed 451 runs in a row with KeyError 'end'.
-- Root cause: the Costco rebooker started writing LIVE booking rows to fleet_maint_events on 2026-10-31
-- with only value.start (no value.end). Stella's never-host-cancel guard (run_guard) reads value.end.
-- Fix at the data contract: every booking row gets an end. Costco tire windows are 3 hours, the same
-- window every dry-run row and the booking text use ("1:00 PM to 4:00 PM").

create or replace function public.fleet_booking_fill_end()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.kind = 'booking' and new.value ? 'start' and coalesce(new.value->>'end', '') = '' then
    begin
      new.value := new.value || jsonb_build_object('end',
        to_char(((new.value->>'start')::timestamptz + interval '3 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
        'end_assumed', true);
    exception when others then
      null; -- unparseable start: leave the row alone, the guard skips it
    end;
  end if;
  return new;
end $$;

drop trigger if exists fleet_booking_fill_end on public.fleet_maint_events;
create trigger fleet_booking_fill_end
  before insert or update of value on public.fleet_maint_events
  for each row execute function public.fleet_booking_fill_end();

-- backfill the rows already written without an end (fires the trigger)
update public.fleet_maint_events set value = value
 where kind = 'booking' and value ? 'start' and coalesce(value->>'end', '') = '';
