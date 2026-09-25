-- A guest sees one trip. Two is the host.
--
-- The first cut of the retro rule compared the first and last event of a device string, so a
-- browser that opened two trip pages a minute apart and then came back the next afternoon looked
-- like a ten-hour span and matched nothing. The suspicious thing is not the span — it is opening a
-- page within a few minutes of the host sending that link, from a browser that also opened someone
-- else's page. Mark only those events, and leave the later ones as the guest.
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

  -- Rows from before there was a browser id. A device string is not an identity, so the most this
  -- can honestly say is 'unsure'.
  with multi as (
    select device from public.lax_guest_events
     where device_id is null and device is not null and reservation_id > 0
     group by 1 having count(distinct reservation_id) > 1
  ), sent as (
    select reservation_id, min(at) sent_at from public.lax_guest_events where kind = 'link_sent' group by 1
  )
  update public.lax_guest_events e set actor = 'unsure'
    from sent s
   where e.device_id is null and e.actor = 'guest' and e.reservation_id > 0
     and e.device in (select device from multi)
     and e.reservation_id = s.reservation_id
     and e.at between s.sent_at and s.sent_at + interval '5 minutes';

  return v_new;
end $$;

select public.lax_learn_host_devices();
