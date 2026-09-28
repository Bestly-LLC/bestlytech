-- Demo key watchdog: a REJOIN counts as a join (2026-09-27).
-- False alarm since 9/25 ("Demo key: the link was tapped and nobody joined", 67 "dead taps"): the watchdog only
-- counted a join when car_drivers_seen.first_seen came after the tap. Jared tests with the same Tesla account
-- (share_user_id 2534032695282569), whose car_drivers_seen row dates from 9/24, so every successful re-accept
-- kept the old first_seen and looked like nothing happened. Proof it worked: tap 2:13 PM, Tesla "Vehicle App
-- Access Granted" 2:14 PM, key_check saw Jared Best 2:22 PM, demo_key_drivers.accepted_at 2:22 PM, removed 3:27 PM.
-- Now a join is ALSO: demo_key_drivers.accepted_at after the tap, or a key_check after the tap that reported
-- new_drivers (the car's own word that an account was added). dead_taps resets on the next healthy check.

create or replace function public.demo_key_watchdog()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare d demo_key; v_added boolean; v_names text; v_rotated boolean := false;
begin
  select * into d from public.demo_key where id = 1;
  if not d.enabled then
    perform public.bestly_raise('demo.key', 'resolved', 'info', null);
    return jsonb_build_object('ok', true, 'enabled', false);
  end if;

  select string_agg(name, ', ' order by first_seen) into v_names
    from public.car_drivers_seen where gone_at is null;

  -- Did anybody actually join since the last tap? New account, the demo's own accept record, or a returning account.
  select d.tapped_at is not null and (
           exists (select 1 from public.car_drivers_seen
                    where first_seen > d.tapped_at - interval '2 minutes')
        or exists (select 1 from public.demo_key_drivers
                    where accepted_at > d.tapped_at - interval '2 minutes')
        or exists (select 1 from public.tesla_fleet_commands c
                    where c.action = 'key_check' and c.status = 'done'
                      and c.created_at > d.tapped_at - interval '2 minutes'
                      and jsonb_array_length(coalesce(c.result->'new_drivers', '[]'::jsonb)) > 0))
    into v_added;

  if d.tapped_at is not null and not v_added and d.tapped_at < now() - interval '10 minutes'
     and coalesce(d.last_check_at, 'epoch') > d.tapped_at then
    -- A tap that produced nothing, with the car checked since. Rotate once: a consumed or stale
    -- invite is the one cause we can fix from here.
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
end $function$;
