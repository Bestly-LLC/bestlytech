-- Cleaning up the visits Jared made from the admin side.
--
-- The narrow rule only caught the two views within five minutes of him sending the link. It left
-- the rest of the same sitting — the 9:23–9:30 PM run on Willie's page, and two views on
-- GianPaula's from the same iPad that had just spent an hour on the demo trip — reading as the
-- guest. Before browser ids there is no honest way to separate those, so the rule is now the
-- device string: a browser used on more than one trip page, or on the demo trip, cannot have any
-- of its pre-id events claimed as the guest's. They become 'unsure', not 'host' — Willie may well
-- have opened his own page on an iPhone too, and the data cannot say.
--
-- Only ever applies to rows with no device_id. Everything from now on is decided by the browser id.
create or replace function public.lax_learn_host_devices()
returns int language plpgsql security definer set search_path to 'public'
as $$
declare v_new int := 0;
begin
  with spans as (
    select device_id, count(distinct reservation_id) trips, count(*) n
      from public.lax_guest_events
     where device_id is not null and reservation_id > 0
     group by 1 having count(distinct reservation_id) > 1
  )
  insert into public.lax_host_devices (device_id, reason, events)
  select device_id, format('seen on %s different trip pages', trips), n from spans
  on conflict (device_id) do update set events = excluded.events;
  get diagnostics v_new = row_count;

  update public.lax_guest_events e set actor = 'host'
   where e.actor <> 'host'
     and e.device_id in (select device_id from public.lax_host_devices);

  with multi as (
    select device from public.lax_guest_events
     where device_id is null and device is not null
     group by 1
    having count(distinct reservation_id) > 1
        or bool_or(reservation_id < 0)
  )
  update public.lax_guest_events e set actor = 'unsure'
   where e.device_id is null and e.actor = 'guest' and e.reservation_id > 0
     and e.device in (select device from multi);

  return v_new;
end $$;

select public.lax_learn_host_devices();
