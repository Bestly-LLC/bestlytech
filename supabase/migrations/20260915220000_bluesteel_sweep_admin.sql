-- Blue Steel street-sweeping alerts, part 2: config + run log + admin surface.
--
-- The two Claude scheduled tasks ("Street sweeping alert – Blue Steel" :25 / :55,
-- Mon+Tue 6:55–9:55am PT) now:
--   1. call bluesteel_sweep_precheck()   -> enabled? skipped today? acked today?
--   2. read the car from TezLab, decide the side
--   3. call bluesteel_sweep_send_alert() -> one ntfy push, built in one place
--   4. call bluesteel_sweep_log_run()    -> every check lands in bluesteel_sweep_runs
-- /admin/street-sweeping reads and controls all of it through admin_* RPCs.

create table if not exists public.bluesteel_sweep_config (
  id smallint primary key default 1 check (id = 1),
  alerts_enabled boolean not null default true,
  skip_dates date[] not null default '{}',
  updated_at timestamptz not null default now()
);
insert into public.bluesteel_sweep_config (id) values (1) on conflict do nothing;
alter table public.bluesteel_sweep_config enable row level security;
revoke all on public.bluesteel_sweep_config from anon, authenticated;

create table if not exists public.bluesteel_sweep_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  outcome text not null check (outcome in
    ('alerted','safe_side','not_on_street','acknowledged','disabled','skipped','location_error','outside_window','test')),
  side text check (side in ('west','east')),
  latitude double precision,
  longitude double precision,
  alert_title text,
  alert_body text,
  ntfy_request_id bigint,
  note text
);
create index if not exists bluesteel_sweep_runs_ran_at_idx on public.bluesteel_sweep_runs (ran_at desc);
alter table public.bluesteel_sweep_runs enable row level security;
revoke all on public.bluesteel_sweep_runs from anon, authenticated;

-- LA-local date helper
create or replace function public.bluesteel_la_today()
returns date language sql stable as $$ select (now() at time zone 'America/Los_Angeles')::date $$;

-- ---------------------------------------------------------------- worker RPCs
create or replace function public.bluesteel_sweep_precheck()
returns jsonb
language sql
security definer
set search_path to 'public'
stable
as $$
  select jsonb_build_object(
    'alerts_enabled', c.alerts_enabled,
    'skipped_today', bluesteel_la_today() = any(c.skip_dates),
    'acked_today', exists(
      select 1 from bluesteel_sweep_acks a
      where (a.acked_at at time zone 'America/Los_Angeles')::date = bluesteel_la_today()),
    'la_now', to_char(now() at time zone 'America/Los_Angeles', 'ID HH24:MI')
  )
  from bluesteel_sweep_config c where c.id = 1
$$;

create or replace function public.bluesteel_sweep_send_alert(p_title text, p_body text)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ack constant text := 'https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/bluesteel-ack?k=tR4c_gX-TGd7_acCgz0cI_EA';
begin
  return net.http_post(
    url  := 'https://ntfy.sh',
    body := jsonb_build_object(
      'topic', 'bestly-sysalert-7q2k9mx4',
      'title', p_title,
      'message', p_body,
      'priority', 5,
      'tags', jsonb_build_array('rotating_light', 'blue_steel_sweep'),
      'click', v_ack || '&via=tap',
      'actions', jsonb_build_array(jsonb_build_object(
        'action', 'http', 'label', 'Moved it',
        'url', v_ack || '&via=button', 'method', 'POST', 'clear', true))
    )
  );
end $$;

create or replace function public.bluesteel_sweep_log_run(
  p_outcome text,
  p_side text default null,
  p_latitude double precision default null,
  p_longitude double precision default null,
  p_alert_title text default null,
  p_alert_body text default null,
  p_ntfy_request_id bigint default null,
  p_note text default null
)
returns bigint
language sql
security definer
set search_path to 'public'
as $$
  insert into bluesteel_sweep_runs (outcome, side, latitude, longitude, alert_title, alert_body, ntfy_request_id, note)
  values (p_outcome, p_side, p_latitude, p_longitude, p_alert_title, p_alert_body, p_ntfy_request_id, p_note)
  returning id
$$;

revoke all on function public.bluesteel_sweep_precheck() from public, anon, authenticated;
revoke all on function public.bluesteel_sweep_send_alert(text, text) from public, anon, authenticated;
revoke all on function public.bluesteel_sweep_log_run(text, text, double precision, double precision, text, text, bigint, text) from public, anon, authenticated;
grant execute on function public.bluesteel_sweep_precheck() to service_role;
grant execute on function public.bluesteel_sweep_send_alert(text, text) to service_role;
grant execute on function public.bluesteel_sweep_log_run(text, text, double precision, double precision, text, text, bigint, text) to service_role;

-- ---------------------------------------------------------------- admin RPCs
create or replace function public.admin_bluesteel_sweep_state()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
stable
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'config', (select to_jsonb(c) from bluesteel_sweep_config c where id = 1),
    'la_today', bluesteel_la_today(),
    'acked_today', exists(
      select 1 from bluesteel_sweep_acks a
      where (a.acked_at at time zone 'America/Los_Angeles')::date = bluesteel_la_today()),
    'last_location', (
      select to_jsonb(r) from (
        select ran_at, side, latitude, longitude, outcome
        from bluesteel_sweep_runs where latitude is not null
        order by ran_at desc limit 1) r),
    'runs', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.ran_at desc) from (
        select id, ran_at, outcome, side, latitude, longitude, alert_title, alert_body, note
        from bluesteel_sweep_runs order by ran_at desc limit 40) r), '[]'::jsonb),
    'acks', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.acked_at desc) from (
        select id, acked_at, via from bluesteel_sweep_acks order by acked_at desc limit 20) a), '[]'::jsonb)
  );
end $$;

create or replace function public.admin_bluesteel_sweep_set(
  p_alerts_enabled boolean default null,
  p_skip_dates date[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update bluesteel_sweep_config set
    alerts_enabled = coalesce(p_alerts_enabled, alerts_enabled),
    skip_dates = case
      when p_skip_dates is null then skip_dates
      else (select coalesce(array_agg(distinct d order by d), '{}') from unnest(p_skip_dates) d where d >= bluesteel_la_today())
    end,
    updated_at = now()
  where id = 1;
  return (select to_jsonb(c) from bluesteel_sweep_config c where id = 1);
end $$;

create or replace function public.admin_bluesteel_sweep_ack()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return public.bluesteel_sweep_ack('admin');
end $$;

create or replace function public.admin_bluesteel_sweep_test()
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id bigint;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin only' using errcode = '42501';
  end if;
  v_id := public.bluesteel_sweep_send_alert(
    'TEST - MOVE BLUE STEEL',
    'Test from bestly.tech/admin. Tap this or long-press and tap Moved it; you should get a Got it back.');
  perform public.bluesteel_sweep_log_run('test', null, null, null, 'TEST - MOVE BLUE STEEL', null, v_id, 'sent from admin');
  return v_id;
end $$;

revoke all on function public.admin_bluesteel_sweep_state() from public, anon;
revoke all on function public.admin_bluesteel_sweep_set(boolean, date[]) from public, anon;
revoke all on function public.admin_bluesteel_sweep_ack() from public, anon;
revoke all on function public.admin_bluesteel_sweep_test() from public, anon;
grant execute on function public.admin_bluesteel_sweep_state() to authenticated;
grant execute on function public.admin_bluesteel_sweep_set(boolean, date[]) to authenticated;
grant execute on function public.admin_bluesteel_sweep_ack() to authenticated;
grant execute on function public.admin_bluesteel_sweep_test() to authenticated;
