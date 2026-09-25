-- Bestly could not remove Dylan's key. It could not remove GianPaula's either — the reason is the
-- same for both, and it was never about Dylan.
--
-- tesla_keys_tick drives removal from tesla_guest_keys: at trip end it enqueues key_remove using
-- that row's share_user_id. Trip 61347896 had no row at all, because both keys were sent by hand
-- from the Tesla app rather than through Bestly's invite flow. No row, no removal, for either of
-- them. The system only knows how to clean up after keys it issued itself.
--
-- car_drivers_seen knows who is really on the car, with real share_user_ids. Adopting those into
-- the tables the removal machinery already reads is the whole fix.
create or replace function public.adopt_unmanaged_keys()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare r record; v_primary int := 0; v_extra int := 0;
begin
  for r in
    select s.share_user_id, s.name, s.first_seen, s.reservation_id,
           row_number() over (
             partition by s.reservation_id
             order by (case when s.name ilike '%' || t.guest_first || '%'
                             or s.name ilike '%' || coalesce(t.guest_last,'~none~') || '%' then 0 else 1 end),
                      s.first_seen) rn
      from public.car_drivers_seen s
      join public.turo_trips t on t.reservation_id = s.reservation_id
     where s.share_user_id not in (select share_user_id from public.car_host_drivers)
       and coalesce(t.status,'') not in ('test','CANCELLED','CANCELED')
       and not exists (select 1 from public.tesla_guest_keys k where k.share_user_id = s.share_user_id)
       and not exists (select 1 from public.trip_extra_drivers x where x.share_user_id = s.share_user_id)
       and not exists (select 1 from public.demo_key_drivers d where d.share_user_id = s.share_user_id)
  loop
    if r.rn = 1 and not exists (select 1 from public.tesla_guest_keys k
                                 where k.reservation_id = r.reservation_id and k.share_user_id is not null) then
      insert into public.tesla_guest_keys (reservation_id, status, share_user_id, driver_name, accepted_at, ready_at, created_at)
      values (r.reservation_id, 'accepted', r.share_user_id, r.name, r.first_seen, r.first_seen, r.first_seen)
      on conflict (reservation_id) do update
        set status = 'accepted', share_user_id = excluded.share_user_id, driver_name = excluded.driver_name,
            accepted_at = coalesce(public.tesla_guest_keys.accepted_at, excluded.accepted_at), updated_at = now();
      v_primary := v_primary + 1;
    else
      insert into public.trip_extra_drivers (reservation_id, name, driver_name, share_user_id, status,
                                             ack_text, ack_at, accepted_at)
      values (r.reservation_id, coalesce(r.name, 'Extra driver'), r.name, r.share_user_id, 'accepted',
              'Adopted from the car: this key was already on the vehicle and was not issued through Bestly.',
              r.first_seen, r.first_seen);
      v_extra := v_extra + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'adopted_primary', v_primary, 'adopted_extra', v_extra);
end $$;

comment on function public.adopt_unmanaged_keys() is
  'Takes keys that exist on the car but were never issued by Bestly and files them where tesla_keys_tick and extra_driver_admin can see them, so they get removed at trip end like any other.';

-- The demo key looks healthy from the server: enabled, ready, a fresh unexpired share link, the
-- page being viewed. The failure is on the far side of the tap, where nothing was recorded — the
-- page asked "is a new driver there yet?" and a silent no was indistinguishable from a dead link.
alter table public.demo_key
  add column if not exists tapped_at timestamptz,
  add column if not exists taps int not null default 0,
  add column if not exists dead_taps int not null default 0;

create or replace function public.demo_key_tap(p_pass text default null)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare d demo_key;
begin
  if not demo_key_ok(p_pass) then return null; end if;
  update public.demo_key
     set tapped_at = now(), taps = taps + 1, last_check_at = least(coalesce(last_check_at, 'epoch'), now() - interval '1 minute')
   where id = 1 returning * into d;
  if d.status = 'ready' then perform demo_key_enqueue('key_check', jsonb_build_object('baseline', demo_key_baseline())); end if;
  return jsonb_build_object('ok', true, 'taps', d.taps);
end $$;
grant execute on function public.demo_key_tap(text) to anon, authenticated;

-- Who is on the car right now. The answer to "why did my tap do nothing" is usually in this list:
-- Tesla will not let an account that already holds a key accept another invite, and the owner's
-- own account can never accept one.
create or replace function public.demo_key_context()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  select jsonb_build_object(
    'on_car', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'since', first_seen) order by first_seen)
                          from public.car_drivers_seen where gone_at is null), '[]'::jsonb),
    'seats_used', (select count(*) from public.car_drivers_seen where gone_at is null),
    'last_tap', (select tapped_at from public.demo_key where id = 1),
    'taps', (select taps from public.demo_key where id = 1),
    'dead_taps', (select dead_taps from public.demo_key where id = 1));
$$;
grant execute on function public.demo_key_context() to authenticated;

create or replace function public.demo_key_watchdog()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare d demo_key; v_added boolean; v_names text; v_rotated boolean := false;
begin
  select * into d from public.demo_key where id = 1;
  if not d.enabled then
    perform public.bestly_raise('demo.key', 'resolved', 'info', null);
    return jsonb_build_object('ok', true, 'enabled', false);
  end if;

  select string_agg(name, ', ' order by first_seen) into v_names
    from public.car_drivers_seen where gone_at is null;

  select exists (select 1 from public.car_drivers_seen
                  where d.tapped_at is not null and first_seen > d.tapped_at - interval '2 minutes')
    into v_added;

  if d.tapped_at is not null and not v_added and d.tapped_at < now() - interval '10 minutes'
     and coalesce(d.last_check_at, 'epoch') > d.tapped_at then
    if d.dead_taps = 0 then
      update public.demo_key set status = 'none', invite_id = null, share_link = null,
             invite_expires_at = null, dead_taps = dead_taps + 1, updated_at = now() where id = 1;
      v_rotated := true;
    else
      update public.demo_key set dead_taps = dead_taps + 1 where id = 1;
    end if;

    perform public.bestly_raise('demo.key', 'problem', 'warning',
      'Demo key: the link was tapped and nobody joined',
      format('Tapped %s and the car still shows only %s. %s Tesla refuses an invite from an account that already holds a key to this car, and the owner account can never accept one — check which Tesla account you are testing with.',
             to_char(d.tapped_at at time zone 'America/Los_Angeles', 'FMHH12:MI AM'),
             coalesce(v_names, 'nobody'),
             case when v_rotated then 'A fresh invite is being made now.' else 'A fresh invite was already tried.' end),
      'turo', null, true);
  elsif v_added then
    update public.demo_key set dead_taps = 0 where id = 1 and dead_taps > 0;
    perform public.bestly_raise('demo.key', 'resolved', 'info', null);
  elsif d.status = 'failed' then
    perform public.bestly_raise('demo.key', 'problem', 'warning',
      'Demo key: Tesla would not make an invite', coalesce(d.last_error, 'No reason given.'), 'turo');
  else
    perform public.bestly_raise('demo.key', 'resolved', 'info', null);
  end if;

  return jsonb_build_object('ok', true, 'status', d.status, 'on_car', v_names,
                            'tapped_at', d.tapped_at, 'joined_since_tap', v_added, 'rotated', v_rotated);
end $$;

select cron.schedule('demo-key-watchdog', '29 * * * *', $$select public.demo_key_watchdog()$$);
