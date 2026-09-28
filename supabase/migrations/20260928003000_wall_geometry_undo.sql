-- Wall geometry undo / redo (worker G, 2026-09-27).
--
-- Any change to the wall's projection geometry (strip corners, blocked area, sign wall,
-- sky and its fit keys), from ANY writer (admin drag, nudges, recalibration scripts),
-- pushes the previous geometry onto wall_geometry_history. A drag is one step: writes that
-- arrive less than 3 s apart and touch the same keys are folded into one row that keeps the
-- geometry from BEFORE the first write. Undo / redo walk that stack; a new change clears redo.
-- Legacy snapshot keys (cornersPrev, geometrySaved, geometryBeforeMove, cornersAccident, ...)
-- are not geometry and are never touched.

create table if not exists public.wall_geometry_history (
  id            bigserial primary key,
  at            timestamptz not null default now(),    -- when the change started
  last_at       timestamptz not null default now(),    -- last write folded into this step
  burst_until   timestamptz,                           -- later writes before this join the step
  geometry      jsonb not null,                        -- geometry BEFORE the change
  after_geometry jsonb,                                -- geometry replaced by an undo (for redo)
  keys          text[] not null default '{}',          -- which geometry keys changed
  reason        text not null,
  who           text,
  changes       int not null default 1,
  undone        boolean not null default false
);
create index if not exists wall_geometry_history_at on public.wall_geometry_history (at desc);
alter table public.wall_geometry_history enable row level security;
revoke all on public.wall_geometry_history from anon, authenticated;
revoke all on sequence public.wall_geometry_history_id_seq from anon, authenticated;

-- The keys that make up "geometry".
create or replace function public.wall_geo_keys()
returns text[] language sql immutable set search_path = public
as $$ select array['corners','mask','air','wing','airAspect','airRot','airFlip','airBearing'] $$;

-- Pull just the geometry out of a wall state (only keys that exist).
create or replace function public.wall_geo_of(p_state jsonb)
returns jsonb language sql immutable set search_path = public
as $$
  select coalesce(jsonb_object_agg(k, p_state->k), '{}'::jsonb)
    from unnest(public.wall_geo_keys()) k
   where p_state ? k
$$;

-- Plain words for what changed.
create or replace function public.wall_geo_label(p_old jsonb, p_new jsonb, p_keys text[])
returns text language plpgsql immutable set search_path = public
as $$
declare parts text[] := '{}'; sky text[] := array['air','airAspect','airRot','airFlip'];
begin
  if p_keys @> array['corners','wing','air'] then return 'Moved everything'; end if;
  if 'corners' = any(p_keys) then parts := array_append(parts, 'Moved strip'); end if;
  if p_keys && sky then
    parts := array_append(parts, case when p_keys <@ array['airFlip'] then 'Flipped sky' else 'Moved sky' end);
  end if;
  if 'airBearing' = any(p_keys) then parts := array_append(parts, 'Turned sky'); end if;
  if 'wing' = any(p_keys) then parts := array_append(parts, 'Moved sign wall'); end if;
  if 'mask' = any(p_keys) then
    parts := array_append(parts, case
      when coalesce(jsonb_typeof(p_old->'mask'),'null') = 'null' then 'Added blocked area'
      when coalesce(jsonb_typeof(p_new->'mask'),'null') = 'null' then 'Removed blocked area'
      else 'Changed blocked area' end);
  end if;
  if cardinality(parts) = 0 then return 'Changed layout'; end if;
  if cardinality(parts) = 1 then return parts[1]; end if;
  -- Same verb: "Moved strip and sky". Mixed: "Moved strip, added blocked area".
  if (select bool_and(p like 'Moved %') from unnest(parts) p) then
    return 'Moved ' || array_to_string(array(select substr(p, 7) from unnest(parts[1:cardinality(parts)-1]) p), ', ')
           || ' and ' || substr(parts[cardinality(parts)], 7);
  end if;
  return parts[1] || ', ' || lower(array_to_string(parts[2:], ', '));
end $$;

-- BEFORE UPDATE trigger on wall_state: record the old geometry.
create or replace function public.wall_geometry_track()
returns trigger language plpgsql security definer set search_path = public
as $$
declare o jsonb; n jsonb; ks text[]; h wall_geometry_history; v_reason text; v_who text;
begin
  if coalesce(current_setting('wall.geo_op', true), '') in ('undo','redo') then return new; end if;
  o := wall_geo_of(old.state); n := wall_geo_of(new.state);
  if o = n then return new; end if;
  ks := array(select k from unnest(wall_geo_keys()) k where (o->k) is distinct from (n->k) order by k);

  delete from wall_geometry_history where undone;          -- a new change clears redo

  select * into h from wall_geometry_history order by id desc limit 1 for update;
  if h.id is not null and h.burst_until is not null and h.burst_until > clock_timestamp() and h.keys = ks then
    update wall_geometry_history
       set last_at = clock_timestamp(), burst_until = clock_timestamp() + interval '3 seconds', changes = changes + 1
     where id = h.id;
    return new;
  end if;

  v_reason := coalesce(nullif(current_setting('wall.geo_reason', true), ''), wall_geo_label(o, n, ks));
  v_who := case when auth.uid() is not null then 'admin'
                else coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
                              nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb)->>'role', ''),
                              current_user) end;
  insert into wall_geometry_history (at, last_at, burst_until, geometry, keys, reason, who)
  values (clock_timestamp(), clock_timestamp(), clock_timestamp() + interval '3 seconds', o, ks, v_reason, v_who);
  delete from wall_geometry_history
   where id in (select id from wall_geometry_history order by id desc offset 50);
  return new;
exception when others then
  -- History is a safety net; it must never block a wall write. Tell Scout instead.
  raise warning 'wall_geometry_track: %', sqlerrm;
  begin
    perform bestly_raise('wall.geometry_track', 'problem', 'warning', 'Wall undo missed a layout change',
      'Saving the layout history failed: ' || sqlerrm || '. The wall itself is fine; that one change cannot be undone.', 'house', null, false);
  exception when others then null;
  end;
  return new;
end $$;

drop trigger if exists wall_geometry_track on public.wall_state;
create trigger wall_geometry_track
  before update of state on public.wall_state
  for each row when (old.state is distinct from new.state)
  execute function public.wall_geometry_track();

-- Undo: go back one step.
create or replace function public.wall_geometry_undo()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare w wall_state; h wall_geometry_history; cur jsonb;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into w from wall_state where id = 1 for update;
  select * into h from wall_geometry_history where not undone order by id desc limit 1 for update;
  if h.id is null then return jsonb_build_object('ok', false, 'error', 'Nothing to undo'); end if;
  cur := wall_geo_of(w.state);
  perform set_config('wall.geo_op', 'undo', true);
  update wall_state set state = (state - wall_geo_keys()) || h.geometry,
         version = version + 1, updated_at = now()
   where id = 1 returning * into w;
  perform set_config('wall.geo_op', '', true);
  update wall_geometry_history set undone = true, after_geometry = cur where id = h.id;
  update wall_geometry_history set burst_until = null where burst_until is not null;
  return jsonb_build_object('ok', true, 'id', h.id, 'at', h.at, 'reason', h.reason,
                            'geometry', wall_geo_of(w.state), 'version', w.version);
end $$;

-- Redo: go forward one step (only after an undo, and only until something new changes).
create or replace function public.wall_geometry_redo()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare w wall_state; h wall_geometry_history;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select * into w from wall_state where id = 1 for update;
  select * into h from wall_geometry_history where undone order by id asc limit 1 for update;
  if h.id is null or h.after_geometry is null then return jsonb_build_object('ok', false, 'error', 'Nothing to redo'); end if;
  perform set_config('wall.geo_op', 'redo', true);
  update wall_state set state = (state - wall_geo_keys()) || h.after_geometry,
         version = version + 1, updated_at = now()
   where id = 1 returning * into w;
  perform set_config('wall.geo_op', '', true);
  update wall_geometry_history set undone = false, after_geometry = null where id = h.id;
  update wall_geometry_history set burst_until = null where burst_until is not null;
  return jsonb_build_object('ok', true, 'id', h.id, 'at', h.at, 'reason', h.reason,
                            'geometry', wall_geo_of(w.state), 'version', w.version);
end $$;

-- History for the admin, newest first. can_undo marks the step Undo would reverse next,
-- can_redo the step Redo would bring back next (at most one of each).
create or replace function public.wall_geometry_history_list()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare nu bigint; nr bigint;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  select max(id) into nu from wall_geometry_history where not undone;
  select min(id) into nr from wall_geometry_history where undone and after_geometry is not null;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'at', at, 'reason', reason,
                                        'can_undo', id = nu, 'can_redo', id is not distinct from nr,
                                        'undone', undone, 'who', who) order by id desc)
      from wall_geometry_history), '[]'::jsonb);
end $$;

-- Watchdog (every minute): runaway changes, a broken strip, a missing trigger.
create or replace function public.wall_geometry_watchdog()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare n int; long_burst boolean; w wall_state; ok_corners boolean; h wall_geometry_history; has_trg boolean;
begin
  select count(*) into n from wall_geometry_history where at > now() - interval '2 minutes';
  select exists(select 1 from wall_geometry_history
                 where last_at > now() - interval '1 minute' and last_at - at > interval '5 minutes') into long_burst;
  if n > 20 or long_burst then
    perform bestly_raise('wall.geometry_churn', 'problem', 'warning',
      'The wall layout keeps changing',
      format('The projector layout changed %s times in the last 2 minutes%s. Something may be writing it in a loop. Every step is kept, so Undo in Admin > Wall > Alignment walks it back.',
             n, case when long_burst then ' (one change has been running for over 5 minutes)' else '' end),
      'house', null, false);
  else
    perform bestly_raise('wall.geometry_churn', 'resolved', 'info', null);
  end if;

  -- Self-heal: a strip that isn't 4 valid points is restored from the newest good step.
  select * into w from wall_state where id = 1;
  ok_corners := public.wall_clean_patch(jsonb_build_object('corners', w.state->'corners')) ? 'corners';
  if not ok_corners then
    select * into h from wall_geometry_history
     where public.wall_clean_patch(jsonb_build_object('corners', geometry->'corners')) ? 'corners'
     order by id desc limit 1;
    if h.id is not null then
      perform set_config('wall.geo_reason', 'Watchdog fixed a broken strip', true);
      update wall_state set state = (state - wall_geo_keys()) || h.geometry, version = version + 1, updated_at = now() where id = 1;
      perform set_config('wall.geo_reason', '', true);
    end if;
    perform bestly_raise('wall.geometry_invalid', 'problem', case when h.id is null then 'error' else 'info' end,
      case when h.id is null then 'The wall strip layout is broken' else 'Fixed a broken wall strip layout' end,
      case when h.id is null then 'The strip corners are not 4 valid points and there is no saved step to go back to. Re-align in Admin > Wall.'
           else format('The strip corners were not 4 valid points. Put back the layout from %s. Undo in Admin > Wall if that was wrong.',
                       to_char(h.at at time zone 'America/Los_Angeles', 'Mon DD FMHH12:MI AM')) end,
      'house', case when h.id is null then 'Re-align the wall in Admin > Wall' end, h.id is not null);
  else
    perform bestly_raise('wall.geometry_invalid', 'resolved', 'info', null);
  end if;

  -- A history write error clears itself after 30 quiet minutes.
  if exists (select 1 from monitor_issues where key = 'wall.geometry_track' and status = 'open'
               and updated_at < now() - interval '30 minutes') then
    perform bestly_raise('wall.geometry_track', 'resolved', 'info', null);
  end if;

  select exists(select 1 from pg_trigger where tgrelid = 'public.wall_state'::regclass
                  and tgname = 'wall_geometry_track' and tgenabled <> 'D') into has_trg;
  if not has_trg then
    perform bestly_raise('wall.geometry_history', 'problem', 'warning', 'Wall undo stopped recording',
      'The wall_geometry_track trigger is missing or off, so layout changes are not saved for Undo. Re-apply migration 20260928003000_wall_geometry_undo.',
      'house', null, false);
  else
    perform bestly_raise('wall.geometry_history', 'resolved', 'info', null);
  end if;
  return jsonb_build_object('ok', n <= 20 and not long_burst and ok_corners and has_trg,
                            'changes_2min', n, 'long_burst', long_burst, 'corners_ok', ok_corners, 'trigger', has_trg);
end $$;

revoke all on function public.wall_geometry_undo() from public, anon;
revoke all on function public.wall_geometry_redo() from public, anon;
revoke all on function public.wall_geometry_history_list() from public, anon;
revoke all on function public.wall_geometry_watchdog() from public, anon, authenticated;
revoke all on function public.wall_geometry_track() from public, anon, authenticated;
grant execute on function public.wall_geometry_undo() to authenticated;
grant execute on function public.wall_geometry_redo() to authenticated;
grant execute on function public.wall_geometry_history_list() to authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'wall-geometry-watchdog';
select cron.schedule('wall-geometry-watchdog', '* * * * *', 'select public.wall_geometry_watchdog()');

-- Seed: the 4:59 PM slip. The restored layout is the present; one Undo step goes back to the
-- slipped strip (clearly labeled), so nothing is lost and Redo returns to today's layout.
insert into public.wall_geometry_history (at, last_at, geometry, keys, reason, who)
select timestamptz '2026-09-27 17:00:00 America/Los_Angeles', timestamptz '2026-09-27 17:00:00 America/Los_Angeles',
       public.wall_geo_of(state) || jsonb_build_object('corners', state->'cornersAccident'),
       array['corners'], 'Accidental move 4:59 PM (restored)', 'seed'
  from public.wall_state
 where id = 1 and state ? 'cornersAccident'
   and not exists (select 1 from public.wall_geometry_history where who = 'seed');
