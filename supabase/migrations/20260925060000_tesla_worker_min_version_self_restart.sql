-- Shipping new worker code used to need somebody to restart the worker by hand. The worker cannot
-- be reached from the cloud — worker.py lives on the Mac and launchd owns the process — but the
-- worker already knows how to restart itself: twenty failed polls in a row and it exits for launchd
-- to bring it back, which reloads worker.py from disk. So the deploy signal belongs in the poll.
--
-- min_worker_version is that signal. Raise it after editing worker.py and the running copy starts
-- failing its poll, counts to twenty over about ten minutes, exits, and comes back on the new code.
-- A worker already at or above the minimum is untouched.

alter table public.tesla_fleet_settings
  add column if not exists min_worker_version text;
comment on column public.tesla_fleet_settings.min_worker_version is
  'Set this to the version just written to worker.py on the Mac. Older running copies fail their poll until launchd restarts them onto the new code. Null disables the check.';

-- Dotted versions compare wrong as text ("1.10.0" < "1.9.0"), so compare them as number arrays.
create or replace function public.semver_key(p text)
returns int[] language sql immutable as $$
  select coalesce((select array_agg(coalesce(nullif(x, '')::int, 0))
                     from unnest(string_to_array(split_part(coalesce(p, '0'), '-', 1), '.')) x), '{0}');
$$;

create or replace function public.tesla_worker_claim(p_token text, p_version text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'vault'
as $function$
declare j tesla_fleet_commands; s tesla_fleet_settings;
begin
  if not tesla_worker_ok(p_token) then raise exception 'forbidden'; end if;
  update tesla_fleet_settings set worker_seen_at = now(), worker_version = coalesce(p_version, worker_version) where id = 1;

  -- Stale code: refuse the poll so the worker's own failure counter walks it to a restart.
  select * into s from tesla_fleet_settings where id = 1;
  if s.min_worker_version is not null and p_version is not null
     and semver_key(p_version) < semver_key(s.min_worker_version) then
    raise exception 'worker % is older than the required %; restart to pick up the new code', p_version, s.min_worker_version;
  end if;

  update tesla_fleet_commands set status = 'queued' where status = 'running' and claimed_at < now() - interval '2 minutes' and attempts < 2;
  update tesla_fleet_commands set status = 'failed', done_at = now(), result = jsonb_build_object('error', 'timed out')
    where (status = 'queued' and created_at < now() - interval '5 minutes') or (status = 'running' and claimed_at < now() - interval '2 minutes');
  select * into j from tesla_fleet_commands where status = 'queued' order by created_at limit 1 for update skip locked;
  if j.id is null then return null; end if;
  update tesla_fleet_commands set status = 'running', claimed_at = now(), attempts = attempts + 1 where id = j.id;
  return jsonb_build_object('job', jsonb_build_object('id', j.id, 'action', j.action, 'reservation_id', j.reservation_id, 'args', coalesce(j.args, '{}'::jsonb)),
    'vin', s.vin, 'secrets', tesla_fleet_secrets());
end $function$;

-- A restart that does not come back is the one way this makes things worse, so watch for it.
create or replace function public.tesla_worker_version_watchdog()
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare s tesla_fleet_settings; v_behind boolean; v_quiet_min numeric;
begin
  select * into s from tesla_fleet_settings where id = 1;
  v_behind := s.min_worker_version is not null and s.worker_version is not null
              and semver_key(s.worker_version) < semver_key(s.min_worker_version);
  v_quiet_min := extract(epoch from now() - coalesce(s.worker_seen_at, 'epoch')) / 60;

  if v_behind and v_quiet_min > 25 then
    perform public.bestly_raise('tesla.workerstuck', 'problem', 'warning',
      'Turo Watch: the car worker has not come back after an update',
      format('worker.py on the Mac is at %s and the running copy last reported %s, %s minutes ago. It should have exited and been restarted by launchd by now. Start it by hand, or clear tesla_fleet_settings.min_worker_version to let the old copy keep working.',
             s.min_worker_version, s.worker_version, round(v_quiet_min)),
      'turo');
  else
    perform public.bestly_raise('tesla.workerstuck', 'resolved', 'info', null);
  end if;

  return jsonb_build_object('ok', true, 'running', s.worker_version, 'required', s.min_worker_version,
                            'behind', v_behind, 'quiet_minutes', round(v_quiet_min));
end $$;

select cron.schedule('tesla-worker-version-watchdog', '8,38 * * * *', $$select public.tesla_worker_version_watchdog()$$);

-- worker.py 1.8.0 is on the Mac; this is the floor that pulls the running copy onto it.
update public.tesla_fleet_settings set min_worker_version = '1.8.0' where id = 1;
