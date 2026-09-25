-- Where window state has to come from, and the one change left to make.
--
-- TezLab does not have it. Its status payload for this car is doors.locked, front_trunk_open,
-- rear_trunk_open and nothing else about openings — checked live against get_vehicle_status, not
-- assumed. car_raw_store writes that payload verbatim, so no work on our side can find a window.
--
-- Tesla's own Fleet API does have it, and the worker is already reading it. The `health` action
-- returns tires.fl/fr/rl/rr, tpms_at, sentry, odometer and charge_limit — every one of those comes
-- from vehicle_data.vehicle_state, the same object that carries fd_window, fp_window, rd_window and
-- rp_window (0 closed, non-zero open). The worker parses that response already and drops the four
-- window fields. No new call, no new scope, no extra cost.
--
-- This prepares the database so that change is a one-liner in the worker:
--   1. car_status_raw becomes two rows, one per source, so TezLab's refresh cannot clobber fields
--      only the Fleet path supplies. It was a single row overwritten wholesale.
--   2. any completed command whose result carries window keys is filed as the fleet source.
--   3. car_raw_find reads only sources still fresh, so a dead feed goes quiet rather than
--      answering with yesterday's window position.
-- car_windows_open() needs no change: it already matches any key containing "window" and reads a
-- number above zero as open, which is exactly Tesla's shape.

create or replace function public.car_raw_store(p_raw jsonb, p_source text default 'tezlab')
returns void language sql security definer set search_path to 'public'
as $function$
  insert into car_status_raw (id, raw, at)
  values (case lower(coalesce(p_source,'tezlab')) when 'fleet' then 2 else 1 end, p_raw, now())
  on conflict (id) do update set raw = excluded.raw, at = now();
$function$;

comment on function public.car_raw_store(jsonb, text) is
  'Row 1 is TezLab''s status, row 2 is the Tesla Fleet API''s. Separate rows so one source cannot erase what only the other reports.';

create or replace function public.car_raw_find(p_re text)
returns table(k text, v jsonb) language sql stable security definer set search_path to 'public'
as $function$
  with recursive src as (
    select raw from car_status_raw where at > now() - interval '2 hours'
  ), walk(k, v) as (
    select key, value from src, jsonb_each(coalesce(src.raw, '{}'::jsonb))
    union all
    select c.key, c.value from walk w, jsonb_each(case when jsonb_typeof(w.v) = 'object' then w.v else '{}'::jsonb end) c
  ) select k, v from walk where k ~* p_re;
$function$;

create or replace function public.car_raw_from_command()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  if new.status = 'done' and new.result is not null and new.result::text ~* '"[a-z]{0,3}_?window' then
    perform public.car_raw_store(new.result, 'fleet');
  end if;
  return new;
end $$;

drop trigger if exists trg_car_raw_from_command on public.tesla_fleet_commands;
create trigger trg_car_raw_from_command
  after insert or update on public.tesla_fleet_commands
  for each row execute function public.car_raw_from_command();

delete from public.scout_lessons where signature = 'turo:window-state-source';
insert into public.scout_lessons (scope, title, when_text, do_text, avoid_text, signature, source, active)
values (
  'turo',
  'Window state comes from the Tesla Fleet API, not TezLab',
  'anything that needs to know whether a window is open — the guest key gate, the close-the-windows auto-fix, the return checklist',
  'TezLab''s status payload has doors.locked, front_trunk_open and rear_trunk_open and nothing else about openings; checked live against get_vehicle_status. Tesla''s Fleet API vehicle_data.vehicle_state carries fd_window, fp_window, rd_window, rp_window (0 closed, non-zero open) and the worker already reads that object — tires, tpms_at, sentry, odometer and charge_limit in the health result all come from it. The remaining change is in the worker, outside this repo: include those four fields in a result. car_status_raw is now two rows (1 TezLab, 2 Fleet), car_raw_find only reads sources refreshed within two hours, and a trigger files any result containing window keys as the fleet source. car_windows_open() already understands the shape — proven end to end with a simulated payload, which returned true for a rear window at 2.',
  'Do not try to derive window state from TezLab, and do not treat car_windows_open() returning null as "closed". Null means no sensor reached us.',
  'turo:window-state-source',
  'incident',
  true
);
