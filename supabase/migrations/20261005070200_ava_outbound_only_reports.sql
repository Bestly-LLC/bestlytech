-- Ava answers both lines, part 3 (Spark, 2026-10-04): RoofGuard reports count outbound dialer calls only.
-- Incoming calls and call-backs are tracked separately (rg_calls.direction).

-- 2. RoofGuard reports count outbound dialer calls only (incoming calls and call-backs are tracked separately) -------
create or replace function public.rg_ava_calls()
 returns table(id uuid, at timestamp with time zone, wk date, day date, connected boolean, dm boolean, pitched boolean, booked boolean, outcome text, duration_sec integer, transcript jsonb)
 language sql stable security definer set search_path to 'public'
as $function$
  select c.id, c.queued_at,
         date_trunc('week', c.queued_at at time zone 'America/Los_Angeles')::date,
         (c.queued_at at time zone 'America/Los_Angeles')::date,
         (c.status = 'completed' and c.outcome is not null and c.outcome not in ('voicemail_left', 'no_answer')),
         (coalesce(c.dm_reached, false) or c.outcome = 'booked'),
         (coalesce(c.kept_talking, false) or c.outcome = 'booked'),
         (c.outcome = 'booked'),
         c.outcome, c.duration_sec, c.transcript
    from rg_calls c
   where not c.is_test and c.deleted_at is null and c.direction = 'outbound'
     and c.lead_id is distinct from (select demo_lead_id from rg_settings where id)
     and c.lead_id is distinct from (select personal_lead_id from rg_settings where id)
$function$;

create or replace function public.rg_call_board(p_limit integer DEFAULT 100)
 returns table(call_id uuid, lead_id uuid, company text, state text, timezone text, stage text, outcome text, summary text, notes text, meeting_times text, meeting_email text, callback_at timestamp with time zone, dm_name text, dm_title text, opener_key text, duration_sec integer, ended_at timestamp with time zone, attempt integer, calls integer, is_test boolean, to_number text, has_transcript boolean)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return query
  with s as (select * from rg_settings where id),
  latest as (
    select distinct on (c.lead_id, c.is_test) c.*,
           count(*) over (partition by c.lead_id, c.is_test) as n
      from rg_calls c
     where c.status not in ('queued', 'in_progress') and c.moved_to_ava_at is null and c.deleted_at is null and c.direction = 'outbound'
     order by c.lead_id, c.is_test, coalesce(c.ended_at, c.queued_at) desc
  )
  select x.id, x.lead_id, l.company, l.state, l.timezone,
         case when x.is_test then rg_stage(x.outcome, null, 0, s.max_attempts)
              else rg_stage(x.outcome, l.call_status, l.call_attempts, s.max_attempts) end,
         x.outcome, x.summary, x.notes, x.meeting_times, x.meeting_email, x.callback_at,
         x.dm_name, x.dm_title, x.opener_key, x.duration_sec, coalesce(x.ended_at, x.queued_at),
         x.attempt, x.n::int, x.is_test, x.to_number, (x.transcript is not null)
    from latest x join rg_leads l on l.id = x.lead_id, s
   order by coalesce(x.ended_at, x.queued_at) desc
   limit greatest(1, least(p_limit, 500));
end $function$;

create or replace function public.rg_call_stats()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'admin only'; end if;
  return jsonb_build_object(
    'settings',     (select to_jsonb(s) - 'id' from rg_settings s where id),
    'keys',         rg_secret_status(),
    'unverified',   (select count(*) from rg_leads where phone is not null and line_type = 'unverified'),
    'dialable',     (select count(*) from rg_leads where phone is not null and line_type in ('landline','voip') and not dnc),
    'mobile',       (select count(*) from rg_leads where line_type = 'mobile'),
    'calls_total',  (select count(*) from rg_calls where not is_test and direction = 'outbound'),
    'test_calls',   (select count(*) from rg_calls where is_test and moved_to_ava_at is null and deleted_at is null),
    'calls_24h',    (select count(*) from rg_calls where queued_at > now() - interval '24 hours' and not is_test and direction = 'outbound'),
    'by_outcome',   (select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb) from (select outcome, count(*) n from rg_calls where outcome is not null and not is_test and direction = 'outbound' group by 1) o),
    'booked',       (select count(*) from rg_leads where call_status = 'booked'),
    'callbacks_due',(select count(*) from rg_leads where next_call_at is not null and call_status = 'callback_set'),
    'dnc',          (select count(*) from rg_dnc),
    'openers',      (select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object('script', r.script)), '[]'::jsonb)
                       from rg_opener_scores() o join rg_openers r on r.key = o.key),
    'open_issue',   (select to_jsonb(i) from (select key, title, body, opened_at from monitor_issues where key = 'roofguard.caller' and status = 'open') i)
  );
end $function$;

create or replace function public.rg_next_call_batch(p_limit integer DEFAULT 10)
 returns table(lead_id uuid, company text, phone text, timezone text, contact_name text, contact_title text, pitch_angle text, category text, state text, attempt integer)
 language sql stable security definer set search_path to 'public'
as $function$
  with s as (select * from rg_settings where id),
  today as (select count(*) n from rg_calls where queued_at > now() - interval '24 hours' and not is_test and direction = 'outbound'),
  ever as (select count(distinct lead_id) n from rg_calls where not is_test and direction = 'outbound')
  select l.id, l.company, l.phone, l.timezone, l.contacts->0->>'name', l.contacts->0->>'title',
         l.pitch, l.category, l.state, l.call_attempts + 1
    from rg_leads l, s, today, ever
   where s.calling_enabled
     and l.phone is not null
     and l.line_type in ('landline','voip')
     and not l.dnc
     and not exists (select 1 from rg_dnc d where d.phone = l.phone)
     and l.call_status not in ('booked','not_interested','do_not_call','wrong_number','in_progress')
     and l.call_attempts < s.max_attempts
     and case when l.next_call_at is not null then now() >= l.next_call_at - interval '10 minutes'
              else (l.last_called_at is null or rg_business_days_between(l.last_called_at, now(), l.timezone) >= s.min_gap_bdays) end
     and extract(isodow from (now() at time zone l.timezone)) < 6
     and extract(hour from (now() at time zone l.timezone)) >= s.window_start_hour
     and extract(hour from (now() at time zone l.timezone)) <  s.window_end_hour
     and not exists (select 1 from rg_holidays h where h.day = (now() at time zone l.timezone)::date)
     and today.n < s.daily_cap
     and (s.pilot_limit is null or ever.n < s.pilot_limit or exists (select 1 from rg_calls c where c.lead_id = l.id and not c.is_test and c.direction = 'outbound'))
   order by (l.next_call_at is not null) desc, l.next_call_at, l.priority desc
   limit greatest(0, least(p_limit, (select daily_cap from s) - (select n from today)));
$function$;

create or replace function public.rg_opener_scores()
 returns table(key text, label text, active boolean, calls integer, reached integer, kept_talking integer, booked integer, book_rate numeric, score numeric)
 language sql stable security definer set search_path to 'public'
as $function$
  select o.key, o.label, o.active,
         count(c.id)::int,
         count(c.id) filter (where c.dm_reached)::int,
         count(c.id) filter (where c.dm_reached and c.kept_talking)::int,
         count(c.id) filter (where c.outcome = 'booked')::int,
         round(100.0 * count(c.id) filter (where c.outcome = 'booked') / nullif(count(c.id) filter (where c.dm_reached), 0), 1),
         (count(c.id) filter (where c.outcome = 'booked') + 1.0) / (count(c.id) filter (where c.dm_reached) + 2.0)
    from rg_openers o left join rg_calls c on c.opener_key = o.key and not c.is_test and c.direction = 'outbound'
   where o.audience = 'decision_maker'
   group by o.key, o.label, o.active
   order by o.key;
$function$;

create or replace function public.rg_daily_report()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  r record;
  v_body text;
begin
  select count(*) filter (where not is_test) calls,
         count(*) filter (where not is_test and dm_reached) reached,
         count(*) filter (where not is_test and outcome = 'booked') booked,
         count(*) filter (where not is_test and outcome = 'callback_set') callbacks,
         count(*) filter (where not is_test and outcome = 'voicemail_left') voicemails,
         count(*) filter (where not is_test and outcome = 'do_not_call') dnc
    into r from rg_calls where queued_at > now() - interval '24 hours' and direction = 'outbound';
  if r.calls = 0 then return jsonb_build_object('sent', false, 'reason', 'no calls today'); end if;
  v_body := format('%s calls, %s reached a decision maker, %s meetings booked, %s callbacks set, %s voicemails, %s asked not to be called.',
                   r.calls, r.reached, r.booked, r.callbacks, r.voicemails, r.dnc);
  perform scout_notify('RoofGuard today: ' || r.booked || ' booked', v_body, 'info', r.booked > 0, '/admin/roofguard',
                       'roofguard-daily-' || to_char(now() at time zone 'America/Los_Angeles', 'YYYY-MM-DD'));
  return jsonb_build_object('sent', true, 'body', v_body);
end $function$;

create or replace function public.rg_watch_calls()
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  s rg_settings;
  v_stuck int;
  v_eligible int;
  v_last timestamptz;
begin
  select * into s from rg_settings where id;
  with stuck as (
    update rg_calls set status = 'failed', notes = coalesce(notes || ' ', '') || '[watchdog: no webhook after 30 min]'
     where status in ('queued','in_progress') and queued_at < now() - interval '30 minutes'
    returning lead_id)
  select count(*) into v_stuck from stuck;
  update rg_leads set call_status = 'attempted'
   where call_status = 'in_progress' and id not in (select lead_id from rg_calls where status in ('queued','in_progress'));

  if not s.calling_enabled then
    perform bestly_raise('roofguard.caller', 'resolved', 'info', 'RoofGuard caller: off', null, 'roofguard');
    return jsonb_build_object('enabled', false, 'stuck_fixed', v_stuck);
  end if;

  select count(*) into v_eligible from rg_next_call_batch(50);
  select max(queued_at) into v_last from rg_calls where direction = 'outbound';

  if v_eligible > 0 and (v_last is null or v_last < now() - interval '45 minutes') then
    perform bestly_raise('roofguard.caller', 'problem', 'warning', 'RoofGuard caller stalled',
      format('%s leads are ready to dial inside their calling window, but no call went out in 45 min.', v_eligible),
      'roofguard', null, false);
  elsif v_stuck >= 3 then
    perform bestly_raise('roofguard.caller', 'problem', 'warning', 'RoofGuard calls not reporting back',
      format('%s calls never got a post-call webhook. Watchdog closed them; check the webhook in ElevenLabs.', v_stuck),
      'roofguard', null, true);
  else
    perform bestly_raise('roofguard.caller', 'resolved', 'info', 'RoofGuard caller healthy again', null, 'roofguard');
  end if;
  return jsonb_build_object('enabled', true, 'eligible_now', v_eligible, 'stuck_fixed', v_stuck, 'last_call', v_last);
end $function$;

