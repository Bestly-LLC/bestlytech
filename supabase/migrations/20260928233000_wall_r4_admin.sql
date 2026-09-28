-- Wall round 4, W4 (admin): Do Not Disturb, layout-block highlight, Motivate me, and the live sky for /admin/sky.
--
-- New wall_state.state keys (cleaned by wall_clean_r4admin, chained into wall_admin_set):
--   dnd       {on, from:"HH:MM", to:"HH:MM", override:{mode:"on"|"off", until:ms}|null}   quiet schedule for wall sounds/pop-ups
--   layoutSel "corners"|"mask"|"wing"|"air"|null   block being adjusted; the wall outlines it while the grid is on
--   motivate  {seq, ts}|null                         "Motivate me": the wall plays the show once per new seq (W5)
--
-- wall_dnd_now() tells anything else (Scout announcements, HomePod, pushes) whether the wall is in Do Not Disturb.
-- wall_air_live holds the Pi's aircraft snapshot for the admin Sky tab; the Pi pushes every 3 s only while someone
-- is watching (wall_admin_air() sets watch_until), every 30 s otherwise.

create or replace function public.wall_clean_r4admin(p jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare out jsonb := '{}'::jsonb; d jsonb; o jsonb; hm text := '^([01][0-9]|2[0-3]):[0-5][0-9]$';
begin
  if p ? 'dnd' then
    d := p->'dnd';
    if jsonb_typeof(d) = 'object' then
      o := d->'override';
      out := out || jsonb_build_object('dnd', jsonb_build_object(
        'on', coalesce(case when jsonb_typeof(d->'on') = 'boolean' then (d->>'on')::boolean end, true),
        'from', case when coalesce(d->>'from', '') ~ hm then d->>'from' else '22:30' end,
        'to', case when coalesce(d->>'to', '') ~ hm then d->>'to' else '07:00' end,
        'override', case
          when jsonb_typeof(o) = 'object' and o->>'mode' in ('on', 'off') and jsonb_typeof(o->'until') = 'number'
               and (o->>'until')::numeric between 0 and 99999999999999
            then jsonb_build_object('mode', o->>'mode', 'until', round((o->>'until')::numeric))
          else 'null'::jsonb end));
    end if;
  end if;
  if p ? 'layoutSel' then
    if jsonb_typeof(p->'layoutSel') = 'null' then out := out || '{"layoutSel": null}'::jsonb;
    elsif p->>'layoutSel' in ('corners', 'mask', 'wing', 'air') then out := out || jsonb_build_object('layoutSel', p->>'layoutSel');
    end if;
  end if;
  if p ? 'motivate' then
    if jsonb_typeof(p->'motivate') = 'null' then out := out || '{"motivate": null}'::jsonb;
    elsif jsonb_typeof(p->'motivate') = 'object' and jsonb_typeof(p->'motivate'->'seq') = 'number'
          and (p->'motivate'->>'seq')::numeric between 0 and 1000000000 then
      out := out || jsonb_build_object('motivate', jsonb_build_object(
        'seq', round((p->'motivate'->>'seq')::numeric)::bigint,
        'ts', case when jsonb_typeof(p->'motivate'->'ts') = 'number' then p->'motivate'->'ts'
                   else to_jsonb((extract(epoch from now()) * 1000)::bigint) end));
    end if;
  end if;
  return out;
end $$;

-- wall_admin_set = the live definition (round 3) plus wall_clean_r4admin.
create or replace function public.wall_admin_set(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w public.wall_state;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update wall_state
     set state = state || wall_clean_patch(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_toggles(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_tour(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_wake(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_widgets(coalesce(p_patch, '{}'::jsonb))
                       || wall_clean_r4admin(coalesce(p_patch, '{}'::jsonb)),
         version = version + 1, updated_at = now()
   where id = 1 returning * into w;
  return jsonb_build_object('state', w.state, 'version', w.version);
end $$;

-- Default schedule (10:30 PM to 7:00 AM), only where it isn't set yet.
update public.wall_state
   set state = state || '{"dnd": {"on": true, "from": "22:30", "to": "07:00", "override": null}}'::jsonb,
       version = version + 1, updated_at = now()
 where id = 1 and not (state ? 'dnd');

-- Effective Do Not Disturb at a moment (Los Angeles time). Same rules as wall.html dndNow() and watchdog dnd_watch.
create or replace function public.wall_dnd_eval(p_dnd jsonb, p_at timestamptz default now())
returns jsonb language plpgsql stable set search_path = public as $$
declare d jsonb := coalesce(p_dnd, '{}'::jsonb); o jsonb := d->'override'; now_ms numeric := extract(epoch from p_at) * 1000;
        loc timestamp := p_at at time zone 'America/Los_Angeles'; cur int; f int; t int; inq boolean;
begin
  if jsonb_typeof(o) = 'object' and (o->>'until')::numeric > now_ms then
    return jsonb_build_object('on', o->>'mode' = 'on', 'why', 'override', 'until', (o->>'until')::numeric);
  end if;
  if jsonb_typeof(d->'on') = 'boolean' and not (d->>'on')::boolean then
    return jsonb_build_object('on', false, 'why', 'off');
  end if;
  cur := extract(hour from loc)::int * 60 + extract(minute from loc)::int;
  f := split_part(coalesce(d->>'from', '22:30'), ':', 1)::int * 60 + split_part(coalesce(d->>'from', '22:30'), ':', 2)::int;
  t := split_part(coalesce(d->>'to', '07:00'), ':', 1)::int * 60 + split_part(coalesce(d->>'to', '07:00'), ':', 2)::int;
  inq := case when f = t then false when f < t then cur >= f and cur < t else cur >= f or cur < t end;
  return jsonb_build_object('on', inq, 'why', 'schedule');
exception when others then
  return jsonb_build_object('on', false, 'why', 'error');
end $$;

-- For anything that makes noise for Jared (Scout announcements on the HomePod, wall pop-ups, pushes): is it quiet now?
create or replace function public.wall_dnd_now()
returns jsonb language sql stable security definer set search_path = public as $$
  select wall_dnd_eval(state->'dnd', now()) from wall_state where id = 1;
$$;
revoke all on function public.wall_dnd_now() from public, anon;
grant execute on function public.wall_dnd_now() to authenticated, service_role;

-- ───── live sky for /admin/sky ─────
create table if not exists public.wall_air_live (
  id int primary key default 1 check (id = 1),
  data jsonb not null default '{}'::jsonb,
  at timestamptz,
  watch_until timestamptz,
  pushes bigint not null default 0
);
alter table public.wall_air_live enable row level security;
revoke all on public.wall_air_live from anon, authenticated;
insert into public.wall_air_live (id) values (1) on conflict do nothing;

-- The Pi (agent key) stores its aircraft snapshot; the answer says whether someone is watching (push every 3 s then).
create or replace function public.wall_pi_air_put(p_token text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare w timestamptz;
begin
  if p_token is null or p_token <> get_home_hub_agent_key() then raise exception 'not allowed'; end if;
  if jsonb_typeof(p_data) <> 'object' or length(p_data::text) > 60000 then raise exception 'bad snapshot'; end if;
  update wall_air_live set data = p_data, at = now(), pushes = pushes + 1 where id = 1 returning watch_until into w;
  return jsonb_build_object('ok', true, 'watch', coalesce(w > now(), false));
end $$;
revoke all on function public.wall_pi_air_put(text, jsonb) from public;
grant execute on function public.wall_pi_air_put(text, jsonb) to anon, authenticated, service_role;

-- Admin Sky tab: the latest snapshot + the sky settings; also tells the Pi someone is watching for the next 20 s.
create or replace function public.wall_admin_air()
returns jsonb language plpgsql security definer set search_path = public as $$
declare a wall_air_live; s jsonb;
begin
  if not has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  update wall_air_live set watch_until = now() + interval '20 seconds' where id = 1 returning * into a;
  select state into s from wall_state where id = 1;
  return jsonb_build_object('data', a.data, 'at', a.at, 'age_s', extract(epoch from now() - a.at),
    'radius_mi', coalesce((s->>'airRadiusMi')::numeric, 15), 'home_pos', s->'homePos', 'focus', s->'airFocus',
    'bearing', coalesce((s->>'airBearing')::numeric, 0));
end $$;
revoke all on function public.wall_admin_air() from public, anon;
grant execute on function public.wall_admin_air() to authenticated;

-- ───── watchdog (cron every 5 min) → Scout ─────
-- 1. A Do Not Disturb override set more than 36 h out is a mistake: clear it (self-heal) and say so.
-- 2. The schedule covering 18+ hours a day would silence nearly everything: tell Scout.
-- 3. Someone watched /admin/sky in the last few minutes but the Pi's snapshot is 60+ s old: the Pi isn't sharing.
create or replace function public.wall_r4admin_watchdog()
returns jsonb language plpgsql security definer set search_path = public as $$
declare s jsonb; d jsonb; a wall_air_live; f int; t int; span int; out jsonb := '{}'::jsonb;
begin
  select state into s from wall_state where id = 1;
  d := s->'dnd';
  if jsonb_typeof(d->'override') = 'object' and (d->'override'->>'until')::numeric > extract(epoch from now() + interval '36 hours') * 1000 then
    update wall_state set state = jsonb_set(state, '{dnd,override}', 'null'::jsonb), version = version + 1, updated_at = now() where id = 1;
    perform bestly_raise('wall.dnd_stuck', 'problem', 'info', 'Wall Do Not Disturb override was stuck',
      'An override was set more than 36 hours out, so it was cleared. The normal quiet schedule is back.', 'house', null, true);
    out := out || '{"dnd_override_cleared": true}';
  end if;
  if jsonb_typeof(d) = 'object' and coalesce((d->>'on')::boolean, true) then
    f := split_part(coalesce(d->>'from', '22:30'), ':', 1)::int * 60 + split_part(coalesce(d->>'from', '22:30'), ':', 2)::int;
    t := split_part(coalesce(d->>'to', '07:00'), ':', 1)::int * 60 + split_part(coalesce(d->>'to', '07:00'), ':', 2)::int;
    span := ((t - f) + 1440) % 1440;
    if span >= 18 * 60 then
      perform bestly_raise('wall.dnd_long', 'problem', 'info', 'Wall Do Not Disturb covers most of the day',
        format('Quiet hours run %s hours a day (%s to %s), so the wall is silent nearly all the time. Change it in Admin > Wall > Do Not Disturb.',
               round(span / 60.0, 1), d->>'from', d->>'to'), 'house', null, false);
    else
      perform bestly_raise('wall.dnd_long', 'resolved', 'info', null);
    end if;
  end if;
  select * into a from wall_air_live where id = 1;
  if a.watch_until > now() - interval '3 minutes' and (a.at is null or a.at < now() - interval '60 seconds') then
    perform bestly_raise('wall.sky_share', 'problem', 'warning', 'Admin Sky tab isn''t getting planes from the wall',
      format('The Pi last shared its planes %s. The Sky tab falls back to reading adsb.lol directly. Check server.py sky_share_loop on the Pi.',
             coalesce(to_char(a.at at time zone 'America/Los_Angeles', 'Mon DD FMHH12:MI AM'), 'never')), 'house', null, false);
    out := out || '{"sky_share": "stale"}';
  elsif a.at > now() - interval '60 seconds' then
    perform bestly_raise('wall.sky_share', 'resolved', 'info', null);
  end if;
  return out;
end $$;
revoke all on function public.wall_r4admin_watchdog() from public, anon, authenticated;

select cron.schedule('wall-r4admin-watchdog', '2-59/5 * * * *', $$select public.wall_r4admin_watchdog()$$);
