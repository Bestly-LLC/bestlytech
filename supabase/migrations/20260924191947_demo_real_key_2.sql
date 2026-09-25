
do $$
declare src text := pg_get_functiondef('tesla_keys_apply'::regproc);
begin
  if position('demo key jobs' in src) = 0 then
    src := replace(src, $x$  if new.action not like 'key_%' or new.status not in ('done','failed') or old.status = new.status then return new; end if;$x$,
      $x$  if new.action not like 'key_%' or new.status not in ('done','failed') or old.status = new.status then return new; end if;
  if coalesce(new.args->>'demo','') = 'true' then return new; end if; -- demo key jobs: handled by demo_key_apply$x$);
    src := replace(src, $x$where not exists (select 1 from trip_extra_drivers e where e.reservation_id = new.reservation_id and e.share_user_id = x->>'id')), '[]'::jsonb));$x$,
      $x$where not exists (select 1 from trip_extra_drivers e where e.reservation_id = new.reservation_id and e.share_user_id = x->>'id')
               and not exists (select 1 from demo_key_drivers dd where dd.share_user_id = x->>'id')), '[]'::jsonb));$x$);
    if position('demo key jobs' in src) = 0 or position('demo_key_drivers' in src) = 0 then raise exception 'patch failed'; end if;
    execute src;
  end if;
end $$;

-- Cleaner guest-vs-demo rule: while a Turo guest's key is waiting to be accepted, new drivers are left for the trip to claim.
create or replace function demo_key_guest_pending() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from tesla_guest_keys g join turo_trips t using (reservation_id)
                 where g.status = 'ready' and now() between t.starts_at - interval '3 hours' and t.ends_at);
$$;

do $$
declare src text := pg_get_functiondef('demo_key_apply'::regproc);
begin
  src := regexp_replace(src, 'or exists \(select 1 from tesla_guest_keys g where g\.status = ''ready''.*?and d\.ready_at < g\.ready_at\);',
    'or demo_key_guest_pending();', 's');
  if position('demo_key_guest_pending' in src) = 0 then raise exception 'patch2 failed'; end if;
  execute src;
end $$;

-- Every 5 min: remove demo drivers when their time is up, keep one fresh invite ready, alert if stuck.
create or replace function demo_key_tick() returns jsonb
language plpgsql security definer set search_path = public as $$
declare d demo_key; fs tesla_fleet_settings; ids jsonb; out jsonb := '{}'::jsonb;
begin
  select * into d from demo_key where id = 1;
  select * into fs from tesla_fleet_settings where id = 1;
  if fs.connected_at is null then return jsonb_build_object('off','tesla not connected'); end if;
  -- Unstick: a job that never came back.
  if d.status = 'creating' and d.updated_at < now() - interval '20 minutes' and not demo_key_busy() then
    update demo_key set status = 'failed', fails = fails + 1, last_error = coalesce(last_error, 'Worker never answered'), updated_at = now() where id = 1;
    d.status := 'failed';
  end if;
  -- 1) Time's up: remove demo drivers (only those; never a guest).
  select jsonb_agg(share_user_id) into ids from demo_key_drivers where removed_at is null and remove_at <= now();
  if ids is not null and demo_key_enqueue('key_remove', jsonb_build_object('only', ids, 'baseline', '[]'::jsonb)) then
    out := out || jsonb_build_object('remove', ids);
  end if;
  if not d.enabled then
    -- Turned off: kill the open invite too.
    if d.invite_id is not null and demo_key_enqueue('key_remove', jsonb_build_object('invite_id', d.invite_id, 'only', '["none"]'::jsonb, 'baseline','[]'::jsonb, 'revoke_only', true)) then
      out := out || '{"revoke":true}';
    end if;
    return out;
  end if;
  -- 2) After a demo was viewed or a driver was added, keep a fresh invite ready.
  if d.status = 'ready' and d.invite_expires_at < now() + interval '10 minutes' then
    update demo_key set status = 'none', updated_at = now() where id = 1; d.status := 'none';
  end if;
  if (d.status = 'none' or (d.status = 'failed' and d.fails < 5 and d.updated_at < now() - interval '10 minutes'))
     and coalesce(d.last_view_at, 'epoch') > now() - interval '7 days' and demo_key_enqueue('key_create') then
    update demo_key set status = 'creating', updated_at = now() where id = 1;
    out := out || '{"create":true}';
  end if;
  -- 3) While a demo is open after the tap, ask Tesla every 5 min as a backup to the page's own checks.
  if d.status = 'ready' and d.last_view_at > now() - interval '30 minutes' and coalesce(d.last_check_at,'epoch') < now() - interval '5 minutes'
     and demo_key_enqueue('key_check', jsonb_build_object('baseline', coalesce(d.baseline,'[]'::jsonb))) then
    update demo_key set last_check_at = now() where id = 1;
  end if;
  -- Watchdog → Scout.
  if exists (select 1 from demo_key_drivers where removed_at is null and remove_at < now() - interval '30 minutes') then
    perform scout_notify('Demo driver still on Blue Steel', 'A driver added from the demo page wasn''t removed on time. Retrying every 5 min. Check Tesla app > Add Driver, or Turo settings > Demo key.',
      'critical', true, '/admin/turo/settings#demo-key', 'demo-key-stuck-' || to_char(now(),'YYYYMMDDHH24'));
  end if;
  if d.status = 'failed' and d.fails >= 3 then
    perform scout_notify('Demo key can''t be made', coalesce(d.last_error,'unknown error') || '. The demo falls back to the pretend key.', 'warning', false,
      '/admin/turo/settings#demo-key', 'demo-key-fail-' || to_char(now(),'YYYYMMDD'));
  end if;
  return out;
end $$;

-- Admin panel.
create or replace function demo_key_admin(p_action text default 'get', p_value text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare ids jsonb;
begin
  if not has_role(auth.uid(), 'admin') and current_user not in ('postgres','supabase_admin') then raise exception 'admin only'; end if;
  if p_action = 'on' then update demo_key set enabled = true, updated_at = now() where id = 1;
  elsif p_action = 'off' then update demo_key set enabled = false, updated_at = now() where id = 1;
  elsif p_action = 'keep' then update demo_key set keep_minutes = greatest(15, least(24*60, p_value::int)) where id = 1;
  elsif p_action = 'new_pass' then update demo_key set pass = replace(gen_random_uuid()::text, '-', '') where id = 1;
  elsif p_action = 'new_invite' then
    update demo_key set status = 'none', fails = 0, last_error = null, updated_at = now() where id = 1;
    perform demo_key_get(null);
  elsif p_action = 'remove_all' then
    select jsonb_agg(share_user_id) into ids from demo_key_drivers where removed_at is null;
    if ids is null then raise exception 'No demo drivers on the car'; end if;
    update demo_key_drivers set remove_at = least(remove_at, now()) where removed_at is null;
    if not demo_key_enqueue('key_remove', jsonb_build_object('only', ids, 'baseline', '[]'::jsonb)) then
      raise exception 'A demo key job is running; removal will run within 5 min';
    end if;
  elsif p_action <> 'get' then raise exception 'unknown action';
  end if;
  return (select to_jsonb(d) - 'baseline' || jsonb_build_object(
    'drivers', coalesce((select jsonb_agg(to_jsonb(x) order by x.accepted_at desc) from (select * from demo_key_drivers order by accepted_at desc limit 10) x), '[]'::jsonb),
    'busy', demo_key_busy()) from demo_key d where id = 1);
end $$;

revoke all on function demo_key_admin(text,text), demo_key_tick(), demo_key_enqueue(text,jsonb) from public, anon;
grant execute on function demo_key_admin(text,text) to authenticated;
grant execute on function demo_key_get(text), demo_key_check(text) to anon, authenticated;

select cron.schedule('demo-key', '2-59/5 * * * *', 'select public.demo_key_tick()');

create or replace function public.trip_health_expected_crons()
 returns table(jobname text, schedule text, command text, max_gap interval) language sql immutable set search_path to 'public', 'pg_temp'
as $f$ values
  ('lax-guest-tick', '9-59/10 * * * *', 'select public.lax_guest_tick()', interval '30 minutes'),
  ('lax-watchdog', '1-59/5 * * * *', 'select public.lax_watchdog()', interval '20 minutes'),
  ('lax-ask-watchdog', '*/2 * * * *', 'select lax_ask_watchdog()', interval '15 minutes'),
  ('tesla-climate-autooff', '* * * * *', 'select tesla_climate_autooff()', interval '10 minutes'),
  ('lax-pass-reminder', '0 16 * * *', 'select public.lax_pass_reminder()', interval '26 hours'),
  ('trip-health', '4-59/10 * * * *', 'select public.trip_health_run()', interval '40 minutes'),
  ('trip-charges', '13-59/15 * * * *', 'select public.trip_charges_tick()', interval '45 minutes'),
  ('trip-guest-push', '*/5 * * * *', 'select public.trip_guest_push_tick()', interval '20 minutes'),
  ('car-watch', '*/5 * * * *', 'select public.car_watch_tick()', interval '20 minutes'),
  ('supercharge-audit', '37 17 * * *', 'select public.supercharge_audit_tick()', interval '26 hours'),
  ('demo-key', '2-59/5 * * * *', 'select public.demo_key_tick()', interval '20 minutes') $f$;

