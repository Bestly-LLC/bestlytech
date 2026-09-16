-- Street sweeping: tapping a TEST alert must not silence that morning's real alerts.
--
-- Before: admin_bluesteel_sweep_test sent the test through bluesteel_sweep_send_alert with the same
-- ack links as a real alert (&via=tap / &via=button). Tapping it inserted a normal ack, and
-- acked_today (precheck + admin state) counted every ack on that LA date, so the scheduled checks
-- would log 'acknowledged' and send nothing. Seen live: test at 22:27:00 UTC, via=button ack 12s later.
--
-- After: test alerts carry &via=test-tap / &via=test-button (11 chars; bluesteel-ack keeps 20).
-- Acks whose via starts with 'test' are still recorded (the admin log shows them) but never count
-- toward acked_today, never post to the ack-record topic, and get their own confirmation push.
-- Every definition below is based on the live one as of 2026-09-16.

-- 1. send_alert gains p_test (default false). Two-arg calls from the scheduled tasks still resolve.
--    The old (text, text) overload has to go, or two-arg calls would be ambiguous.
drop function if exists public.bluesteel_sweep_send_alert(text, text);

create or replace function public.bluesteel_sweep_send_alert(p_title text, p_body text, p_test boolean default false)
returns bigint
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ack text := 'https://rcqfqhguwpmaarseifqg.supabase.co/functions/v1/bluesteel-ack?k=' || public.bluesteel_ack_key();
  v_prefix text := case when coalesce(p_test, false) then 'test-' else '' end;
begin
  return net.http_post(
    url  := 'https://ntfy.sh',
    body := jsonb_build_object(
      'topic', 'bestly-sysalert-7q2k9mx4',
      'title', p_title,
      'message', p_body,
      'priority', 5,
      'tags', jsonb_build_array('rotating_light', 'blue_steel_sweep'),
      'click', v_ack || '&via=' || v_prefix || 'tap',
      'actions', jsonb_build_array(jsonb_build_object(
        'action', 'http', 'label', 'Moved it',
        'url', v_ack || '&via=' || v_prefix || 'button', 'method', 'POST', 'clear', true))
    )
  );
end $$;
revoke all on function public.bluesteel_sweep_send_alert(text, text, boolean) from public, anon, authenticated;
grant execute on function public.bluesteel_sweep_send_alert(text, text, boolean) to service_role;

-- 2. The admin test sends with p_test => true.
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
    'Test from bestly.tech/admin. Tap this or long-press and tap Moved it; you should get a Got it back.',
    true);
  perform public.bluesteel_sweep_log_run('test', null, null, null, 'TEST - MOVE BLUE STEEL', null, v_id, 'sent from admin');
  return v_id;
end $$;

-- 3. Acks: a test ack is logged and confirmed as a test, and does nothing else.
create or replace function public.bluesteel_sweep_ack(p_via text default 'tap'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_via text := left(coalesce(p_via, 'tap'), 20);
  v_test boolean := left(coalesce(p_via, 'tap'), 20) like 'test%';
  v_recent boolean;
begin
  -- "recent" only looks at acks of the same kind, so a test tap can't swallow a real confirmation
  select exists(
    select 1 from bluesteel_sweep_acks
    where acked_at > now() - interval '2 minutes'
      and (coalesce(via, '') like 'test%') = v_test) into v_recent;
  insert into bluesteel_sweep_acks (via) values (v_via);

  if v_test then
    if not v_recent then
      perform net.http_post(
        url  := 'https://ntfy.sh',
        body := jsonb_build_object(
          'topic','bestly-sysalert-7q2k9mx4',
          'title','Got it: test acknowledged',
          'message','The test worked. Real sweeping alerts are not affected.',
          'priority',3,
          'tags',jsonb_build_array('white_check_mark'))
      );
    end if;
    return jsonb_build_object('ok', true, 'test', true, 'confirmation_sent', not v_recent);
  end if;

  -- record the ack where the scheduled alert task looks for it
  perform net.http_post(
    url  := 'https://ntfy.sh',
    body := jsonb_build_object('topic','bluesteel-ack-qx59qnmegm','message','ack-' || v_via)
  );

  -- one confirmation push per burst of taps
  if not v_recent then
    perform net.http_post(
      url  := 'https://ntfy.sh',
      body := jsonb_build_object(
        'topic','bestly-sysalert-7q2k9mx4',
        'title','Got it: sweeping alerts off',
        'message','No more Blue Steel alerts this morning. They start again next sweeping day.',
        'priority',3,
        'tags',jsonb_build_array('white_check_mark'))
    );
  end if;
  return jsonb_build_object('ok', true, 'confirmation_sent', not v_recent);
end $$;

-- 4. acked_today ignores test acks: in the precheck the scheduled tasks read...
create or replace function public.bluesteel_sweep_precheck()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'alerts_enabled', c.alerts_enabled,
    'skipped_today', bluesteel_la_today() = any(c.skip_dates),
    'acked_today', exists(
      select 1 from bluesteel_sweep_acks a
      where (a.acked_at at time zone 'America/Los_Angeles')::date = bluesteel_la_today()
        and coalesce(a.via, '') not like 'test%'),
    'la_now', to_char(now() at time zone 'America/Los_Angeles', 'ID HH24:MI')
  )
  from bluesteel_sweep_config c where c.id = 1
$$;

-- ...and in the admin page's state.
create or replace function public.admin_bluesteel_sweep_state()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
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
      where (a.acked_at at time zone 'America/Los_Angeles')::date = bluesteel_la_today()
        and coalesce(a.via, '') not like 'test%'),
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

-- create or replace keeps existing grants; restate the live ones so a fresh database matches.
revoke all on function public.bluesteel_sweep_ack(text) from public, anon, authenticated;
grant execute on function public.bluesteel_sweep_ack(text) to service_role;
revoke all on function public.bluesteel_sweep_precheck() from public, anon, authenticated;
grant execute on function public.bluesteel_sweep_precheck() to service_role;
revoke all on function public.admin_bluesteel_sweep_state() from public, anon;
grant execute on function public.admin_bluesteel_sweep_state() to authenticated, service_role;
revoke all on function public.admin_bluesteel_sweep_test() from public, anon;
grant execute on function public.admin_bluesteel_sweep_test() to authenticated, service_role;
