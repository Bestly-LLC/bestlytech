-- Jared, 2026-10-04: delete a call from the call sheet, on both Ava pages (personal and RoofGuard).
-- Soft delete: the row gets deleted_at and drops out of every list and the scorecard.
-- Spend still counts it, because that money was really spent.

alter table public.rg_calls add column if not exists deleted_at timestamptz;
alter table public.ava_calls add column if not exists deleted_at timestamptz;

create or replace function public.rg_delete_call(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  update rg_calls set deleted_at = now() where id = p_id and deleted_at is null;
end $function$;

create or replace function public.ava_delete_call(p_id uuid)
 returns void language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  update ava_calls set deleted_at = now() where id = p_id and deleted_at is null;
end $function$;

revoke all on function public.rg_delete_call(uuid) from public, anon;
revoke all on function public.ava_delete_call(uuid) from public, anon;
grant execute on function public.rg_delete_call(uuid) to authenticated;
grant execute on function public.ava_delete_call(uuid) to authenticated;

-- scorecard ignores deleted calls
create or replace function public.rg_ava_calls()
 returns table(id uuid, at timestamptz, wk date, day date, connected boolean, dm boolean, pitched boolean, booked boolean, outcome text, duration_sec integer, transcript jsonb)
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
   where not c.is_test and c.deleted_at is null
     and c.lead_id is distinct from (select demo_lead_id from rg_settings where id)
     and c.lead_id is distinct from (select personal_lead_id from rg_settings where id)
$function$;

-- unread count ignores deleted messages
create or replace function public.ava_costs()
 returns jsonb language sql stable security definer set search_path to 'public'
as $function$
  select case when not public.has_role(auth.uid(), 'admin') then null else jsonb_build_object(
    'total', round(coalesce(sum(coalesce(c.duration_sec, 0) / 60.0 * s.cost_voice_per_min + ceil(coalesce(c.duration_sec, 0) / 60.0) * s.cost_phone_per_min + coalesce(c.llm_cost, 0)), 0)
                   + 1.00 * (1 + extract(month from age(now(), date '2026-10-04'))::int + 12 * extract(year from age(now(), date '2026-10-04'))::int), 2),
    'month', round(coalesce(sum(coalesce(c.duration_sec, 0) / 60.0 * s.cost_voice_per_min + ceil(coalesce(c.duration_sec, 0) / 60.0) * s.cost_phone_per_min + coalesce(c.llm_cost, 0))
                   filter (where date_trunc('month', c.created_at) = date_trunc('month', now())), 0), 2),
    'minutes', round(coalesce(sum(c.duration_sec), 0) / 60.0, 1), 'calls', count(c.id) filter (where c.deleted_at is null),
    'unread', count(c.id) filter (where c.message is not null and c.read_at is null and c.deleted_at is null)) end
  from ava_settings s left join ava_calls c on true
  group by s.cost_voice_per_min, s.cost_phone_per_min
$function$;

create or replace function public.rg_call_board(p_limit integer default 100)
 returns table(call_id uuid, lead_id uuid, company text, state text, timezone text, stage text, outcome text, summary text, notes text, meeting_times text, meeting_email text, callback_at timestamptz, dm_name text, dm_title text, opener_key text, duration_sec integer, ended_at timestamptz, attempt integer, calls integer, is_test boolean, to_number text, has_transcript boolean)
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
     where c.status not in ('queued', 'in_progress') and c.moved_to_ava_at is null and c.deleted_at is null
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

create or replace function public.rg_lead_calls(p_lead uuid)
 returns table(call_id uuid, outcome text, summary text, notes text, meeting_times text, meeting_email text, callback_at timestamptz, dm_name text, dm_title text, opener_key text, duration_sec integer, ended_at timestamptz, attempt integer, is_test boolean, transcript jsonb)
 language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.has_role(auth.uid(), 'admin') then raise exception 'Admins only'; end if;
  return query
  select c.id, c.outcome, c.summary, c.notes, c.meeting_times, c.meeting_email, c.callback_at, c.dm_name, c.dm_title,
         c.opener_key, c.duration_sec, coalesce(c.ended_at, c.queued_at), c.attempt, c.is_test,
         (select coalesce(jsonb_agg(jsonb_build_object('role', t->>'role', 'text', t->>'message',
                                                       't', (t->>'time_in_call_secs')::int) order by ord), '[]'::jsonb)
            from jsonb_array_elements(coalesce(c.transcript, '[]'::jsonb)) with ordinality as e(t, ord)
           where coalesce(t->>'message', '') <> '')
    from rg_calls c
   where c.lead_id = p_lead and c.status not in ('queued', 'in_progress') and c.moved_to_ava_at is null and c.deleted_at is null
   order by coalesce(c.ended_at, c.queued_at) desc;
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
    'calls_total',  (select count(*) from rg_calls where not is_test),
    'test_calls',   (select count(*) from rg_calls where is_test and moved_to_ava_at is null and deleted_at is null),
    'calls_24h',    (select count(*) from rg_calls where queued_at > now() - interval '24 hours' and not is_test),
    'by_outcome',   (select coalesce(jsonb_object_agg(outcome, n), '{}'::jsonb) from (select outcome, count(*) n from rg_calls where outcome is not null and not is_test group by 1) o),
    'booked',       (select count(*) from rg_leads where call_status = 'booked'),
    'callbacks_due',(select count(*) from rg_leads where next_call_at is not null and call_status = 'callback_set'),
    'dnc',          (select count(*) from rg_dnc),
    'openers',      (select coalesce(jsonb_agg(to_jsonb(o) || jsonb_build_object('script', r.script)), '[]'::jsonb)
                       from rg_opener_scores() o join rg_openers r on r.key = o.key),
    'open_issue',   (select to_jsonb(i) from (select key, title, body, opened_at from monitor_issues where key = 'roofguard.caller' and status = 'open') i)
  );
end $function$;
